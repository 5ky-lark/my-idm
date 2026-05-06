import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DownloadJob } from "../../shared/types.js";

interface StoreShape {
  jobs: DownloadJob[];
}

export class JobStore {
  private readonly path: string;

  constructor(baseDir: string) {
    this.path = join(baseDir, "job-store.json");
  }

  async load(): Promise<DownloadJob[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as StoreShape;
      return parsed.jobs ?? [];
    } catch {
      return [];
    }
  }

  async save(jobs: DownloadJob[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const payload: StoreShape = { jobs };
    await writeFile(this.path, JSON.stringify(payload, null, 2), "utf8");
  }
}
