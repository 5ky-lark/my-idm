import type { CreateJobInput, DownloadJob } from "./types.js";

/** Shape of APIs exposed via preload (`contextBridge.exposeInMainWorld`). */
export interface IpcBridgeApi {
  listJobs: () => Promise<DownloadJob[]>;
  addJob: (payload: CreateJobInput) => Promise<DownloadJob>;
  startJob: (id: string) => Promise<void>;
  pauseJob: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  retryJob: (id: string) => Promise<void>;
  removeJob: (id: string) => Promise<void>;
  chooseDirectory: () => Promise<string | null>;
  onJobsUpdated: (handler: (jobs: DownloadJob[]) => void) => () => void;
}
