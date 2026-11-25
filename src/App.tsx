import React, { useCallback, useEffect, useState } from "react";
import { AudioTrimBar, type AudioAsset } from "./components/AudioTrimBar";
import { MediaDropStage, type FitMode, type VisualAsset } from "./components/MediaDropStage";
import { WhatsAppConnectCard } from "./components/WhatsAppConnectCard";
import {
  checkHealth,
  connectWhatsAppApi,
  fetchMyInstantsApi,
  getWhatsAppStatusApi,
  logoutWhatsAppApi,
  recopyArtifactApi,
  renderMediaApi,
  sendWhatsAppStickerApi,
  type RenderResponse,
  type WhatsAppStatus
} from "./lib/api";
import { decodeAudioWaveform } from "./lib/audioWaveform";

function isImageOrVideoFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    /\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i.test(file.name)
  );
}

function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/i.test(file.name);
}

function readVisualDimensions(
  _file: File,
  url: string,
  isVideo: boolean
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    if (isVideo) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        resolve({ width: video.videoWidth || 512, height: video.videoHeight || 512 });
      };
      video.onerror = () => resolve({ width: 512, height: 512 });
      video.src = url;
    } else {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth || 512, height: img.naturalHeight || 512 });
      };
      img.onerror = () => resolve({ width: 512, height: 512 });
      img.src = url;
    }
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const App: React.FC = () => {
  const [visual, setVisual] = useState<VisualAsset | null>(null);
  const [audio, setAudio] = useState<AudioAsset | null>(null);
  const [cropX, setCropX] = useState(0.5);
  const [cropY, setCropY] = useState(0.5);
  const [fitMode, setFitMode] = useState<FitMode>("cover");
  const [matteColor, setMatteColor] = useState("#0B141A");
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(5);

  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({
    status: "disconnected",
    qrDataUrl: null,
    userPhone: null,
    userName: null,
    lastError: null
  });
  const [targetPhone, setTargetPhone] = useState("");

  const [isBusy, setIsBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResponse | null>(null);
  const [globalDrag, setGlobalDrag] = useState(false);

  const refreshWhatsAppStatus = useCallback(async () => {
    const status = await getWhatsAppStatusApi();
    setWaStatus(status);
  }, []);

  useEffect(() => {
    checkHealth()
      .then((h) => {
        if (!h.ok || !h.ffmpeg) {
          setErrorMsg("Servidor local ou FFmpeg indisponível.");
        }
      })
      .catch(() => setErrorMsg("Servidor local indisponível."));
    refreshWhatsAppStatus().catch(() => undefined);
  }, [refreshWhatsAppStatus]);

  const handleConnectWhatsApp = useCallback(async () => {
    setErrorMsg(null);
    try {
      const next = await connectWhatsAppApi();
      setWaStatus(next);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao conectar WhatsApp.");
    }
  }, []);

  const handleLogoutWhatsApp = useCallback(async () => {
    setErrorMsg(null);
    try {
      const next = await logoutWhatsAppApi();
      setWaStatus(next);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao desconectar WhatsApp.");
    }
  }, []);

  const loadVisualFile = useCallback(async (file: File) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setResult(null);
    const url = URL.createObjectURL(file);
    const isVideo =
      file.type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(file.name);
    const dims = await readVisualDimensions(file, url, isVideo);
    setVisual((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { file, url, isVideo, width: dims.width, height: dims.height };
    });
    setCropX(0.5);
    setCropY(0.5);
  }, []);

  const loadAudioFile = useCallback(async (file: File) => {
    setIsBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setResult(null);
    try {
      const info = await decodeAudioWaveform(file);
      const url = URL.createObjectURL(file);
      setAudio((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return {
          file,
          url,
          durationSec: info.durationSec,
          peaks: info.peaks
        };
      });
      setStartSec(0);
      setEndSec(Number(Math.max(0.2, Math.min(info.durationSec, 5)).toFixed(2)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao carregar o áudio.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleMyInstants = useCallback(
    async (url: string) => {
      setIsBusy(true);
      setErrorMsg(null);
      setStatusMsg("Baixando som do MyInstants...");
      try {
        const file = await fetchMyInstantsApi(url);
        await loadAudioFile(file);
        setStatusMsg(`Áudio "${file.name}" carregado!`);
      } catch (err) {
        setStatusMsg(null);
        setErrorMsg(err instanceof Error ? err.message : "Erro ao buscar no MyInstants.");
      } finally {
        setIsBusy(false);
      }
    },
    [loadAudioFile]
  );

  // Global Ctrl+V paste (images or MyInstants links)
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      const files = Array.from(e.clipboardData?.files ?? []);
      const items = Array.from(e.clipboardData?.items ?? []);
      const imgFile =
        files.find(isImageOrVideoFile) ??
        items.find((it) => it.type.startsWith("image/"))?.getAsFile() ??
        null;
      const audFile = files.find(isAudioFile) ?? null;

      if (imgFile || audFile) {
        e.preventDefault();
        if (imgFile) await loadVisualFile(imgFile);
        if (audFile) await loadAudioFile(audFile);
        return;
      }

      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (text && /^https:\/\/(www\.)?myinstants\.com\//i.test(text)) {
        e.preventDefault();
        await handleMyInstants(text);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadVisualFile, loadAudioFile, handleMyInstants]);

  const handleSendToWhatsApp = async (withAudio: boolean) => {
    if (!visual) {
      setErrorMsg("Adicione uma imagem ou GIF primeiro.");
      return;
    }
    if (withAudio && !audio) {
      setErrorMsg("Adicione um áudio antes de enviar a figurinha com som.");
      return;
    }
    if (waStatus.status !== "connected") {
      setErrorMsg("Conecte seu WhatsApp pelo QR Code acima antes de enviar.");
      if (waStatus.status === "disconnected") {
        await handleConnectWhatsApp();
      }
      return;
    }

    setIsBusy(true);
    setErrorMsg(null);
    setStatusMsg(
      withAudio
        ? "Convertendo WebP 512×512 + Ogg/Opus e enviando figurinha com som para o WhatsApp..."
        : "Convertendo WebP 512×512 e enviando figurinha para o WhatsApp..."
    );

    try {
      const clipDuration = audio ? Math.max(0.2, Math.min(10, endSec - startSec)) : 5;
      const maxStart = audio ? Math.max(0, audio.durationSec - clipDuration) : 0;
      const clampedStart = Math.max(0, Math.min(startSec, maxStart));

      const sent = await sendWhatsAppStickerApi({
        imageFile: visual.file,
        audioFile: audio?.file ?? null,
        withAudio,
        startSec: clampedStart,
        durationSec: clipDuration,
        cropX,
        cropY,
        fitMode,
        targetPhone
      });

      const targetLabel = targetPhone.trim()
        ? `+${targetPhone.replace(/\D/g, "")}`
        : 'sua conversa "Você mesmo"';

      setStatusMsg(
        sent.withAudio
          ? `Figurinha com som (🔊) enviada para ${targetLabel}! Agora é só favoritar ou encaminhar no WhatsApp.`
          : `Figurinha enviada para ${targetLabel}!`
      );
    } catch (err) {
      setStatusMsg(null);
      setErrorMsg(err instanceof Error ? err.message : "Erro ao enviar para o WhatsApp.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleRender = async (format: "mp4" | "webp", copyToClipboard: boolean) => {
    if (!visual) {
      setErrorMsg("Adicione uma imagem ou GIF primeiro.");
      return;
    }
    if (format === "mp4" && !audio) {
      setErrorMsg("Adicione um áudio antes de gerar o MP4.");
      return;
    }

    setIsBusy(true);
    setErrorMsg(null);
    setStatusMsg(format === "mp4" ? "Renderizando MP4 quadrado com FFmpeg..." : "Gerando figurinha WebP...");

    try {
      const clipDuration = audio ? Math.max(0.2, Math.min(10, endSec - startSec)) : 5;
      const maxStart = audio ? Math.max(0, audio.durationSec - clipDuration) : 0;
      const clampedStart = Math.max(0, Math.min(startSec, maxStart));

      const res = await renderMediaApi({
        imageFile: visual.file,
        audioFile: audio?.file ?? null,
        format,
        startSec: clampedStart,
        durationSec: clipDuration,
        cropX,
        cropY,
        fitMode,
        matteColor,
        copyToClipboard,
        baseName: visual.file.name
      });

      setResult(res);

      if (copyToClipboard) {
        if (res.copied) {
          setStatusMsg(
            format === "mp4"
              ? "MP4 copiado para a área de transferência! Dê Ctrl+V no WhatsApp para enviar como vídeo."
              : "Figurinha WebP copiada para a área de transferência!"
          );
        } else {
          setStatusMsg(
            `Arquivo gerado (${res.clipboardError || "não foi possível copiar automaticamente"}). Use o botão Baixar.`
          );
        }
      } else {
        const a = document.createElement("a");
        a.href = res.downloadUrl;
        a.download = res.fileName;
        a.click();
        setStatusMsg(`Download iniciado: ${res.fileName}`);
      }
    } catch (err) {
      setStatusMsg(null);
      setErrorMsg(err instanceof Error ? err.message : "Erro ao gerar o arquivo.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleRecopy = async () => {
    if (!result) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      await recopyArtifactApi(result.id);
      setStatusMsg("Copiado novamente para a área de transferência (Ctrl+V)!");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Falha ao copiar novamente.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleClearAll = () => {
    setVisual((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setAudio((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setResult(null);
    setStatusMsg(null);
    setErrorMsg(null);
    setStartSec(0);
    setEndSec(5);
    setCropX(0.5);
    setCropY(0.5);
  };

  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        e.preventDefault();
        setGlobalDrag(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setGlobalDrag(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        setGlobalDrag(false);
        const files = Array.from(e.dataTransfer.files);
        const img = files.find(isImageOrVideoFile);
        const aud = files.find(isAudioFile);
        if (img) await loadVisualFile(img);
        if (aud) await loadAudioFile(aud);
      }}
    >
      {globalDrag && (
        <div className="global-drop-overlay">
          <div className="global-drop-box">Solte a imagem e/ou o áudio aqui</div>
        </div>
      )}

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <svg
              className="brand-logo"
              viewBox="0 0 40 40"
              width="38"
              height="38"
              aria-hidden="true"
            >
              <path
                fill="#25d366"
                d="M20 3C10.6 3 3 10.3 3 19.3c0 3.2 1 6.2 2.7 8.7L4 36l8.3-2.2c2.3 1.2 5 1.8 7.7 1.8 9.4 0 17-7.3 17-16.3S29.4 3 20 3z"
              />
              <rect x="13" y="15" width="2.6" height="9" rx="1.3" fill="#ffffff" />
              <rect x="18.7" y="11.5" width="2.6" height="16" rx="1.3" fill="#ffffff" />
              <rect x="24.4" y="14" width="2.6" height="11" rx="1.3" fill="#ffffff" />
            </svg>
            <div>
              <h1>ZapSom</h1>
              <p>Jogue imagem + áudio e envie figurinhas nativas com som direto pro WhatsApp</p>
            </div>
          </div>

          <div className="topbar-right">
            <button type="button" className="btn-ghost" onClick={handleClearAll}>
              Limpar tudo
            </button>
          </div>
        </div>
      </header>

      <main className="studio-grid">
        <div className="left-col">
          <MediaDropStage
            visual={visual}
            hasAudio={Boolean(audio)}
            cropX={cropX}
            cropY={cropY}
            fitMode={fitMode}
            matteColor={matteColor}
            onSelectVisualFile={loadVisualFile}
            onChangeCrop={(x, y) => {
              setCropX(x);
              setCropY(y);
              setResult(null);
            }}
            onChangeFitMode={(m) => {
              setFitMode(m);
              setResult(null);
            }}
            onChangeMatteColor={(c) => {
              setMatteColor(c);
              setResult(null);
            }}
            onClearVisual={() => {
              setVisual((prev) => {
                if (prev) URL.revokeObjectURL(prev.url);
                return null;
              });
              setResult(null);
            }}
          />
        </div>

        <div className="right-col">
          <AudioTrimBar
            audio={audio}
            startSec={startSec}
            endSec={endSec}
            isBusy={isBusy}
            onSelectAudioFile={loadAudioFile}
            onFetchMyInstants={handleMyInstants}
            onChangeRange={(nextStart, nextEnd) => {
              setStartSec(nextStart);
              setEndSec(nextEnd);
              setResult(null);
            }}
            onClearAudio={() => {
              setAudio((prev) => {
                if (prev) URL.revokeObjectURL(prev.url);
                return null;
              });
              setResult(null);
            }}
          />

          <WhatsAppConnectCard
            waStatus={waStatus}
            targetPhone={targetPhone}
            isBusy={isBusy}
            onRefreshStatus={refreshWhatsAppStatus}
            onConnect={handleConnectWhatsApp}
            onLogout={handleLogoutWhatsApp}
            onChangeTargetPhone={setTargetPhone}
          />

          <section className="card action-card">
            <div className="card-header">
              <div>
                <span className="step-pill">3</span>
                <h2>Enviar pro WhatsApp ou Copiar</h2>
              </div>
            </div>

            <div className="action-buttons">
              <button
                type="button"
                className="btn-primary"
                disabled={!visual || !audio || isBusy}
                onClick={() => handleSendToWhatsApp(true)}
              >
                <svg
                  className="btn-icon"
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
                <span>
                  {isBusy
                    ? "Processando..."
                    : waStatus.status === "connected"
                      ? "Enviar Figurinha com Som direto pro WhatsApp"
                      : "Conectar e Enviar Figurinha com Som pro WhatsApp"}
                </span>
              </button>

              <div className="secondary-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!visual || isBusy || waStatus.status !== "connected"}
                  onClick={() => handleSendToWhatsApp(false)}
                >
                  🖼️ Enviar Figurinha sem Som
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!visual || !audio || isBusy}
                  onClick={() => handleRender("mp4", true)}
                >
                  📋 Copiar MP4 (Ctrl+V)
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!visual || !audio || isBusy}
                  onClick={() => handleRender("mp4", false)}
                >
                  ⬇ Baixar MP4
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!visual || isBusy}
                  onClick={() => handleRender("webp", false)}
                >
                  ⬇ Baixar WebP
                </button>
              </div>
            </div>

            {errorMsg && <div className="banner error">{errorMsg}</div>}
            {statusMsg && <div className="banner success">{statusMsg}</div>}

            {result && (
              <div className="result-preview">
                <div className="result-media-wrap">
                  {result.format === "mp4" ? (
                    <video src={result.previewUrl} controls loop autoPlay playsInline />
                  ) : (
                    <img src={result.previewUrl} alt={result.fileName} />
                  )}
                </div>

                <div className="result-info">
                  <p className="result-filename">
                    <strong>{result.fileName}</strong> · {formatBytes(result.sizeBytes)}
                  </p>
                  <div className="result-btns">
                    <button
                      type="button"
                      className="btn-primary small"
                      disabled={isBusy}
                      onClick={handleRecopy}
                    >
                      📋 Copiar novamente (Ctrl+V)
                    </button>
                    <a className="btn-secondary small" href={result.downloadUrl} download={result.fileName}>
                      ⬇ Salvar arquivo
                    </a>
                  </div>
                </div>
              </div>
            )}

            <div className="whatsapp-tip">
              <strong>Como funciona:</strong>
              <ul>
                <li>
                  <strong>Figurinha com som real (🔊):</strong> ao conectar seu QR Code acima, o botão
                  verde envia a figurinha nativa direto para a conversa <em>"Você mesmo"</em> — aí é
                  só favoritar ou encaminhar para qualquer conversa ou grupo.
                </li>
                <li>
                  <strong>Copiar MP4 (Ctrl+V):</strong> gera o vídeo quadrado para colar como vídeo
                  normal no WhatsApp Web/Desktop.
                </li>
              </ul>
            </div>
          </section>
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Baseado no app original{" "}
          <a
            href="https://github.com/SilverFeit/StikSound?tab=readme-ov-file"
            target="_blank"
            rel="noopener noreferrer"
          >
            StikSound (SilverFeit/StikSound)
          </a>
          .
        </p>
      </footer>
    </div>
  );
};
