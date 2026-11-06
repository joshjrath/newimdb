import { progressBand } from "@/lib/domain/progressBand";

/** A list's (or an item's) progress bar. */
export function ListProgress({ percent, label, thin }: { percent: number; label?: string; thin?: boolean }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className={`list-progress ${progressBand(p)}${thin ? " thin" : ""}${p >= 100 ? " done" : ""}`}>
      <div className="list-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} aria-label={label ?? "Progress"}>
        <span style={{ width: `${p}%` }} />
      </div>
      {label && <span className="list-progress-label">{label}</span>}
    </div>
  );
}
