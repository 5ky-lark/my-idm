import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, truncate } from "node:fs/promises";
import { dirname } from "node:path";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { DownloadChunk, DownloadJob } from "../../shared/types.js";
import { formatJobBrief, logMain, logMainError, logMainWarn } from "../logger.js";
import { mergeDownloadHeaders, drainBodyPreviewUtf8 } from "./httpDefaults.js";

type ProgressCallback = (job: DownloadJob) => void;

interface RuntimeState {
  cancelled: boolean;
  paused: boolean;
}

function requestFor(url: string) {
  return url.startsWith("https:") ? httpsRequest : httpRequest;
}

export class DownloadService {
  private readonly runtimes = new Map<string, RuntimeState>();
  private readonly onProgress: ProgressCallback;

  constructor(onProgress: ProgressCallback) {
    this.onProgress = onProgress;
  }

  pause(jobId: string): void {
    logMain("download", "pause requested", { jobShort: formatJobBrief(jobId) });
    const state = this.runtimes.get(jobId);
    if (state) {
      state.paused = true;
    }
  }

  cancel(jobId: string): void {
    logMain("download", "cancel requested", { jobShort: formatJobBrief(jobId) });
    const state = this.runtimes.get(jobId);
    if (state) {
      state.cancelled = true;
    }
  }

  async run(job: DownloadJob): Promise<DownloadJob> {
    logMain(
      "download",
      `start job "${job.fileName}"`,
      {
        jobShort: formatJobBrief(job.id),
        urlSnippet: shorten(job.url),
        acceptsRanges: job.capability.acceptsRanges,
        contentLengthProbe: job.capability.contentLength,
        maxConnections: job.maxConnections,
        tempPath: job.tempPath,
        outputPath: job.outputPath,
        chunks: job.chunks.length
      }
    );

    const state: RuntimeState = { paused: false, cancelled: false };
    this.runtimes.set(job.id, state);
    const speedWindow = { bytes: 0, at: Date.now() };
    job.status = "downloading";
    await mkdir(dirname(job.tempPath), { recursive: true });

    const contentLength = job.capability.contentLength;
    if (contentLength && contentLength > 0) {
      await ensureTempSize(job.tempPath, contentLength);
      job.totalBytes = contentLength;
    }

    try {
      if (!job.capability.acceptsRanges || job.totalBytes <= 0) {
        logMainWarn(
          "download",
          "using GET single-stream fallback (ranges disabled or unknown size)",
          {
            jobShort: formatJobBrief(job.id),
            urlSnippet: shorten(job.url)
          }
        );
        await this.downloadSingle(job, state, speedWindow);
      } else {
        logMain(
          "download",
          "using segmented range download",
          {
            jobShort: formatJobBrief(job.id),
            connections: job.maxConnections,
            chunkCount: job.chunks.length,
            bytes: job.totalBytes
          }
        );
        await this.downloadChunked(job, state, speedWindow);
      }

      if (state.cancelled) {
        job.status = "cancelled";
        logMain("download", "finished cancelled", {
          jobShort: formatJobBrief(job.id),
          downloadedBytes: job.downloadedBytes
        });
      } else if (state.paused) {
        job.status = "paused";
        logMain("download", "finished paused mid-flight", {
          jobShort: formatJobBrief(job.id),
          downloadedBytes: job.downloadedBytes
        });
      } else {
        await rename(job.tempPath, job.outputPath);
        job.status = "completed";
        logMain("download", "completed ✓", {
          jobShort: formatJobBrief(job.id),
          outputPath: job.outputPath,
          bytes: job.downloadedBytes
        });
      }
    } catch (error) {
      if (state.paused) {
        job.status = "paused";
      } else if (state.cancelled) {
        job.status = "cancelled";
      } else {
        job.status = "failed";
        job.lastError = error instanceof Error ? error.message : "Unknown download error";
        logMainError("download", "failed", {
          jobShort: formatJobBrief(job.id),
          error: job.lastError,
          urlSnippet: shorten(job.url)
        });
      }
    } finally {
      this.runtimes.delete(job.id);
      this.refreshSpeed(job, speedWindow, true);
      this.onProgress(job);
    }

    return job;
  }

