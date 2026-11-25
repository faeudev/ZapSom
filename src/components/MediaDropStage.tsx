import React, { useRef, useState } from "react";

export type FitMode = "cover" | "contain";

export interface VisualAsset {
  file: File;
  url: string;
  isVideo: boolean;
  width: number;
  height: number;
}

interface MediaDropStageProps {
  visual: VisualAsset | null;
  hasAudio: boolean;
  cropX: number;
  cropY: number;
  fitMode: FitMode;
  matteColor: string;
  onSelectVisualFile: (file: File) => void;
  onChangeCrop: (cropX: number, cropY: number) => void;
  onChangeFitMode: (mode: FitMode) => void;
  onChangeMatteColor: (hex: string) => void;
  onClearVisual: () => void;
}

const MATTE_SWATCHES = [
  { label: "Branco", hex: "#FFFFFF" },
  { label: "Preto", hex: "#000000" },
  { label: "WhatsApp Escuro", hex: "#0B141A" },
  { label: "WhatsApp Claro", hex: "#EFEAE2" }
];

export const MediaDropStage: React.FC<MediaDropStageProps> = ({
  visual,
  hasAudio,
  cropX,
  cropY,
  fitMode,
  matteColor,
  onSelectVisualFile,
  onChangeCrop,
  onChangeFitMode,
  onChangeMatteColor,
  onClearVisual
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isPanning, setIsPanning] = useState(false);

  const canCrop = Boolean(visual) && fitMode === "cover" && visual!.width !== visual!.height;

  const updateCropFromPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canCrop) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onChangeCrop(Number(nx.toFixed(3)), Number(ny.toFixed(3)));
  };

  return (
    <section className="card stage-card">
      <div className="card-header">
        <div>
          <span className="step-pill">1</span>
          <h2>Imagem, GIF ou Vídeo</h2>
        </div>
        {visual && (
          <button type="button" className="btn-link" onClick={onClearVisual}>
            Trocar imagem
          </button>
        )}
      </div>

      <div
        className={`drop-stage ${visual ? "has-media" : ""} ${isDraggingOver ? "drag-over" : ""} ${canCrop ? "can-crop" : ""}`}
        style={visual ? { backgroundColor: matteColor } : undefined}
        onClick={() => {
          if (!visual) inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingOver(false);
          const file = Array.from(e.dataTransfer.files).find(
            (f) => f.type.startsWith("image/") || f.type.startsWith("video/") || /\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i.test(f.name)
          );
          if (file) onSelectVisualFile(file);
        }}
        onPointerDown={(e) => {
          if (!canCrop) return;
          setIsPanning(true);
          updateCropFromPointer(e);
        }}
        onPointerMove={(e) => {
          if (isPanning && canCrop) {
            updateCropFromPointer(e);
          }
        }}
        onPointerUp={() => setIsPanning(false)}
        onPointerLeave={() => setIsPanning(false)}
      >
        <input
          ref={inputRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/quicktime,video/webm,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onSelectVisualFile(file);
            e.target.value = "";
          }}
        />

        {!visual ? (
          <div className="drop-placeholder">
            <div className="drop-icon">🖼️</div>
            <p className="drop-title">Arraste sua imagem ou GIF aqui</p>
            <p className="drop-hint">
              Ou clique para escolher • Também aceita <strong>Ctrl+V</strong> direto
            </p>
            <span className="format-tags">PNG · JPG · WebP · GIF animado · MP4/WebM</span>
          </div>
        ) : (
          <>
            {visual.isVideo ? (
              <video
                src={visual.url}
                className="stage-media"
                autoPlay
                loop
                muted
                playsInline
                style={{
                  objectFit: fitMode,
                  objectPosition: `${Math.round(cropX * 100)}% ${Math.round(cropY * 100)}%`
                }}
              />
            ) : (
              <img
                src={visual.url}
                alt={visual.file.name}
                className="stage-media"
                draggable={false}
                style={{
                  objectFit: fitMode,
                  objectPosition: `${Math.round(cropX * 100)}% ${Math.round(cropY * 100)}%`
                }}
              />
            )}

            <div className="stage-overlay-badges">
              <span className="pill-badge">1:1 · 512×512</span>
              {canCrop && <span className="pill-badge subtle">Arraste na imagem para enquadrar</span>}
            </div>

            {hasAudio && (
              <div className="speaker-badge" title="Áudio anexado">
                🔊
              </div>
            )}
          </>
        )}
      </div>

      <div className="stage-controls">
        <div className="control-row">
          <span className="control-label">Enquadramento:</span>
          <div className="segmented">
            <button
              type="button"
              className={fitMode === "cover" ? "active" : ""}
              onClick={() => onChangeFitMode("cover")}
            >
              Preencher 1:1
            </button>
            <button
              type="button"
              className={fitMode === "contain" ? "active" : ""}
              onClick={() => onChangeFitMode("contain")}
            >
              Ajustar inteiro
            </button>
          </div>
        </div>

        <div className="control-row">
          <span className="control-label">Fundo do MP4:</span>
          <div className="swatches">
            {MATTE_SWATCHES.map((s) => (
              <button
                key={s.hex}
                type="button"
                title={s.label}
                className={`swatch ${matteColor.toUpperCase() === s.hex ? "active" : ""}`}
                style={{ backgroundColor: s.hex }}
                onClick={() => onChangeMatteColor(s.hex)}
              />
            ))}
            <label className="swatch-picker" title="Escolher outra cor">
              <input
                type="color"
                value={matteColor}
                onChange={(e) => onChangeMatteColor(e.target.value.toUpperCase())}
              />
              <span>🎨</span>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
};
