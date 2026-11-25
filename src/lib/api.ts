export interface HealthResponse {
  ok: boolean;
  ffmpeg: boolean;
  platform: string;
}

export interface WhatsAppStatus {
  status: "disconnected" | "connecting" | "qr" | "connected";
  qrDataUrl: string | null;
  userPhone: string | null;
  userName: string | null;
  lastError: string | null;
}

export interface SendWhatsAppStickerParams {
  imageFile: File;
  audioFile: File | null;
  withAudio: boolean;
  startSec: number;
  durationSec: number;
  cropX: number;
  cropY: number;
  fitMode: "cover" | "contain";
  targetPhone: string;
}

export interface SendWhatsAppStickerResponse {
  ok: boolean;
  messageId: string;
  targetJid: string;
  withAudio: boolean;
  stickerBytes: number;
  audioBytes: number;
}

export interface RenderResponse {
  id: string;
  format: "mp4" | "webp";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  copied: boolean;
  clipboardPath: string | null;
  clipboardError: string | null;
  previewUrl: string;
  downloadUrl: string;
}

export interface RenderRequestParams {
  imageFile: File;
  audioFile: File | null;
  format: "mp4" | "webp";
  startSec: number;
  durationSec: number;
  cropX: number;
  cropY: number;
  fitMode: "cover" | "contain";
  matteColor: string;
  copyToClipboard: boolean;
  baseName: string;
}

async function parseErrorMessage(resp: Response, fallback: string): Promise<string> {
  try {
    const data = (await resp.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // ignore JSON parse error
  }
  return fallback;
}

export async function checkHealth(): Promise<HealthResponse> {
  const resp = await fetch("/api/health");
  if (!resp.ok) {
    throw new Error("Servidor local indisponível.");
  }
  return (await resp.json()) as HealthResponse;
}

export async function getWhatsAppStatusApi(): Promise<WhatsAppStatus> {
  const resp = await fetch("/api/whatsapp/status");
  if (!resp.ok) {
    throw new Error("Não foi possível verificar o status do WhatsApp.");
  }
  return (await resp.json()) as WhatsAppStatus;
}

export async function connectWhatsAppApi(): Promise<WhatsAppStatus> {
  const resp = await fetch("/api/whatsapp/connect", { method: "POST" });
  if (!resp.ok) {
    throw new Error(await parseErrorMessage(resp, "Falha ao conectar WhatsApp."));
  }
  return (await resp.json()) as WhatsAppStatus;
}

export async function logoutWhatsAppApi(): Promise<WhatsAppStatus> {
  const resp = await fetch("/api/whatsapp/logout", { method: "POST" });
  if (!resp.ok) {
    throw new Error(await parseErrorMessage(resp, "Falha ao desconectar WhatsApp."));
  }
  return (await resp.json()) as WhatsAppStatus;
}

export async function sendWhatsAppStickerApi(
  params: SendWhatsAppStickerParams
): Promise<SendWhatsAppStickerResponse> {
  const form = new FormData();
  form.append("image", params.imageFile);
  if (params.audioFile) {
    form.append("audio", params.audioFile);
  }
  form.append("withAudio", String(params.withAudio));
  form.append("startSec", String(params.startSec));
  form.append("durationSec", String(params.durationSec));
  form.append("cropX", String(params.cropX));
  form.append("cropY", String(params.cropY));
  form.append("fitMode", params.fitMode);
  form.append("targetPhone", params.targetPhone);

  const resp = await fetch("/api/whatsapp/send-sticker", { method: "POST", body: form });
  if (!resp.ok) {
    throw new Error(await parseErrorMessage(resp, "Erro ao enviar figurinha para o WhatsApp."));
  }
  return (await resp.json()) as SendWhatsAppStickerResponse;
}

export async function probeAudioDurationApi(file: File): Promise<number> {
  const form = new FormData();
  form.append("audio", file);
  const resp = await fetch("/api/probe-audio", { method: "POST", body: form });
  if (!resp.ok) {
    throw new Error(await parseErrorMessage(resp, "Não foi possível ler o áudio."));
  }
  const data = (await resp.json()) as { durationSec: number };
  return data.durationSec;
}

export async function fetchMyInstantsApi(url: string): Promise<File> {
  const resp = await fetch("/api/myinstants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  if (!resp.ok) {
    throw new Error(await parseErrorMessage(resp, "Não foi possível baixar o som do MyInstants."));
  }
  const rawHeader = resp.headers.get("X-File-Name");
  const fileName = rawHeader ? decodeURIComponent(rawHeader) : "myinstants.mp3";
  const mimeType = resp.headers.get("Content-Type") || "audio/mpeg";
  const blob = await resp.blob();
  return new File([blob], fileName, { type: mimeType });
}

export async function renderMediaApi(params: RenderRequestParams): Promise<RenderResponse> {
  const form = new FormData();
  form.append("image", params.imageFile);
  if (params.audioFile) {
    form.append("audio", params.audioFile);
  }
  form.append("format", params.format);
  form.append("startSec", String(params.startSec));
  form.append("durationSec", String(params.durationSec));
  form.append("cropX", String(params.cropX));
  form.append("cropY", String(params.cropY));
  form.append("fitMode", params.fitMode);
  form.append("matteColor", params.matteColor);
  form.append("copyToClipboard", String(params.copyToClipboard));
  form.append("baseName", params.baseName);

  const resp = await fetch("/api/render", { method: "POST", body: form });
  if (!resp.ok) {
    throw new Error(await parseErrorMessage(resp, "Erro ao gerar arquivo."));
  }
  return (await resp.json()) as RenderResponse;
}

export async function recopyArtifactApi(
  id: string
): Promise<{ copied: boolean; clipboardPath: string | null }> {
  const resp = await fetch(`/api/artifact/${encodeURIComponent(id)}/copy`, {
    method: "POST"
  });
  if (!resp.ok) {
    throw new Error(await parseErrorMessage(resp, "Falha ao copiar novamente."));
  }
  return (await resp.json()) as { copied: boolean; clipboardPath: string | null };
}
