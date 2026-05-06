import type { IncomingMessage } from "node:http";

/** Generic browser-like fingerprint; improves compatibility with guarded CDNs when no cookies are involved. */
export const DEFAULT_DOWNLOAD_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9"
};

/** Merge default browser-like headers with optional extras (extras win on key clash). */

export function mergeDownloadHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_DOWNLOAD_HEADERS, ...filterExtra(extra) };
}

function filterExtra(extra?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!extra) return out;
  for (const [k, v] of Object.entries(extra)) {
    const key = k.trim();
    if (!key || v == null || v === "") continue;
    out[key] = v;
  }
  return out;
}

/** Read first bytes of failed responses so consoles show CDN error text (e.g. expired link). */
export function drainBodyPreviewUtf8(res: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    res.on("data", (b: Buffer) => {
      if (received >= maxBytes) return;
      const need = maxBytes - received;
      chunks.push(need >= b.length ? Buffer.from(b) : Buffer.from(b.subarray(0, need)));
      received += need >= b.length ? b.length : need;
    });
    res.on("end", () => {
      try {
        resolve(sanitizeOneLine(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve("(unable to decode as UTF-8)");
      }
    });
    res.on("error", () => resolve(""));
  });
}

function sanitizeOneLine(raw: string): string {
  const one = raw.replace(/\s+/g, " ").trim();
  const maxPrint = 600;
  if (one.length <= maxPrint) return one;
  return `${one.slice(0, maxPrint)}…`;
}
