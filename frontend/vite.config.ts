import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist",
  },
  resolve: {
    alias: [
      {
        find: /^\.\/frontend\//,
        replacement: "./",
      },
    ],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8100",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
