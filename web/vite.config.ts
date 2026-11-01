import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = path.resolve(import.meta.dirname);
const repo = path.resolve(import.meta.dirname, "..");
const base = (process.env.WALLET_BASE ?? "").replace(/\/+$/, "");

// One id per build. The app compares it with version.json to notice a newer release and reload.
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const versionFile = (): Plugin => ({
  name: "wallet-version",
  apply: "build",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: buildId }) });
  },
});

export default defineConfig({
  root,
  base: `${base}/`,
  plugins: [react(), versionFile()],
  define: { __WALLET_BUILD__: JSON.stringify(buildId) },
  resolve: { alias: { "@shared": path.join(repo, "shared") } },
  server: { port: Number(process.env.PORT) || 5181, strictPort: true, fs: { allow: [repo] } },
  build: { outDir: path.join(repo, "dist", "web"), emptyOutDir: true },
});
