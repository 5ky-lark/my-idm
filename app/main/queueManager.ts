import { unlink } from "node:fs/promises";
import type { DownloadJob, QueueConfig } from "../shared/types.js";
import { DownloadService } from "./download/downloadService.js";
import { rebalanceChunks } from "./download/chunkPlanner.js";
import { formatJobBrief, logMain, logMainError } from "./logger.js";

type UpdateHook = (jobs: DownloadJob[]) => Promise<void>;
type PublishHook = (jobs: DownloadJob[]) => void;

export class QueueManager {
  private readonly config: QueueConfig;
  private readonly jobs: DownloadJob[] = [];
  private readonly active = new Set<string>();
  private readonly service: DownloadService;
  private readonly onUpdate: UpdateHook;
  private readonly publish: PublishHook;

  constructor(config: QueueConfig, onUpdate: UpdateHook, publish: PublishHook) {
    this.config = config;
    this.onUpdate = onUpdate;
    this.publish = publish;
    this.service = new DownloadService((job) => {
      const idx = this.jobs.findIndex((item) => item.id === job.id);
      if (idx >= 0) {
        this.jobs[idx] = { ...job };
        this.publish(this.jobs);
      }
    });
  }

  hydrate(jobs: DownloadJob[]): void {
    this.jobs.splice(0, this.jobs.length, ...jobs);
  }

  list(): DownloadJob[] {
    return [...this.jobs].sort((a, b) => b.createdAt - a.createdAt);
  }

  async add(job: DownloadJob): Promise<void> {
    this.jobs.push(job);
    await this.onUpdate(this.jobs);
    this.publish(this.jobs);
    logMain(
      "queue",
      `job queued: "${job.fileName}"`,
      {
        jobShort: formatJobBrief(job.id),
        status: job.status,
        chunks: job.chunks.length,
        acceptsRanges: job.capability.acceptsRanges,
        contentLengthProbe: job.capability.contentLength
      }
    );
    void this.tick();
  }

  async start(id: string): Promise<void> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) return;
    if (job.status === "completed") return;
    job.status = "queued";
    logMain("queue", `job start requested → queued`, {
      jobShort: formatJobBrief(id),
      name: job.fileName
    });
    await this.onUpdate(this.jobs);
    this.publish(this.jobs);
    void this.tick();
  }

  async pause(id: string): Promise<void> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) return;
    logMain("queue", `pause IPC`, { jobShort: formatJobBrief(id) });
    this.service.pause(id);
    if (job.status === "queued") {
      job.status = "paused";
    }
    await this.onUpdate(this.jobs);
    this.publish(this.jobs);
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) return;
    logMain("queue", `cancel IPC`, { jobShort: formatJobBrief(id) });
    this.service.cancel(id);
    job.status = "cancelled";
    await this.onUpdate(this.jobs);
    this.publish(this.jobs);
  }

  async remove(id: string): Promise<void> {
    const idx = this.jobs.findIndex((item) => item.id === id);
    if (idx === -1) return;
    const job = this.jobs[idx];
    logMain("queue", `remove job from list`, {
      jobShort: formatJobBrief(id),
      name: job.fileName
    });
    this.service.cancel(id);
    this.service.pause(id);
    this.active.delete(id);
    this.jobs.splice(idx, 1);
    await unlink(job.tempPath).catch(() => {});
    await this.onUpdate(this.jobs);
    this.publish(this.jobs);
    void this.tick();
  }

  async retry(id: string): Promise<void> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) return;
    logMain("queue", `retry IPC`, {
      jobShort: formatJobBrief(id),
      previousError: job.lastError
    });
    job.status = "queued";
    job.lastError = null;
    job.retries += 1;
    for (const chunk of job.chunks) {
      if (chunk.status === "failed") {
        chunk.status = "pending";
      }
    }
    await this.onUpdate(this.jobs);
    this.publish(this.jobs);
    void this.tick();
  }

  private async tick(): Promise<void> {
    const availableSlots = this.config.maxConcurrentDownloads - this.active.size;
    if (availableSlots <= 0) return;

    const queuedJobs = this.jobs.filter((job) => job.status === "queued").slice(0, availableSlots);
    for (const job of queuedJobs) {
      this.active.add(job.id);
      logMain("queue", `slot acquired — running downloader`, {
        jobShort: formatJobBrief(job.id),
        fileName: job.fileName,
        activeJobs: this.active.size,
        queuedRemaining: this.jobs.filter((j) => j.status === "queued").length
      });
      if (job.capability.acceptsRanges) {
        job.chunks = rebalanceChunks(job.chunks);
      }
      void this.service
        .run(job)
        .then(async () => {
          this.active.delete(job.id);
          logMain("queue", `run finished`, {
            jobShort: formatJobBrief(job.id),
            finalStatus: job.status,
            lastError: job.lastError
          });
          await this.onUpdate(this.jobs);
          this.publish(this.jobs);
          void this.tick();
        })
        .catch(async (error) => {
          this.active.delete(job.id);
          job.status = "failed";
          job.lastError = error instanceof Error ? error.message : "Unknown queue error";
          logMainError("queue", "unexpected exception escaping DownloadService.run", {
            jobShort: formatJobBrief(job.id),
            error: job.lastError
          });
          await this.onUpdate(this.jobs);
          this.publish(this.jobs);
          void this.tick();
        });
    }
  }
}
