import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根目录 data/，与导入脚本默认图片目录一致 */
const DATA_DIR = path.resolve(__dirname, "../data");

/**
 * 开发/preview：把 /media/* 映射到仓库 data/*。
 * 例：/media/prompt-images/0001-01.jpg → data/prompt-images/0001-01.jpg
 */
function mediaFromDataDir(): Plugin {
  const mount = (middlewares: Connect.Server) => {
    middlewares.use("/media", (req, res, next) => {
      const requestPath = (req.url ?? "/").split("?")[0] ?? "/";
      const relativePath = decodeURIComponent(requestPath.replace(/^\/+/, ""));
      if (
        !relativePath ||
        relativePath.includes("\0") ||
        path.normalize(relativePath).startsWith("..") ||
        path.isAbsolute(relativePath)
      ) {
        res.statusCode = 400;
        res.end("Bad Request");
        return;
      }

      const absolutePath = path.resolve(DATA_DIR, relativePath);
      const dataRoot = path.resolve(DATA_DIR) + path.sep;
      if (
        absolutePath !== path.resolve(DATA_DIR) &&
        !absolutePath.startsWith(dataRoot)
      ) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }

      const ext = path.extname(absolutePath).toLowerCase();
      const types: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
      };
      res.setHeader(
        "Content-Type",
        types[ext] ?? "application/octet-stream",
      );
      fs.createReadStream(absolutePath).pipe(res);
    });
  };

  return {
    name: "media-from-data-dir",
    configureServer(server) {
      mount(server.middlewares);
    },
    configurePreviewServer(server) {
      mount(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), mediaFromDataDir()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  preview: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
