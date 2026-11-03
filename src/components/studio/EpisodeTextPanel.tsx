"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "../Toasts";
import type { SegmentView } from "@/lib/domain/types";

export function EpisodeTextPanel({ mediaId, onApplied }: { mediaId: number; onApplied: (s: SegmentView[]) => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async (all: boolean) => {
    try {
      const r = await api<{ text: string }>(`/api/media/${mediaId}/episodes/text${all ? "?all=1" : ""}`);
      setText(r.text);
      setErrors([]);
    } catch (e) {
      toast.push("error", (e as Error).message);
    }
  };

  const apply = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const r = await api<{ count: number; segments: SegmentView[] }>(`/api/media/${mediaId}/episodes/text`, { body: { text } });
      onApplied(r.segments);
      toast.push("ok", `Applied ${r.count} episode ${r.count === 1 ? "line" : "lines"}.`);
    } catch (e) {
      if (e instanceof ApiError && Array.isArray(e.body.lineErrors)) setErrors(e.body.lineErrors as typeof errors);
      toast.push("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="txt-h">
      <header>
        <h2 id="txt-h">Ratings as text</h2>
        <div className="toolbar">
          <button type="button" className="btn small" onClick={() => load(false)}>Load current ratings</button>
          <button type="button" className="btn small ghost" onClick={() => load(true)}>Load every episode</button>
        </div>
      </header>
      <p className="hint">
        One episode per line: <code>S1C1E1: 4.5</code>, <code>S2E3: skip</code>, <code>S1E4: watched</code>, <code>S1E5: 3 filler</code>,{" "}
        <code>&quot;OVA&quot; E1: 5</code>. Lines that can&apos;t be matched are listed and nothing is applied until they&apos;re fixed.
      </p>
      <label className="field">
        <span className="visually-hidden">Episode ratings text</span>
        <textarea className="textarea mono" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      </label>
      {errors.length > 0 && (
        <div className="notice error" role="alert">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {errors.slice(0, 20).map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}
          </ul>
        </div>
      )}
      <div><button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={apply}>{busy ? "Applying…" : "Apply ratings"}</button></div>
    </section>
  );
}
