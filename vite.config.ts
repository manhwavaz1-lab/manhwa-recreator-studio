// @lovable.dev/vite-tanstack-config already includes the base plugins.
// The Vast.ai browser UI uses same-origin /api requests; Vite forwards them
// privately to FastAPI so no public API port or API URL is needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8001",
          changeOrigin: true,
          timeout: 60 * 60 * 1000,
          proxyTimeout: 60 * 60 * 1000,
        },
      },
    },
  },
});
