import { contextBridge, ipcRenderer } from "electron";

const api = {
  listJobs: () => ipcRenderer.invoke("jobs:list"),
  addJob: (payload: { url: string; destinationDir: string; fileName?: string }) =>
    ipcRenderer.invoke("jobs:add", payload),
  startJob: (id: string) => ipcRenderer.invoke("jobs:start", id),
  pauseJob: (id: string) => ipcRenderer.invoke("jobs:pause", id),
  cancelJob: (id: string) => ipcRenderer.invoke("jobs:cancel", id),
  retryJob: (id: string) => ipcRenderer.invoke("jobs:retry", id),
  removeJob: (id: string) => ipcRenderer.invoke("jobs:remove", id),
  chooseDirectory: () => ipcRenderer.invoke("dialog:chooseDirectory"),
  onJobsUpdated: (handler: (jobs: unknown[]) => void) => {
    const listener = (_event: unknown, jobs: unknown[]) => handler(jobs);
    ipcRenderer.on("jobs:updated", listener);
    return () => ipcRenderer.removeListener("jobs:updated", listener);
  }
};

contextBridge.exposeInMainWorld("myidm", api);
