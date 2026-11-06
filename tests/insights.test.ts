import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { bulkAssess, createMedia, getMediaDetail, setAssessment } from "@/lib/repo/media";
import { getInsights } from "@/lib/repo/stats";
import { getDb } from "@/lib/db";

beforeEach(() => {
  freshDb();
});

describe("statistics insights", () => {
  it("finds the longest runs of 5/5 episodes, streaks and how you compare with IMDb", () => {
    const ep = (n: number) => ({ number: n, title: null, airDate: "2010-01-01", overview: null, providerRef: null });
    const bb = createMedia({
      type: "tv",
      metadata: { title: "Breaking Bad" },
      review: { rating: 5 },
      segments: [
        { kind: "season", label: "Season 4", seasonNumber: 4, courNumber: null, episodeCount: 3, episodes: [1, 2, 3].map(ep) },
        { kind: "season", label: "Season 5", seasonNumber: 5, courNumber: null, episodeCount: 4, episodes: [1, 2, 3, 4].map(ep) },
      ],
    });
    const segs = getMediaDetail(bb.id)!.segments;
    const ids = segs.flatMap((s) => s.episodes.map((e) => e.id));
    // S4E1 4, then S4E2 → S5E3 all 5s (5 in a row), S5E4 4
    [4, 5, 5, 5, 5, 5, 4].forEach((r, k) => setAssessment(bb.id, ids[k], { rating: r }));
    getDb().prepare(`UPDATE media SET imdb_rating = 9.5 WHERE id = ?`).run(bb.id);
    const db = getDb();
    const d = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    [0, 1, 2, 5, 6].forEach((n, k) => db.prepare(`UPDATE episode_assessment SET watched_at = ? WHERE episode_id = ?`).run(d(n), ids[k]));
    const i = getInsights();
    expect(i.perfectRuns[0]).toMatchObject({ title: "Breaking Bad", length: 5, from: "S4E2", to: "S5E3" });
    expect(i.streak).toMatchObject({ current: 3, longest: 3 });
    expect(i.vsImdb).toMatchObject({ compared: 1, averageGap: 0.5 });
    expect(i.bestSeasons[0]).toMatchObject({ season: "Season 5", rated: 4 });
    expect(i.weekdays.reduce((a, b) => a + b, 0)).toBe(7);
    bulkAssess(bb.id, ids, "unwatched", undefined);
  });
});
