import { useEffect, useMemo, useState } from "react";
import type { DownloadJob } from "@shared/types";

function getBridge() {
  return typeof window !== "undefined" ? window.myidm : undefined;
}

const mb = 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${(bytes / mb).toFixed(2)} MB`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return "0 MB/s";
  return `${(bytesPerSec / mb).toFixed(2)} MB/s`;
}

export function App() {
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState("");

  const bridge = useMemo(() => getBridge(), []);

  useEffect(() => {
    const api = bridge;
    if (!api) {
      return undefined;
    }
    void api.listJobs().then(setJobs);
    return api.onJobsUpdated(setJobs);
  }, [bridge]);

  const activeCount = useMemo(() => jobs.filter((job) => job.status === "downloading").length, [jobs]);

  async function chooseDirectory() {
    if (!bridge) return;
    const path = await bridge.chooseDirectory();
    if (path) setDestination(path);
  }

  async function addJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bridge || !url || !destination) return;
    await bridge.addJob({ url, destinationDir: destination });
    setUrl("");
  }

  return (
    <main className="container">
      <header className="header">
        <h1>MyIDM</h1>
        <p>{activeCount} active download(s)</p>
      </header>

      {!bridge && (
        <div className="bridge-warning" role="status">
          <strong>Electron bridge not available.</strong>
          <p>
            Run the app via <code>npm run dev</code> so the preload script loads, <strong>or</strong> use the packaged app.
            Opening <code>http://localhost:5173</code> in a normal browser will stay blank for downloads until the bridge exists.
          </p>
        </div>
      )}

      <form className="job-form" onSubmit={addJob}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/file.zip" />
        <div className="dest-row">
          <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Download folder" />
          <button type="button" disabled={!bridge} onClick={chooseDirectory}>
            Browse
          </button>
        </div>
        <button type="submit" disabled={!bridge}>
          Add to queue
        </button>
      </form>

      <section className="table">
        <div className="row row-head">
          <span>Name</span>
          <span>Status</span>
          <span>Progress</span>
          <span>Speed</span>
          <span>ETA</span>
          <span>Actions</span>
        </div>
        {jobs.map((job) => {
          const progress = job.totalBytes > 0 ? Math.min((job.downloadedBytes / job.totalBytes) * 100, 100) : 0;
          const eta = job.etaSeconds == null ? "-" : `${job.etaSeconds}s`;
          return (
            <div key={job.id} className="row">
              <span title={job.fileName}>{job.fileName}</span>
              <span>{job.status}</span>
              <span>
                <progress max={100} value={progress} />
                {progress.toFixed(1)}% ({formatBytes(job.downloadedBytes)} / {formatBytes(job.totalBytes)})
              </span>
              <span>{formatSpeed(job.speedBytesPerSec)}</span>
              <span>{eta}</span>
              <span className="actions">
                {bridge &&
                  (job.status === "paused" || job.status === "failed" || job.status === "cancelled") && (
                    <button type="button" onClick={() => bridge.startJob(job.id)}>
                      Start
                    </button>
                  )}
                {bridge && (job.status === "queued" || job.status === "downloading") && (
                  <button type="button" onClick={() => bridge.pauseJob(job.id)}>
                    Pause
                  </button>
                )}
                {bridge && job.status === "failed" && (
                  <button type="button" onClick={() => bridge.retryJob(job.id)}>
                    Retry
                  </button>
                )}
                {bridge && job.status !== "completed" && job.status !== "cancelled" && (
                  <button type="button" onClick={() => bridge.cancelJob(job.id)}>
                    Cancel
                  </button>
                )}
                {bridge && (
                  <button type="button" className="btn-danger" onClick={() => bridge.removeJob(job.id)}>
                    Delete
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </section>
    </main>
  );
}
