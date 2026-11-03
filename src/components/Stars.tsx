import { formatRating } from "@/lib/domain/rating";

export const STAR_PATH = "M12 2.6l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.4l-5.9 3.3 1.3-6.6L2.5 9.5l6.6-.8z";

function Svg({ empty }: { empty?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={empty ? "empty" : undefined}>
      <path d={STAR_PATH} fill="currentColor" />
    </svg>
  );
}

export type StarFill = "full" | "half" | "empty";

/** How star `i` (1–5) is drawn for a rating `value`. */
export const starFill = (value: number | null, i: number): StarFill => ((value ?? 0) >= i ? "full" : (value ?? 0) >= i - 0.5 ? "half" : "empty");

export function StarIcon({ fill }: { fill: StarFill }) {
  if (fill !== "half") return <Svg empty={fill === "empty"} />;
  return (
    <span className="star-half" aria-hidden="true">
      <Svg empty />
      <span className="star-half-fill"><Svg /></span>
    </span>
  );
}

/** Stars only — no redundant numeric score beside them. Screen readers get the number. */
export function Stars({ value, size = 16 }: { value: number | null; size?: number }) {
  if (value == null) return null;
  return (
    <span className="stars" role="img" aria-label={formatRating(value)} style={{ "--star-size": `${size}px` } as React.CSSProperties}>
      {[1, 2, 3, 4, 5].map((i) => (
        <StarIcon key={i} fill={starFill(value, i)} />
      ))}
    </span>
  );
}
