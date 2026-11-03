import { isValidRating } from "./rating";
import type { EpisodeState, SegmentView } from "./types";
import { orderedSegments, segmentCode } from "./progress";

/**
 * Plain-text episode ratings, e.g.
 *
 *   S1C1E1: 4.5
 *   S1C1E2: 4 filler
 *   S1E7: skip
 *   S2E1: watched
 *   S2E2: ?
 *   "OVA" E1: 5
 *   "Movie 1" E1: 4.5
 *
 * Values: a rating 0.5–5 (half steps), `watched`/`✓`, `skip`/`skipped`/`N/A`, `?`/`unwatched`.
 * A trailing `filler` (or `F`) marks filler; `-filler` clears it. `#` starts a comment.
 */

export interface TextAssignment {
  line: number;
  segmentRef: { season: number; cour: number | null } | { label: string };
  episode: number;
  state: EpisodeState;
  rating: number | null;
  filler: boolean | undefined;
}

export interface ParseResult {
  assignments: TextAssignment[];
  errors: { line: number; message: string }[];
}

const LINE_RE =
  /^(?:S(\d+)(?:C(\d+))?\s*E(\d+)|"([^"]+)"\s*E(\d+))\s*[:=]\s*(.+)$/i;

export function parseEpisodeText(text: string): ParseResult {
  const assignments: TextAssignment[] = [];
  const errors: ParseResult["errors"] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const stripped = raw.replace(/#.*$/, "").trim();
    if (!stripped) return;
    const m = LINE_RE.exec(stripped);
    if (!m) {
      errors.push({ line, message: `Can't read "${raw.trim()}". Expected e.g. S1C1E1: 4.5` });
      return;
    }
    const segmentRef = m[1]
      ? { season: Number(m[1]), cour: m[2] ? Number(m[2]) : null }
      : { label: m[4] };
    const episode = Number(m[3] ?? m[5]);
    let rest = m[6].trim();
    let filler: boolean | undefined;
    const fm = /\s+(-?)(filler|f)$/i.exec(rest);
    if (fm) {
      filler = fm[1] !== "-";
      rest = rest.slice(0, fm.index).trim();
    } else if (/^(filler|f)$/i.test(rest)) {
      filler = true;
      rest = "?";
    }
    const v = rest.toLowerCase();
    let state: EpisodeState;
    let rating: number | null = null;
    if (["skip", "skipped", "n/a", "na"].includes(v)) state = "skipped";
    else if (["watched", "✓", "w", "seen"].includes(v)) state = "watched";
    else if (["?", "unwatched", "-", "none"].includes(v)) state = "unwatched";
    else {
      const n = Number(v.replace(",", "."));
      if (!isValidRating(n)) {
        errors.push({ line, message: `"${rest}" isn't a rating. Use 0.5–5 in half steps, watched, skip or ?` });
        return;
      }
      state = "watched";
      rating = n;
    }
    if (episode < 1) {
      errors.push({ line, message: "Episode numbers start at 1" });
      return;
    }
    assignments.push({ line, segmentRef, episode, state, rating, filler });
  });
  return { assignments, errors };
}

/** Resolve parsed assignments against a structure. Unknown references are errors (no silent drops). */
export function resolveAssignments(segments: SegmentView[], parsed: ParseResult) {
  const errors = [...parsed.errors];
  const resolved: { episodeId: number; state: EpisodeState; rating: number | null; filler: boolean | undefined }[] = [];
  for (const a of parsed.assignments) {
    let seg: SegmentView | undefined;
    if ("label" in a.segmentRef) {
      const label = a.segmentRef.label.toLowerCase();
      seg = segments.find((s) => s.label.toLowerCase() === label);
    } else {
      const { season, cour } = a.segmentRef;
      const candidates = segments.filter(
        (s) => (s.kind === "season" || s.kind === "cour") && s.seasonNumber === season,
      );
      seg =
        cour == null
          ? candidates.find((s) => s.courNumber == null) ?? (candidates.length === 1 ? candidates[0] : undefined)
          : candidates.find((s) => s.courNumber === cour);
      if (!seg && cour == null && candidates.length > 1) {
        // Season split into cours: S2E14 means the 14th episode across its cours, in order.
        const ordered = orderedSegments(candidates);
        let n = a.episode;
        for (const c of ordered) {
          if (n <= c.episodes.length) {
            const ep = [...c.episodes].sort((x, y) => x.number - y.number)[n - 1];
            if (ep) resolved.push({ episodeId: ep.id, state: a.state, rating: a.rating, filler: a.filler });
            n = -1;
            break;
          }
          n -= c.episodes.length;
        }
        if (n !== -1) errors.push({ line: a.line, message: `Season ${season} has no episode ${a.episode}` });
        continue;
      }
    }
    if (!seg) {
      errors.push({ line: a.line, message: `No segment matches line ${a.line}` });
      continue;
    }
    const ep = seg.episodes.find((e) => e.number === a.episode);
    if (!ep) {
      errors.push({ line: a.line, message: `${seg.label} has no episode ${a.episode}` });
      continue;
    }
    resolved.push({ episodeId: ep.id, state: a.state, rating: a.rating, filler: a.filler });
  }
  return { resolved, errors };
}

export function exportEpisodeText(segments: SegmentView[], opts: { includeUnwatched?: boolean } = {}): string {
  const lines: string[] = [];
  for (const s of orderedSegments(segments)) {
    const code = segmentCode(s);
    const prefix = /^S\d+/.test(code) ? code : `"${s.label.replace(/"/g, "'")}" `;
    const eps = [...s.episodes].sort((a, b) => a.number - b.number);
    const out = eps
      .filter((e) => opts.includeUnwatched || e.state !== "unwatched" || e.filler)
      .map((e) => {
        const v = e.rating != null ? String(e.rating) : e.state === "watched" ? "watched" : e.state === "skipped" ? "skip" : "?";
        return `${prefix}E${e.number}: ${v}${e.filler ? " filler" : ""}`;
      });
    if (out.length) {
      lines.push(`# ${s.label}`);
      lines.push(...out);
    }
  }
  return lines.join("\n");
}
