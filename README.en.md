<div align="center">

<img src="docs/assets/zapsom-icon.svg" alt="ZapSom Icon" width="120" height="120" />

# ZapSom

**Create and send native WhatsApp sound stickers (🔊 badge) by combining any image, GIF, or short video with an exact audio clip — 100% local, with zero external servers.**

🇧🇷 [Português](README.md) · 🇺🇸 **English**

[![Download Release](https://img.shields.io/github/v/release/faeudev/ZapSom?style=for-the-badge&label=Download&color=25D366)](https://github.com/faeudev/ZapSom/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/faeudev/ZapSom/ci.yml?style=for-the-badge&label=CI)](https://github.com/faeudev/ZapSom/actions/workflows/ci.yml)

[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20macOS%20%7C%20Linux-25D366?style=flat-square)](#download-and-run-releases)
[![Processing](https://img.shields.io/badge/Processing-100%25%20local-00a884?style=flat-square)](#privacy-and-disclaimers)
[![License](https://img.shields.io/badge/License-MIT-6366f1?style=flat-square)](LICENSE)

[**Download Release**](#download-and-run-releases) · [**Step-by-step Tutorial**](#step-by-step-tutorial) · [**Development**](#development) · [**Credits**](#credits-and-inspiration)

</div>

---

## What ZapSom does

**ZapSom** is a local-first web studio styled after WhatsApp Web Dark Mode that merges visuals and trimmed audio in seconds:

- **Direct native WhatsApp sound stickers (🔊):** link your WhatsApp once via QR Code and send real sound stickers (`512×512 WebP + Ogg/Opus`) straight to your *"Message Yourself"* chat (or any target number), ready to favorite and forward.
- **Full-track interactive audio trimmer:** load multi-minute audio files (e.g. 5+ minutes, up to 60 MB), scrub via the overview minimap, zoom with your mouse wheel, listen to the full track, and cut the exact `0.2s–10.0s` snippet.
- **Flexible visual inputs:** `PNG` (with alpha transparency), `JPG`, `WebP`, animated `GIF`, short videos (`MP4`, `MOV`, `WebM`), or direct `Ctrl+V` clipboard paste.
- **1:1 square framing:** **Fill 1:1** (`cover` with pointer drag positioning) or **Fit whole image** (`contain` with transparent sticker borders or custom MP4 matte color).
- **MyInstants integration:** paste `myinstants.com` URLs to fetch sounds directly from the local backend.
- **Local file export:** copy a `512×512` square MP4 to the Windows clipboard (`Ctrl+V`) or download `MP4` / `WebP` files.

---

## Download and Run (Releases)

Prebuilt releases bundle **portable Node.js** and **`ffmpeg-static`** — **no external tools or dependencies required**.

1. Open [**Releases**](https://github.com/faeudev/ZapSom/releases/latest).
2. Download the package for your operating system:

| OS | Package | How to launch |
| --- | --- | --- |
| **Windows (x64)** | `ZapSom-*-windows-x64.zip` | Extract the ZIP and double-click **`ZapSom.bat`** |
| **macOS (Apple Silicon)** | `ZapSom-*-macos-arm64.zip` | Extract the ZIP and run **`ZapSom.command`** *(right-click → Open if Gatekeeper asks)* |
| **Linux (x64)** | `ZapSom-*-linux-x64.tar.gz` | Extract the `.tar.gz` and run **`./zapsom.sh`** |

Your browser opens automatically at `http://127.0.0.1:3847`.

---

## Step-by-step tutorial

### 1. Load an image, GIF, or short video
- Drop a file onto **Step 1**, click to browse, or press **`Ctrl+V`** with a copied image.
- Choose **Preencher 1:1** (drag on the preview to reframe) or **Ajustar inteiro**.

### 2. Pick and trim the audio
- Drop an audio file (`MP3`, `WAV`, `OGG`, `M4A`, `AAC` — up to 60 MB), click **Escolher áudio**, or paste a **`myinstants.com`** URL and click **Buscar**.
- On long tracks, use the **minimap** and **zoom** (mouse wheel or `+` / `−` / `Focar trecho`) to navigate the full duration.
- Play the full track (`🔊 Ouvir completo`) and click **`✂️ Início aqui`** / **`✂️ Fim aqui`**, or drag the green handles and fine-tune (`0.2s` to `10.0s`).
- Preview the isolated selection with **`▶ Ouvir trecho`**.

### 3. Connect WhatsApp and send
1. Click **Conectar WhatsApp (QR Code)**.
2. On your phone, go to **WhatsApp → Linked Devices → Link a Device** and scan the QR Code.
3. *(Optional)* Enter a target phone number (`country + area + number`) or leave it blank to send to **"Message Yourself"**.
4. Click **Enviar Figurinha com Som direto pro WhatsApp**.
5. Tap the sticker in WhatsApp to play the sound 🔊, favorite it, and forward it anywhere!

---

## Development

### Requirements
- [Node.js 22+](https://nodejs.org/) and npm 10+

### Run from source

```bash
git clone https://github.com/faeudev/ZapSom.git
cd ZapSom
npm install
npm run dev
```

- Frontend (Vite): `http://127.0.0.1:5173`
- Local API (Express): `http://127.0.0.1:3847`

### Available scripts

```bash
npm run typecheck   # TypeScript checks (frontend + server)
npm test            # Run automated unit tests (Vitest)
npm run build       # Build frontend (dist/) and server (dist-server/)
npm start           # Serve production build at http://127.0.0.1:3847
```

---

## Troubleshooting

| Issue | Solution |
| --- | --- |
| QR Code stays on connecting or times out | Click **Cancelar** and try connecting again; check your internet connection. |
| Session disconnected from phone | Click **Conectar WhatsApp (QR Code)** to scan a fresh QR Code. |
| Sticker arrives without audio | Make sure the selected snippet has audible audio and is between `0.2s` and `10s`, and update WhatsApp on your phone. |
| Large audio file rejected | Local upload limit is **60 MB** per file. |

---

## Privacy and disclaimers

- **100% local processing:** media files and session keys never leave your computer to any third-party service. All transcoding runs locally with `ffmpeg-static`.
- **WhatsApp session folder:** credentials live in `whatsapp-session/` (ignored by `.gitignore` — **never share or commit** it).
- **Unofficial protocol notice:** direct sound-sticker sending relies on [Baileys](https://github.com/WhiskeySockets/Baileys) (an unofficial WhatsApp Web client) and a reverse-engineered protobuf wrapper. Future WhatsApp updates may affect compatibility. Use at your own risk; this project is not affiliated with WhatsApp or Meta.

---

## Credits and inspiration

- Based on the original **[SilverFeit/StikSound](https://github.com/SilverFeit/StikSound?tab=readme-ov-file)** application, adapted for local PT-BR workflows with direct WhatsApp sound-sticker delivery and a full-track timeline editor.
- Sound-sticker protobuf envelope approach inspired by [coelhobugado/whatsapp-figurinhas-com-som](https://github.com/coelhobugado/whatsapp-figurinhas-com-som).

## License

Licensed under the **MIT License**. See [LICENSE](LICENSE) for details.
