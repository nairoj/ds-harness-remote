import { defineConfig } from "vite";
import { aliases } from "./scripts/aliases.mjs";
const target = "https://47.102.38.163";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: aliases },
  server: {
    port: 4174,
    strictPort: true,
    proxy: {
      "/api/v1": { target, changeOrigin: true, headers: { Origin: target } },
      "/ws/v1/connect": {
        target: target.replace("https:", "wss:"),
        ws: true,
        changeOrigin: true,
        headers: { Origin: target },
      },
      "/brand-whale.webp": { target, changeOrigin: true },
    },
  },
});
