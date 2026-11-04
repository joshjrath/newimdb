"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { useAction } from "../useAction";

type Share = { token: string | null; ratings: boolean };

/** Share a list by link. Off by default; turning it off kills the link. */
export function SharePanel({ listId }: { listId: number }) {
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [copied, setCopied] = useState(false);
  const { busy, run } = useAction();
  useEffect(() => {
    if (open && !share) api<{ share: Share }>(`/api/lists/${listId}/share`).then((r) => setShare(r.share)).catch(() => {});
  }, [open, share, listId]);
  const url = share?.token ? `${window.location.origin}/s/${share.token}` : null;
  const set = async (on: boolean, ratings = share?.ratings ?? false) => {
    const r = await run(() => api<{ share: Share }>(`/api/lists/${listId}/share`, { body: { on, ratings } }), { ok: on ? "Sharing on. Anyone with the link can view this list." : "Sharing off. The link no longer works." });
    if (r) setShare(r.share);
  };
  const copy = async () => {
    if (!url) return;
    try {
      if (navigator.share) await navigator.share({ url, title: document.title });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return (
    <div className="share-panel">
      <button type="button" className="btn small" onClick={() => setOpen(!open)} aria-expanded={open}>
        {share?.token ? "🔗 Shared" : "Share"}
      </button>
      {open && (
        <div className="share-pop" role="dialog" aria-label="Share this list">
          {!share ? (
            <p className="hint">Loading…</p>
          ) : !share.token ? (
            <>
              <p><b>Share this list by link</b></p>
              <p className="hint">Anyone with the link sees the list: titles, posters, dates and how far you&apos;ve got. Never your reviews or the rest of your library.</p>
              <label className="check"><input type="checkbox" checked={share.ratings} onChange={(e) => setShare({ ...share, ratings: e.target.checked })} /> Include my ratings</label>
              <button className="btn primary" disabled={busy} onClick={() => set(true, share.ratings)}>Create link</button>
            </>
          ) : (
            <>
              <p><b>Anyone with this link can view</b></p>
              <div className="share-url">
                <input className="input small" readOnly value={url ?? ""} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
                <button className="btn small primary" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
              </div>
              <label className="check"><input type="checkbox" checked={share.ratings} disabled={busy} onChange={(e) => set(true, e.target.checked)} /> Include my ratings</label>
              <div className="toolbar">
                <a className="btn small ghost" href={url ?? "#"} target="_blank" rel="noopener noreferrer">Preview</a>
                <button className="btn small danger" disabled={busy} onClick={() => set(false)}>Stop sharing</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
