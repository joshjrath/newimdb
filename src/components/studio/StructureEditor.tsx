"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "../Toasts";
import { SEGMENT_KIND_LABEL, SEGMENT_KINDS, type MediaType, type SegmentKind, type SegmentView } from "@/lib/domain/types";
import { computeProgress } from "@/lib/domain/progress";

interface Row {
  key: string;
  id?: number;
  kind: SegmentKind;
  label: string;
  seasonNumber: string;
  courNumber: string;
  episodeCount: string;
  provider: string;
  providerRef: string;
}

let n = 0;
const toRows = (segs: SegmentView[]): Row[] =>
  segs.map((s) => ({
    key: `s${s.id}`,
    id: s.id,
    kind: s.kind,
    label: s.label,
    seasonNumber: s.seasonNumber == null ? "" : String(s.seasonNumber),
    courNumber: s.courNumber == null ? "" : String(s.courNumber),
    episodeCount: String(s.episodes.length),
    provider: s.provider ?? "",
    providerRef: s.providerRef ?? "",
  }));

function nextDefaults(rows: Row[], kind: SegmentKind): Partial<Row> {
  const seasons = rows.map((r) => Number(r.seasonNumber)).filter((x) => x > 0);
  const maxSeason = seasons.length ? Math.max(...seasons) : 0;
  const countKind = rows.filter((r) => r.kind === kind).length + 1;
  if (kind === "season") return { label: `Season ${maxSeason + 1}`, seasonNumber: String(maxSeason + 1), episodeCount: "12" };
  if (kind === "cour") {
    const s = maxSeason || 1;
    const cours = rows.filter((r) => Number(r.seasonNumber) === s && r.courNumber).length;
    return { label: `Season ${s} · Cour ${cours + 1}`, seasonNumber: String(s), courNumber: String(cours + 1), episodeCount: "12" };
  }
  if (kind === "movie") return { label: `Movie ${countKind}`, episodeCount: "1" };
  if (kind === "ova") return { label: countKind > 1 ? `OVA ${countKind}` : "OVA", episodeCount: "1" };
  return { label: countKind > 1 ? `Special ${countKind}` : "Specials", episodeCount: "1" };
}

