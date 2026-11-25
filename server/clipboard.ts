import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLIPBOARD_DIR = path.join(os.tmpdir(), "ZapSomClipboard");
const MAX_CLIPBOARD_FILES = 10;

export interface ClipboardCopyResult {
  filePath: string;
  fileName: string;
  sizeBytes: number;
}

export function sanitizeClipboardFileName(fileName: string): string {
  const base = path.basename(fileName || "zapsom.mp4");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned : "zapsom.mp4";
}

async function pruneOldClipboardFiles(keepCount: number): Promise<void> {
  try {
    const entries = await fs.readdir(CLIPBOARD_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile() && !e.name.endsWith(".tmp"))
        .map(async (e) => {
          const full = path.join(CLIPBOARD_DIR, e.name);
          const stat = await fs.stat(full);
          return { full, mtimeMs: stat.mtimeMs };
        })
    );
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const toDelete = files.slice(keepCount);
    await Promise.all(toDelete.map((f) => fs.rm(f.full, { force: true })));
  } catch {
    // Best-effort cleanup
  }
}

export async function copyFileToWindowsClipboard(
  sourceBytes: Buffer,
  fileName: string
): Promise<ClipboardCopyResult> {
  const safeName = sanitizeClipboardFileName(fileName);
  await fs.mkdir(CLIPBOARD_DIR, { recursive: true });

  const destPath = path.join(CLIPBOARD_DIR, safeName);
  const tmpPath = `${destPath}.${process.pid}.${Date.now()}.tmp`;

  await fs.writeFile(tmpPath, sourceBytes);
  await fs.rename(tmpPath, destPath);
  await pruneOldClipboardFiles(MAX_CLIPBOARD_FILES);

  if (process.platform !== "win32") {
    throw new Error("Cópia de arquivo na área de transferência só é suportada no Windows.");
  }

  const escapedPath = destPath.replace(/'/g, "''");
  const psCommand = `Set-Clipboard -LiteralPath '${escapedPath}'`;

  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-Command", psCommand],
    { windowsHide: true, timeout: 15_000 }
  );

  return {
    filePath: destPath,
    fileName: safeName,
    sizeBytes: sourceBytes.length
  };
}
