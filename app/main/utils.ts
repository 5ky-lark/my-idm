import { randomUUID } from "node:crypto";
import { basename } from "node:path";

export function createId(): string {
  return randomUUID();
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "download.bin";
}

export function fallbackNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathName = decodeURIComponent(parsed.pathname);
    const candidate = basename(pathName);
    return sanitizeFileName(candidate || "download.bin");
  } catch {
    return "download.bin";
  }
}

export function now(): number {
  return Date.now();
}
