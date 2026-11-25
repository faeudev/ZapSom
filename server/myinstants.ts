import dns from "node:dns/promises";
import net from "node:net";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 2;
const TIMEOUT_MS = 15_000;

function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("::ffff:")) {
      return isPrivateOrReservedIp(lower.slice(7));
    }
    return false;
  }
  return true;
}

export function validateMyInstantsUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("Link inválido. Cole um link completo do MyInstants (https://www.myinstants.com/...).");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Apenas links HTTPS do MyInstants são permitidos.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Links com usuário ou senha não são permitidos.");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new Error("Porta não permitida no link.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "myinstants.com" && host !== "www.myinstants.com") {
    throw new Error("Apenas links do domínio myinstants.com são aceitos.");
  }
  return parsed;
}

async function assertPublicHost(hostname: string): Promise<void> {
  const records = await dns.lookup(hostname, { all: true });
  if (records.length === 0) {
    throw new Error("Não foi possível resolver o endereço do MyInstants.");
  }
  for (const rec of records) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error("Endereço IP bloqueado por segurança.");
    }
  }
}

async function fetchValidatedBytes(
  initialUrl: string
): Promise<{ buffer: Buffer; contentType: string; finalUrl: URL }> {
  let current = validateMyInstantsUrl(initialUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ZapSom/1.0"
        }
      });

      if (resp.status >= 300 && resp.status < 400) {
        if (hop === MAX_REDIRECTS) {
          throw new Error("Muitos redirecionamentos no link do MyInstants.");
        }
        const location = resp.headers.get("location");
        if (!location) {
          throw new Error("Redirecionamento inválido do MyInstants.");
        }
        const next = new URL(location, current);
        current = validateMyInstantsUrl(next.toString());
        continue;
      }

      if (!resp.ok) {
        throw new Error(`MyInstants retornou erro HTTP ${resp.status}.`);
      }

      const contentLength = Number(resp.headers.get("content-length") ?? "0");
      if (contentLength > MAX_BYTES) {
        throw new Error("O arquivo do MyInstants excede o limite de 25 MB.");
      }

      const arrayBuf = await resp.arrayBuffer();
      if (arrayBuf.byteLength > MAX_BYTES) {
        throw new Error("O arquivo do MyInstants excede o limite de 25 MB.");
      }

      return {
        buffer: Buffer.from(arrayBuf),
        contentType: resp.headers.get("content-type") ?? "application/octet-stream",
        finalUrl: current
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Falha ao baixar áudio do MyInstants.");
}

function extractSoundUrlFromHtml(html: string, pageUrl: URL): string | null {
  // Common MyInstants patterns: play('/media/sounds/xxx.mp3', ...) or href="/media/sounds/xxx.mp3"
  const absoluteMatch = html.match(
    /https:\/\/(?:www\.)?myinstants\.com\/media\/sounds\/[^"'`\s<>)]+\.(?:mp3|wav|ogg|m4a)/i
  );
  if (absoluteMatch) {
    return absoluteMatch[0];
  }

  const relativeMatch = html.match(/\/media\/sounds\/[^"'`\s<>)]+\.(?:mp3|wav|ogg|m4a)/i);
  if (relativeMatch) {
    return new URL(relativeMatch[0], pageUrl.origin).toString();
  }

  return null;
}

export async function fetchMyInstantsAudio(rawUrl: string): Promise<{
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}> {
  const first = await fetchValidatedBytes(rawUrl);
  const ct = first.contentType.toLowerCase();
  const startsWithHtml =
    ct.includes("text/html") ||
    first.buffer.subarray(0, 32).toString("utf8").trimStart().startsWith("<");

  let audioResult = first;
  if (startsWithHtml) {
    const html = first.buffer.toString("utf8");
    const extracted = extractSoundUrlFromHtml(html, first.finalUrl);
    if (!extracted) {
      throw new Error("Não encontramos o arquivo MP3 nessa página do MyInstants.");
    }
    audioResult = await fetchValidatedBytes(extracted);
  }

  const pathname = audioResult.finalUrl.pathname;
  const rawName = decodeURIComponent(pathname.split("/").pop() || "myinstants.mp3");
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_") || "myinstants.mp3";
  const mimeType = audioResult.contentType.split(";")[0]?.trim() || "audio/mpeg";

  return {
    buffer: audioResult.buffer,
    fileName: safeName,
    mimeType
  };
}
