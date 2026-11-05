// Proxy browser requests to the local GPU API so the user opens one site URL.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const gpuApiProxy = {
  "/api": { target: "http://127.0.0.1:8001", changeOrigin: true },
  "/health": { target: "http://127.0.0.1:8001", changeOrigin: true },
};

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: { host: "0.0.0.0", proxy: gpuApiProxy },
    preview: { host: "0.0.0.0", proxy: gpuApiProxy },
  },
});
