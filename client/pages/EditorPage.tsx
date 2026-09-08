import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";
import {
  clearOwnerToken,
  deleteShare,
  fetchShare,
  loadOwnerToken,
  patchShare,
  type Share,
  verifyOwner,
} from "../api";
import { CodeEditor, LANGUAGES } from "../components/CodeEditor";
import { Logo } from "../components/Logo";

type Peer = { id: string; name: string; color: string };

export function EditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [share, setShare] = useState<Share | null>(null);
  const [content, setContent] = useState("");
  const [language, setLanguage] = useState("plaintext");
  const [title, setTitle] = useState("Untitled");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [connected, setConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const skipBroadcast = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionRef = useRef(0);

  const ownerToken = useMemo(() => (id ? loadOwnerToken(id) : null), [id]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { share: s } = await fetchShare(id);
        if (cancelled) return;
        setShare(s);
        setContent(s.content);
        setLanguage(s.language);
        setTitle(s.title);
        setNotFound(false);

        const token = loadOwnerToken(id);
        if (token) {
          try {
            const v = await verifyOwner(id, token);
            if (!cancelled) setIsOwner(v.isOwner);
          } catch {
            if (!cancelled) setIsOwner(false);
          }
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (id) load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!share) return;

    const socket = io({
      path: "/socket.io",
      transports: ["polling", "websocket"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 12,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      socket.emit("join", { shareId: share.id });
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("init", (payload: { share: Share; peers: Peer[] }) => {
      skipBroadcast.current = true;
      setContent(payload.share.content);
      setLanguage(payload.share.language);
      setTitle(payload.share.title);
      setPeers(payload.peers);
      skipBroadcast.current = false;
    });

    socket.on(
      "content-update",
      (payload: {
        content: string;
        language: string;
        title: string;
        from: string;
      }) => {
        if (payload.from === socket.id) return;
        skipBroadcast.current = true;
        setContent(payload.content);
        setLanguage(payload.language);
        setTitle(payload.title);
        setSaveState("saved");
        skipBroadcast.current = false;
      },
    );

    socket.on("peer-join", (peer: Peer) => {
      setPeers((prev) => (prev.some((p) => p.id === peer.id) ? prev : [...prev, peer]));
    });
    socket.on("peer-leave", ({ id: peerId }: { id: string }) => {
      setPeers((prev) => prev.filter((p) => p.id !== peerId));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [share?.id]);

  const broadcastContent = useCallback(
    (nextContent: string, nextLang: string, nextTitle: string) => {
      revisionRef.current += 1;
      socketRef.current?.emit("content-change", {
        shareId: id,
        content: nextContent,
        language: nextLang,
        title: nextTitle,
        revision: revisionRef.current,
      });
    },
    [id],
  );

  const schedulePersist = useCallback(
    (nextContent: string, nextLang: string, nextTitle: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          await patchShare(id, {
            content: nextContent,
            language: nextLang,
            title: nextTitle,
          });
          setSaveState("saved");
        } catch {
          setSaveState("error");
        }
      }, 400);
    },
    [id],
  );

  function handleContentChange(next: string) {
    setContent(next);
    if (skipBroadcast.current) return;
    broadcastContent(next, language, title);
    schedulePersist(next, language, title);
  }

  function handleLanguageChange(next: string) {
    setLanguage(next);
    if (skipBroadcast.current) return;
    broadcastContent(content, next, title);
    schedulePersist(content, next, title);
  }

  function handleTitleChange(next: string) {
    setTitle(next);
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(() => {
      if (skipBroadcast.current) return;
      broadcastContent(content, language, next);
      schedulePersist(content, language, next);
    }, 350);
  }

  async function copyLink() {
    const url = window.location.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("input");
        input.value = url;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      showToast("Link copied — anyone with it can edit.", "ok");
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  async function handleDelete() {
    if (!ownerToken) return;
    try {
      await deleteShare(id, ownerToken);
      clearOwnerToken(id);
      showToast("Share deleted.", "ok");
      navigate("/");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed.", "err");
    } finally {
      setConfirmDelete(false);
    }
  }

  function showToast(msg: string, kind: "ok" | "err") {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2800);
  }

  if (loading) {
    return (
      <div className="loading-page">
        <div>
          <div className="spinner" />
          Opening pad…
        </div>
      </div>
    );
  }

  if (notFound || !share) {
    return (
      <div className="error-page">
        <div>
          <h1>Pad not found</h1>
          <p>This share may have been deleted, or the link is invalid.</p>
          <Link className="btn btn-primary" to="/">
            Create a new pad
          </Link>
        </div>
      </div>
    );
  }

  const lineCount = content.length === 0 ? 1 : content.split("\n").length;
  const charCount = content.length;

  return (
    <div className="editor-page">
      <header className="toolbar">
        <Link to="/" className="toolbar-brand" title="Home">
          <Logo size={22} />
          OnlineShare
        </Link>

        <input
          className="title-input"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          aria-label="Document title"
          maxLength={120}
        />

        <select
          className="lang-select"
          value={language}
          onChange={(e) => handleLanguageChange(e.target.value)}
          aria-label="Language"
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>

        <div className="toolbar-spacer" />

        <div className="peers" title={`${peers.length} connected`}>
          {peers.slice(0, 6).map((p) => (
            <span
              key={p.id}
              className="peer-dot"
              style={{ background: p.color }}
              title={p.name}
            >
              {p.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>

        <span className="status-pill">
          <span className="pulse" style={{ background: connected ? undefined : "var(--text-dim)" }} />
          {saveState === "saving"
            ? "Saving…"
            : saveState === "error"
              ? "Save failed"
              : connected
                ? "Live"
                : "Reconnecting…"}
        </span>

        <button type="button" className="btn btn-ghost btn-sm" onClick={copyLink}>
          Copy link
        </button>

        {isOwner && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        )}
      </header>

      <main className="editor-main">
        <CodeEditor value={content} language={language} onChange={handleContentChange} />
      </main>

      <footer className="statusbar">
        <span>
          {lineCount} lines · {charCount.toLocaleString()} chars
        </span>
        <span>
          ID {id.slice(0, 6)}…{id.slice(-4)}
          {isOwner ? " · Owner" : ""}
        </span>
      </footer>

      {confirmDelete && (
        <div className="modal-backdrop" role="presentation" onClick={() => setConfirmDelete(false)}>
          <div
            className="modal"
            role="dialog"
            aria-labelledby="del-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="del-title">Delete this pad?</h2>
            <p>
              This permanently removes the content for everyone with the link. This cannot be
              undone.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                Delete forever
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.msg}</div>}
    </div>
  );
}
