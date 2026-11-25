import React, { useCallback, useEffect, useRef, useState } from "react";

export interface AudioAsset {
  file: File;
  url: string;
  durationSec: number;
  peaks: number[];
}

interface AudioTrimBarProps {
  audio: AudioAsset | null;
  startSec: number;
  endSec: number;
  isBusy: boolean;
  onSelectAudioFile: (file: File) => void;
  onFetchMyInstants: (url: string) => Promise<void>;
  onChangeRange: (startSec: number, endSec: number) => void;
  onClearAudio: () => void;
}

const MIN_CLIP_SEC = 0.2;
const MAX_CLIP_SEC = 10.0;

type PlayMode = "none" | "clip" | "full";
type DragMode = "none" | "left" | "right" | "move" | "seek";

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function formatTime(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${String(mins).padStart(2, "0")}:${rem.toFixed(1).padStart(4, "0")}`;
}

function formatAxisTick(sec: number, showTenths: boolean): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  if (showTenths) {
    return `${String(mins).padStart(2, "0")}:${rem.toFixed(1).padStart(4, "0")}`;
  }
  const wholeSecs = Math.floor(rem);
  return `${String(mins).padStart(2, "0")}:${String(wholeSecs).padStart(2, "0")}`;
}

export function parseTimeInput(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const val = Number(text);
    return Number.isFinite(val) ? val : null;
  }
  const parts = text.split(":");
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (Number.isFinite(m) && Number.isFinite(s) && m >= 0 && s >= 0 && s < 60) {
      return m * 60 + s;
    }
  }
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (
      Number.isFinite(h) &&
      Number.isFinite(m) &&
      Number.isFinite(s) &&
      h >= 0 &&
      m >= 0 &&
      m < 60 &&
      s >= 0 &&
      s < 60
    ) {
      return h * 3600 + m * 60 + s;
    }
  }
  return null;
}

function pickTickStep(spanSec: number): number {
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  for (const step of candidates) {
    if (spanSec / step <= 8) return step;
  }
  return 600;
}

export const AudioTrimBar: React.FC<AudioTrimBarProps> = ({
  audio,
  startSec,
  endSec,
  isBusy,
  onSelectAudioFile,
  onFetchMyInstants,
  onChangeRange,
  onClearAudio
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const miniCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const [urlInput, setUrlInput] = useState("");
  const [playMode, setPlayMode] = useState<PlayMode>("none");
  const [playheadSec, setPlayheadSec] = useState(0);
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(10);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const [startText, setStartText] = useState("00:00.0");
  const [endText, setEndText] = useState("00:05.0");

  const dragRef = useRef<{
    mode: DragMode;
    offsetSec: number;
    fixedLen: number;
  }>({ mode: "none", offsetSec: 0, fixedLen: 5 });

  const miniDragRef = useRef<{ active: boolean; offsetSec: number }>({
    active: false,
    offsetSec: 0
  });

  const duration = audio?.durationSec ?? 0;
  const safeStart = audio ? clamp(startSec, 0, Math.max(0, duration - MIN_CLIP_SEC)) : 0;
  const safeEnd = audio
    ? clamp(
        endSec,
        Math.min(duration, safeStart + MIN_CLIP_SEC),
        Math.min(duration, safeStart + MAX_CLIP_SEC)
      )
    : 5;
  const clipLen = Math.max(0, safeEnd - safeStart);

  useEffect(() => {
    setStartText(formatTime(safeStart));
    setEndText(formatTime(safeEnd));
  }, [safeStart, safeEnd]);

  const stopPlayback = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    setPlayMode("none");
  }, []);

  useEffect(() => {
    stopPlayback();
    if (audio) {
      setViewStart(0);
      setViewEnd(audio.durationSec);
      setPlayheadSec(0);
    } else {
      setViewStart(0);
      setViewEnd(10);
      setPlayheadSec(0);
    }
    return () => stopPlayback();
  }, [audio?.url, audio?.durationSec, stopPlayback]);

  const vStart = audio ? clamp(viewStart, 0, Math.max(0, duration - 0.5)) : 0;
  const vEnd = audio ? clamp(viewEnd, Math.min(duration, vStart + 0.5), duration) : 10;
  const vSpan = Math.max(0.5, vEnd - vStart);
  const isZoomed = Boolean(audio) && vSpan < duration - 0.05;
  const showMinimap = Boolean(audio) && (duration > 12 || isZoomed);

  const zoomAround = useCallback(
    (centerSec: number, factor: number) => {
      if (!audio) return;
      const minSpan = Math.min(2.0, duration);
      const nextSpan = clamp(vSpan * factor, minSpan, duration);
      const ratio = clamp((centerSec - vStart) / vSpan, 0, 1);
      let nextStart = centerSec - ratio * nextSpan;
      nextStart = clamp(nextStart, 0, Math.max(0, duration - nextSpan));
      setViewStart(nextStart);
      setViewEnd(nextStart + nextSpan);
    },
    [audio, duration, vStart, vSpan]
  );

  const focusSelection = useCallback(() => {
    if (!audio) return;
    const pad = Math.max(3, clipLen * 1.2);
    const nextStart = Math.max(0, safeStart - pad);
    const nextEnd = Math.min(duration, safeEnd + pad);
    setViewStart(nextStart);
    setViewEnd(Math.max(nextStart + Math.min(2, duration), nextEnd));
  }, [audio, clipLen, duration, safeEnd, safeStart]);

  const resetZoom = useCallback(() => {
    if (!audio) return;
    setViewStart(0);
    setViewEnd(duration);
  }, [audio, duration]);

  // Attach non-passive wheel listener to zoom smoothly without scrolling the page
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas || !audio) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const ratio = rect.width > 0 ? clamp((e.clientX - rect.left) / rect.width, 0, 1) : 0.5;
      const cursorSec = vStart + ratio * vSpan;
      const factor = e.deltaY < 0 ? 0.72 : 1.38;
      zoomAround(cursorSec, factor);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [audio, vStart, vSpan, zoomAround]);

  // Render main zoomed waveform + ticks + selection handles + playhead
  useEffect(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas || !audio) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const waveH = h - 20;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "#0b141a";
    ctx.fillRect(0, 0, w, waveH);

    // Adaptive time ticks
    const step = pickTickStep(vSpan);
    const showTenths = step < 1;
    const firstTick = Math.ceil(vStart / step) * step;
    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (let t = firstTick; t <= vEnd + 0.001; t += step) {
      const x = ((t - vStart) / vSpan) * w;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, waveH);
      ctx.stroke();

      ctx.fillStyle = "#8696a0";
      const label = formatAxisTick(t, showTenths);
      const labelW = ctx.measureText(label).width;
      const textX = clamp(x - labelW / 2, 2, w - labelW - 2);
      ctx.fillText(label, textX, waveH + 10);
    }

    // Selection overlay
    const selX1 = ((safeStart - vStart) / vSpan) * w;
    const selX2 = ((safeEnd - vStart) / vSpan) * w;
    const selW = Math.max(4, selX2 - selX1);

    if (selX2 >= 0 && selX1 <= w) {
      ctx.fillStyle = "rgba(0, 168, 132, 0.25)";
      ctx.fillRect(selX1, 0, selW, waveH);
    }

    // Waveform bars inside [vStart, vEnd]
    const totalBars = audio.peaks.length;
    const drawBars = 150;
    const gap = 2;
    const barW = Math.max(1.5, (w - gap * (drawBars - 1)) / drawBars);

    for (let i = 0; i < drawBars; i++) {
      const t = vStart + ((i + 0.5) / drawBars) * vSpan;
      const bucketIdx = clamp(Math.floor((t / duration) * totalBars), 0, totalBars - 1);
      const peak = audio.peaks[bucketIdx] ?? 0.2;
      const x = i * (barW + gap);
      const barH = Math.max(4, peak * (waveH - 14));
      const y = (waveH - barH) / 2;
      const inSelection = t >= safeStart && t <= safeEnd;
      ctx.fillStyle = inSelection ? "#25d366" : "#3b4a54";
      ctx.fillRect(x, y, barW, barH);
    }

    // Selection border & resize handles
    if (selX2 >= 0 && selX1 <= w) {
      ctx.strokeStyle = "#00a884";
      ctx.lineWidth = 2;
      ctx.strokeRect(selX1, 1, selW, waveH - 2);

      // Left handle
      ctx.fillStyle = "#25d366";
      ctx.fillRect(selX1 - 3, 0, 6, waveH);
      // Right handle
      ctx.fillRect(selX2 - 3, 0, 6, waveH);
    }

    // Playhead line
    if (playheadSec >= vStart && playheadSec <= vEnd) {
      const px = ((playheadSec - vStart) / vSpan) * w;
      ctx.strokeStyle = "#e9edef";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, waveH);
      ctx.stroke();

      ctx.fillStyle = "#25d366";
      ctx.beginPath();
      ctx.arc(px, 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [audio, duration, playheadSec, safeEnd, safeStart, vEnd, vSpan, vStart]);

  // Render full-track minimap
  useEffect(() => {
    const canvas = miniCanvasRef.current;
    if (!canvas || !audio || !showMinimap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0b141a";
    ctx.fillRect(0, 0, w, h);

    // Full waveform miniature
    const bars = 120;
    const gap = 1.5;
    const barW = Math.max(1, (w - gap * (bars - 1)) / bars);
    for (let i = 0; i < bars; i++) {
      const bucketIdx = Math.floor((i / bars) * audio.peaks.length);
      const peak = audio.peaks[bucketIdx] ?? 0.2;
      const bh = Math.max(3, peak * (h - 6));
      const t = ((i + 0.5) / bars) * duration;
      ctx.fillStyle = t >= safeStart && t <= safeEnd ? "#25d366" : "#3b4a54";
      ctx.fillRect(i * (barW + gap), (h - bh) / 2, barW, bh);
    }

    // Selected snippet highlight
    const s1 = (safeStart / duration) * w;
    const s2 = (safeEnd / duration) * w;
    ctx.fillStyle = "rgba(37, 211, 102, 0.26)";
    ctx.fillRect(s1, 0, Math.max(3, s2 - s1), h);

    // Viewport rectangle
    const vx1 = (vStart / duration) * w;
    const vx2 = (vEnd / duration) * w;
    ctx.strokeStyle = "#e9edef";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vx1 + 0.5, 0.5, Math.max(6, vx2 - vx1 - 1), h - 1);

    // Playhead
    const px = (playheadSec / duration) * w;
    ctx.fillStyle = "#e9edef";
    ctx.fillRect(px - 1, 0, 2, h);
  }, [audio, duration, playheadSec, safeEnd, safeStart, showMinimap, vEnd, vStart]);

  const timeFromMainPointer = (e: React.PointerEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return vStart;
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    return clamp(vStart + ratio * vSpan, 0, duration);
  };

  const handleMainPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!audio) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const xStart = ((safeStart - vStart) / vSpan) * rect.width;
    const xEnd = ((safeEnd - vStart) / vSpan) * rect.width;
    const t = timeFromMainPointer(e);

    if (Math.abs(px - xLeftOrRight(xStart, xEnd, px)) <= 10 && Math.abs(px - xStart) <= 10) {
      dragRef.current = { mode: "left", offsetSec: 0, fixedLen: clipLen };
      return;
    }
    if (Math.abs(px - xEnd) <= 10) {
      dragRef.current = { mode: "right", offsetSec: 0, fixedLen: clipLen };
      return;
    }
    if (px > xStart && px < xEnd) {
      dragRef.current = { mode: "move", offsetSec: t - safeStart, fixedLen: clipLen };
      return;
    }

    // Clicked outside selection -> seek playhead
    dragRef.current = { mode: "seek", offsetSec: 0, fixedLen: clipLen };
    setPlayheadSec(t);
    if (audioElRef.current && playMode === "full") {
      audioElRef.current.currentTime = t;
    }
  };

  const handleMainPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!audio || dragRef.current.mode === "none") return;
    const t = timeFromMainPointer(e);
    const mode = dragRef.current.mode;

    if (mode === "left") {
      const minStart = Math.max(0, safeEnd - MAX_CLIP_SEC);
      const maxStart = safeEnd - MIN_CLIP_SEC;
      const nextStart = Number(clamp(t, minStart, maxStart).toFixed(2));
      onChangeRange(nextStart, safeEnd);
    } else if (mode === "right") {
      const minEnd = safeStart + MIN_CLIP_SEC;
      const maxEnd = Math.min(duration, safeStart + MAX_CLIP_SEC);
      const nextEnd = Number(clamp(t, minEnd, maxEnd).toFixed(2));
      onChangeRange(safeStart, nextEnd);
    } else if (mode === "move") {
      const len = dragRef.current.fixedLen;
      const nextStart = Number(clamp(t - dragRef.current.offsetSec, 0, Math.max(0, duration - len)).toFixed(2));
      const nextEnd = Number(Math.min(duration, nextStart + len).toFixed(2));
      onChangeRange(nextStart, nextEnd);
    } else if (mode === "seek") {
      setPlayheadSec(t);
      if (audioElRef.current && playMode === "full") {
        audioElRef.current.currentTime = t;
      }
    }
  };

  const handleMainPointerUp = () => {
    dragRef.current.mode = "none";
  };

  const panViewportFromMini = (e: React.PointerEvent<HTMLCanvasElement>, initial: boolean) => {
    if (!audio) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const t = ratio * duration;

    if (initial) {
      const insideView = t >= vStart && t <= vEnd;
      miniDragRef.current = {
        active: true,
        offsetSec: insideView ? t - vStart : vSpan / 2
      };
    }
    if (!miniDragRef.current.active) return;

    const nextStart = clamp(t - miniDragRef.current.offsetSec, 0, Math.max(0, duration - vSpan));
    setViewStart(nextStart);
    setViewEnd(nextStart + vSpan);
  };

  const startPlayback = (mode: "clip" | "full") => {
    if (!audio) return;
    if (playMode === mode) {
      stopPlayback();
      return;
    }
    stopPlayback();

    const el = new Audio(audio.url);
    const initialPos = mode === "clip" ? safeStart : clamp(playheadSec, 0, Math.max(0, duration - 0.05));
    el.currentTime = initialPos;
    audioElRef.current = el;
    setPlayMode(mode);

    const tick = () => {
      if (!audioElRef.current) return;
      const cur = audioElRef.current.currentTime;
      setPlayheadSec(cur);
      if (mode === "clip" && cur >= safeEnd) {
        stopPlayback();
        setPlayheadSec(safeStart);
        return;
      }
      if (audioElRef.current.ended) {
        stopPlayback();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    el.play()
      .then(() => {
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => stopPlayback());
  };

  const setStartAtPlayhead = () => {
    if (!audio) return;
    const targetStart = clamp(playheadSec, 0, Math.max(0, duration - MIN_CLIP_SEC));
    const desiredLen = clamp(clipLen || 5, MIN_CLIP_SEC, MAX_CLIP_SEC);
    const nextEnd = Math.min(duration, targetStart + desiredLen);
    const adjustedStart = Math.max(0, Math.min(targetStart, nextEnd - MIN_CLIP_SEC));
    onChangeRange(Number(adjustedStart.toFixed(2)), Number(nextEnd.toFixed(2)));
  };

  const setEndAtPlayhead = () => {
    if (!audio) return;
    const targetEnd = clamp(playheadSec, Math.min(duration, MIN_CLIP_SEC), duration);
    let nextStart = safeStart;
    if (targetEnd <= safeStart + MIN_CLIP_SEC || targetEnd - safeStart > MAX_CLIP_SEC) {
      nextStart = Math.max(0, targetEnd - Math.min(5, targetEnd));
    }
    onChangeRange(Number(nextStart.toFixed(2)), Number(targetEnd.toFixed(2)));
  };

  const nudgeStart = (delta: number) => {
    if (!audio) return;
    const nextStart = clamp(safeStart + delta, Math.max(0, safeEnd - MAX_CLIP_SEC), safeEnd - MIN_CLIP_SEC);
    onChangeRange(Number(nextStart.toFixed(2)), safeEnd);
  };

  const nudgeEnd = (delta: number) => {
    if (!audio) return;
    const nextEnd = clamp(safeEnd + delta, safeStart + MIN_CLIP_SEC, Math.min(duration, safeStart + MAX_CLIP_SEC));
    onChangeRange(safeStart, Number(nextEnd.toFixed(2)));
  };

  const commitStartText = () => {
    if (!audio) return;
    const parsed = parseTimeInput(startText);
    if (parsed === null) {
      setStartText(formatTime(safeStart));
      return;
    }
    const clampedStart = clamp(parsed, 0, Math.max(0, duration - MIN_CLIP_SEC));
    const preservedLen = clamp(clipLen || 5, MIN_CLIP_SEC, MAX_CLIP_SEC);
    const nextEnd = clamp(
      clampedStart + preservedLen,
      Math.min(duration, clampedStart + MIN_CLIP_SEC),
      Math.min(duration, clampedStart + MAX_CLIP_SEC)
    );
    onChangeRange(Number(clampedStart.toFixed(2)), Number(nextEnd.toFixed(2)));
  };

  const commitEndText = () => {
    if (!audio) return;
    const parsed = parseTimeInput(endText);
    if (parsed === null) {
      setEndText(formatTime(safeEnd));
      return;
    }
    const clampedEnd = clamp(parsed, Math.min(duration, MIN_CLIP_SEC), duration);
    let nextStart = safeStart;
    if (clampedEnd <= safeStart + MIN_CLIP_SEC || clampedEnd - safeStart > MAX_CLIP_SEC) {
      nextStart = Math.max(0, clampedEnd - Math.min(5, clampedEnd));
    }
    onChangeRange(Number(nextStart.toFixed(2)), Number(clampedEnd.toFixed(2)));
  };

  const handleMyInstantsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || isBusy) return;
    await onFetchMyInstants(urlInput.trim());
    setUrlInput("");
  };

  return (
    <section className="card audio-card">
      <div className="card-header">
        <div>
          <span className="step-pill">2</span>
          <h2>Áudio do Sticker</h2>
        </div>
        {audio && (
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              stopPlayback();
              onClearAudio();
            }}
          >
            Remover áudio
          </button>
        )}
      </div>

      <div
        className={`audio-drop ${isDraggingOver ? "drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingOver(false);
          const file = Array.from(e.dataTransfer.files).find(
            (f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(f.name)
          );
          if (file) {
            stopPlayback();
            onSelectAudioFile(file);
          }
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              stopPlayback();
              onSelectAudioFile(file);
            }
            e.target.value = "";
          }}
        />

        <div className="audio-source-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            🎵 Escolher áudio (MP3, WAV, OGG...)
          </button>

          <form className="myinstants-form" onSubmit={handleMyInstantsSubmit}>
            <input
              type="url"
              placeholder="Ou cole um link do MyInstants (https://www.myinstants.com/...)"
              value={urlInput}
              disabled={isBusy}
              onChange={(e) => setUrlInput(e.target.value)}
            />
            <button type="submit" className="btn-secondary" disabled={isBusy || !urlInput.trim()}>
              Buscar
            </button>
          </form>
        </div>

        {audio ? (
          <div className="timeline-editor">
            <div className="timeline-toolbar">
              <div className="timeline-meta">
                <strong title={audio.file.name}>{audio.file.name}</strong>
                <span>Total: {formatTime(duration)}</span>
                <span className="clip-badge">Trecho: {clipLen.toFixed(1)}s (máx. 10s)</span>
              </div>
              <div className="zoom-controls">
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => zoomAround((vStart + vEnd) / 2, 1.4)}
                  disabled={!isZoomed}
                  title="Diminuir zoom"
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => zoomAround((safeStart + safeEnd) / 2, 0.65)}
                  title="Aumentar zoom no trecho"
                >
                  +
                </button>
                <button type="button" className="btn-mini" onClick={focusSelection}>
                  Focar trecho
                </button>
                {isZoomed && (
                  <button type="button" className="btn-mini" onClick={resetZoom}>
                    Ver tudo
                  </button>
                )}
              </div>
            </div>

            {showMinimap && (
              <div className="minimap-wrap" title="Arraste para navegar pelo áudio completo">
                <canvas
                  ref={miniCanvasRef}
                  width={620}
                  height={26}
                  className="minimap-canvas"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    panViewportFromMini(e, true);
                  }}
                  onPointerMove={(e) => {
                    if (miniDragRef.current.active) panViewportFromMini(e, false);
                  }}
                  onPointerUp={() => {
                    miniDragRef.current.active = false;
                  }}
                />
              </div>
            )}

            <canvas
              ref={mainCanvasRef}
              width={620}
              height={96}
              className="waveform-canvas"
              onPointerDown={handleMainPointerDown}
              onPointerMove={handleMainPointerMove}
              onPointerUp={handleMainPointerUp}
            />

            <div className="timeline-actions-row">
              <div className="play-controls">
                <button
                  type="button"
                  className={`btn-secondary small ${playMode === "clip" ? "active-play" : ""}`}
                  onClick={() => startPlayback("clip")}
                >
                  {playMode === "clip" ? "⏹ Parar trecho" : "▶ Ouvir trecho"}
                </button>
                <button
                  type="button"
                  className={`btn-secondary small ${playMode === "full" ? "active-play" : ""}`}
                  onClick={() => startPlayback("full")}
                >
                  {playMode === "full" ? "⏹ Parar completo" : "🔊 Ouvir completo"}
                </button>
              </div>

              <div className="marker-controls">
                <button
                  type="button"
                  className="btn-mini"
                  onClick={setStartAtPlayhead}
                  title="Definir início do corte na posição atual da linha laranja"
                >
                  ✂️ Início aqui ({formatTime(playheadSec)})
                </button>
                <button
                  type="button"
                  className="btn-mini"
                  onClick={setEndAtPlayhead}
                  title="Definir fim do corte na posição atual da linha laranja"
                >
                  ✂️ Fim aqui
                </button>
              </div>
            </div>

            <div className="precision-row">
              <div className="time-field">
                <span>Início</span>
                <div className="time-input-group">
                  <button type="button" className="btn-mini" onClick={() => nudgeStart(-0.1)}>
                    −0.1s
                  </button>
                  <input
                    type="text"
                    value={startText}
                    onChange={(e) => setStartText(e.target.value)}
                    onBlur={commitStartText}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitStartText();
                    }}
                  />
                  <button type="button" className="btn-mini" onClick={() => nudgeStart(0.1)}>
                    +0.1s
                  </button>
                </div>
              </div>

              <div className="time-field">
                <span>Fim</span>
                <div className="time-input-group">
                  <button type="button" className="btn-mini" onClick={() => nudgeEnd(-0.1)}>
                    −0.1s
                  </button>
                  <input
                    type="text"
                    value={endText}
                    onChange={(e) => setEndText(e.target.value)}
                    onBlur={commitEndText}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEndText();
                    }}
                  />
                  <button type="button" className="btn-mini" onClick={() => nudgeEnd(0.1)}>
                    +0.1s
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="audio-empty-hint">
            Arraste qualquer áudio (mesmo de vários minutos) aqui ou escolha um arquivo do PC. Você
            poderá navegar pela faixa inteira, dar zoom e cortar o trecho exato de até 10s.
          </p>
        )}
      </div>
    </section>
  );
};

function xLeftOrRight(xStart: number, xEnd: number, px: number): number {
  return Math.abs(px - xStart) <= Math.abs(px - xEnd) ? xStart : xEnd;
}