export function StructureEditor({
  mediaId, type, segments, version, onSaved, onSegments, onDirty,
}: {
  mediaId: number; type: MediaType; segments: SegmentView[]; version: number;
  onSaved: (s: SegmentView[], version: number) => void; onSegments: (s: SegmentView[]) => void; onDirty: (d: boolean) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => toRows(segments));
  const [base, setBase] = useState<Row[]>(() => toRows(segments));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<number | null>(null);
  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(base), [rows, base]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const byId = new Map(segments.map((s) => [s.id, s]));
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const c = [...rs];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const add = (kind: SegmentKind) =>
    setRows((rs) => [...rs, { key: `n${++n}`, kind, label: "", seasonNumber: "", courNumber: "", episodeCount: "1", provider: "", providerRef: "", ...nextDefaults(rs, kind) }]);

  const payload = (confirmLoss?: boolean) => ({
    version,
    confirmLoss,
    segments: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label.trim() || SEGMENT_KIND_LABEL[r.kind],
      seasonNumber: r.seasonNumber === "" ? null : Number(r.seasonNumber),
      courNumber: r.courNumber === "" ? null : Number(r.courNumber),
      episodeCount: Number(r.episodeCount) || 0,
      provider: r.provider.trim() || null,
      providerRef: r.providerRef.trim() || null,
    })),
  });

  const save = async (confirmLoss?: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ segments: SegmentView[]; version: number }>(`/api/media/${mediaId}/structure`, { method: "PUT", body: payload(confirmLoss) });
      onSaved(r.segments, r.version);
      const fresh = toRows(r.segments);
      setRows(fresh);
      setBase(fresh);
      toast.push("ok", "Seasons saved.");
    } catch (e) {
      if (e instanceof ApiError && e.body.code === "needs_confirmation") {
        const losses = (e.body.losses as { segment: string; episodes: number; withData: number }[]) ?? [];
        const msg = losses.map((l) => `• ${l.segment}: ${l.withData} episode(s) with ratings or watch states`).join("\n");
        if (confirm(`This will permanently remove:\n${msg}\n\nSave anyway?`)) return save(true);
        setError("Not saved. Nothing was removed.");
      } else {
        setError((e as Error).message);
        toast.push("error", `Seasons not saved: ${(e as Error).message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const fetchTitles = async (r: Row) => {
    if (!r.id) return;
    if (dirty) {
      toast.push("info", "Save the structure first, then fetch episode titles.");
      return;
    }
    setFetching(r.id);
    try {
      const res = await api<{ added: number; updated: number; segments: SegmentView[] }>(`/api/media/${mediaId}/segments/${r.id}/fetch`, {
        body: { provider: r.provider || undefined, providerRef: r.providerRef || undefined },
      });
      onSegments(res.segments);
      const fresh = toRows(res.segments);
      setRows(fresh);
      setBase(fresh);
      toast.push("ok", `${r.label}: ${res.updated} titles updated, ${res.added} episodes added. Ratings untouched.`);
    } catch (e) {
      toast.push("error", (e as Error).message);
    } finally {
      setFetching(null);
    }
  };

  const providers = type === "anime" ? ["", "jikan"] : ["", "tmdb", "tvmaze"];

  return (
    <section className="panel" id="structure" aria-labelledby="struct-h">
      <header>
        <h2 id="struct-h">Seasons, cours and specials</h2>
        <span className="hint">Order here is the watch order. Put an OVA or special between cours if that's when you watch it.</span>
      </header>
      <div className="seg-editor">
        {rows.map((r, i) => {
          const seg = r.id ? byId.get(r.id) : undefined;
          const p = seg ? computeProgress(seg.episodes) : null;
          return (
            <div className={`seg-row${r.id ? "" : " new"}`} key={r.key}>
              <div className="move">
                <button type="button" className="btn small ghost" aria-label={`Move ${r.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn small ghost" aria-label={`Move ${r.label} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
              </div>
              <label className="field">
                <span>Kind</span>
                <select className="select" value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as SegmentKind })}>
                  {SEGMENT_KINDS.map((k) => <option key={k} value={k}>{SEGMENT_KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Label</span>
                <input className="input" value={r.label} maxLength={60} onChange={(e) => update(r.key, { label: e.target.value })} />
              </label>
              <label className="field">
                <span>Season #</span>
                <input className="input" inputMode="numeric" value={r.seasonNumber} onChange={(e) => update(r.key, { seasonNumber: e.target.value.replace(/\D/g, "") })} />
              </label>
              <label className="field">
                <span>Cour #</span>
                <input className="input" inputMode="numeric" value={r.courNumber} onChange={(e) => update(r.key, { courNumber: e.target.value.replace(/\D/g, "") })} />
              </label>
              <label className="field">
                <span>Episodes</span>
                <input className="input" inputMode="numeric" value={r.episodeCount} onChange={(e) => update(r.key, { episodeCount: e.target.value.replace(/\D/g, "") })} />
              </label>
              <div className="row-actions">
                {p && p.total > 0 && <span className="hint" style={{ alignSelf: "center" }}>{p.watched}/{p.denominator} watched</span>}
                <button type="button" className="btn small danger" aria-label={`Remove ${r.label}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                <label className="field" style={{ width: 130 }}>
                  <span>Titles from</span>
                  <select className="select" value={r.provider} onChange={(e) => update(r.key, { provider: e.target.value })}>
                    {providers.map((p) => <option key={p} value={p}>{p || "None"}</option>)}
                  </select>
                </label>
                <label className="field" style={{ width: 170 }}>
                  <span>{type === "anime" ? "MAL ID" : "Show ID:season"}</span>
                  <input className="input" value={r.providerRef} placeholder={type === "anime" ? "e.g. 5114" : "e.g. 1396:2"} onChange={(e) => update(r.key, { providerRef: e.target.value })} />
                </label>
                {r.id && (
                  <button type="button" className="btn small" disabled={fetching === r.id || !r.provider || !r.providerRef} onClick={() => fetchTitles(r)}>
                    {fetching === r.id ? "Fetching…" : "Fetch episode titles"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <p className="hint">No seasons yet.</p>}
      </div>
      <div className="toolbar">
        <span className="label">Add</span>
        {SEGMENT_KINDS.map((k) => (
          <button key={k} type="button" className="btn small" onClick={() => add(k)}>{SEGMENT_KIND_LABEL[k]}</button>
        ))}
      </div>
      <div className="toolbar" style={{ justifyContent: "flex-end" }}>
        <span className={`hint`} style={{ marginRight: "auto", color: error ? "var(--danger)" : dirty ? "var(--brass)" : undefined }} role="status">
          {error ?? (saving ? "Saving…" : dirty ? "Unsaved changes to seasons" : "Seasons saved")}
        </span>
        {dirty && <button type="button" className="btn ghost" onClick={() => { setRows(base); setError(null); }}>Discard</button>}
        <button type="button" className="btn primary" disabled={!dirty || saving} onClick={() => save()}>Save seasons</button>
      </div>
    </section>
  );
}
