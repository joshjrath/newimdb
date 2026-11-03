/** Five-star scale with half-star steps: 0.5, 1, … 5. `null` means "not rated". */
export const RATING_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;

export function isValidRating(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0.5 && v <= 5 && Number.isInteger(v * 2);
}

/** Parses "4.5", "4,5", "★★★★½" style input. Returns undefined for invalid input. */
export function parseRating(input: string): number | null | undefined {
  const s = input.trim();
  if (s === "" || s === "-" || s === "?") return null;
  if (/^[★½]+$/.test(s)) {
    const v = (s.match(/★/g)?.length ?? 0) + (s.includes("½") ? 0.5 : 0);
    return isValidRating(v) ? v : undefined;
  }
  const n = Number(s.replace(",", "."));
  return isValidRating(n) ? n : undefined;
}

/** Suggested short labels. Owner can override per review ("Perfect", not "Awesome"). */
const SUGGESTED_LABEL: Record<string, string> = {
  "5": "Perfect",
  "4.5": "Excellent",
  "4": "Great",
  "3.5": "Good",
  "3": "Decent",
  "2.5": "Mixed",
  "2": "Weak",
  "1.5": "Poor",
  "1": "Bad",
  "0.5": "Awful",
};

export function suggestedLabel(r: number | null): string | null {
  return r == null ? null : SUGGESTED_LABEL[String(r)] ?? null;
}

export function formatRating(r: number | null): string {
  if (r == null) return "Not rated";
  return `${r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)} out of 5 stars`;
}

export function formatScore(r: number | null, digits = 1): string {
  if (r == null) return "–";
  return Number.isInteger(r) && digits === 1 ? r.toFixed(0) : r.toFixed(digits);
}

/**
 * Heatmap bands (SeriesGraph-style): green high → yellow → orange/red → purple low.
 * Every band also has a text label so colour never carries meaning alone.
 */
export interface RatingBand {
  min: number;
  key: string;
  label: string;
}
export const RATING_BANDS: RatingBand[] = [
  { min: 4.5, key: "b5", label: "Outstanding (4.5–5)" },
  { min: 4, key: "b4", label: "Great (4)" },
  { min: 3.5, key: "b35", label: "Good (3.5)" },
  { min: 3, key: "b3", label: "Okay (3)" },
  { min: 2.5, key: "b25", label: "Mixed (2.5)" },
  { min: 2, key: "b2", label: "Weak (2)" },
  { min: 1.5, key: "b15", label: "Bad (1.5)" },
  { min: 0, key: "b1", label: "Awful (0.5–1)" },
];

export function ratingBand(r: number): RatingBand {
  return RATING_BANDS.find((b) => r >= b.min) ?? RATING_BANDS[RATING_BANDS.length - 1];
}
