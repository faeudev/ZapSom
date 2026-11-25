import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { addStickerMetadata, inspectWebp } from "./webp.js";

const execFileAsync = promisify(execFile);

export type FitMode = "cover" | "contain";

export interface RenderMp4Options {
  imageBytes: Buffer;
  imageName: string;
  imageMime?: string;
  audioBytes: Buffer;
  audioName: string;
  startSec: number;
  durationSec: number;
  cropX: number;
  cropY: number;
  fitMode: FitMode;
  matteColor: string;
}

export interface RenderWebpOptions {
  imageBytes: Buffer;
  imageName: string;
  imageMime?: string;
  cropX: number;
  cropY: number;
  fitMode: FitMode;
  packName?: string;
  publisher?: string;
}

export interface RenderAnimatedStickerOptions {
  imageBytes: Buffer;
  imageName: string;
  imageMime?: string;
  durationSec: number;
  cropX: number;
  cropY: number;
  fitMode: FitMode;
  packName?: string;
  publisher?: string;
}

export interface RenderOpusAudioOptions {
  audioBytes: Buffer;
  audioName: string;
  startSec: number;
  durationSec: number;
}

const MAX_STATIC_WEBP_BYTES = 102_400; // 100 KB WhatsApp static sticker limit
const MAX_ANIMATED_WEBP_BYTES = 500_000; // 500 KB WhatsApp animated sticker limit
const MAX_AUDIO_OGG_BYTES = 256_000;

export function getFfmpegBinary(): string {
  if (!ffmpegPath) {
    throw new Error("Binário do ffmpeg-static não encontrado nesta plataforma.");
  }
  return ffmpegPath;
}

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

export function normalizeMatteColor(color: string | undefined): string {
  if (color && /^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
    return color.trim().toUpperCase();
  }
  return "#FFFFFF";
}

function safeExt(name: string, fallback: string): string {
  const ext = path.extname(name || "").toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext.length >= 2 && ext.length <= 6 ? ext : fallback;
}

/**
 * Parses GIF87a/GIF89a byte structure to distinguish single-frame static GIFs
 * from multi-frame animated GIFs without invoking an external process.
 */
export function isAnimatedGif(buf: Buffer): boolean {
  if (buf.length < 14) return false;
  const header = buf.subarray(0, 6).toString("ascii");
  if (header !== "GIF87a" && header !== "GIF89a") return false;

  let pos = 13;
  const packed = buf[10]!;
  if ((packed & 0x80) !== 0) {
    const gctSize = 3 * (1 << ((packed & 0x07) + 1));
    pos += gctSize;
  }

  let frameCount = 0;

  const skipSubBlocks = () => {
    while (pos < buf.length) {
      const size = buf[pos++]!;
      if (size === 0) break;
      pos += size;
    }
  };

  while (pos < buf.length) {
    const introducer = buf[pos++]!;
    if (introducer === 0x3b) {
      break;
    }
    if (introducer === 0x21) {
      if (pos >= buf.length) break;
      pos++; // extension label
      skipSubBlocks();
      continue;
    }
    if (introducer === 0x2c) {
      frameCount++;
      if (frameCount >= 2) return true;
      if (pos + 9 > buf.length) break;
      const imgPacked = buf[pos + 8]!;
      pos += 9;
      if ((imgPacked & 0x80) !== 0) {
        const lctSize = 3 * (1 << ((imgPacked & 0x07) + 1));
        pos += lctSize;
      }
      if (pos >= buf.length) break;
      pos++; // LZW minimum code size
      skipSubBlocks();
      continue;
    }
    break;
  }

  return false;
}

function isVideoInput(buf: Buffer, name: string, mime?: string): boolean {
  const lowerMime = (mime || "").toLowerCase();
  const ext = path.extname(name || "").toLowerCase();
  if (lowerMime.startsWith("video/")) return true;
  if ([".mp4", ".mov", ".m4v", ".webm"].includes(ext)) return true;
  // ISO BMFF (ftyp) or EBML (WebM)
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") return true;
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return true;
  }
  return false;
}

async function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const bin = getFfmpegBinary();
  return execFileAsync(bin, args, {
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000
  });
}

