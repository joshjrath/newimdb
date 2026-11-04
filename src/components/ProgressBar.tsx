import type { Progress } from "@/lib/domain/progress";

export function ProgressBar({ p, big }: { p: Progress; big?: boolean }) {
  if (p.total === 0) return null;
  const label = `${p.watched} of ${p.denominator} episodes watched${p.skipped ? ` · ${p.skipped} skipped` : ""}`;
  return (
    <div className={`progress${big ? " big" : ""}`}>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={p.denominator} aria-valuenow={p.watched} aria-label={label}>
        <div className="progress-fill" style={{ width: `${p.percent}%` }} />
      </div>
      <span className="progress-label">
        {p.watched}/{p.denominator} watched{p.skipped ? `, ${p.skipped} skipped` : ""}{p.unaired ? `, ${p.unaired} not out yet` : ""}
        {big && p.rated !== p.watched ? `, ${p.rated} rated` : ""} · {Math.round(p.percent)}%
      </span>
    </div>
  );
}
