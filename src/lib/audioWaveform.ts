import { probeAudioDurationApi } from "./api";

export interface DecodedAudioInfo {
  durationSec: number;
  peaks: number[];
}

const BUCKETS = 1200;

function flatPeaks(): number[] {
  return Array.from({ length: BUCKETS }, (_, i) => 0.25 + 0.15 * Math.sin(i * 0.15));
}

export async function decodeAudioWaveform(file: File): Promise<DecodedAudioInfo> {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      const durationSec = await probeAudioDurationApi(file);
      return { durationSec, peaks: flatPeaks() };
    }

    const ctx = new AudioCtx();
    try {
      const buf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(buf);
      const durationSec = decoded.duration;
      const channelCount = decoded.numberOfChannels;
      const length = decoded.length;
      const channels = Array.from({ length: channelCount }, (_, c) => decoded.getChannelData(c));

      const peaks: number[] = [];
      const blockSize = Math.max(1, Math.floor(length / BUCKETS));
      let globalMax = 0.001;

      for (let b = 0; b < BUCKETS; b++) {
        const start = b * blockSize;
        const end = Math.min(length, start + blockSize);
        let peak = 0;
        const step = Math.max(1, Math.floor((end - start) / 64));
        for (let i = start; i < end; i += step) {
          let sum = 0;
          for (let c = 0; c < channelCount; c++) {
            sum += Math.abs(channels[c]![i] ?? 0);
          }
          const avg = sum / channelCount;
          if (avg > peak) peak = avg;
        }
        if (peak > globalMax) globalMax = peak;
        peaks.push(peak);
      }

      const normalized = peaks.map((p) => Math.max(0.08, Math.min(1, p / globalMax)));
      return { durationSec, peaks: normalized };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } catch {
    const durationSec = await probeAudioDurationApi(file);
    return { durationSec, peaks: flatPeaks() };
  }
}
