<div align="center">

<img src="docs/assets/zapsom-icon.svg" alt="ZapSom Icon" width="120" height="120" />

# ZapSom

**Crie e envie figurinhas com áudio (ícone 🔊) direto para o seu WhatsApp, combinando qualquer imagem, GIF ou vídeo curto com um trecho exato de áudio — 100% local, sem servidores externos.**

🇧🇷 **Português** · 🇺🇸 [English](README.en.md)

[![Baixar Release](https://img.shields.io/github/v/release/faeudev/ZapSom?style=for-the-badge&label=Baixar&color=25D366)](https://github.com/faeudev/ZapSom/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/faeudev/ZapSom/ci.yml?style=for-the-badge&label=CI)](https://github.com/faeudev/ZapSom/actions/workflows/ci.yml)

[![Plataformas](https://img.shields.io/badge/Plataformas-Windows%20%7C%20macOS%20%7C%20Linux-25D366?style=flat-square)](#baixar-e-usar-releases)
[![Processamento](https://img.shields.io/badge/Processamento-100%25%20local-00a884?style=flat-square)](#privacidade-e-avisos)
[![Licença](https://img.shields.io/badge/Licen%C3%A7a-MIT-6366f1?style=flat-square)](LICENSE)

[**Baixar Release**](#baixar-e-usar-releases) · [**Tutorial passo a passo**](#tutorial-passo-a-passo) · [**Desenvolvimento**](#desenvolvimento) · [**Créditos**](#créditos-e-inspiração)

</div>

---

## O que é o ZapSom

O **ZapSom** é uma aplicação local com visual inspirado no WhatsApp Web Dark Mode que junta uma mídia visual e um trecho de áudio em segundos:

- **Figurinha nativa com som (🔊) direto no WhatsApp:** conecte via QR Code uma única vez e envie a figurinha com áudio (`WebP 512×512 + Ogg/Opus`) direto para a sua conversa *"Você mesmo"* (ou para outro número), pronta para favoritar e encaminhar.
- **Editor completo da linha do tempo do áudio:** carregue áudios longos (ex.: 5 minutos, até 60 MB), navegue pelo minimapa da faixa inteira, dê zoom com a roda do mouse, ouça a faixa completa e recorte exatamente o trecho desejado (`0,2s` a `10,0s`).
- **Suporte a múltiplas entradas visuais:** `PNG` (com transparência), `JPG`, `WebP`, `GIF` animado e vídeos curtos (`MP4`, `MOV`, `WebM`) ou colando direto com `Ctrl+V`.
- **Enquadramento 1:1:** modo **Preencher 1:1** (arrastando o recorte na imagem) ou **Ajustar inteiro** (com transparência na figurinha ou cor de fundo no MP4).
- **Links do MyInstants:** cole links de `myinstants.com` para baixar o áudio automaticamente no backend local.
- **Exportação local também disponível:** copie um **MP4 quadrado (`512×512`)** direto para a área de transferência do Windows (`Ctrl+V`) ou baixe em `MP4` / `WebP`.
- **Pacote EXIF padrão:** gravado automaticamente como `ZapSom - Faeudev`.

---

## Baixar e Usar (Releases)

As builds prontas incluem o **Node.js portátil** e o **FFmpeg (`ffmpeg-static`)** embutidos — **não é necessário instalar nada extra**.

1. Acesse [**Releases**](https://github.com/faeudev/ZapSom/releases/latest).
2. Baixe o pacote do seu sistema:

| Sistema | Arquivo | Como abrir |
| --- | --- | --- |
| **Windows (x64)** | `ZapSom-*-windows-x64.zip` | Extraia o ZIP em uma pasta e dê duplo clique em **`ZapSom.bat`** |
| **macOS (Apple Silicon)** | `ZapSom-*-macos-arm64.zip` | Extraia o ZIP e execute **`ZapSom.command`** *(se pedir permissão, clique direito → Abrir)* |
| **Linux (x64)** | `ZapSom-*-linux-x64.tar.gz` | Extraia o `.tar.gz` e execute **`./zapsom.sh`** |

O navegador abrirá automaticamente em `http://127.0.0.1:3847`.

---

## Tutorial passo a passo

### 1. Adicione a imagem, GIF ou vídeo
- Arraste o arquivo para a área **1 (Imagem, GIF ou Vídeo)**, clique para escolher ou pressione **`Ctrl+V`** com uma imagem copiada.
- Escolha **Preencher 1:1** (arraste sobre a prévia para centralizar) ou **Ajustar inteiro**.

### 2. Escolha e recorte o áudio
- Arraste um arquivo de áudio (`MP3`, `WAV`, `OGG`, `M4A`, `AAC` — até 60 MB), clique em **Escolher áudio** ou cole um link de **`myinstants.com`** e clique em **Buscar**.
- Em áudios longos, use o **minimapa superior** e o **zoom** (roda do mouse ou botões `+` / `−` / `Focar trecho`) para navegar por toda a faixa.
- Clique em **`🔊 Ouvir completo`**, posicione a linha na hora exata e use **`✂️ Início aqui`** / **`✂️ Fim aqui`**, ou arraste as alças verdes e ajuste fino (`−0.1s` / `+0.1s`, entre `0.2s` e `10.0s`).
- Use **`▶ Ouvir trecho`** para conferir apenas o recorte final.

### 3. Conecte o WhatsApp e envie
1. No bloco **Conexão direta com WhatsApp**, clique em **Conectar WhatsApp (QR Code)**.
2. No celular, abra **WhatsApp → Aparelhos conectados → Conectar aparelho** e escaneie o QR Code.
3. *(Opcional)* Informe um número com `DDI + DDD + número` em **Enviar para**, ou deixe vazio para mandar para a sua conversa **"Você mesmo"**.
4. Clique em **`Enviar Figurinha com Som direto pro WhatsApp`**.
5. Abra o WhatsApp, toque na figurinha recebida para testar o som 🔊, favorite e encaminhe para qualquer conversa ou grupo!

> **Dica:** Se preferir não conectar o WhatsApp, você também pode usar **Copiar MP4 (Ctrl+V)** no Windows ou **Baixar MP4 / Baixar WebP**.

---

## Desenvolvimento

### Requisitos
- [Node.js 22+](https://nodejs.org/) e npm 10+

### Rodar localmente

```bash
git clone https://github.com/faeudev/ZapSom.git
cd ZapSom
npm install
npm run dev
```

- Frontend (Vite): `http://127.0.0.1:5173`
- API local (Express): `http://127.0.0.1:3847`

### Scripts disponíveis

```bash
npm run typecheck   # Verifica TypeScript (frontend + servidor)
npm test            # Executa os testes automatizados (Vitest)
npm run build       # Compila frontend (dist/) e servidor (dist-server/)
npm start           # Inicia a versão compilada em http://127.0.0.1:3847
```

---

## Solução de problemas

| Sintoma | O que fazer |
| --- | --- |
| O QR Code demora ou falha ao conectar | Clique em **Cancelar** e tente gerar o QR novamente; verifique sua conexão com a internet. |
| "Sessão desconectada no celular" | Clique em **Conectar WhatsApp (QR Code)** para vincular novamente. |
| A figurinha chegou sem som no destinatário | Verifique se o trecho selecionado tem áudio audível e entre `0.2s` e `10s`. Atualize também o app do WhatsApp no celular. |
| Áudio muito grande não carrega | O limite de upload local é de **60 MB** por arquivo. |
| O arquivo copiado no Ctrl+V vai como vídeo | Isso é comportamento padrão do WhatsApp para arquivos `.mp4`. Para figurinha com som nativa, use o envio direto via QR Code. |

---

## Privacidade e avisos

- **100% local:** nenhum arquivo de imagem, áudio ou credencial é enviado a servidores de terceiros do projeto. O processamento ocorre na sua máquina com `ffmpeg-static`.
- **Sessão do WhatsApp:** as chaves de autenticação ficam salvas apenas na pasta local `whatsapp-session/` (ignorada pelo `.gitignore` — **nunca compartilhe** essa pasta).
- **Aviso sobre protocolo não oficial:** o envio direto de figurinhas com som usa [Baileys](https://github.com/WhiskeySockets/Baileys) (cliente não oficial de WhatsApp Web) e uma estrutura de mensagem obtida por engenharia reversa. Atualizações da Meta/WhatsApp podem alterar esse formato sem aviso prévio. Use com moderação e por sua conta e risco. Este projeto não possui afiliação com o WhatsApp ou a Meta.

---

## Créditos e inspiração

- Este projeto foi **baseado no aplicativo original [SilverFeit/StikSound](https://github.com/SilverFeit/StikSound?tab=readme-ov-file)**, adaptado para uso local em português com envio direto de figurinhas com som para o WhatsApp e editor de linha do tempo completo.
- Referência do envelope protobuf de figurinhas sonoras no Baileys baseada no projeto [coelhobugado/whatsapp-figurinhas-com-som](https://github.com/coelhobugado/whatsapp-figurinhas-com-som).

## Licença

Distribuído sob a licença **MIT**. Veja [LICENSE](LICENSE) para mais detalhes.
