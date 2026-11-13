import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:43821", changeOrigin: true } },
  },
});