  private async downloadSingle(job: DownloadJob, state: RuntimeState, speedWindow: { bytes: number; at: number }) {
    const reqImpl = requestFor(job.url);
    await new Promise<void>((resolve, reject) => {
      const req = reqImpl(job.url, { method: "GET", headers: mergeDownloadHeaders() }, (res) => {
        const location = String(res.headers["location"] ?? "");
        if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400 && location) {
          logMainWarn("download:get", "redirect response — downloader does not follow redirects yet", {
            jobShort: formatJobBrief(job.id),
            statusCode: res.statusCode,
            locationSnippet: location.length > 180 ? `${location.slice(0, 180)}…` : location
          });
        }
        if (!res.statusCode || res.statusCode >= 400) {
          const code = res.statusCode ?? 0;
          void drainBodyPreviewUtf8(res, 2048).then((bodyPreview) => {
            logMainError("download:get", "bad HTTP status", {
              jobShort: formatJobBrief(job.id),
              statusCode: code,
              urlSnippet: shorten(job.url),
              headers: summarizeResponseHeaders(res),
              bodyPreview: bodyPreview || undefined
            });
            const hint = bodyPreview ? ` — ${bodyPreview}` : "";
            reject(new Error(`Request failed (${code})${hint}`.slice(0, 900)));
          });
          return;
        }
        logMain("download:get", "streaming body", {
          jobShort: formatJobBrief(job.id),
          statusCode: res.statusCode,
          contentLength: res.headers["content-length"]
        });
        const output = createWriteStream(job.tempPath, { flags: "a" });
        res.on("data", (chunk: Buffer) => {
          if (state.paused || state.cancelled) {
            req.destroy();
            output.close();
            resolve();
            return;
          }
          output.write(chunk);
          const byteLength = chunk.length;
          job.downloadedBytes += byteLength;
          speedWindow.bytes += byteLength;
          this.refreshSpeed(job, speedWindow);
          this.onProgress(job);
        });
        res.on("end", () => {
          output.close();
          resolve();
        });
        res.on("error", (err: Error & { cause?: unknown }) => {
          logMainError("download:get", "response stream error", {
            jobShort: formatJobBrief(job.id),
            message: err.message
          });
          reject(err);
        });
      });
      req.on("error", (err: Error & { cause?: unknown }) => {
        logMainError("download:get", "request error", {
          jobShort: formatJobBrief(job.id),
          message: err.message,
          code: (err as NodeJS.ErrnoException).code
        });
        reject(err);
      });
      req.end();
    });
  }

  private async downloadChunked(job: DownloadJob, state: RuntimeState, speedWindow: { bytes: number; at: number }) {
    const active = new Set<Promise<void>>();
    const getNextChunk = (): DownloadChunk | undefined =>
      job.chunks.find((chunk) => chunk.status === "pending" || chunk.status === "failed");

    while (!state.paused && !state.cancelled) {
      while (active.size < job.maxConnections) {
        const chunk = getNextChunk();
        if (!chunk) {
          break;
        }
        chunk.status = "downloading";
        const work = this.downloadChunk(job, chunk, state, speedWindow).finally(() => active.delete(work));
        active.add(work);
      }

      if (active.size === 0) {
        break;
      }

      await Promise.race(active);
    }

    await Promise.all(active);
  }

  private async downloadChunk(
    job: DownloadJob,
    chunk: DownloadChunk,
    state: RuntimeState,
    speedWindow: { bytes: number; at: number }
  ) {
    if (state.paused || state.cancelled) {
      return;
    }

    const start = chunk.startByte + chunk.downloadedBytes;
    const end = chunk.endByte;
    if (start > end) {
      chunk.status = "completed";
      return;
    }

    const reqImpl = requestFor(job.url);
    await new Promise<void>((resolve, reject) => {
      const req = reqImpl(
        job.url,
        {
          method: "GET",
          headers: {
            ...mergeDownloadHeaders(),
            Range: `bytes=${start}-${end}`
          }
        },
        (res) => {
          if (res.statusCode !== 206 && res.statusCode !== 200) {
            chunk.status = "failed";
            const code = res.statusCode ?? 0;
            void drainBodyPreviewUtf8(res, 2048).then((bodyPreview) => {
              logMainError("download:chunk", "bad Range response", {
                jobShort: formatJobBrief(job.id),
                chunkIdShort: shortenChunkId(chunk.id),
                byteRange: `bytes=${start}-${end}`,
                statusCode: code,
                contentRange: res.headers["content-range"],
                retryAfter: res.headers["retry-after"] ?? null,
                bodyPreview: bodyPreview || undefined
              });
              const hint = bodyPreview ? ` — ${bodyPreview}` : "";
              reject(new Error(`Chunk request failed (${code})${hint}`.slice(0, 900)));
            });
            return;
          }

          let offset = start;
          const writer = createWriteStream(job.tempPath, { flags: "r+", start: offset });
          res.on("data", (buffer: Buffer) => {
            if (state.paused || state.cancelled) {
              req.destroy();
              writer.close();
              resolve();
              return;
            }
            writer.write(buffer);
            offset += buffer.length;
            chunk.downloadedBytes += buffer.length;
            job.downloadedBytes += buffer.length;
            speedWindow.bytes += buffer.length;
            this.refreshSpeed(job, speedWindow);
            this.onProgress(job);
          });
          res.on("end", () => {
            writer.close();
            chunk.status = "completed";
            resolve();
          });
          res.on("error", (error) => {
            chunk.status = "failed";
            logMainError("download:chunk", "response stream error", {
              jobShort: formatJobBrief(job.id),
              chunkIdShort: shortenChunkId(chunk.id),
              byteRange: `bytes=${start}-${end}`,
              message: error instanceof Error ? error.message : String(error)
            });
            reject(error);
          });
        }
      );
      req.on("error", (error) => {
        chunk.status = "failed";
        logMainError("download:chunk", "request error", {
          jobShort: formatJobBrief(job.id),
          chunkIdShort: shortenChunkId(chunk.id),
          byteRange: `bytes=${start}-${end}`,
          message: error instanceof Error ? error.message : String(error),
          code: error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined
        });
        reject(error);
      });
      req.end();
    });
  }

  private refreshSpeed(job: DownloadJob, speedWindow: { bytes: number; at: number }, force = false) {
    const now = Date.now();
    const elapsedMs = now - speedWindow.at;
    if (!force && elapsedMs < 500) {
      return;
    }
    const seconds = Math.max(elapsedMs / 1000, 0.001);
    job.speedBytesPerSec = Math.round(speedWindow.bytes / seconds);
    const remaining = Math.max(job.totalBytes - job.downloadedBytes, 0);
    job.etaSeconds = job.speedBytesPerSec > 0 ? Math.ceil(remaining / job.speedBytesPerSec) : null;
    speedWindow.bytes = 0;
    speedWindow.at = now;
    job.updatedAt = now;
  }
}

function shorten(url: string, max = 160): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max)}…`;
}

function shortenChunkId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function summarizeResponseHeaders(res: IncomingMessage): Record<string, unknown> {
  const h = res.headers;
  return {
    contentLength: h["content-length"],
    contentType: h["content-type"],
    server: h["server"],
    cacheControl: h["cache-control"]
  };
}

async function ensureTempSize(path: string, size: number): Promise<void> {
  try {
    const current = await stat(path);
    if (current.size < size) {
      await truncate(path, size);
    }
  } catch {
    const stream = createWriteStream(path, { flags: "w" });
    await new Promise<void>((resolve, reject) => {
      stream.on("open", () => resolve());
      stream.on("error", reject);
    });
    stream.close();
    await truncate(path, size);
  }
}
