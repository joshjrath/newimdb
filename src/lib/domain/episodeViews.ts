import { orderedSegments, sortedEpisodes } from "./progress";
import type { EpisodeView, SegmentView } from "./types";

/**
 * Ways to lay out one show's episodes (anime especially). Every view shows the same
 * episodes, so rating and marking work the same in all of them; only the grouping changes.
 */
export const EPISODE_VIEWS = [
  { key: "story", label: "Story order", hint: "Your order, with films and OVAs where they fit" },
  { key: "release", label: "Release order", hint: "Everything by air date" },
  { key: "seasons", label: "Seasons", hint: "Main seasons first, extras after" },
  { key: "cours", label: "Cours", hint: "Seasons split into ~12-episode cours" },
  { key: "arcs", label: "Arcs", hint: "Your story arcs, with filler runs grouped" },
  { key: "all", label: "All episodes", hint: "One long run, numbered 1, 2, 3…" },
] as const;
export type EpisodeViewKey = (typeof EPISODE_VIEWS)[number]["key"];

export interface Arc {
  id: number;
  name: string;
  /** 1-based positions in the run of regular episodes (story order). */
  firstEp: number;
  lastEp: number;
}

const isMain = (s: SegmentView) => s.kind === "season" || s.kind === "cour";
let fakeId = -1;
/** A grouping that exists only on screen. Negative ids never collide with real seasons. */
function virtual(label: string, eps: EpisodeView[], renumber: boolean, base: Partial<SegmentView> = {}): SegmentView {
  const id = fakeId--;
  return {
    id,
    kind: "season",
    label,
    seasonNumber: null,
    courNumber: null,
    position: -id,
    provider: null,
    providerRef: null,
    ...base,
    episodes: eps.map((e, i) => ({ ...e, segmentId: id, number: renumber ? i + 1 : e.number })),
  };
}

const firstDate = (s: SegmentView) => sortedEpisodes(s).map((e) => e.airDate).find((d) => d && d !== "TBA") ?? "9999";

/** The run of regular episodes in story order (what arcs and "All episodes" number). */
export function mainRun(segments: SegmentView[]): EpisodeView[] {
  return orderedSegments(segments).filter(isMain).flatMap(sortedEpisodes);
}

/** Split a long season into cours: at long gaps in air dates when known, else evenly by ~12. */
export function splitCours(eps: EpisodeView[]): EpisodeView[][] {
  if (eps.length <= 15) return [eps];
  const dated = eps.every((e) => e.airDate && /^\d{4}-\d{2}-\d{2}/.test(e.airDate));
  if (dated) {
    const out: EpisodeView[][] = [[eps[0]]];
    for (let i = 1; i < eps.length; i++) {
      const gap = (Date.parse(eps[i].airDate!) - Date.parse(eps[i - 1].airDate!)) / 86_400_000;
      if (gap > 21 && out[out.length - 1].length >= 8) out.push([]);
      out[out.length - 1].push(eps[i]);
    }
    if (out.length > 1) return out;
  }
  const parts = Math.round(eps.length / 12.5) || 1;
  const size = Math.ceil(eps.length / parts);
  return Array.from({ length: parts }, (_, i) => eps.slice(i * size, (i + 1) * size)).filter((x) => x.length);
}

export function buildEpisodeView(segments: SegmentView[], view: EpisodeViewKey, arcs: Arc[] = []): SegmentView[] {
  // The grid orders groups by position, so each view numbers its own.
  return layout(segments, view, arcs).map((s, i) => ({ ...s, position: i }));
}

function layout(segments: SegmentView[], view: EpisodeViewKey, arcs: Arc[]): SegmentView[] {
  fakeId = -1;
  const ordered = orderedSegments(segments);
  const extras = ordered.filter((s) => !isMain(s));
  switch (view) {
    case "story":
      return ordered;
    case "release":
      return [...ordered].sort((a, b) => firstDate(a).localeCompare(firstDate(b)) || a.position - b.position);
    case "seasons":
      return [...ordered.filter(isMain), ...extras];
    case "cours": {
      const out: SegmentView[] = [];
      for (const s of ordered) {
        if (s.kind !== "season") {
          out.push(s);
          continue;
        }
        const cours = splitCours(sortedEpisodes(s));
        if (cours.length === 1) out.push(s);
        else cours.forEach((c, i) => out.push(virtual(`${s.label} · Cour ${i + 1}`, c, false, { seasonNumber: s.seasonNumber, courNumber: i + 1, kind: "cour" })));
      }
      return out;
    }
    case "all": {
      const run = mainRun(segments);
      const out: SegmentView[] = [];
      for (let i = 0; i < run.length; i += 50) {
        const chunk = run.slice(i, i + 50).map((e, j) => ({ ...e, number: i + j + 1 }));
        out.push(virtual(`Episodes ${i + 1}–${i + chunk.length}`, chunk, false));
      }
      return [...out, ...extras];
    }
    case "arcs": {
      const run = mainRun(segments);
      const sorted = [...arcs].sort((a, b) => a.firstEp - b.firstEp);
      const out: SegmentView[] = [];
      let i = 0;
      // Episodes between your arcs: filler runs become "Filler" groups, the rest stay together.
      const gap = (from: number, to: number) => {
        let j = from;
        while (j < to) {
          const filler = run[j].filler;
          let k = j;
          while (k < to && run[k].filler === filler) k++;
          out.push(virtual(filler ? `Filler · ${j + 1}–${k}` : `Episodes ${j + 1}–${k}`, run.slice(j, k).map((e, n) => ({ ...e, number: j + n + 1 })), false));
          j = k;
        }
      };
      for (const a of sorted) {
        const from = Math.max(i, a.firstEp - 1);
        const to = Math.min(run.length, a.lastEp);
        if (from >= to) continue;
        if (from > i) gap(i, from);
        out.push(virtual(a.name, run.slice(from, to).map((e, n) => ({ ...e, number: from + n + 1 })), false));
        i = to;
      }
      if (i < run.length) gap(i, run.length);
      return [...out, ...extras];
    }
  }
}

/** Fold edits made in a view (ratings, watched…) back onto the real seasons. */
export function foldBack(real: SegmentView[], shown: SegmentView[]): SegmentView[] {
  const byId = new Map(shown.flatMap((s) => s.episodes).map((e) => [e.id, e]));
  return real.map((s) => ({
    ...s,
    episodes: s.episodes.map((e) => {
      const v = byId.get(e.id);
      return v ? { ...e, state: v.state, rating: v.rating, filler: v.filler, watchedAt: v.watchedAt, title: v.title } : e;
    }),
  }));
}
