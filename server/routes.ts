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

  router.post("/shares", createLimiter, async (_req, res, next) => {
    try {
      const { share, ownerToken } = await createShare();
      res.status(201).json({ share, ownerToken });
    } catch (err) {
      next(err);
    }
  });

  router.get("/shares/:id", lookupLimiter, async (req, res, next) => {
    try {
      const share = await getShare(paramId(req.params.id));
      if (!share) {
        res.status(404).json({ error: "Share not found." });
        return;
      }
      res.json({ share });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/shares/:id", mutateLimiter, async (req, res, next) => {
    const parsed = updateShareSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload.", details: parsed.error.flatten() });
      return;
    }

    try {
      const share = await updateShare(paramId(req.params.id), parsed.data);
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
      next(err);
    }
  });

  router.post("/shares/:id/verify-owner", lookupLimiter, async (req, res, next) => {
    try {
      const token = typeof req.body?.ownerToken === "string" ? req.body.ownerToken : "";
      if (!token) {
        res.status(400).json({ error: "ownerToken required." });
        return;
      }
      const ok = await isOwner(paramId(req.params.id), token);
      if (!ok) {
        res.status(403).json({ error: "Not the owner.", isOwner: false });
        return;
      }
      res.json({ isOwner: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/shares/:id", mutateLimiter, async (req, res, next) => {
    try {
      const token =
        (typeof req.body?.ownerToken === "string" && req.body.ownerToken) ||
        (typeof req.headers["x-owner-token"] === "string" && req.headers["x-owner-token"]) ||
        "";

      if (!token) {
        res.status(400).json({ error: "Owner token required to delete." });
        return;
      }

      const id = paramId(req.params.id);
      const share = await getShare(id);
      if (!share) {
        res.status(404).json({ error: "Share not found." });
        return;
      }

      const deleted = await deleteShare(id, token);
      if (!deleted) {
        res.status(403).json({ error: "Invalid owner token." });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
