import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  getFfmpegBinary,
  isAnimatedGif,
  renderAnimatedStickerWebp,
  renderMp4,
  renderOpusAudio,
  renderWebp
} from "../server/media.js";
import { inspectWebp, readStickerMetadata } from "../server/webp.js";

const execFileAsync = promisify(execFile);

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createTestPng(width: number, height: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowStride = 1 + width * 4;
  const raw = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowStride;
    raw[rowStart] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 4;
      raw[p] = (x * 255) / width;
      raw[p + 1] = (y * 255) / height;
      raw[p + 2] = 180;
      raw[p + 3] = x < width / 2 ? 255 : 0; // half transparent
    }
  }

  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    signature,
    makePngChunk("IHDR", ihdr),
    makePngChunk("IDAT", idat),
    makePngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createTestWav(durationSec: number, sampleRate = 44100): Buffer {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.4;
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  return buf;
}

function createSyntheticGif(frameCount: 1 | 2): Buffer {
  const header = Buffer.from("GIF89a", "ascii");
  // Logical screen descriptor: 2x2, no GCT
  const lsd = Buffer.from([0x02, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00]);
  const frame = Buffer.from([
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00, // Image descriptor
    0x02, // LZW min code size
    0x02, 0x4c, 0x01, // 2-byte sub-block
    0x00 // block terminator
  ]);
  const trailer = Buffer.from([0x3b]);
  return frameCount === 1
    ? Buffer.concat([header, lsd, frame, trailer])
    : Buffer.concat([header, lsd, frame, frame, trailer]);
}

async function inspectMediaWithFfmpeg(fileBytes: Buffer, ext: string): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zapsom-test-"));
  const target = path.join(tmpDir, `check${ext}`);
  await fs.writeFile(target, fileBytes);
  try {
    await execFileAsync(getFfmpegBinary(), ["-hide_banner", "-i", target], {
      windowsHide: true
    });
    return "";
  } catch (err: unknown) {
    return typeof err === "object" && err !== null && "stderr" in err
      ? String((err as { stderr?: unknown }).stderr ?? "")
      : "";
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("ZapSom media pipeline", () => {
  it("detects static vs animated GIFs", () => {
    expect(isAnimatedGif(createSyntheticGif(1))).toBe(false);
    expect(isAnimatedGif(createSyntheticGif(2))).toBe(true);
    expect(isAnimatedGif(Buffer.from("not a gif"))).toBe(false);
  });

  it("renders a 512x512 H.264 + AAC MP4 in cover mode with exact duration", async () => {
    const png = createTestPng(640, 480);
    const wav = createTestWav(3.0);

    const mp4 = await renderMp4({
      imageBytes: png,
      imageName: "meme.png",
      audioBytes: wav,
      audioName: "som.wav",
      startSec: 0.5,
      durationSec: 1.5,
      cropX: 0.5,
      cropY: 0.5,
      fitMode: "cover",
      matteColor: "#0B141A"
    });

    expect(mp4.length).toBeGreaterThan(1000);
    expect(mp4.subarray(4, 8).toString("ascii")).toBe("ftyp");

    const stderr = await inspectMediaWithFfmpeg(mp4, ".mp4");
    expect(stderr).toContain("512x512");
    expect(stderr).toContain("h264");
    expect(stderr).toContain("aac");

    const durMatch = stderr.match(/Duration:\s*00:00:(\d+\.\d+)/);
    expect(durMatch).not.toBeNull();
    const actualDur = Number(durMatch![1]);
    expect(Math.abs(actualDur - 1.5)).toBeLessThanOrEqual(0.15);
  });

  it("renders a valid MP4 in contain mode", async () => {
    const png = createTestPng(640, 480);
    const wav = createTestWav(2.0);

    const mp4 = await renderMp4({
      imageBytes: png,
      imageName: "meme.png",
      audioBytes: wav,
      audioName: "som.wav",
      startSec: 0,
      durationSec: 1.2,
      cropX: 0.5,
      cropY: 0.5,
      fitMode: "contain",
      matteColor: "#FFFFFF"
    });

    expect(mp4.subarray(4, 8).toString("ascii")).toBe("ftyp");
    const stderr = await inspectMediaWithFfmpeg(mp4, ".mp4");
    expect(stderr).toContain("512x512");
  });

  it("renders a 512x512 static WebP under 100 KB", async () => {
    const png = createTestPng(640, 480);
    const webp = await renderWebp({
      imageBytes: png,
      imageName: "meme.png",
      cropX: 0.5,
      cropY: 0.5,
      fitMode: "cover"
    });

    expect(webp.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(webp.subarray(8, 12).toString("ascii")).toBe("WEBP");
    expect(webp.length).toBeLessThanOrEqual(102_400);
  });

  it("renders a 512x512 animated WebP with EXIF metadata under 500 KB from a static PNG", async () => {
    const png = createTestPng(640, 480);
    const { webp, animated } = await renderAnimatedStickerWebp({
      imageBytes: png,
      imageName: "meme.png",
      durationSec: 2.0,
      cropX: 0.5,
      cropY: 0.5,
      fitMode: "contain",
      packName: "ZapSom - Faeudev"
    });

    expect(animated).toBe(true);
    expect(webp.length).toBeLessThanOrEqual(500_000);
    const info = inspectWebp(webp);
    expect(info.width).toBe(512);
    expect(info.height).toBe(512);
    expect(info.animated).toBe(true);
    expect(info.frames).toBeGreaterThanOrEqual(2);

    const meta = readStickerMetadata(webp);
    expect(meta?.["sticker-pack-name"]).toBe("ZapSom - Faeudev");
  });

  it("renders trimmed Ogg/Opus mono 48kHz audio under 256 KB", async () => {
    const wav = createTestWav(3.0);
    const { audio, durationMs } = await renderOpusAudio({
      audioBytes: wav,
      audioName: "som.wav",
      startSec: 0.5,
      durationSec: 1.5
    });

    expect(audio.subarray(0, 4).toString("ascii")).toBe("OggS");
    expect(audio.length).toBeLessThanOrEqual(256_000);
    expect(durationMs).toBe(1500);

    const stderr = await inspectMediaWithFfmpeg(audio, ".ogg");
    expect(stderr).toContain("opus");
    const durMatch = stderr.match(/Duration:\s*00:00:(\d+\.\d+)/);
    expect(durMatch).not.toBeNull();
    expect(Math.abs(Number(durMatch![1]) - 1.5)).toBeLessThanOrEqual(0.2);
  });
});
