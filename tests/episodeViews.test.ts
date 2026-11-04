import { describe, expect, it } from "vitest";
import { buildEpisodeView, foldBack, splitCours } from "@/lib/domain/episodeViews";
import type { EpisodeView, SegmentView } from "@/lib/domain/types";

let id = 1;
const seg = (label: string, n: number, kind: SegmentView["kind"], position: number, date: (i: number) => string | null = () => null, filler: number[] = []): SegmentView => {
  const sid = id++;
  return {
    id: sid, kind, label, seasonNumber: kind === "season" ? position : null, courNumber: null, position, provider: null, providerRef: null,
    episodes: Array.from({ length: n }, (_, i): EpisodeView => ({ id: sid * 1000 + i, segmentId: sid, number: i + 1, title: null, airDate: date(i), overview: null, state: "unwatched", rating: null, filler: filler.includes(i + 1), watchedAt: null })),
  };
};

describe("episode views", () => {
  const s1 = seg("Season 1", 26, "season", 1, (i) => `2020-${String(10 + Math.floor(i / 13)).padStart(2, "0")}-01`, [10, 11]);
  const film = seg("Jujutsu Kaisen 0", 1, "movie", 2, () => "2021-12-24");
  const s2 = seg("Season 2", 23, "season", 3, () => "2023-07-06");
  const all = [s1, film, s2];

  it("lays out the same episodes in each view", () => {
    expect(buildEpisodeView(all, "story").map((s) => s.label)).toEqual(["Season 1", "Jujutsu Kaisen 0", "Season 2"]);
    expect(buildEpisodeView(all, "seasons").map((s) => s.label)).toEqual(["Season 1", "Season 2", "Jujutsu Kaisen 0"]);
    expect(buildEpisodeView(all, "cours").map((s) => s.label)).toEqual(["Season 1 · Cour 1", "Season 1 · Cour 2", "Jujutsu Kaisen 0", "Season 2 · Cour 1", "Season 2 · Cour 2"]);
    const run = buildEpisodeView(all, "all");
    expect(run[0].label).toBe("Episodes 1–49");
    expect(run[0].episodes[30].number).toBe(31);
    const arcs = buildEpisodeView(all, "arcs", [{ id: 1, name: "Cursed Womb", firstEp: 1, lastEp: 9 }, { id: 2, name: "Shibuya", firstEp: 30, lastEp: 49 }]);
    expect(arcs.map((s) => s.label)).toEqual(["Cursed Womb", "Filler · 10–11", "Episodes 12–29", "Shibuya", "Jujutsu Kaisen 0"]);
    expect(splitCours(s2.episodes).length).toBe(2);
  });

  it("puts edits made in a view back on the real seasons", () => {
    const shown = buildEpisodeView(all, "all");
    shown[0].episodes[27] = { ...shown[0].episodes[27], state: "watched", rating: 4.5 };
    const real = foldBack(all, shown);
    expect(real[2].episodes[1]).toMatchObject({ state: "watched", rating: 4.5, number: 2, segmentId: s2.id });
  });
});
