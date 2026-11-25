import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { copyFileToWindowsClipboard } from "./clipboard.js";
import {
  getFfmpegBinary,
  normalizeMatteColor,
  probeAudioDurationFromBytes,
  renderAnimatedStickerWebp,
  renderMp4,
  renderOpusAudio,
  renderWebp,
  type FitMode
} from "./media.js";
import { fetchMyInstantsAudio } from "./myinstants.js";
import { whatsappManager } from "./whatsapp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3847);
const HOST = "127.0.0.1";
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const MAX_CACHED_ARTIFACTS = 5;
const FIXED_STICKER_PACK_NAME = "ZapSom - Faeudev";

interface CachedArtifact {
  id: string;
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}

const artifactCache = new Map<string, CachedArtifact>();

function cacheArtifact(item: CachedArtifact): void {
  if (artifactCache.has(item.id)) {
    artifactCache.delete(item.id);
  }
  artifactCache.set(item.id, item);
  while (artifactCache.size > MAX_CACHED_ARTIFACTS) {
    const oldestKey = artifactCache.keys().next().value;
    if (oldestKey) artifactCache.delete(oldestKey);
    else break;
  }
}

function makeSafeBaseName(raw: string | undefined): string {
  const stem = (raw || "figurinha")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 36);
  return stem || "figurinha";
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 2
    }
  });

  app.get("/api/health", (_req, res) => {
    let hasFfmpeg = false;
    try {
      hasFfmpeg = Boolean(getFfmpegBinary());
    } catch {
      hasFfmpeg = false;
    }
    res.json({
      ok: true,
      ffmpeg: hasFfmpeg,
      platform: process.platform
    });
  });

  app.post("/api/probe-audio", upload.single("audio"), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "Envie um arquivo de áudio." });
        return;
      }
      const durationSec = await probeAudioDurationFromBytes(
        req.file.buffer,
        req.file.originalname
      );
      res.json({ durationSec });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Erro ao ler o áudio."
      });
    }
  });

  app.post("/api/myinstants", async (req, res) => {
    try {
      const url = typeof req.body?.url === "string" ? req.body.url : "";
      if (!url.trim()) {
        res.status(400).json({ error: "Cole um link válido do MyInstants." });
        return;
      }
      const result = await fetchMyInstantsAudio(url);
      res.setHeader("Content-Type", result.mimeType);
      res.setHeader("X-File-Name", encodeURIComponent(result.fileName));
      res.send(result.buffer);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Erro ao baixar áudio do MyInstants."
      });
    }
  });

  app.post(
    "/api/render",
    upload.fields([
      { name: "image", maxCount: 1 },
      { name: "audio", maxCount: 1 }
    ]),
    async (req, res) => {
      try {
        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const imageFile = files?.image?.[0];
        const audioFile = files?.audio?.[0];

        if (!imageFile) {
          res.status(400).json({ error: "Envie uma imagem, GIF ou vídeo primeiro." });
          return;
        }

        const format = req.body?.format === "webp" ? "webp" : "mp4";
        const startSec = Number(req.body?.startSec ?? 0);
        const durationSec = Number(req.body?.durationSec ?? 5);
        const cropX = Number(req.body?.cropX ?? 0.5);
        const cropY = Number(req.body?.cropY ?? 0.5);
        const fitMode: FitMode = req.body?.fitMode === "contain" ? "contain" : "cover";
        const matteColor = normalizeMatteColor(req.body?.matteColor);
        const copyToClipboard = req.body?.copyToClipboard !== "false";
        const baseName = makeSafeBaseName(req.body?.baseName || imageFile.originalname);

        let bytes: Buffer;
        let fileName: string;
        let mimeType: string;

        if (format === "webp") {
          bytes = await renderWebp({
            imageBytes: imageFile.buffer,
            imageName: imageFile.originalname,
            imageMime: imageFile.mimetype,
            cropX,
            cropY,
            fitMode
          });
          fileName = `${baseName}-figurinha.webp`;
          mimeType = "image/webp";
        } else {
          if (!audioFile) {
            res.status(400).json({ error: "Adicione um áudio antes de gerar o MP4." });
            return;
          }
          bytes = await renderMp4({
            imageBytes: imageFile.buffer,
            imageName: imageFile.originalname,
            imageMime: imageFile.mimetype,
            audioBytes: audioFile.buffer,
            audioName: audioFile.originalname,
            startSec,
            durationSec,
            cropX,
            cropY,
            fitMode,
            matteColor
          });
          fileName = `${baseName}-zapsom.mp4`;
          mimeType = "video/mp4";
        }

        const id = crypto.randomUUID();
        cacheArtifact({ id, bytes, fileName, mimeType });

        let copied = false;
        let clipboardPath: string | null = null;
        let clipboardError: string | null = null;

        if (copyToClipboard) {
          try {
            const copyRes = await copyFileToWindowsClipboard(bytes, fileName);
            copied = true;
            clipboardPath = copyRes.filePath;
          } catch (clipErr) {
            clipboardError =
              clipErr instanceof Error ? clipErr.message : "Falha ao copiar para o clipboard.";
          }
        }

        res.json({
          id,
          format,
          fileName,
          mimeType,
          sizeBytes: bytes.length,
          copied,
          clipboardPath,
          clipboardError,
          previewUrl: `/api/artifact/${id}`,
          downloadUrl: `/api/artifact/${id}?download=1`
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Erro ao processar a mídia."
        });
      }
    }
  );

  app.get("/api/artifact/:id", (req, res) => {
    const item = artifactCache.get(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Arquivo expirado. Gere novamente." });
      return;
    }
    res.setHeader("Content-Type", item.mimeType);
    if (req.query.download === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="${item.fileName}"`);
    }
    res.send(item.bytes);
  });

  app.post("/api/artifact/:id/copy", async (req, res) => {
    const item = artifactCache.get(req.params.id);
    if (!item) {
      res.status(404).json({ error: "Arquivo expirado. Gere novamente." });
      return;
    }
    try {
      const copyRes = await copyFileToWindowsClipboard(item.bytes, item.fileName);
      res.json({
        copied: true,
        clipboardPath: copyRes.filePath,
        fileName: copyRes.fileName,
        sizeBytes: copyRes.sizeBytes
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Falha ao copiar para a área de transferência."
      });
    }
  });

  app.get("/api/whatsapp/status", (_req, res) => {
    res.json(whatsappManager.getStatus());
  });

  app.post("/api/whatsapp/connect", async (_req, res) => {
    try {
      const status = await whatsappManager.connect();
      res.json(status);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Falha ao iniciar conexão com WhatsApp."
      });
    }
  });

  app.post("/api/whatsapp/logout", async (_req, res) => {
    try {
      const status = await whatsappManager.disconnect(true);
      res.json(status);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Falha ao desconectar WhatsApp."
      });
    }
  });

  app.post(
    "/api/whatsapp/send-sticker",
    upload.fields([
      { name: "image", maxCount: 1 },
      { name: "audio", maxCount: 1 }
    ]),
    async (req, res) => {
      try {
        if (whatsappManager.getStatus().status !== "connected") {
          res.status(400).json({ error: "Conecte seu WhatsApp via QR Code primeiro." });
          return;
        }

        const files = req.files as Record<string, Express.Multer.File[]> | undefined;
        const imageFile = files?.image?.[0];
        const audioFile = files?.audio?.[0];

        if (!imageFile) {
          res.status(400).json({ error: "Envie uma imagem, GIF ou vídeo primeiro." });
          return;
        }

        const withAudio = req.body?.withAudio !== "false" && Boolean(audioFile);
        const startSec = Number(req.body?.startSec ?? 0);
        const durationSec = Number(req.body?.durationSec ?? 5);
        const cropX = Number(req.body?.cropX ?? 0.5);
        const cropY = Number(req.body?.cropY ?? 0.5);
        const fitMode: FitMode = req.body?.fitMode === "contain" ? "contain" : "cover";
        const targetPhone = typeof req.body?.targetPhone === "string" ? req.body.targetPhone : undefined;

        if (withAudio && audioFile) {
          const [stickerRes, audioRes] = await Promise.all([
            renderAnimatedStickerWebp({
              imageBytes: imageFile.buffer,
              imageName: imageFile.originalname,
              imageMime: imageFile.mimetype,
              durationSec,
              cropX,
              cropY,
              fitMode,
              packName: FIXED_STICKER_PACK_NAME,
              publisher: ""
            }),
            renderOpusAudio({
              audioBytes: audioFile.buffer,
              audioName: audioFile.originalname,
              startSec,
              durationSec
            })
          ]);

          const sent = await whatsappManager.sendNativeSoundSticker(
            targetPhone,
            stickerRes.webp,
            audioRes.audio,
            audioRes.durationMs
          );

          res.json({
            ok: true,
            messageId: sent.messageId,
            targetJid: sent.targetJid,
            withAudio: true,
            stickerBytes: stickerRes.webp.length,
            audioBytes: audioRes.audio.length
          });
          return;
        }

        const webp = await renderWebp({
          imageBytes: imageFile.buffer,
          imageName: imageFile.originalname,
          imageMime: imageFile.mimetype,
          cropX,
          cropY,
          fitMode,
          packName: FIXED_STICKER_PACK_NAME,
          publisher: ""
        });
        const sent = await whatsappManager.sendNativeRegularSticker(targetPhone, webp);
        res.json({
          ok: true,
          messageId: sent.messageId,
          targetJid: sent.targetJid,
          withAudio: false,
          stickerBytes: webp.length,
          audioBytes: 0
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : "Erro ao enviar figurinha para o WhatsApp."
        });
      }
    }
  );

  // Production static frontend serving when dist/ exists
  const distDir = path.resolve(__dirname, "..", "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get("/{*splat}", (req, res, next) => {
      if (req.path.startsWith("/api/")) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  return app;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  whatsappManager.initIfSessionExists();
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`ZapSom API rodando em http://${HOST}:${PORT}`);
  });
}
