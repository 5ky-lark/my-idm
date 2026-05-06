import type { DownloadChunk } from "../../shared/types.js";
import { createId } from "../utils.js";

export function buildInitialChunks(totalBytes: number, maxConnections: number): DownloadChunk[] {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return [
      {
        id: createId(),
        startByte: 0,
        endByte: 0,
        downloadedBytes: 0,
        status: "pending"
      }
    ];
  }

  const connections = Math.max(1, maxConnections);
  const idealChunkSize = Math.ceil(totalBytes / connections);
  const chunks: DownloadChunk[] = [];

  let start = 0;
  while (start < totalBytes) {
    const end = Math.min(start + idealChunkSize - 1, totalBytes - 1);
    chunks.push({
      id: createId(),
      startByte: start,
      endByte: end,
      downloadedBytes: 0,
      status: "pending"
    });
    start = end + 1;
  }

  return chunks;
}

export function rebalanceChunks(chunks: DownloadChunk[]): DownloadChunk[] {
  const pending = chunks
    .filter((chunk) => chunk.status === "pending")
    .sort((a, b) => remainingBytes(b) - remainingBytes(a));
  if (pending.length === 0) {
    return chunks;
  }

  const largest = pending[0];
  if (remainingBytes(largest) < 2 * 1024 * 1024) {
    return chunks;
  }

  const splitStart = largest.startByte + largest.downloadedBytes;
  const originalEnd = largest.endByte;
  const midpoint = Math.floor((splitStart + largest.endByte) / 2);
  if (midpoint <= splitStart || midpoint >= largest.endByte) {
    return chunks;
  }

  largest.endByte = midpoint;
  const newChunk: DownloadChunk = {
    id: createId(),
    startByte: midpoint + 1,
    endByte: originalEnd,
    downloadedBytes: 0,
    status: "pending"
  };
  return [...chunks, newChunk];
}

function remainingBytes(chunk: DownloadChunk): number {
  return chunk.endByte - (chunk.startByte + chunk.downloadedBytes) + 1;
}
