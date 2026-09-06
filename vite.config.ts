import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "client",
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": { target: "http://localhost:3847", changeOrigin: true },
      "/socket.io": {
        target: "http://localhost:3847",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    target: "es2020",
    cssTarget: "chrome80",
    chunkSizeWarningLimit: 1400,
  },
});
