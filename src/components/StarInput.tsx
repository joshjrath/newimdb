"use client";
import { StarIcon } from "./Stars";
import { formatRating } from "@/lib/domain/rating";

/** Five stars with half steps. Click left/right half; arrow keys step by 0.5; Backspace clears. */
export function StarInput({ value, onChange, label = "Rating" }: { value: number | null; onChange: (v: number | null) => void; label?: string }) {
  return (
    <div
      className="star-input-wrap"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={value ?? 0}
      aria-valuetext={formatRating(value)}
      onKeyDown={(e) => {
        const v = value ?? 0;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange(Math.min(5, v + 0.5)); }
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange(v - 0.5 >= 0.5 ? v - 0.5 : null); }
        else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") { e.preventDefault(); onChange(null); }
        else if (/^[1-5]$/.test(e.key)) { e.preventDefault(); onChange(Number(e.key)); }
        else if (e.key === "Home") { e.preventDefault(); onChange(0.5); }
        else if (e.key === "End") { e.preventDefault(); onChange(5); }
      }}
      style={{ display: "inline-flex", alignItems: "center", gap: 12 }}
    >
      <span className="star-input">
        {[1, 2, 3, 4, 5].map((i) => {
          const v = value ?? 0;
          const fill = v >= i ? "full" : v >= i - 0.5 ? "half" : "empty";
          return (
            <span key={i} className={`star-btn${fill !== "empty" ? " on" : ""}`}>
              <StarIcon fill={fill} />
              <button type="button" tabIndex={-1} className="half l" aria-hidden="true" onClick={() => onChange(i - 0.5)} />
              <button type="button" tabIndex={-1} className="half r" aria-hidden="true" onClick={() => onChange(i)} />
            </span>
          );
        })}
      </span>
      <span className="hint" aria-hidden="true">{value == null ? "Not rated" : `${value} / 5`}</span>
      {value != null && (
        <button type="button" className="btn small ghost" onClick={() => onChange(null)}>Clear</button>
      )}
    </div>
  );
}
