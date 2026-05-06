/// <reference types="vite/client" />

import type { IpcBridgeApi } from "@shared/ipcBridge";

declare global {
  interface Window {
    /** Present only when loaded inside Electron with preload wired. */
    myidm?: IpcBridgeApi;
  }
}

export {};
