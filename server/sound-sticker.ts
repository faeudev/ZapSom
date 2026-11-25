import { createCipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  generateWAMessageFromContent,
  getMediaKeys,
  prepareWAMessageMedia,
  proto,
  type WAMessage,
  type WASocket
} from "@whiskeysockets/baileys";

const FIELD_STICKER = 26; // Message.stickerMessage
const FIELD_STICKER_AUDIO = 26; // StickerMessage.<audioMessage>
const FIELD_SOUND_WRAPPER = 134; // Message.<FutureProofMessage for sound sticker>
const FIELD_FUTURE_PROOF_MESSAGE = 1;
const SIDECAR_CHUNK = 64 * 1024;

export const SOUND_STICKER_BYTES = Symbol.for("zapsom.sound-sticker.wrapper");
type MarkedMessage = proto.IMessage & { [SOUND_STICKER_BYTES]?: Uint8Array };

function varint(value: number): Buffer {
  const bytes: number[] = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value) byte |= 0x80;
    bytes.push(byte);
  } while (value);
  return Buffer.from(bytes);
}

function lengthField(field: number, payload: Uint8Array): Buffer {
  return Buffer.concat([varint(field * 8 + 2), varint(payload.length), payload]);
}

/**
 * Encodes FutureProofMessage (field 134) wrapping Message.26 (StickerMessage) -> StickerMessage.26 (AudioMessage).
 */
export function buildSoundStickerWrapper(
  sticker: proto.Message.IStickerMessage,
  audio: proto.Message.IAudioMessage
): Buffer {
  const stickerBytes = Buffer.concat([
    proto.Message.StickerMessage.encode(sticker).finish(),
    lengthField(FIELD_STICKER_AUDIO, proto.Message.AudioMessage.encode(audio).finish())
  ]);
  const innerMessage = lengthField(FIELD_STICKER, stickerBytes);
  return lengthField(FIELD_FUTURE_PROOF_MESSAGE, innerMessage);
}

let encoderInstalled = false;

/**
 * Idempotently patches proto.Message.encode so only messages tagged with SOUND_STICKER_BYTES
 * emit field 134 instead of plain field 26.
 */
export function installSoundStickerEncoder(): void {
  if (encoderInstalled) return;
  const original = proto.Message.encode;
  const patched = function encode(message: MarkedMessage, writer?: Parameters<typeof original>[1]) {
    const wrapper = message?.[SOUND_STICKER_BYTES];
    if (!wrapper) {
      return original.call(proto.Message, message, writer);
    }
    const { stickerMessage: _keepOnlyForBaileysStanza, ...rest } = message;
    const out = original.call(proto.Message, rest, writer);
    out.uint32(FIELD_SOUND_WRAPPER * 8 + 2).bytes(wrapper);
    return out;
  };
  proto.Message.encode = patched as typeof original;
  encoderInstalled = true;
}

export async function createStreamingSidecar(
  audio: Buffer,
  mediaKey: Uint8Array,
  fileEncSha256: Uint8Array
): Promise<Buffer> {
  const { iv, cipherKey, macKey } = await getMediaKeys(Buffer.from(mediaKey), "audio");
  if (!iv || !cipherKey || !macKey) {
    throw new Error("Não foi possível derivar as chaves de mídia do áudio.");
  }

  const cipher = createCipheriv("aes-256-cbc", cipherKey, iv);
  const encrypted = Buffer.concat([cipher.update(audio), cipher.final()]);
  const mac = createHmac("sha256", macKey).update(iv).update(encrypted).digest().subarray(0, 10);
  const hash = createHash("sha256").update(encrypted).update(mac).digest();

  if (hash.length !== fileEncSha256.length || !timingSafeEqual(hash, Buffer.from(fileEncSha256))) {
    throw new Error("Falha ao validar o áudio cifrado para o sidecar.");
  }

  const parts: Buffer[] = [];
  for (let start = 0; start < encrypted.length; start += SIDECAR_CHUNK) {
    const previous = start === 0 ? iv : encrypted.subarray(start - 16, start);
    const chunk = encrypted.subarray(start, start + SIDECAR_CHUNK);
    parts.push(createHmac("sha256", macKey).update(previous).update(chunk).digest().subarray(0, 10));
  }
  return Buffer.concat(parts);
}

export interface SoundStickerInput {
  sticker: Buffer;
  audio: Buffer;
  durationMs: number;
  quoted?: WAMessage;
}

export async function sendSoundSticker(
  socket: WASocket,
  jid: string,
  input: SoundStickerInput
): Promise<string> {
  if (!socket.user?.id) {
    throw new Error("WhatsApp ainda não está conectado.");
  }

  const options = { upload: socket.waUploadToServer, mediaUploadTimeoutMs: 60_000 };

  const [visual, sound] = await Promise.all([
    prepareWAMessageMedia(
      { sticker: input.sticker, isAnimated: true, width: 512, height: 512 },
      options
    ),
    prepareWAMessageMedia(
      {
        audio: input.audio,
        mimetype: "audio/ogg; codecs=opus",
        seconds: Math.max(1, Math.ceil(input.durationMs / 1000))
      },
      options
    )
  ]);

  const audioMessage = sound.audioMessage;
  if (!visual.stickerMessage || !audioMessage?.mediaKey || !audioMessage.fileEncSha256) {
    throw new Error("Falha ao preparar o upload da figurinha e do áudio.");
  }

  audioMessage.streamingSidecar = await createStreamingSidecar(
    input.audio,
    audioMessage.mediaKey,
    audioMessage.fileEncSha256
  );

  const message = generateWAMessageFromContent(jid, visual, {
    userJid: socket.user.id,
    quoted: input.quoted
  });
  const content = message.message as MarkedMessage | null | undefined;
  if (!content?.stickerMessage || !message.key.id) {
    throw new Error("Falha ao montar a mensagem da figurinha com som.");
  }

  content.stickerMessage.isAnimated = true;
  content[SOUND_STICKER_BYTES] = buildSoundStickerWrapper(content.stickerMessage, audioMessage);

  installSoundStickerEncoder();
  await socket.relayMessage(jid, content, { messageId: message.key.id });
  return message.key.id;
}

export async function sendRegularSticker(
  socket: WASocket,
  jid: string,
  sticker: Buffer
): Promise<string> {
  if (!socket.user?.id) {
    throw new Error("WhatsApp ainda não está conectado.");
  }
  const sent = await socket.sendMessage(jid, { sticker });
  return sent?.key?.id ?? "";
}
