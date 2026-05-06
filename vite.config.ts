import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: "app/renderer",
  // Electron loads the renderer via file:// ; absolute "/assets/..." URLs break without this.
  base: "./",
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "app/shared")
    }
  }
});
