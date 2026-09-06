# OnlineShare

A real-time code & text sharing app in the spirit of [codeshare.io](https://codeshare.io): open a pad, get a hard-to-guess link, and anyone with that link can view and edit. Only the person who created the pad can delete it.

This document explains **what the product does**, **how the pieces fit together**, and **how the important parts were implemented**.

---

## Table of contents

1. [What it does](#what-it-does)
2. [High-level architecture](#high-level-architecture)
3. [User flows](#user-flows)
4. [Security model](#security-model)
5. [Backend implementation](#backend-implementation)
6. [Frontend implementation](#frontend-implementation)
7. [Real-time sync](#real-time-sync)
8. [Database](#database)
9. [Project structure](#project-structure)
10. [API reference](#api-reference)
11. [Local development](#local-development)
12. [Production & Render deploy](#production--render-deploy)
13. [Environment variables](#environment-variables)
14. [Design notes & trade-offs](#design-notes--trade-offs)

---

## What it does

| Feature | Behavior |
|--------|----------|
| Create pad | Landing page → “Open a new pad” creates a share and redirects to `/s/<id>` |
| Share by link | URL is the access key. Anyone who has it can read and edit |
| Live editing | Changes sync to other open viewers over Socket.io |
| Languages | CodeMirror with JS/TS, Python, Java, C/C++, Rust, HTML, CSS, JSON, Markdown, SQL, plaintext |
| Owner delete | Only the creating browser (with the owner token) can delete the pad |
| Persistence | Content is stored in a local SQLite file (`data/onlineshare.db`) |
| Mobile | Responsive toolbar/editor; works over LAN IP and on phones |

**Trust model (same idea as codeshare):** the link is the secret. If you send someone the URL, they can edit. That is intentional. What we harden is **guessing IDs** and **deleting without being the owner**.

---

## High-level architecture

```
┌─────────────────────┐         ┌──────────────────────────────────────┐
│  Browser (React)    │  HTTP   │  Express API  (/api/...)             │
│  Vite-built SPA     │◄───────►│  create / get / patch / delete       │
│  CodeMirror editor  │         │                                      │
│                     │  WS     │  Socket.io                           │
│                     │◄───────►│  join room, broadcast edits          │
└─────────────────────┘         │                                      │
                                │  node:sqlite → data/onlineshare.db   │
                                └──────────────────────────────────────┘
```

In **production**, one Node process serves:

1. The built React app from `dist/client`
2. REST under `/api`
3. Socket.io under `/socket.io`

In **development**, Vite runs the UI on `:5173` and proxies `/api` + `/socket.io` to the API on `:3847`.

| Layer | Tech |
|-------|------|
| UI | React 19, React Router, CodeMirror 6 |
| Bundler | Vite 6 |
| API | Express 4 |
| Realtime | Socket.io 4 |
| Validation | Zod |
| DB | Node.js built-in `node:sqlite` (`DatabaseSync`) |
| IDs / crypto | `nanoid` + Node `crypto` |
| Hardening | Helmet, express-rate-limit, compression |

We intentionally **do not** use `better-sqlite3` (native addon). It broke across Node 22 vs 24. Built-in SQLite avoids rebuild/ABI issues on local machines and on Render.

---

## User flows

### 1. Create a pad

1. User clicks **Open a new pad**.
2. Browser `POST /api/shares`.
3. Server generates:
   - **Share ID** — 22-character public id (URL path)
   - **Owner token** — 64-character hex secret (never stored in plaintext)
4. Server inserts a row; returns `{ share, ownerToken }`.
5. Browser saves `ownerToken` in `localStorage` under `onlineshare.owner.<shareId>`.
6. Browser navigates to `/s/<shareId>`.

### 2. Open / edit a pad (anyone with the link)

1. Browser loads the SPA and `GET /api/shares/:id`.
2. Editor fills with saved content, title, language.
3. Socket.io connects and emits `join` with `shareId`.
4. Server adds the socket to a room named after the share id and sends `init`.
5. On typing, the client:
   - Broadcasts `content-change` over the socket (live for peers)
   - Debounced `PATCH /api/shares/:id` (durable write to SQLite)

### 3. Delete (owner only)

1. UI shows **Delete** only if `POST /api/shares/:id/verify-owner` succeeds with the stored token.
2. Confirm → `DELETE /api/shares/:id` with `{ ownerToken }`.
3. Server checks the SHA-256 hash with a timing-safe compare; then deletes the row.
4. Client clears localStorage and returns home.

If you open the same link on another device/browser, you can edit, but you **won’t** see Delete unless that browser also has the owner token.

---

## Security model

### Share IDs (anti–brute-force)

```text
Alphabet: 0-9 A-Z a-z  (62 symbols)
Length:   22
Entropy:  ≈ 22 × log2(62) ≈ 131 bits
```

Implemented with `nanoid`’s `customAlphabet` in `server/security.ts`.

Guessing a valid pad by trying URLs is not practical. Rate limits on lookup endpoints add another layer.

IDs are **not** sequential (no `1`, `2`, `3`…), so you cannot walk the namespace.

### Owner tokens

| Step | Detail |
|------|--------|
| Generate | `crypto.randomBytes(32)` → 64 hex chars |
| Store | Only `SHA-256(token)` in `shares.owner_token_hash` |
| Verify | Hash candidate + `timingSafeEqual` vs stored hash |
| Client | Kept in `localStorage` on the creating browser only |
| API | Never returned again on `GET`; required for `DELETE` |

So: leaking the database does not give usable owner tokens (only hashes). Stealing someone’s laptop/browser storage could.

### Link = edit access

Anyone with `/s/<id>` can read and write content. That matches the product goal (quick paste sharing). Do not put secrets in a pad unless you trust everyone who might get the URL.

### Other hardening

- **Helmet** — CSP and related headers (CSP allows fonts; does **not** force `upgrade-insecure-requests`, so `http://192.168.x.x` LAN links keep working on phones)
- **Rate limits** — create / lookup / mutate capped per IP (`server/routes.ts`)
- **Body size** — JSON ~2.5 MB; content capped at 2 MB in business logic
- **CORS** — configurable via `CLIENT_ORIGIN`; default allows same-origin / reflected origin for simple single-service deploys
- **Trust proxy** — enabled so rate limits work behind Render’s proxy

---

## Backend implementation

### Entry point — `server/index.ts`

- Creates HTTP server + Express + Socket.io on the same port
- Listens on `0.0.0.0` (required for Render and LAN phone access)
- Mounts `/api` router
- If `dist/client/index.html` exists, serves the SPA and falls back to `index.html` for client routes like `/s/:id`
- Socket rooms keyed by `shareId`

### Start script — `scripts/start.mjs`

Sets `NODE_ENV=production` then imports the compiled server. This avoids the common mistake of running `node dist/server/index.js` without production mode (which used to skip static UI serving).

### Shares domain — `server/shares.ts`

CRUD-ish helpers on top of SQLite:

- `createShare` / `getShare` / `updateShare` / `deleteShare` / `isOwner`
- Zod schema for patches (`content`, `language`, `title`)
- Updates `updated_at` / `last_accessed_at`

### Routes — `server/routes.ts`

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/shares` | Create pad + return owner token |
| `GET` | `/api/shares/:id` | Load pad |
| `PATCH` | `/api/shares/:id` | Update content/meta |
| `POST` | `/api/shares/:id/verify-owner` | Check owner token |
| `DELETE` | `/api/shares/:id` | Delete (owner token required) |
| `GET` | `/api/health` | Health + DB path (for Render) |

### Security helpers — `server/security.ts`

ID generation, owner token generation, hashing, timing-safe verify.

### Database — `server/db.ts`

Opens `DATA_DIR/onlineshare.db` (default `./data/onlineshare.db`), enables WAL, creates `shares` table if missing.

---

## Frontend implementation

### Routing — `client/App.tsx`

- `/` — landing (`LandingPage`)
- `/s/:id` — editor (`EditorPage`)
- Wrapped in `ErrorBoundary` so failures show a message instead of a blank white screen

### Landing — `client/pages/LandingPage.tsx`

Calls `createShare`, stores owner token, navigates into the pad.

### Editor — `client/pages/EditorPage.tsx`

- Loads share over REST
- Verifies owner token (for Delete button)
- Connects Socket.io (`polling` first, then websocket — more reliable on mobile Wi‑Fi)
- Debounced PATCH for durability
- Presence dots for peers in the same room
- Mobile-friendly copy-link fallback if Clipboard API is blocked

### Editor surface — `client/components/CodeEditor.tsx`

CodeMirror 6 with line numbers, history, language packs, One Dark–based theme tuned to the app palette.

### API client — `client/api.ts`

Thin `fetch` wrappers + `localStorage` helpers for owner tokens.

### UI

Custom CSS (`client/styles.css`): dark charcoal + amber accent, Outfit + IBM Plex Mono, responsive layout with `100dvh` and safe-area insets for phones. Inline boot styles in `index.html` show “Loading OnlineShare…” before the JS bundle runs (avoids a mysterious white page on slow mobile networks).

---

## Real-time sync

```
Client A types
    │
    ├─► socket.emit("content-change") ──► server updates SQLite
    │                                        │
    │                                        └─► socket.to(shareId).emit("content-update")
    │                                                    │
    │                                                    └─► Client B applies text (skip echo)
    │
    └─► debounced PATCH /api/shares/:id   (backup durable write)
```

**Semantics:** last-write-wins, not full CRDT/OT. Fine for paste-and-share and light collaboration; simultaneous heavy editing on the same region can briefly conflict (same class of product as classic codeshare).

Socket events used:

| Event | Direction | Role |
|-------|-----------|------|
| `join` | client → server | Enter share room |
| `init` | server → client | Snapshot + peer list |
| `content-change` | client → server | Persist + fan-out |
| `content-update` | server → others | Apply remote doc |
| `peer-join` / `peer-leave` | server → room | Presence |
| `error-msg` | server → client | Soft errors |

---

## Database

**File:** `data/onlineshare.db` (or `$DATA_DIR/onlineshare.db`)

```sql
CREATE TABLE shares (
  id               TEXT PRIMARY KEY,
  owner_token_hash TEXT NOT NULL,
  content          TEXT NOT NULL DEFAULT '',
  language         TEXT NOT NULL DEFAULT 'plaintext',
  title            TEXT NOT NULL DEFAULT 'Untitled',
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  last_accessed_at TEXT NOT NULL
);
```

- Engine: Node built-in SQLite (`node:sqlite`), started with `--experimental-sqlite` (required on Node 22; fine on Node 24+)
- Journal: WAL
- No external DB server, no cloud DB account — just a file in the repo/host

On Render’s **free** disk, this file is ephemeral (lost on redeploy) unless you attach a **persistent disk** and set `DATA_DIR`.

---

## Project structure

```text
OnlineShare/
├── client/                 # React SPA (Vite root)
│   ├── components/         # CodeEditor, ErrorBoundary
│   ├── pages/              # LandingPage, EditorPage
│   ├── api.ts              # REST + owner token storage
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   └── index.html
├── server/                 # Express + Socket.io + SQLite
│   ├── index.ts            # HTTP/Socket entry
│   ├── routes.ts           # REST routes + rate limits
│   ├── shares.ts           # Domain logic
│   ├── security.ts         # IDs + owner tokens
│   ├── db.ts               # SQLite open + schema
│   ├── init-db.ts          # Optional DB bootstrap CLI
│   ├── tsconfig.json       # IDE / typecheck (noEmit)
│   └── tsconfig.build.json # Emits JS to dist/server
├── scripts/
│   └── start.mjs           # Production starter (sets NODE_ENV)
├── data/
│   └── onlineshare.db      # SQLite database file
├── dist/                   # Build output (gitignored)
│   ├── client/             # Static SPA
│   └── server/             # Compiled API
├── render.yaml             # Render blueprint
├── vite.config.ts
├── package.json
└── README.md
```

---

## API reference

Base URL: same origin in production (e.g. `https://your-app.onrender.com`), or `http://localhost:3847` in dev.

### `POST /api/shares`

Creates an empty pad.

**Response `201`**
```json
{
  "share": {
    "id": "kVjOkoGM5PpBFlzUIIWTCW",
    "content": "",
    "language": "plaintext",
    "title": "Untitled",
    "createdAt": "...",
    "updatedAt": "..."
  },
  "ownerToken": "<64-hex-chars>"
}
```

### `GET /api/shares/:id`

**Response `200`** `{ "share": { ... } }`  
**Response `404`** if missing  

Does **not** include the owner token.

### `PATCH /api/shares/:id`

Body (any subset):
```json
{ "content": "...", "language": "javascript", "title": "Demo" }
```

### `POST /api/shares/:id/verify-owner`

```json
{ "ownerToken": "..." }
```
→ `{ "isOwner": true }` or `403`

### `DELETE /api/shares/:id`

```json
{ "ownerToken": "..." }
```
→ `204` on success, `403` if token wrong, `404` if gone

### `GET /api/health`

```json
{ "ok": true, "db": "...", "env": "production", "serveClient": true }
```

---

## Local development

**Requirements:** Node.js **22+** (24 works). Always run commands from the **repo root**, not from `client/`.

### Dev mode (hot reload)

```bash
npm install
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:3847  

### Production-like locally

```bash
npm run build
npm start
```

Open http://localhost:3847  

On the same Wi‑Fi, phones can use `http://<your-pc-lan-ip>:3847`.

### Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | API watch + Vite |
| `npm run build` | Vite client + `tsc` server → `dist/` |
| `npm start` | Run production server |
| `npm run typecheck` | Typecheck client + server |
| `npm run init-db` | Ensure DB file/schema exists |

If port **3847** is already in use:

```powershell
Get-NetTCPConnection -LocalPort 3847 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## Production & Render deploy

Designed to deploy from GitHub → [Render](https://render.com) as a **single Web Service**.

### Settings

| Setting | Value |
|---------|--------|
| Runtime | Node |
| Build | `npm install && npm run build` |
| Start | `npm start` |
| Node | `22` (`NODE_VERSION=22.14.0` or `.nvmrc`) |
| Health check | `/api/health` |

You can also apply `render.yaml` as a Blueprint.

### Persistence on Render

Free instances wipe the filesystem on restart/redeploy.

For durable pads:

1. Add a **persistent disk**, mount at `/var/data`
2. Set `DATA_DIR=/var/data`

### Why this deploy shape

- One service = simpler CORS, cookies not needed, Socket.io on same host
- No native C++ addon to compile on Render
- Static SPA + API from one process matches how users share a single URL

---

## Environment variables

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3847` | HTTP port (Render sets this) |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | set by `scripts/start.mjs` in prod | Affects Helmet etc. |
| `DATA_DIR` | `./data` | Directory for `onlineshare.db` |
| `CLIENT_ORIGIN` | reflect / allow | Optional CORS origin override |

---

## Design notes & trade-offs

1. **Link secrecy over accounts** — No login. Faster UX; owner power is browser-local. Fine for ephemeral paste sharing; not a substitute for private repos.
2. **Last-write-wins sync** — Simple and enough for this product. Full CRDT (e.g. Yjs) would be the next step for Google-Docs-grade concurrency.
3. **Built-in SQLite** — Portable across Node versions; experimental flag on Node 22. Avoids `better-sqlite3` ABI pain.
4. **Owner token in localStorage** — Convenient; XSS on the origin could steal it. CSP is part of the mitigation. HttpOnly cookies would need a login/session model.
5. **Dual write (socket + PATCH)** — Socket path updates DB and peers; HTTP PATCH is a safety net if the socket drops mid-session.
6. **Mobile** — Large CodeMirror bundle; boot splash + polling-first sockets improve first paint and flaky mobile networks.

---

## License / status

Private project (`"private": true` in `package.json`). Adjust licensing before making the repo public if you need a specific license.

---

## Quick mental model

> **Create** → unguessable id + owner secret  
> **Share the URL** → others can edit live  
> **Owner token in your browser** → only you can delete  
> **SQLite file** → content survives process restarts (and Render disks if configured)  
> **One Node process** → API + websockets + static UI for deploy
