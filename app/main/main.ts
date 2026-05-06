import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { CreateJobInput, DownloadJob, QueueConfig } from "../shared/types.js";
import { JobStore } from "./persistence/jobStore.js";
import { QueueManager } from "./queueManager.js";
import { buildInitialChunks } from "./download/chunkPlanner.js";
import { probeCapability } from "./download/capabilityProbe.js";
import { createId, fallbackNameFromUrl, now, sanitizeFileName } from "./utils.js";
import { logMain, logMainError } from "./logger.js";

const queueConfig: QueueConfig = {
  maxConcurrentDownloads: 2,
  defaultConnectionsPerDownload: 8,
  minConnectionsPerDownload: 1,
  maxConnectionsPerDownload: 16
};

let mainWindow: BrowserWindow | null = null;
const dataDir = join(app.getPath("userData"), "storage");
const store = new JobStore(dataDir);
const queue = new QueueManager(
  queueConfig,
  async (jobs) => store.save(jobs),
  (jobs) => {
    if (mainWindow) {
      mainWindow.webContents.send("jobs:updated", jobs);
    }
  }
);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(join(import.meta.dirname, "../../renderer/index.html"));
  }
}

async function createJob(input: CreateJobInput): Promise<DownloadJob> {
  logMain(
    "job",
    "createJob (mkdir + HEAD probe)",
    {
      destinationDir: input.destinationDir,
      urlSnippet: truncateMiddle(input.url, 180)
    }
  );
  await mkdir(input.destinationDir, { recursive: true });
  const capability = await probeCapability(input.url);
  const fileName = sanitizeFileName(input.fileName?.trim() || fallbackNameFromUrl(input.url));
  const id = createId();
  const outputPath = join(input.destinationDir, fileName);
  const tempPath = join(dataDir, "partial", `${id}.part`);
  const totalBytes = capability.contentLength ?? 0;

  const connections = capability.acceptsRanges
    ? queueConfig.defaultConnectionsPerDownload
    : queueConfig.minConnectionsPerDownload;

  logMain(
    "job",
    "createJob assembled",
    {
      jobShort: id.slice(0, 8),
      fileName,
      acceptsRanges: capability.acceptsRanges,
      contentLength: capability.contentLength,
      plannedConnections: connections,
      chunked: capability.acceptsRanges && totalBytes > 0
    }
  );

  return {
    id,
    url: input.url,
    fileName,
    destinationDir: input.destinationDir,
    outputPath,
    tempPath,
    status: "queued",
    totalBytes,
    downloadedBytes: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
    maxConnections: connections,
    retries: 0,
    lastError: null,
    createdAt: now(),
    updatedAt: now(),
    capability,
    chunks: capability.acceptsRanges && totalBytes > 0 ? buildInitialChunks(totalBytes, connections) : []
  };
}

function truncateMiddle(url: string, max: number): string {
  if (url.length <= max) return url;
  const half = Math.floor((max - 3) / 2);
  return `${url.slice(0, half)}…${url.slice(-half)}`;
}

app.whenReady().then(async () => {
  const existing = await store.load();
  for (const job of existing) {
    if (job.status === "downloading" || job.status === "queued") {
      job.status = "paused";
    }
  }
  queue.hydrate(existing);
  logMain(
    "app",
    "ready",
    { restoredJobs: existing.length, dataDir }
  );
  createWindow();

  ipcMain.handle("jobs:list", async () => queue.list());
  ipcMain.handle("jobs:add", async (_event, payload: CreateJobInput) => {
    try {
      const job = await createJob(payload);
      await queue.add(job);
      return job;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logMainError("ipc", "jobs:add failed", {
        message,
        destinationDir: payload.destinationDir,
        urlSnippet: truncateMiddle(payload.url, 180)
      });
      throw error;
    }
  });
  ipcMain.handle("jobs:start", async (_event, id: string) => queue.start(id));
  ipcMain.handle("jobs:pause", async (_event, id: string) => queue.pause(id));
  ipcMain.handle("jobs:cancel", async (_event, id: string) => queue.cancel(id));
  ipcMain.handle("jobs:retry", async (_event, id: string) => queue.retry(id));
  ipcMain.handle("jobs:remove", async (_event, id: string) => queue.remove(id));
  ipcMain.handle("dialog:chooseDirectory", async () => {
    const result = await dialog.showOpenDialog({
      title: "Choose download folder",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
