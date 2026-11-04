"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdatesSummary } from "@/lib/repo/releases";

const POLL_MS = 60_000;

const BELL = (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
    <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
  </svg>
);

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const seenToast = (id: string) => {
  try {
    if (sessionStorage.getItem("update-toast") === id) return true;
    sessionStorage.setItem("update-toast", id);
  } catch {}
  return false;
};

/**
 * Top-right update bell. Shows a badge for updates you haven't looked at, an "Update
 * complete" card after a deploy, and notices a deploy that finishes while the page is open.
 */
export function UpdateBell({ initial }: { initial: UpdatesSummary }) {
  const [data, setData] = useState(initial);
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<null | "done" | "reload">(null);
  const loadedVersion = useRef(initial.version);
  const wrap = useRef<HTMLDivElement>(null);
  const latest = data.releases[0];

  // After a deploy: announce it once per browser session.
  useEffect(() => {
    if (initial.unseen > 0 && initial.releases[0] && !seenToast(initial.releases[0].id)) setCard("done");
  }, [initial]);

  // While the page is open: notice a new deploy finishing.
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/updates", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as UpdatesSummary;
        setData(next);
        if (next.version !== loadedVersion.current) setCard("reload");
      } catch {}
    };
    const t = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const markSeen = useCallback(async () => {
    if (!data.unseen) return;
    try {
      const res = await fetch("/api/updates/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (res.ok) setData(await res.json());
    } catch {}
  }, [data.unseen]);

  useEffect(() => {
    if (!open) return;
    markSeen();
    const onDown = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, markSeen]);

  const badge = data.unseen + (data.storage.warning ? 1 : 0);

  return (
    <div className="bell-wrap" ref={wrap}>
      <button
        type="button"
        className={`bell${badge ? " has" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={badge ? `Updates: ${badge} new` : "Updates"}
        onClick={() => {
          setOpen((o) => !o);
          setCard(null);
        }}
      >
        {BELL}
        {badge > 0 && <span className="badge">{badge}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Updates">
          <h2>Updates</h2>
          {data.storage.warning && <div className="bell-warn">{data.storage.warning}</div>}
          {data.releases.length === 0 && <p className="hint">No updates yet. When a new version goes live, it shows up here.</p>}
          <ol className="bell-list">
            {data.releases.map((r, i) => (
              <li key={r.id} className={r.seen && i > 0 ? "old" : undefined}>
                <div className="bell-head">
                  <b>{i === 0 ? "Update complete" : "Update"}</b>
                  <span className="hint">{when(r.deployedAt)}</span>
                </div>
                {r.entries.length ? (
                  r.entries.map((e) => (
                    <div key={e.id} className="bell-entry">
                      <strong>{e.title}</strong>
                      <ul>
                        {e.items.map((it) => <li key={it}>{it}</li>)}
                      </ul>
                    </div>
                  ))
                ) : (
                  <p className="muted">{r.message ?? "Behind-the-scenes improvements."}</p>
                )}
              </li>
            ))}
          </ol>
          <p className="hint">Your library is backed up automatically before every update.</p>
        </div>
      )}

      {card && (
        <div className="update-card" role="status" aria-live="polite">
          <div>
            <b>Update complete</b>
            <p>
              {card === "reload"
                ? "A new version just went live. Reload to start using it. Your data is untouched."
                : latest?.entries[0]?.title ?? latest?.message ?? "The site was updated. Your data is untouched."}
            </p>
          </div>
          <div className="update-card-actions">
            {card === "reload" ? (
              <button type="button" className="btn small" onClick={() => window.location.reload()}>Reload</button>
            ) : (
              <button type="button" className="btn small" onClick={() => { setCard(null); setOpen(true); }}>What&apos;s new</button>
            )}
            <button type="button" className="close" aria-label="Dismiss" onClick={() => setCard(null)}>×</button>
          </div>
        </div>
      )}
    </div>
  );
}
