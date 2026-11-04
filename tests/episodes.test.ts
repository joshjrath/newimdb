import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers";
import { activePointer, computeProgress, isUnaired } from "@/lib/domain/progress";
import { bulkAssess, createMedia, getMediaDetail, listMedia, setAssessment } from "@/lib/repo/media";
import { dueShows, markSynced, syncShowEpisodes } from "@/lib/repo/episodeSync";
import { runEpisodeSync } from "@/lib/episodes/sync";
import type { EpisodeView } from "@/lib/domain/types";

const ep = (o: Partial<EpisodeView>): EpisodeView => ({ id: 1, segmentId: 1, number: 1, title: null, airDate: null, overview: null, state: "unwatched", rating: null, filler: false, watchedAt: null, ...o });

beforeEach(() => {
  freshDb();
  (globalThis as { __episodeSync?: unknown }).__episodeSync = undefined;
});
afterEach(() => vi.unstubAllGlobals());

describe("episodes that aren't out yet", () => {
  const today = "2026-11-04";
  it("knows what hasn't aired", () => {
    expect(isUnaired(ep({ airDate: "TBA" }), today)).toBe(true);
    expect(isUnaired(ep({ airDate: "2027-01-10" }), today)).toBe(true);
    expect(isUnaired(ep({ airDate: "2027" }), today)).toBe(true);
    // Only a year, and it is this year: no date yet, so not counted as out (Tires S4 on IMDb).
    expect(isUnaired(ep({ airDate: "2026" }), today)).toBe(true);
    expect(isUnaired(ep({ airDate: "2025" }), today)).toBe(false);
    expect(isUnaired(ep({ airDate: "2026-11-01" }), today)).toBe(false);
    expect(isUnaired(ep({ airDate: null }), today)).toBe(false);
    expect(isUnaired(ep({ airDate: "TBA", state: "watched" }), today)).toBe(false);
  });

  it("doesn't count them, so a finished show is 100% and caught up", () => {
    const m = createMedia({
      type: "tv",
      metadata: { title: "Tires" },
      segments: [
        { kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 2, episodes: [{ number: 1, title: "A", airDate: "2024-05-01", overview: null, providerRef: null }, { number: 2, title: "B", airDate: "2024-05-01", overview: null, providerRef: null }] },
        { kind: "season", label: "Season 4", seasonNumber: 4, courNumber: null, episodeCount: 1, episodes: [{ number: 1, title: "Episode #4.1", airDate: "TBA", overview: null, providerRef: null }] },
      ],
    });
    const d = getMediaDetail(m.id)!;
    for (const e of d.segments[0].episodes) setAssessment(m.id, e.id, { rating: 4 });
    const segs = getMediaDetail(m.id)!.segments;
    const p = computeProgress(segs.flatMap((s) => s.episodes));
    expect(p).toMatchObject({ watched: 2, unaired: 1, denominator: 2, percent: 100 });
    expect(activePointer(segs)).toMatchObject({ nextEpisode: null, caughtUp: true });
    expect(listMedia({ type: "tv" }).items[0].progress).toMatchObject({ unaired: 1, denominator: 2, percent: 100 });
  });
});

describe("new episodes arrive by themselves", () => {
  const show = () =>
    createMedia({
      type: "tv",
      metadata: { title: "Show", imdbId: "tt1000002" },
      review: { status: "watching" },
      segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 2 }],
    });

  it("adds episodes and new seasons, keeps ratings, and leaves cours alone", () => {
    const m = show();
    const first = getMediaDetail(m.id)!.segments[0].episodes[0];
    setAssessment(m.id, first.id, { rating: 5 });
    const e = (number: number, airDate: string | null = "2024-01-01") => ({ number, title: `E${number}`, airDate, overview: null, providerRef: null });
    const r = syncShowEpisodes(m.id, new Map([[1, [e(1), e(2), e(3)]], [2, [e(1, "TBA")]]]), { provider: "tvmaze", showRef: "77" });
    expect(r).toEqual({ added: 2, newSeasons: 1, mismatched: [] });
    const segs = getMediaDetail(m.id)!.segments;
    expect(segs.map((s) => [s.label, s.episodes.length])).toEqual([["Season 1", 3], ["Season 2", 1]]);
    expect(segs[0].episodes[0]).toMatchObject({ rating: 5, title: "E1" });
    expect(segs[1].episodes[0].airDate).toBe("TBA");
    // Running again changes nothing.
    expect(syncShowEpisodes(m.id, new Map([[1, [e(1), e(2), e(3)]]]), { provider: "tvmaze", showRef: "77" })).toEqual({ added: 0, newSeasons: 0, mismatched: [] });

    const anime = createMedia({ type: "anime", metadata: { title: "A" }, segments: [{ kind: "cour", label: "S1 C1", seasonNumber: 1, courNumber: 1, episodeCount: 12 }] });
    expect(syncShowEpisodes(anime.id, new Map([[1, Array.from({ length: 24 }, (_, i) => e(i + 1))]]), { provider: "tvmaze", showRef: "1" }).added).toBe(0);
  });

  it("checks shows you're watching more often", () => {
    const watching = show();
    const other = createMedia({ type: "tv", metadata: { title: "Other" }, review: { status: "completed" } });
    createMedia({ type: "movie", metadata: { title: "Film" } });
    expect(dueShows(10).map((s) => s.id).sort()).toEqual([watching.id, other.id].sort());
    markSynced(watching.id, null);
    markSynced(other.id, null);
    expect(dueShows(10)).toEqual([]);
    const sevenHoursLater = Date.now() + 7 * 3600_000;
    expect(dueShows(10, undefined, sevenHoursLater).map((s) => s.id)).toEqual([watching.id]);
    expect(dueShows(10, undefined, Date.now() + 25 * 3600_000)).toHaveLength(2);
  });

  it("finds the show on TVmaze by its IMDb id and pulls the episode list", async () => {
    const m = show();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.includes("/lookup/shows")
        ? { id: 77, name: "Show", image: null, summary: null }
        : [
            { id: 1, season: 1, number: 1, name: "One", airdate: "2024-01-01", summary: null },
            { id: 2, season: 1, number: 2, name: "Two", airdate: "2024-01-08", summary: null },
            { id: 3, season: 1, number: 3, name: "Three", airdate: "", summary: null },
          ];
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const s = await runEpisodeSync({ limit: 5 });
    expect(s).toMatchObject({ checked: 1, added: 1, failed: 0 });
    const d = getMediaDetail(m.id)!;
    expect(d.tvmazeId).toBe(77);
    expect(d.segments[0].episodes.map((e) => [e.title, e.airDate])).toEqual([["One", "2024-01-01"], ["Two", "2024-01-08"], ["Three", "TBA"]]);
  }, 15000);
});

