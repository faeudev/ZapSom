import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion,
  jidDecode,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WAVersion,
  type WASocket
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { sendRegularSticker, sendSoundSticker } from "./sound-sticker.js";

export type WhatsAppConnectionStatus = "disconnected" | "connecting" | "qr" | "connected";

export interface WhatsAppStatusSnapshot {
  status: WhatsAppConnectionStatus;
  qrDataUrl: string | null;
  userPhone: string | null;
  userName: string | null;
  lastError: string | null;
}

const DEFAULT_SESSION_DIR = path.resolve(process.cwd(), "whatsapp-session");
const MAX_TRANSIENT_RETRIES = 4;
const logger = pino({ level: "silent" });

async function resolveWhatsAppVersion(): Promise<WAVersion | undefined> {
  try {
    const waWeb = await fetchLatestWaWebVersion({});
    if (waWeb?.version) return waWeb.version;
  } catch {
    // fallback below
  }
  try {
    const baileysVer = await fetchLatestBaileysVersion();
    if (baileysVer?.version) return baileysVer.version;
  } catch {
    // use Baileys bundled fallback
  }
  return undefined;
}

export class WhatsAppSessionManager {
  private socket: WASocket | null = null;
  private isStarting = false;
  private status: WhatsAppConnectionStatus = "disconnected";
  private qrDataUrl: string | null = null;
  private userPhone: string | null = null;
  private userName: string | null = null;
  private lastError: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private intentionalClose = false;
  private readonly sessionDir: string;

  constructor(sessionDir = DEFAULT_SESSION_DIR) {
    this.sessionDir = sessionDir;
  }

  public getStatus(): WhatsAppStatusSnapshot {
    return {
      status: this.status,
      qrDataUrl: this.qrDataUrl,
      userPhone: this.userPhone,
      userName: this.userName,
      lastError: this.lastError
    };
  }

  public initIfSessionExists(): void {
    const credsPath = path.join(this.sessionDir, "creds.json");
    if (fs.existsSync(credsPath)) {
      this.connect().catch((err) => {
        this.lastError =
          err instanceof Error ? err.message : "Falha ao restaurar sessão do WhatsApp.";
      });
    }
  }

  public async connect(): Promise<WhatsAppStatusSnapshot> {
    if (this.status === "connected" || this.status === "qr" || this.socket || this.isStarting) {
      return this.getStatus();
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.lastError = null;
    this.status = "connecting";
    this.qrDataUrl = null;

    await this.startSocket();
    return this.getStatus();
  }

  private async startSocket(): Promise<void> {
    if (this.isStarting || this.intentionalClose) return;
    this.isStarting = true;

    try {
      await fsp.mkdir(this.sessionDir, { recursive: true });
      const [{ state, saveCreds }, version] = await Promise.all([
        useMultiFileAuthState(this.sessionDir),
        resolveWhatsAppVersion()
      ]);

      if (this.intentionalClose) {
        this.status = "disconnected";
        return;
      }

      const sock = makeWASocket({
        auth: state,
        version,
        logger,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        browser: ["ZapSom", "Chrome", "1.0.0"]
      });

      this.socket = sock;

      sock.ev.on("creds.update", () => {
        saveCreds().catch(() => undefined);
      });

      sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (this.socket !== sock) return;

        if (qr) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr, { width: 260, margin: 2 });
            this.status = "qr";
            this.lastError = null;
            this.reconnectAttempt = 0;
            console.log("[WhatsApp] QR Code pronto para leitura.");
          } catch {
            this.lastError = "Falha ao gerar imagem do QR Code.";
          }
        }

        if (connection === "open") {
          this.reconnectAttempt = 0;
          this.status = "connected";
          this.qrDataUrl = null;
          this.lastError = null;
          const decoded = sock.user?.id ? jidDecode(sock.user.id) : null;
          this.userPhone = decoded?.user ?? null;
          this.userName = sock.user?.name ?? null;
          console.log(`[WhatsApp] Conectado (${this.userPhone ?? "usuário"}).`);
        }

