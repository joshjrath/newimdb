import { describe, expect, it } from "vitest";
import { activePointer, computeProgress, episodeAverage, returningSeason } from "@/lib/domain/progress";
import { exportEpisodeText, parseEpisodeText, resolveAssignments } from "@/lib/domain/episodeText";
import { isValidRating, parseRating, ratingBand } from "@/lib/domain/rating";
import { decodeEntities, htmlToText, idFromSlug, slugify } from "@/lib/domain/text";
import type { EpisodeView, SegmentView } from "@/lib/domain/types";

let nextId = 1;
function seg(label: string, n: number, opts: Partial<SegmentView> = {}, states: Partial<EpisodeView>[] = []): SegmentView {
  const id = nextId++;
  return {
    id, kind: "season", label, seasonNumber: null, courNumber: null, position: id, provider: null, providerRef: null,
    ...opts,
    episodes: Array.from({ length: n }, (_, i) => ({
      id: id * 1000 + i + 1, segmentId: id, number: i + 1, title: null, airDate: null, overview: null,
      state: "unwatched", rating: null, filler: false, watchedAt: null, ...(states[i] ?? {}),
    })),
  };
}

describe("ratings", () => {
  it("accepts half steps only", () => {
    expect(isValidRating(4.5)).toBe(true);
    expect(isValidRating(0.5)).toBe(true);
    expect(isValidRating(0)).toBe(false);
    expect(isValidRating(4.25)).toBe(false);
    expect(isValidRating(5.5)).toBe(false);
    expect(parseRating("★★★½")).toBe(3.5);
    expect(parseRating("4,5")).toBe(4.5);
    expect(parseRating("7")).toBeUndefined();
    expect(ratingBand(5).key).toBe("b5");
    expect(ratingBand(1).key).toBe("b1");
  });
});

describe("progress & averages", () => {
  it("excludes skipped from the denominator and counts watched filler", () => {
    const s = seg("S1", 4, {}, [{ state: "watched", rating: 4 }, { state: "skipped" }, { state: "watched", filler: true }, {}]);
    const p = computeProgress(s.episodes);
    expect(p).toMatchObject({ total: 4, watched: 2, rated: 1, skipped: 1, denominator: 3, remaining: 1 });
    expect(p.percent).toBeCloseTo(66.7, 1);
    expect(episodeAverage(s.episodes)).toBe(4);
  });
});

describe("active pointer", () => {
  it("uses real progress, never the highest season", () => {
    const segments = Array.from({ length: 15 }, (_, i) =>
      seg(`Season ${i + 1}`, i === 14 ? 0 : 10, { seasonNumber: i + 1 }, i < 6 ? Array(10).fill({ state: "watched", rating: 4 }) : i === 6 ? [{ state: "watched", rating: 3 }, { state: "watched" }, { state: "watched" }] : []),
    );
    const p = activePointer(segments);
    expect(p.segment?.label).toBe("Season 7");
    expect(p.nextEpisode?.number).toBe(4);
  });
  it("moves to the next season when the current one is finished", () => {
    const a = seg("Season 1", 2, { seasonNumber: 1 }, [{ state: "watched" }, { state: "watched" }]);
    const b = seg("Season 2", 3, { seasonNumber: 2 });
    const p = activePointer([a, b]);
    expect(p.segment?.label).toBe("Season 2");
    expect(p.nextEpisode?.number).toBe(1);
  });
  it("skips intentionally-skipped episodes when choosing next", () => {
    const a = seg("Season 1", 3, {}, [{ state: "watched" }, { state: "skipped" }, {}]);
    expect(activePointer([a]).nextEpisode?.number).toBe(3);
  });
  it("reports caught up", () => {
    const a = seg("Season 1", 2, {}, [{ state: "watched" }, { state: "watched" }]);
    const p = activePointer([a]);
    expect(p.caughtUp).toBe(true);
    expect(p.segment?.label).toBe("Season 1");
  });
});

describe("episode text syntax", () => {
  const s1c1 = seg("S1 Part 1", 3, { seasonNumber: 1, courNumber: 1 });
  const ova = seg("OVA", 1, { kind: "ova" });
  const s1c2 = seg("S1 Part 2", 2, { seasonNumber: 1, courNumber: 2 });
  const movie = seg("Movie 1", 1, { kind: "movie" });
  const segments = [s1c1, ova, s1c2, movie];

  it("parses ratings, skips, filler and labels", () => {
    const r = parseEpisodeText(`# comment\nS1C1E1: 4.5\nS1C1E2: 4 filler\nS1C1E3: skip\n"OVA" E1: 5\nS1C2E1: watched\n"Movie 1" E1: 3.5\nS1E5: 2`);
    expect(r.errors).toEqual([]);
    const { resolved, errors } = resolveAssignments(segments, r);
    expect(errors).toEqual([]);
    expect(resolved).toHaveLength(7);
    expect(resolved[1]).toMatchObject({ rating: 4, filler: true, state: "watched" });
    expect(resolved[2]).toMatchObject({ state: "skipped", rating: null });
    // S1E5 spans cours: 3 in cour 1, so E5 is cour 2 episode 2
    expect(resolved[6].episodeId).toBe(s1c2.episodes[1].id);
  });
  it("reports bad lines instead of dropping them", () => {
    const r = parseEpisodeText("S1C1E1: 4.3\nnonsense\nS9E1: 4");
    expect(r.errors.map((e) => e.line)).toEqual([1, 2]);
    expect(resolveAssignments(segments, r).errors).toHaveLength(3);
  });
  it("round-trips", () => {
    s1c1.episodes[0].state = "watched"; s1c1.episodes[0].rating = 4.5;
    s1c1.episodes[1].state = "skipped";
    ova.episodes[0].filler = true;
    const text = exportEpisodeText(segments);
    expect(text).toContain("S1C1E1: 4.5");
    expect(text).toContain("S1C1E2: skip");
    expect(text).toContain('"OVA" E1: ? filler');
    expect(parseEpisodeText(text).errors).toEqual([]);
  });
});