describe("Tires: IMDb lists the S4 premiere with only this year", () => {
  it("is 100% once every aired episode is watched", () => {
    const year = new Date().toISOString().slice(0, 4);
    const show = createMedia({
      type: "tv",
      metadata: { title: "Tires" },
      segments: [
        { kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 2, episodes: [1, 2].map((n) => ({ number: n, title: null, airDate: "2024", overview: null, providerRef: null })) },
        { kind: "season", label: "Season 4", seasonNumber: 4, courNumber: null, episodeCount: 1, episodes: [{ number: 1, title: null, airDate: year, overview: null, providerRef: null }] },
      ],
    });
    const s1 = getMediaDetail(show.id)!.segments[0].episodes.map((e) => e.id);
    bulkAssess(show.id, s1, "watched", undefined);
    expect(listMedia({ type: "tv" }).items[0].progress).toMatchObject({ watched: 2, unaired: 1, denominator: 2, percent: 100 });
  });
});

describe("syncing never inflates a show (Bleach had 700 episodes)", () => {
  const e = (number: number, airDate: string | null) => ({ number, title: null, airDate, overview: null, providerRef: null });
  const seasons = (counts: number[], years: number[]) =>
    counts.map((n, i) => ({ kind: "season" as const, label: `Season ${i + 1}`, seasonNumber: i + 1, courNumber: null, episodeCount: n, episodes: Array.from({ length: n }, (_, j) => e(j + 1, String(years[i]))) }));
  const total = (id: number) => getMediaDetail(id)!.segments.reduce((a, s) => a + s.episodes.length, 0);

  it("renumbers a season the provider numbers across the whole show", () => {
    const m = createMedia({ type: "anime", metadata: { title: "Bleach" }, segments: seasons([20, 21], [2004, 2005]) });
    // TVmaze: season 2 is episodes 21–41.
    const tv = new Map([
      [1, Array.from({ length: 20 }, (_, i) => e(i + 1, "2004-10-05"))],
      [2, Array.from({ length: 21 }, (_, i) => e(21 + i, "2005-03-08"))],
    ]);
    syncShowEpisodes(m.id, tv, { provider: "tvmaze", showRef: "1" });
    expect(total(m.id)).toBe(41);
    expect(getMediaDetail(m.id)!.segments[1].episodes[0].airDate).toBe("2005-03-08");
  });

  it("leaves seasons alone when the provider splits them differently", () => {
    const m = createMedia({ type: "tv", metadata: { title: "Split" }, segments: seasons([10, 10], [2010, 2011]) });
    const tv = new Map([[1, Array.from({ length: 20 }, (_, i) => e(i + 1, "2010-01-01"))], [2, [e(1, "2012-01-01")]], [3, [e(1, "2013-01-01")]]]);
    const r = syncShowEpisodes(m.id, tv, { provider: "tvmaze", showRef: "2" });
    expect(r).toMatchObject({ added: 0, newSeasons: 0, mismatched: [1, 2] });
    expect(total(m.id)).toBe(20);
  });

  it("doesn't fold a long-gap anime sequel (TYBW) into the original", () => {
    const m = createMedia({ type: "anime", metadata: { title: "Bleach" }, segments: seasons([20], [2004]) });
    const tv = new Map([[1, Array.from({ length: 20 }, (_, i) => e(i + 1, "2004-10-05"))], [2, [e(1, "2022-10-11")]]]);
    expect(syncShowEpisodes(m.id, tv, { provider: "tvmaze", showRef: "1" }).newSeasons).toBe(0);
  });
});
