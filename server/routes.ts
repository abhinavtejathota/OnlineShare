import express from "express";
import rateLimit from "express-rate-limit";
import {
  createShare,
  deleteShare,
  getShare,
  isOwner,
  updateShare,
  updateShareSchema,
} from "./shares.js";

function paramId(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  const createLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many shares created. Try again later." },
  });

  const lookupLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Slow down." },
  });

  const mutateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many updates. Slow down." },
  });

  router.post("/shares", createLimiter, (_req, res) => {
    const { share, ownerToken } = createShare();
    res.status(201).json({ share, ownerToken });
  });

  router.get("/shares/:id", lookupLimiter, (req, res) => {
    const share = getShare(paramId(req.params.id));
    if (!share) {
      res.status(404).json({ error: "Share not found." });
      return;
    }
    res.json({ share });
  });

  router.patch("/shares/:id", mutateLimiter, (req, res) => {
    const parsed = updateShareSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload.", details: parsed.error.flatten() });
      return;
    }

    try {
      const share = updateShare(paramId(req.params.id), parsed.data);
      if (!share) {
        res.status(404).json({ error: "Share not found." });
        return;
      }
      res.json({ share });
    } catch (err) {
      if (err instanceof Error && err.message === "CONTENT_TOO_LARGE") {
        res.status(413).json({ error: "Content exceeds 2 MB limit." });
        return;
      }
      throw err;
    }
  });

  router.post("/shares/:id/verify-owner", lookupLimiter, (req, res) => {
    const token = typeof req.body?.ownerToken === "string" ? req.body.ownerToken : "";
    if (!token) {
      res.status(400).json({ error: "ownerToken required." });
      return;
    }
    const ok = isOwner(paramId(req.params.id), token);
    if (!ok) {
      res.status(403).json({ error: "Not the owner.", isOwner: false });
      return;
    }
    res.json({ isOwner: true });
  });

  router.delete("/shares/:id", mutateLimiter, (req, res) => {
    const token =
      (typeof req.body?.ownerToken === "string" && req.body.ownerToken) ||
      (typeof req.headers["x-owner-token"] === "string" && req.headers["x-owner-token"]) ||
      "";

    if (!token) {
      res.status(400).json({ error: "Owner token required to delete." });
      return;
    }

    const id = paramId(req.params.id);
    const share = getShare(id);
    if (!share) {
      res.status(404).json({ error: "Share not found." });
      return;
    }

    const deleted = deleteShare(id, token);
    if (!deleted) {
      res.status(403).json({ error: "Invalid owner token." });
      return;
    }
    res.status(204).send();
  });

  return router;
}
