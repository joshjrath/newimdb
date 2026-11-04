import type { EpisodeView, SegmentView } from "./types";

/**
 * PROGRESS POLICY (documented choice — the source left it open):
 *  - An episode is "watched" when its state is `watched` (a rating always implies watched).
 *  - Intentionally skipped episodes (N/A) are removed from the denominator, and reported
 *    separately as "skipped". They never count as watched.
 *  - Filler is an independent flag; filler episodes count like any other episode.
 *  - Episodes not out yet (future or unknown air date) are left out until they air.
 *  - Padding cells in the heatmap are visual only and are never episodes.
 */
export interface ProgressCounts {
  total: number; // real episodes in the structure
  watched: number;
  rated: number;
  skipped: number;
  /** Not out yet (and not watched): left out of the denominator until they air. */
  unaired: number;
}

export interface Progress extends ProgressCounts {
  remaining: number; // not watched, not skipped, already out
  denominator: number; // total - skipped - unaired
  percent: number; // 0–100, watched / denominator
}

/** The only place the progress maths lives; SQL aggregates and in-memory episodes both feed it. */
export function progressFromCounts(c: ProgressCounts): Progress {
  const denominator = c.total - c.skipped - c.unaired;
  return {
    ...c,
    denominator,
    remaining: denominator - c.watched,
    percent: denominator === 0 ? 0 : Math.round((c.watched / denominator) * 1000) / 10,
  };
}

/**
 * An episode that isn't out yet: its air date is in the future, it's only known by a year
 * that's this year or later, or it's listed with no date ("TBA"). Anything you've watched or rated counts as out.
 */
export function isUnaired(e: Pick<EpisodeView, "state" | "rating" | "airDate">, today = new Date().toISOString().slice(0, 10)): boolean {
  if (e.state !== "unwatched" || e.rating != null || !e.airDate) return false;
  if (e.airDate === "TBA") return true;
  // Only a year (IMDb lists announced episodes like this): this year or later isn't out yet,
  // since there's no date to say it has aired. A real date replaces it once TVmaze/TMDB list it.
  if (/^\d{4}$/.test(e.airDate)) return Number(e.airDate) >= Number(today.slice(0, 4));
  return e.airDate.slice(0, 10) > today;
}

export function computeProgress(episodes: EpisodeView[]): Progress {
  const c: ProgressCounts = { total: episodes.length, watched: 0, rated: 0, skipped: 0, unaired: 0 };
  for (const e of episodes) {
    if (e.state === "watched") c.watched++;
    if (e.rating != null) c.rated++;
    if (e.state === "skipped") c.skipped++;
    if (isUnaired(e)) c.unaired++;
  }
  return progressFromCounts(c);
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

/** Arithmetic mean of rated episodes. Never used as the owner's overall rating. */
export function episodeAverage(episodes: EpisodeView[]): number | null {
  return average(episodes.filter((e) => e.rating != null).map((e) => e.rating as number));
}

export function orderedSegments(segments: SegmentView[]): SegmentView[] {
  return [...segments].sort((a, b) => a.position - b.position || a.id - b.id);
}

export function sortedEpisodes(s: Pick<SegmentView, "episodes">): EpisodeView[] {
  return [...s.episodes].sort((a, b) => a.number - b.number);
}

/** Every episode in watch order. */
export function allEpisodes(segments: SegmentView[]): EpisodeView[] {
  return orderedSegments(segments).flatMap(sortedEpisodes);
}

export interface ActivePointer {
  /** Segment the owner is currently in (by real progress, never "highest number"). */
  segment: SegmentView | null;
  /** The next episode to watch, or null if caught up / finished. */
  nextEpisode: EpisodeView | null;
  /** Most recently progressed watched episode in watch order. */
  lastWatched: EpisodeView | null;
  caughtUp: boolean;
}

/**
 * Active season / next episode derived from actual progress:
 *  - Find the furthest watched episode in chronological watch order.
 *  - The next episode is the first later episode that is neither watched nor skipped.
 *  - If that episode lives in the next season (previous one complete), the next season is active.
 *  - Empty future seasons (no episodes yet) are never chosen.
 */
export function activePointer(segments: SegmentView[]): ActivePointer {
  const flat = allEpisodes(segments);
  let lastIdx = -1;
  flat.forEach((e, i) => {
    if (e.state === "watched") lastIdx = i;
  });
  const next = flat.slice(lastIdx + 1).find((e) => e.state === "unwatched" && !isUnaired(e)) ?? null;
  const lastWatched = lastIdx >= 0 ? flat[lastIdx] : null;
  const pivot = next ?? lastWatched ?? flat[0];
  const segment = pivot ? segments.find((s) => s.id === pivot.segmentId) ?? null : null;
  return { segment, nextEpisode: next, lastWatched, caughtUp: next == null && lastWatched != null };
}

export function segmentCode(s: Pick<SegmentView, "kind" | "label" | "seasonNumber" | "courNumber">): string {
  if ((s.kind === "season" || s.kind === "cour") && s.seasonNumber != null) {
    return `S${s.seasonNumber}${s.courNumber != null ? `C${s.courNumber}` : ""}`;
  }
  return s.label;
}

export function episodeCode(s: SegmentView, e: Pick<EpisodeView, "number">): string {
  const code = segmentCode(s);
  return /^S\d+/.test(code) ? `${code}E${e.number}` : `${code} · E${e.number}`;
}

export interface Returning {
  /** The first new season (or cour/part) you haven't started. */
  segment: SegmentView;
  /** Every new season after where you finished. */
  newSegments: SegmentView[];
  /** "out": episodes of it have aired. "announced": listed, but nothing has aired yet. */
  state: "out" | "announced";
  airedEpisodes: number;
  /** Earliest known air date of the next episode, when there is one. */
  nextAirDate: string | null;
}

/**
 * A show you'd finished that has since got a new season: every episode that was out up to
 * the last season you watched is watched (or skipped), and a later season with no watched
 * episodes has appeared. Null when you're mid-way, haven't started, or there's nothing new.
 */
export function returningSeason(segments: SegmentView[], today = new Date().toISOString().slice(0, 10)): Returning | null {
  const segs = orderedSegments(segments).filter((s) => s.episodes.length > 0);
  const watchedIn = (s: SegmentView) => s.episodes.some((e) => e.state === "watched");
  let last = -1;
  segs.forEach((s, i) => {
    if (watchedIn(s)) last = i;
  });
  if (last < 0) return null;
  const finished = segs.slice(0, last + 1).every((s) => s.episodes.every((e) => e.state !== "unwatched" || isUnaired(e, today)));
  if (!finished) return null;
  const newSegments = segs.slice(last + 1).filter((s) => !s.episodes.some((e) => e.state !== "unwatched"));
  if (!newSegments.length) return null;
  const segment = newSegments[0];
  const aired = segment.episodes.filter((e) => !isUnaired(e, today)).length;
  const upcoming = segment.episodes
    .filter((e) => isUnaired(e, today) && e.airDate && /^\d{4}-\d{2}-\d{2}/.test(e.airDate))
    .map((e) => e.airDate!.slice(0, 10))
    .sort()[0];
  return { segment, newSegments, state: aired > 0 ? "out" : "announced", airedEpisodes: aired, nextAirDate: upcoming ?? null };
}