export async function probeAudioDurationFromFile(filePath: string): Promise<number> {
  const bin = getFfmpegBinary();
  try {
    await execFileAsync(bin, ["-hide_banner", "-i", filePath], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 15_000
    });
    throw new Error("Não foi possível ler a duração do áudio.");
  } catch (err: unknown) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) {
      throw new Error("Arquivo de áudio inválido ou sem faixa de áudio reconhecível.");
    }
    const hours = Number(match[1]);
    const mins = Number(match[2]);
    const secs = Number(match[3]);
    const total = hours * 3600 + mins * 60 + secs;
    if (!Number.isFinite(total) || total <= 0) {
      throw new Error("A duração do áudio é zero ou inválida.");
    }
    return total;
  }
}

export async function probeAudioDurationFromBytes(
  audioBytes: Buffer,
  audioName: string
): Promise<number> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zapsom-probe-"));
  try {
    const audioPath = path.join(tmpDir, `input${safeExt(audioName, ".mp3")}`);
    await fs.writeFile(audioPath, audioBytes);
    return await probeAudioDurationFromFile(audioPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function renderMp4(opts: RenderMp4Options): Promise<Buffer> {
  const ffmpeg = getFfmpegBinary();
  const startSec = Math.max(0, Number.isFinite(opts.startSec) ? opts.startSec : 0);
  const durationSec = clamp(opts.durationSec, 0.1, 10.0);
  const cropX = clamp(opts.cropX, 0, 1);
  const cropY = clamp(opts.cropY, 0, 1);
  const fitMode: FitMode = opts.fitMode === "contain" ? "contain" : "cover";
  const matteHex = normalizeMatteColor(opts.matteColor).slice(1);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zapsom-mp4-"));
  try {
    const imgExt = safeExt(opts.imageName, ".png");
    const audExt = safeExt(opts.audioName, ".mp3");
    const imagePath = path.join(tmpDir, `visual${imgExt}`);
    const audioPath = path.join(tmpDir, `audio${audExt}`);
    const outputPath = path.join(tmpDir, "output.mp4");

    await Promise.all([
      fs.writeFile(imagePath, opts.imageBytes),
      fs.writeFile(audioPath, opts.audioBytes)
    ]);

    const visualInputArgs: string[] = [];
    if (isVideoInput(opts.imageBytes, opts.imageName, opts.imageMime)) {
      visualInputArgs.push("-stream_loop", "-1", "-i", imagePath);
    } else if (isAnimatedGif(opts.imageBytes)) {
      visualInputArgs.push("-ignore_loop", "0", "-i", imagePath);
    } else {
      visualInputArgs.push("-loop", "1", "-framerate", "30", "-i", imagePath);
    }

    const visualFilter =
      fitMode === "cover"
        ? `color=c=0x${matteHex}:s=512x512:r=30[bg];[0:v]format=rgba,crop=w='min(iw,ih)':h='min(iw,ih)':x='(iw-min(iw,ih))*${cropX.toFixed(4)}':y='(ih-min(iw,ih))*${cropY.toFixed(4)}',scale=512:512:flags=lanczos[fg];[bg][fg]overlay=0:0:shortest=0,format=yuv420p[vout]`
        : `color=c=0x${matteHex}:s=512x512:r=30[bg];[0:v]format=rgba,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=0,format=yuv420p[vout]`;

    const audioFilter = `[1:a]atrim=start=${startSec.toFixed(3)}:duration=${durationSec.toFixed(3)},asetpts=PTS-STARTPTS[aout]`;
    const filterComplex = `${visualFilter};${audioFilter}`;

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      ...visualInputArgs,
      "-i",
      audioPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-t",
      durationSec.toFixed(3),
      "-c:v",
      "libx264",
      "-profile:v",
      "baseline",
      "-level",
      "3.1",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-y",
      outputPath
    ];

    await execFileAsync(ffmpeg, args, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000
    });

    const outBytes = await fs.readFile(outputPath);
    if (outBytes.length === 0) {
      throw new Error("O arquivo MP4 gerado ficou vazio.");
    }
    return outBytes;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function renderWebp(opts: RenderWebpOptions): Promise<Buffer> {
  const cropX = clamp(opts.cropX, 0, 1);
  const cropY = clamp(opts.cropY, 0, 1);
  const fitMode: FitMode = opts.fitMode === "contain" ? "contain" : "cover";

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zapsom-webp-"));
  try {
    const imgExt = safeExt(opts.imageName, ".png");
    const imagePath = path.join(tmpDir, `visual${imgExt}`);
    const outputPath = path.join(tmpDir, "sticker.webp");

    await fs.writeFile(imagePath, opts.imageBytes);

    const vf =
      fitMode === "cover"
        ? `format=rgba,crop=w='min(iw,ih)':h='min(iw,ih)':x='(iw-min(iw,ih))*${cropX.toFixed(4)}':y='(ih-min(iw,ih))*${cropY.toFixed(4)}',scale=512:512:flags=lanczos`
        : `format=rgba,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;

    const qualities = [85, 72, 60, 48, 35, 22];
    let lastBytes: Buffer | null = null;

    for (const q of qualities) {
      await runFfmpeg([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        imagePath,
        "-vf",
        vf,
        "-c:v",
        "libwebp",
        "-lossless",
        "0",
        "-quality",
        String(q),
        "-frames:v",
        "1",
        "-y",
        outputPath
      ]);
      const rawBuf = await fs.readFile(outputPath);
      const buf = opts.packName
        ? addStickerMetadata(rawBuf, {
            packName: opts.packName,
            publisher: opts.publisher ?? ""
          })
        : rawBuf;
      lastBytes = buf;
      if (buf.length <= MAX_STATIC_WEBP_BYTES) {
        return buf;
      }
    }

    if (!lastBytes || lastBytes.length === 0) {
      throw new Error("Não foi possível gerar a figurinha WebP.");
    }
    return lastBytes;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function renderAnimatedStickerWebp(
  opts: RenderAnimatedStickerOptions
): Promise<{ webp: Buffer; durationMs: number; animated: boolean }> {
  const durationSec = clamp(opts.durationSec, 0.2, 10.0);
  const cropX = clamp(opts.cropX, 0, 1);
  const cropY = clamp(opts.cropY, 0, 1);
  const fitMode: FitMode = opts.fitMode === "contain" ? "contain" : "cover";
  const packName = (opts.packName ?? "").trim() || "ZapSom - Faeudev";
  const publisher = (opts.publisher ?? "").trim();

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zapsom-animwebp-"));
  try {
    const imgExt = safeExt(opts.imageName, ".png");
    const imagePath = path.join(tmpDir, `visual${imgExt}`);
    const outputPath = path.join(tmpDir, "sticker.webp");
    await fs.writeFile(imagePath, opts.imageBytes);

    const isVid = isVideoInput(opts.imageBytes, opts.imageName, opts.imageMime);
    const isAnimGif = isAnimatedGif(opts.imageBytes);
    const isDynamic = isVid || isAnimGif;

    const baseFraming =
      fitMode === "cover"
        ? `format=rgba,crop=w='min(iw,ih)':h='min(iw,ih)':x='(iw-min(iw,ih))*${cropX.toFixed(4)}':y='(ih-min(iw,ih))*${cropY.toFixed(4)}',scale=512:512:flags=lanczos`
        : `format=rgba,scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;

    let finalSticker: Buffer | null = null;

    if (!isDynamic) {
      // Static image: alternate a subtle 2x2 corner pixel so libwebp_anim preserves >= 2 frames
      // (WhatsApp requires animated WebP frames for sound stickers)
      const staticDur = Math.max(1.0, durationSec);
      for (const quality of [75, 55, 40, 25]) {
        await runFfmpeg([
          "-hide_banner",
          "-loglevel",
          "error",
          "-loop",
          "1",
          "-framerate",
          "2",
          "-t",
          staticDur.toFixed(3),
          "-i",
          imagePath,
          "-an",
          "-vf",
          `${baseFraming},drawbox=x=0:y=0:w=2:h=2:color=0x80808008:t=fill:replace=1:enable='mod(n,2)',format=yuva420p`,
          "-c:v",
          "libwebp_anim",
          "-lossless",
          "0",
          "-quality",
          String(quality),
          "-compression_level",
          "4",
          "-loop",
          "0",
          "-f",
          "webp",
          "-y",
          outputPath
        ]);
        const withMeta = addStickerMetadata(await fs.readFile(outputPath), {
          packName,
          publisher
        });
        if (withMeta.length <= MAX_ANIMATED_WEBP_BYTES) {
          finalSticker = withMeta;
          break;
        }
      }
    } else {
      const inputArgs = isVid
        ? ["-stream_loop", "-1", "-i", imagePath]
        : ["-ignore_loop", "0", "-i", imagePath];

      const ladder: Array<readonly [number, number, number]> = [
        [15, 60, 512],
        [12, 50, 512],
        [10, 42, 448],
        [10, 32, 384],
        [8, 28, 320],
        [6, 22, 256]
      ];

      for (const [fps, quality, detail] of ladder) {
        const detailScale =
          detail < 512
            ? `,scale=${detail}:${detail}:flags=area,scale=512:512:flags=bicubic`
            : "";
        await runFfmpeg([
          "-hide_banner",
          "-loglevel",
          "error",
          ...inputArgs,
          "-t",
          durationSec.toFixed(3),
          "-an",
          "-vf",
          `fps=${fps},${baseFraming}${detailScale},format=yuva420p`,
          "-c:v",
          "libwebp_anim",
          "-lossless",
          "0",
          "-quality",
          String(quality),
          "-compression_level",
          "4",
          "-loop",
          "0",
          "-f",
          "webp",
          "-y",
          outputPath
        ]);
        const withMeta = addStickerMetadata(await fs.readFile(outputPath), {
          packName,
          publisher
        });
        if (withMeta.length <= MAX_ANIMATED_WEBP_BYTES) {
          finalSticker = withMeta;
          break;
        }
      }
    }

    if (!finalSticker) {
      throw new Error(
        "Não foi possível compactar a figurinha animada abaixo de 500 KB. Tente um trecho menor."
      );
    }

    const info = inspectWebp(finalSticker);
    if (info.width !== 512 || info.height !== 512) {
      throw new Error(`Dimensão inesperada na figurinha: ${info.width}×${info.height}.`);
    }
    if (!info.animated || info.frames < 2) {
      throw new Error("A figurinha gerada não possui quadros animados suficientes.");
    }

    return {
      webp: finalSticker,
      durationMs: Math.round(durationSec * 1000),
      animated: info.animated
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function renderOpusAudio(
  opts: RenderOpusAudioOptions
): Promise<{ audio: Buffer; durationMs: number }> {
  const startSec = Math.max(0, Number.isFinite(opts.startSec) ? opts.startSec : 0);
  const durationSec = clamp(opts.durationSec, 0.1, 10.0);
  const fadeOut = Math.max(0, durationSec - 0.12).toFixed(3);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zapsom-opus-"));
  try {
    const audExt = safeExt(opts.audioName, ".mp3");
    const audioPath = path.join(tmpDir, `audio${audExt}`);
    const outputPath = path.join(tmpDir, "sound.ogg");
    await fs.writeFile(audioPath, opts.audioBytes);

    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      audioPath,
      "-vn",
      "-sn",
      "-dn",
      "-ac",
      "1",
      "-ar",
      "48000",
      "-af",
      `atrim=start=${startSec.toFixed(3)}:duration=${durationSec.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,afade=t=out:st=${fadeOut}:d=0.12`,
      "-c:a",
      "libopus",
      "-b:a",
      "64k",
      "-application",
      "audio",
      "-map_metadata",
      "-1",
      "-f",
      "ogg",
      "-y",
      outputPath
    ]);

    const audio = await fs.readFile(outputPath);
    if (audio.length === 0) {
      throw new Error("O áudio Ogg/Opus gerado ficou vazio.");
    }
    if (audio.length > MAX_AUDIO_OGG_BYTES) {
      throw new Error("O áudio excedeu o limite de 256 KB para figurinha do WhatsApp.");
    }

    return {
      audio,
      durationMs: Math.round(durationSec * 1000)
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