        if (connection === "close") {
          this.qrDataUrl = null;
          this.socket = null;

          const errObj = lastDisconnect?.error as
            | { message?: string; output?: { statusCode?: number } }
            | undefined;
          const statusCode = errObj?.output?.statusCode;
          const errMsg = errObj?.message;

          if (this.intentionalClose) {
            this.status = "disconnected";
            this.userPhone = null;
            this.userName = null;
            return;
          }

          console.warn(
            `[WhatsApp] Conexão encerrada (código=${statusCode ?? "?"}): ${errMsg ?? "sem detalhes"}`
          );

          if (statusCode === DisconnectReason.loggedOut) {
            this.status = "disconnected";
            this.userPhone = null;
            this.userName = null;
            this.lastError = "Sessão desconectada no celular. Gere um novo QR Code.";
            await fsp.rm(this.sessionDir, { recursive: true, force: true }).catch(() => undefined);
            return;
          }

          if (statusCode === DisconnectReason.connectionReplaced) {
            this.status = "disconnected";
            this.lastError = "Sessão substituída por outra instância.";
            return;
          }

          if (statusCode === DisconnectReason.forbidden) {
            this.status = "disconnected";
            this.lastError = "WhatsApp recusou a conexão (403).";
            return;
          }

          const isRestart = statusCode === DisconnectReason.restartRequired;
          if (!isRestart) {
            this.reconnectAttempt++;
          }

          if (this.reconnectAttempt > MAX_TRANSIENT_RETRIES) {
            this.status = "disconnected";
            this.lastError = `Não foi possível conectar ao WhatsApp (código ${statusCode ?? "?"}${errMsg ? `: ${errMsg}` : ""}). Tente novamente.`;
            return;
          }

          const delayMs = isRestart
            ? 500
            : Math.min(15_000, 1500 * 2 ** Math.max(0, this.reconnectAttempt - 1));

          this.status = "connecting";
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
          this.reconnectTimer = setTimeout(() => {
            this.startSocket().catch((err) => {
              this.status = "disconnected";
              this.lastError = err instanceof Error ? err.message : "Erro ao reconectar.";
            });
          }, delayMs);
        }
      });
    } catch (err) {
      this.socket = null;
      this.status = "disconnected";
      this.lastError =
        err instanceof Error ? err.message : "Falha ao iniciar conexão com o WhatsApp.";
      console.error("[WhatsApp] Erro ao iniciar socket:", err);
    } finally {
      this.isStarting = false;
    }
  }

  public async disconnect(clearAuth = true): Promise<WhatsAppStatusSnapshot> {
    this.intentionalClose = true;
    this.reconnectAttempt = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const sock = this.socket;
    this.socket = null;
    if (sock) {
      try {
        if (clearAuth && this.status === "connected") {
          await sock.logout().catch(() => undefined);
        }
        sock.end(undefined);
      } catch {
        // ignore close errors
      }
    }

    if (clearAuth) {
      await fsp.rm(this.sessionDir, { recursive: true, force: true }).catch(() => undefined);
    }

    this.status = "disconnected";
    this.qrDataUrl = null;
    this.userPhone = null;
    this.userName = null;
    this.lastError = null;
    return this.getStatus();
  }

  public resolveTargetJid(phoneInput?: string): string {
    if (!this.socket?.user?.id || this.status !== "connected") {
      throw new Error("Conecte seu WhatsApp via QR Code primeiro.");
    }
    const trimmed = (phoneInput ?? "").trim();
    if (!trimmed) {
      return jidNormalizedUser(this.socket.user.id);
    }
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      throw new Error(
        "Número inválido. Informe DDI + DDD + número (ex: 5511999998888) ou deixe vazio."
      );
    }
    return `${digits}@s.whatsapp.net`;
  }

  public async sendNativeSoundSticker(
    targetPhone: string | undefined,
    sticker: Buffer,
    audio: Buffer,
    durationMs: number
  ): Promise<{ messageId: string; targetJid: string }> {
    const jid = this.resolveTargetJid(targetPhone);
    const messageId = await sendSoundSticker(this.socket!, jid, {
      sticker,
      audio,
      durationMs
    });
    return { messageId, targetJid: jid };
  }

  public async sendNativeRegularSticker(
    targetPhone: string | undefined,
    sticker: Buffer
  ): Promise<{ messageId: string; targetJid: string }> {
    const jid = this.resolveTargetJid(targetPhone);
    const messageId = await sendRegularSticker(this.socket!, jid, sticker);
    return { messageId, targetJid: jid };
  }
}

export const whatsappManager = new WhatsAppSessionManager();
