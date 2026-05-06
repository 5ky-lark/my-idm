export type DownloadStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface DownloadChunk {
  id: string;
  startByte: number;
  endByte: number;
  downloadedBytes: number;
  status: "pending" | "downloading" | "completed" | "failed";
}

export interface DownloadCapability {
  acceptsRanges: boolean;
  contentLength: number | null;
}

export interface DownloadJob {
  id: string;
  url: string;
  fileName: string;
  destinationDir: string;
  outputPath: string;
  tempPath: string;
  status: DownloadStatus;
  totalBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  maxConnections: number;
  retries: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  capability: DownloadCapability;
  chunks: DownloadChunk[];
}

export interface CreateJobInput {
  url: string;
  destinationDir: string;
  fileName?: string;
}

export interface QueueConfig {
  maxConcurrentDownloads: number;
  defaultConnectionsPerDownload: number;
  minConnectionsPerDownload: number;
  maxConnectionsPerDownload: number;
}
