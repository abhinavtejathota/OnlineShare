import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createShare, saveOwnerToken } from "../api";
import { Logo } from "../components/Logo";

const PREVIEW = `// Share anything — code, notes, configs
function greet(name) {
  return \`Hello, \${name}\`;
}

/* Anyone with the link can edit live.
   Only you (the owner) can delete. */`;

export function LandingPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startShare() {
    setBusy(true);
    setError(null);
    try {
      const { share, ownerToken } = await createShare();
      saveOwnerToken(share.id, ownerToken);
      navigate(`/s/${share.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create share.");
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <nav className="landing-nav">
        <div className="brand">
          <Logo size={30} />
          OnlineShare
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={startShare} disabled={busy}>
          New share
        </button>
      </nav>

      <section className="landing-hero">
        <div className="landing-copy">
          <h1>
            Paste once.
            <br />
            <span>Share everywhere.</span>
          </h1>
          <p>
            Open a private pad, get a hard-to-guess link, and collaborate in real
            time. Anyone with the URL can edit — only you can delete.
          </p>
          <div className="cta-row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={startShare}
              disabled={busy}
            >
              {busy ? "Creating…" : "Open a new pad"}
            </button>
            {error && <span style={{ color: "var(--danger)", fontSize: "0.9rem" }}>{error}</span>}
          </div>
        </div>

        <div className="hero-preview" aria-hidden>
          <div className="preview-chrome">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
            <span className="preview-url">onlineshare.app/s/Kx9m…R2qL</span>
          </div>
          <pre className="preview-code">
            <span className="cm">{PREVIEW.split("\n")[0]}</span>
            {"\n"}
            <span className="kw">function</span> greet(name) {"{"}
            {"\n"}
            {"  "}
            <span className="kw">return</span> <span className="str">`Hello, ${"{"}name{"}"}`</span>;
            {"\n"}
            {"}"}
            {"\n\n"}
            <span className="cm">{PREVIEW.split("\n").slice(5).join("\n")}</span>
          </pre>
        </div>
      </section>

      <footer className="landing-foot">
        Cryptographically random IDs · Owner-only delete · Local SQLite storage
      </footer>
    </div>
  );
}
