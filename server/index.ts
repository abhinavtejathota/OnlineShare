import "dotenv/config";
import compression from "compression";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import helmet from "helmet";
import http from "node:http";
import path from "node:path";
import { Server as SocketServer } from "socket.io";
import { getDbLabel, initDb } from "./db.js";
import { createApiRouter } from "./routes.js";
import { getShare, updateShare } from "./shares.js";

const PORT = Number(process.env.PORT) || 3847;
const HOST = process.env.HOST || "0.0.0.0";
const clientDist = path.resolve(process.cwd(), "dist/client");
const serveClient = fs.existsSync(path.join(clientDist, "index.html"));
const isProd = process.env.NODE_ENV === "production" || serveClient;

const app = express();
const server = http.createServer(app);

const corsOrigin = process.env.CLIENT_ORIGIN || true;

const io = new SocketServer(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 2e6,
  transports: ["polling", "websocket"],
});

app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: isProd
      ? {
          useDefaults: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
            "img-src": ["'self'", "data:", "blob:"],
            "connect-src": [
              "'self'",
              "ws:",
              "wss:",
              "http:",
              "https:",
              "https://fonts.googleapis.com",
              "https://fonts.gstatic.com",
            ],
            "worker-src": ["'self'", "blob:"],
            "base-uri": ["'self'"],
            "form-action": ["'self'"],
            "frame-ancestors": ["'self'"],
            "upgrade-insecure-requests": null,
          },
        }
      : false,
  }),
);
app.use(compression());
app.use(
  cors({
    origin: corsOrigin,
  }),
);
app.use(express.json({ limit: "2.5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    db: getDbLabel(),
    env: isProd ? "production" : "development",
    serveClient,
  });
});

app.use("/api", createApiRouter());

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error." });
  },
);

type RoomPresence = Map<string, { name: string; color: string }>;
const presenceByShare = new Map<string, RoomPresence>();

const COLORS = ["#e8a54b", "#5ec4a8", "#7eb6e8", "#e07a7a", "#c4a0e8", "#e8d35e"];

io.on("connection", (socket) => {
  let joinedShareId: string | null = null;

  socket.on("join", async (payload: { shareId?: string; name?: string }) => {
    try {
      const shareId = payload?.shareId;
      if (!shareId || typeof shareId !== "string") return;

      const share = await getShare(shareId);
      if (!share) {
        socket.emit("error-msg", { error: "Share not found." });
        return;
      }

      if (joinedShareId) {
        socket.leave(joinedShareId);
        leavePresence(joinedShareId, socket.id);
      }

      joinedShareId = shareId;
      socket.join(shareId);

      if (!presenceByShare.has(shareId)) {
        presenceByShare.set(shareId, new Map());
      }
      const room = presenceByShare.get(shareId)!;
      const color = COLORS[room.size % COLORS.length];
      const name =
        (typeof payload.name === "string" && payload.name.slice(0, 24)) ||
        `Guest ${room.size + 1}`;
      room.set(socket.id, { name, color });

      socket.emit("init", {
        share,
        peers: [...room.entries()].map(([id, p]) => ({ id, ...p })),
      });
      socket.to(shareId).emit("peer-join", { id: socket.id, name, color });
    } catch (err) {
      console.error("join failed", err);
      socket.emit("error-msg", { error: "Failed to join share." });
    }
  });

  socket.on(
    "content-change",
    async (payload: {
      shareId?: string;
      content?: string;
      language?: string;
      title?: string;
      revision?: number;
    }) => {
      const shareId = payload?.shareId;
      if (!shareId || joinedShareId !== shareId) return;
      if (typeof payload.content !== "string") return;

      try {
        const share = await updateShare(shareId, {
          content: payload.content,
          language: payload.language,
          title: payload.title,
        });
        if (!share) return;

        socket.to(shareId).emit("content-update", {
          content: share.content,
          language: share.language,
          title: share.title,
          updatedAt: share.updatedAt,
          from: socket.id,
          revision: payload.revision ?? 0,
        });
      } catch {
        socket.emit("error-msg", { error: "Failed to save content." });
      }
    },
  );

  socket.on("cursor", (payload: { shareId?: string; line?: number; ch?: number }) => {
    if (!joinedShareId || payload?.shareId !== joinedShareId) return;
    socket.to(joinedShareId).emit("peer-cursor", {
      id: socket.id,
      line: payload.line ?? 0,
      ch: payload.ch ?? 0,
    });
  });

  socket.on("disconnect", () => {
    if (joinedShareId) {
      leavePresence(joinedShareId, socket.id);
      socket.to(joinedShareId).emit("peer-leave", { id: socket.id });
    }
  });
});

function leavePresence(shareId: string, socketId: string) {
  const room = presenceByShare.get(shareId);
  if (!room) return;
  room.delete(socketId);
  if (room.size === 0) presenceByShare.delete(shareId);
}

if (serveClient) {
  app.use(
    express.static(clientDist, {
      index: false,
      maxAge: isProd ? "1h" : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".js")) {
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        }
      },
    }),
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) next(err);
    });
  });
}

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other OnlineShare/node process, then run npm start again.`,
    );
    console.error(
      `Tip (PowerShell): Get-NetTCPConnection -LocalPort ${PORT} | % { Stop-Process -Id $_.OwningProcess -Force }`,
    );
    process.exit(1);
  }
  throw err;
});

async function main() {
  await initDb();
  server.listen(PORT, HOST, () => {
    console.log(`OnlineShare listening on http://${HOST}:${PORT}`);
    console.log(`Mode: ${isProd ? "production" : "development"} (serveClient=${serveClient})`);
    console.log(`Database: ${getDbLabel()}`);
    console.log(`LAN: open http://<your-pc-ip>:${PORT} on your phone (same Wi‑Fi)`);
  });
}

main().catch((err) => {
  console.error("Failed to start OnlineShare:", err);
  process.exit(1);
});
