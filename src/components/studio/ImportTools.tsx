"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client/api";
import { useToast } from "../Toasts";
import type { PreviewRow, ImportAction } from "@/lib/repo/imports";
import { Stars } from "../Stars";
import { useUnsavedGuard } from "./useUnsavedGuard";
import { excerpt } from "@/lib/domain/text";
import { ImdbImport } from "./ImdbImport";

const MATCH_LABEL: Record<PreviewRow["match"], string> = {
  new: "New",
  unchanged: "No change",
  update: "Changed on Letterboxd",
  conflict: "Already here",
  duplicate_in_batch: "Rewatch",
};

const ACTIONS: Record<PreviewRow["match"], ImportAction[]> = {
  new: ["create", "skip"],
  unchanged: ["skip", "overwrite"],
  update: ["update", "overwrite", "skip"],
  conflict: ["link", "update", "overwrite", "skip"],
  duplicate_in_batch: ["update", "skip"],
};
const ACTION_LABEL: Record<ImportAction, string> = {
  create: "Add",
  update: "Fill in missing (keep my text)",
  overwrite: "Replace with Letterboxd",
  link: "Link only, change nothing",
  skip: "Skip",
};

export function ImportTools() {
  return (
    <div className="stack loose">
      <ImdbImport />
      <LetterboxdImport />
      <Backup />
    </div>
  );
}

