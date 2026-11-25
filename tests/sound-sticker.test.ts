import { proto } from "@whiskeysockets/baileys";
import { describe, expect, it } from "vitest";
import {
  buildSoundStickerWrapper,
  installSoundStickerEncoder,
  SOUND_STICKER_BYTES
} from "../server/sound-sticker.js";

describe("WhatsApp native sound-sticker protobuf encoding", () => {
  it("encodes FutureProofMessage (134) wrapping StickerMessage (26) + AudioMessage (26)", () => {
    const sticker: proto.Message.IStickerMessage = {
      url: "https://mmg.whatsapp.net/v/t62.15575-24/sticker.enc",
      mimetype: "image/webp",
      height: 512,
      width: 512,
      isAnimated: true
    };
    const audio: proto.Message.IAudioMessage = {
      url: "https://mmg.whatsapp.net/v/t62.7114-24/audio.enc",
      mimetype: "audio/ogg; codecs=opus",
      seconds: 3
    };

    const wrapper = buildSoundStickerWrapper(sticker, audio);
    expect(wrapper.length).toBeGreaterThan(30);

    // Outer FutureProofMessage.message = field 1, wire type 2 -> tag 0x0a
    expect(wrapper[0]).toBe(0x0a);

    installSoundStickerEncoder();

    const markedMsg: proto.IMessage & { [SOUND_STICKER_BYTES]?: Uint8Array } = {
      stickerMessage: sticker,
      [SOUND_STICKER_BYTES]: wrapper
    };
    const encodedMarked = Buffer.from(proto.Message.encode(markedMsg).finish());

    // Field 134, wire type 2 => (134 << 3) | 2 = 1074 => varint [0xb2, 0x08]
    expect(encodedMarked.includes(Buffer.from([0xb2, 0x08]))).toBe(true);
    // Plain field 26 stickerMessage tag (26 << 3 | 2 = 0xd2, 0x01) must NOT be at root
    expect(encodedMarked.subarray(0, 2).equals(Buffer.from([0xd2, 0x01]))).toBe(false);

    // Unmarked regular message must pass through untouched
    const normalEncoded = Buffer.from(
      proto.Message.encode({ conversation: "oi" }).finish()
    );
    expect(normalEncoded.includes(Buffer.from([0xb2, 0x08]))).toBe(false);
    const decoded = proto.Message.decode(normalEncoded);
    expect(decoded.conversation).toBe("oi");
  });
});
