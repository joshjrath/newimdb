"use client";
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { useToast } from "../Toasts";
import { SaveState } from "./SaveState";
import { defaultSegmentLabel, EPISODE_PROVIDERS_BY_TYPE, SEGMENT_KIND_LABEL, SEGMENT_KINDS, type MediaType, type SegmentKind, type SegmentView } from "@/lib/domain/types";
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

type NumericField = "seasonNumber" | "courNumber" | "episodeCount";
const NUMERIC_FIELDS: [NumericField, string][] = [["seasonNumber", "Season #"], ["courNumber", "Cour #"], ["episodeCount", "Episodes"]];

let newKey = 0;
const str = (v: number | null) => (v == null ? "" : String(v));
const num = (v: string) => (v === "" ? null : Number(v));

const toRows = (segs: SegmentView[]): Row[] =>
  segs.map((s) => ({
    key: `s${s.id}`,
    id: s.id,
    kind: s.kind,
    label: s.label,
    seasonNumber: str(s.seasonNumber),
    courNumber: str(s.courNumber),
    episodeCount: String(s.episodes.length),
    provider: s.provider ?? "",
    providerRef: s.providerRef ?? "",
  }));

/** Sensible defaults for a new segment of `kind`, continuing the numbering already in the list. */
function newRow(rows: Row[], kind: SegmentKind): Row {
  const seasons = rows.map((r) => Number(r.seasonNumber)).filter((x) => x > 0);
  const maxSeason = seasons.length ? Math.max(...seasons) : 0;
  const ordinal = rows.filter((r) => r.kind === kind).length + 1;
  let season: number | null = null;
  let cour: number | null = null;
  if (kind === "season") season = maxSeason + 1;
  if (kind === "cour") {
    season = maxSeason || 1;
    cour = rows.filter((r) => Number(r.seasonNumber) === season && r.courNumber).length + 1;
  }
  return {
    key: `n${++newKey}`,
    kind,
    label: defaultSegmentLabel(kind, { season, cour, ordinal }),
    seasonNumber: str(season),
    courNumber: str(cour),
    episodeCount: kind === "season" || kind === "cour" ? "12" : "1",
    provider: "",
    providerRef: "",
  };
}

export function StructureEditor({ mediaId, type, segments, version, onChange, onDirty }: {
  mediaId: number;
  type: MediaType;
  segments: SegmentView[];
  version: number;
  /** New server state; `version` is set when the entry's version changed. */
  onChange: (s: SegmentView[], version?: number) => void;
  onDirty: (d: boolean) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => toRows(segments));
  const [base, setBase] = useState<Row[]>(rows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState<number | null>(null);
  const dirty = useMemo(() => JSON.stringify(rows) !== JSON.stringify(base), [rows, base]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const progressById = useMemo(() => new Map(segments.map((s) => [s.id, computeProgress(s.episodes)])), [segments]);

  const reset = (segs: SegmentView[], version?: number) => {
    onChange(segs, version);
    const fresh = toRows(segs);
    setRows(fresh);
    setBase(fresh);
  };
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const c = [...rs];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  const save = async (confirmLoss?: boolean): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ segments: SegmentView[]; version: number }>(`/api/media/${mediaId}/structure`, {
        method: "PUT",
        body: {
          version,
          confirmLoss,
          segments: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            label: r.label.trim() || SEGMENT_KIND_LABEL[r.kind],
            seasonNumber: num(r.seasonNumber),
            courNumber: num(r.courNumber),
            episodeCount: Number(r.episodeCount) || 0,
            provider: r.provider.trim() || null,
            providerRef: r.providerRef.trim() || null,
          })),
        },
      });
      reset(r.segments, r.version);
      toast.push("ok", "Seasons saved.");
    } catch (e) {
      if (e instanceof ApiError && e.body.code === "needs_confirmation") {
        const losses = (e.body.losses as { segment: string; withData: number }[]) ?? [];
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
    if (dirty) return toast.push("info", "Save the structure first, then fetch episode titles.");
    setFetching(r.id);
    try {
      const res = await api<{ added: number; updated: number; segments: SegmentView[] }>(`/api/media/${mediaId}/segments/${r.id}/fetch`, {
        body: { provider: r.provider || undefined, providerRef: r.providerRef || undefined },
      });
      reset(res.segments);
      toast.push("ok", `${r.label}: ${res.updated} titles updated, ${res.added} episodes added. Ratings untouched.`);
    } catch (e) {
      toast.push("error", (e as Error).message);
    } finally {
      setFetching(null);
    }
  };

  return (
    <section className="panel" id="structure" aria-labelledby="struct-h">
      <header>
        <h2 id="struct-h">Seasons, cours and specials</h2>
        <span className="hint">Order here is the watch order. Put an OVA or special between cours if that's when you watch it.</span>
      </header>
      <div className="seg-editor">
        {rows.map((r, i) => {
          const p = r.id ? progressById.get(r.id) : undefined;
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
              {NUMERIC_FIELDS.map(([field, label]) => (
                <label className="field" key={field}>
                  <span>{label}</span>
                  <input className="input" inputMode="numeric" value={r[field]} onChange={(e) => update(r.key, { [field]: e.target.value.replace(/\D/g, "") })} />
                </label>
              ))}
              <div className="row-actions">
                {p && p.total > 0 && <span className="hint" style={{ alignSelf: "center" }}>{p.watched}/{p.denominator} watched</span>}
                <button type="button" className="btn small danger" aria-label={`Remove ${r.label}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>Remove</button>
              </div>
              <div className="toolbar" style={{ gridColumn: "1 / -1", alignItems: "end" }}>
                <label className="field" style={{ width: 130 }}>
                  <span>Titles from</span>
                  <select className="select" value={r.provider} onChange={(e) => update(r.key, { provider: e.target.value })}>
                    <option value="">None</option>
                    {EPISODE_PROVIDERS_BY_TYPE[type].map((p) => <option key={p} value={p}>{p}</option>)}
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
          <button key={k} type="button" className="btn small" onClick={() => setRows((rs) => [...rs, newRow(rs, k)])}>{SEGMENT_KIND_LABEL[k]}</button>
        ))}
      </div>
      <div className="toolbar">
        <SaveState error={error} saving={saving} dirty={dirty} dirtyText="Unsaved changes to seasons" savedText="Seasons saved" />
        {dirty && <button type="button" className="btn ghost" onClick={() => { setRows(base); setError(null); }}>Discard</button>}
        <button type="button" className="btn primary" disabled={!dirty || saving} onClick={() => save()}>Save seasons</button>
      </div>
    </section>
  );
}