function LetterboxdImport() {
  const toast = useToast();
  const router = useRouter();
  const [source, setSource] = useState<"rss_url" | "rss_text" | "csv_text">("rss_url");
  const [value, setValue] = useState("");
  const [rows, setRows] = useState<(PreviewRow & { action: ImportAction })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsavedGuard(Boolean(rows?.some((r) => r.action !== "skip")), "You have an import preview that hasn't been applied. Leave anyway?");

  const preview = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ rows: PreviewRow[] }>("/api/import/letterboxd/preview", { body: { source, value } });
      setRows(r.rows.map((x) => ({ ...x, action: x.defaultAction })));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await api<{ counts: Record<string, number> }>("/api/import/letterboxd/commit", {
        body: { items: rows.map((x) => ({ entry: x.entry, action: x.action, mediaId: x.mediaId })) },
      });
      toast.push("ok", `Imported: ${r.counts.created} added, ${r.counts.updated} updated, ${r.counts.linked} linked, ${r.counts.skipped} skipped. All private.`);
      setRows(null);
      setValue("");
      router.refresh();
    } catch (err) {
      toast.push("error", `Import not applied: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const setAll = (from: PreviewRow["match"], action: ImportAction) =>
    setRows((rs) => rs?.map((r) => (r.match === from && ACTIONS[r.match].includes(action) ? { ...r, action } : r)) ?? null);

  const readFile = async (f: File) => {
    const text = await f.text();
    setValue(text);
    setSource(f.name.endsWith(".csv") ? "csv_text" : "rss_text");
  };

  const counts = rows?.reduce<Record<string, number>>((a, r) => ((a[r.action] = (a[r.action] ?? 0) + 1), a), {});

  return (
    <section className="panel" aria-labelledby="lb-h">
      <header>
        <h2 id="lb-h">Import from Letterboxd</h2>
        <span className="hint">Imports stay private. Nothing is posted anywhere.</span>
      </header>
      <form onSubmit={preview} className="stack tight">
        <div className="chips" role="radiogroup" aria-label="Source">
          {([["rss_url", "Username (RSS)"], ["rss_text", "Paste RSS"], ["csv_text", "Export CSV"]] as const).map(([k, l]) => (
            <button type="button" key={k} role="radio" aria-checked={source === k} aria-pressed={source === k} className="chip" onClick={() => { setSource(k); setValue(""); }}>{l}</button>
          ))}
        </div>
        {source === "rss_url" ? (
          <label className="field">
            <span>Letterboxd username or profile URL</span>
            <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="yourname" />
            <span className="hint">The RSS feed only has your latest ~50 entries. For your whole history, use the export CSV (Letterboxd Settings, Data, Export).</span>
          </label>
        ) : (
          <>
            <label className="field">
              <span>{source === "csv_text" ? "reviews.csv, diary.csv or ratings.csv" : "RSS XML"}</span>
              <textarea className="textarea mono" style={{ minHeight: 140 }} value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
            </label>
            <label className="btn small self-start">
              Choose file
              <input type="file" accept=".csv,.xml,.rss,text/csv,application/xml" className="visually-hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
            </label>
          </>
        )}
        {error && <div className="notice error" role="alert">{error}</div>}
        <div><button className="btn primary" disabled={busy || !value.trim()}>{busy && !rows ? "Reading…" : "Preview import"}</button></div>
      </form>

      {rows && (
        <div className="stack tight">
          <div className="toolbar">
            <strong className="push-right">{rows.length} entries found</strong>
            <button className="btn small" onClick={() => setAll("new", "skip")}>Skip all new</button>
            <button className="btn small" onClick={() => setAll("new", "create")}>Add all new</button>
            <button className="btn small" onClick={() => setAll("conflict", "skip")}>Skip all already here</button>
          </div>
          <div className="table-wrap">
            <table className="manage">
              <thead>
                <tr><th>Film</th><th>Rating</th><th>Watched</th><th>Review</th><th>Match</th><th>Action</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.entry.externalId + i}>
                    <td><span className="t">{r.entry.filmTitle}</span> <span className="hint">{r.entry.filmYear}</span>{r.entry.rewatch && <div className="hint">Rewatch</div>}</td>
                    <td>{r.entry.rating != null ? <Stars value={r.entry.rating} size={13} /> : <span className="hint">–</span>}</td>
                    <td className="hint">{r.entry.watchedDate ?? ""}</td>
                    <td className="hint" style={{ maxWidth: 280 }}>
                      {r.entry.reviewText ? excerpt(r.entry.reviewText, 15) : "No text"}
                      {r.entry.spoiler && <div>Spoilers</div>}
                    </td>
                    <td>
                      {MATCH_LABEL[r.match]}
                      <div className="hint">{r.reason}{r.existingTitle && r.match === "conflict" ? ` (${r.existingTitle})` : ""}</div>
                    </td>
                    <td>
                      <select
                        className="select"
                        style={{ padding: "4px 8px" }}
                        aria-label={`Action for ${r.entry.filmTitle}`}
                        value={r.action}
                        onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, action: e.target.value as ImportAction } : x)))}
                      >
                        {ACTIONS[r.match].map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar" style={{ justifyContent: "flex-end" }}>
            <span className="hint push-right">
              {Object.entries(counts ?? {}).map(([k, v]) => `${v} ${ACTION_LABEL[k as ImportAction].toLowerCase()}`).join(" · ")}
            </span>
            <button className="btn ghost" onClick={() => setRows(null)}>Cancel</button>
            <button className="btn primary" disabled={busy} onClick={commit}>{busy ? "Importing…" : "Apply import"}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function Backup() {
  const toast = useToast();
  const router = useRouter();
  const [file, setFile] = useState<unknown>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState(false);

  const choose = async (f: File) => {
    setSummary(null);
    try {
      const json = JSON.parse(await f.text());
      const r = await api<{ summary: Record<string, number> }>("/api/backup/restore", { body: { backup: json, mode, dryRun: true } });
      setFile(json);
      setSummary(r.summary);
    } catch (e) {
      setFile(null);
      toast.push("error", e instanceof SyntaxError ? "That file isn't valid JSON." : (e as Error).message);
    }
  };

  const restore = async () => {
    const warn =
      mode === "replace"
        ? "Replace your whole library with this backup? A snapshot of the current database is saved first."
        : "Restore this backup? Entries in the backup replace matching entries here; others are kept. A snapshot is saved first.";
    if (!confirm(warn)) return;
    setBusy(true);
    try {
      const r = await api<{ result: { created: number; replaced: number; snapshot: string } }>("/api/backup/restore", { body: { backup: file, mode } });
      toast.push("ok", `Restored: ${r.result.created} added, ${r.result.replaced} replaced. Snapshot saved as ${r.result.snapshot}.`);
      setFile(null);
      setSummary(null);
      router.refresh();
    } catch (e) {
      toast.push("error", `Restore failed, nothing changed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="bk-h">
      <header><h2 id="bk-h">Backup</h2></header>
      <p className="hint">Everything: reviews, ratings, every season, cour, OVA and special, episode states, tags and IDs.</p>
      <div><a className="btn primary" href="/api/backup" download>Download backup (JSON)</a></div>
      <div className="stack tight" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
        <h3>Restore</h3>
        <div className="toolbar" style={{ gap: 16 }}>
          <label className="check"><input type="radio" name="mode" checked={mode === "merge"} onChange={() => setMode("merge")} /> Merge into library</label>
          <label className="check"><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace library</label>
        </div>
        <label className="btn self-start">
          Choose backup file
          <input type="file" accept="application/json,.json" className="visually-hidden" onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
        </label>
        {summary && (
          <div className="notice">
            {summary.entries} entries and {summary.episodes} episodes in the file. {summary.wouldCreate} new, {summary.wouldReplace} replace existing entries.
            {mode === "replace" && ` Your current ${summary.currentEntries} entries will be removed first.`}
          </div>
        )}
        {summary && <div><button className="btn danger" disabled={busy} onClick={restore}>{busy ? "Restoring…" : "Restore backup"}</button></div>}
      </div>
    </section>
  );
}