describe("text", () => {
  it("decodes entities incl. double-encoded", () => {
    expect(decodeEntities("Tom &amp;amp; Jerry &#8212; &quot;hi&quot; &#x2764;")).toBe('Tom & Jerry — "hi" ❤');
  });
  it("keeps paragraphs", () => {
    expect(htmlToText("<p>One &amp; two</p><p>Three<br>four</p>")).toBe("One & two\n\nThree\nfour");
  });
  it("slugs", () => {
    expect(slugify("Tom & Jerry: The Movie!")).toBe("tom-and-jerry-the-movie");
    expect(idFromSlug("12-breaking-bad")).toBe(12);
    expect(idFromSlug("abc")).toBeNull();
  });
});

import { resolveAssessment, UNASSESSED } from "@/lib/domain/assessment";
import { defaultSegmentLabel } from "@/lib/domain/types";
import { hashPassword, verifyPasswordHash } from "@/lib/password";

describe("shared rules", () => {
  it("assessment: rating implies watched, leaving watched clears rating, filler independent", () => {
    expect(resolveAssessment(UNASSESSED, { rating: 4 })).toEqual({ state: "watched", rating: 4, filler: false });
    expect(resolveAssessment({ state: "watched", rating: 4, filler: true }, { state: "skipped" })).toEqual({ state: "skipped", rating: null, filler: true });
    expect(resolveAssessment({ state: "watched", rating: 4, filler: false }, { filler: true })).toEqual({ state: "watched", rating: 4, filler: true });
    expect(resolveAssessment({ state: "watched", rating: 4, filler: false }, { rating: null })).toEqual({ state: "watched", rating: null, filler: false });
  });
  it("segment labels", () => {
    expect(defaultSegmentLabel("season", { season: 3 })).toBe("Season 3");
    expect(defaultSegmentLabel("season", { season: 0 })).toBe("Specials");
    expect(defaultSegmentLabel("cour", { season: 2, cour: 2 })).toBe("Season 2 · Cour 2");
    expect(defaultSegmentLabel("ova", { ordinal: 2 })).toBe("OVA 2");
    expect(defaultSegmentLabel("special")).toBe("Specials");
    expect(defaultSegmentLabel("movie", { ordinal: 1 })).toBe("Movie 1");
  });
  it("password hashes verify", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPasswordHash("correct horse", h)).toBe(true);
    expect(await verifyPasswordHash("wrong", h)).toBe(false);
    expect(await verifyPasswordHash("x", "garbage")).toBe(false);
  });
});

describe("new seasons since you finished", () => {
  const T = "2026-11-04";
  const w = (n: number) => Array.from({ length: n }, () => ({ state: "watched" as const }));
  it("spots a new season that's out, or announced with a date", () => {
    const s1 = seg("Season 1", 3, { seasonNumber: 1 }, w(3));
    const s2 = seg("Season 2", 2, { seasonNumber: 2 }, [{ airDate: "2026-10-01" }, { airDate: "2026-11-20" }]);
    expect(returningSeason([s1, s2], T)).toMatchObject({ segment: { id: s2.id }, state: "out", airedEpisodes: 1, nextAirDate: "2026-11-20" });
    const s3 = seg("Season 3", 2, { seasonNumber: 3 }, [{ airDate: "2027-03-01" }, { airDate: "TBA" }]);
    expect(returningSeason([s1, s3], T)).toMatchObject({ state: "announced", airedEpisodes: 0, nextAirDate: "2027-03-01" });
  });
  it("ignores shows you're mid-way through, haven't started, or are caught up on", () => {
    const done = seg("Season 1", 3, { seasonNumber: 1 }, w(3));
    expect(returningSeason([done], T)).toBeNull();
    expect(returningSeason([seg("Season 1", 3, { seasonNumber: 1 }, w(2)), seg("Season 2", 2, { seasonNumber: 2 })], T)).toBeNull();
    expect(returningSeason([seg("Season 1", 3), seg("Season 2", 3)], T)).toBeNull();
    // Skipped episodes and ones not out yet don't stop a season counting as finished.
    const s1 = seg("Season 1", 3, { seasonNumber: 1 }, [{ state: "watched" }, { state: "skipped" }, { state: "watched" }]);
    expect(returningSeason([s1, seg("Season 2", 1, { seasonNumber: 2 }, [{ airDate: "2026-01-01" }])], T)?.segment.label).toBe("Season 2");
    // A new season with no dates at all isn't shown as out (JJK S4 showed "4 episodes out").
    expect(returningSeason([s1, seg("Season 2", 4, { seasonNumber: 2 })], T)).toBeNull();
  });
});
