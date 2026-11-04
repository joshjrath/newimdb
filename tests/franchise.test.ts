import { describe, expect, it } from "vitest";
import { franchiseBase, franchiseMerges, isSeasonEntry, seasonNumberIn, subtitleOf, type FranchiseEntry } from "@/lib/domain/franchise";

let id = 0;
const e = (title: string, year: number, standalone = false, lastYear: number | null = year): FranchiseEntry => ({ id: ++id, title, originalTitle: null, year, standalone, lastYear });

describe("anime franchises", () => {
  it("finds the franchise name", () => {
    expect(franchiseBase("Jujutsu Kaisen 0")).toBe(franchiseBase("Jujutsu Kaisen"));
    expect(franchiseBase("Demon Slayer: Kimetsu no Yaiba - The Movie: Mugen Train")).toBe(franchiseBase("Demon Slayer: Kimetsu no Yaiba"));
    expect(franchiseBase("Naruto Shippuden")).not.toBe(franchiseBase("Naruto"));
    expect(isSeasonEntry("Jujutsu Kaisen Season 2")).toBe(true);
    expect(isSeasonEntry("Bleach: Thousand-Year Blood War")).toBe(false);
    expect(seasonNumberIn("Jujutsu Kaisen Season 2")).toBe(2);
    expect(seasonNumberIn("Mob Psycho 100 III")).toBeNull();
    expect(subtitleOf("Demon Slayer: Kimetsu no Yaiba - The Movie: Mugen Train")).toBe("Mugen Train");
  });

  it("groups JJK 0, JJK S2 and JJK 3 into JJK, and Mugen Train into Demon Slayer", () => {
    const jjk = e("Jujutsu Kaisen", 2020, false, 2021);
    const jjk0 = e("Jujutsu Kaisen 0", 2021, true);
    const jjk2 = e("Jujutsu Kaisen Season 2", 2023);
    const jjk3 = e("Jujutsu Kaisen Season 3", 2026);
    const ds = e("Demon Slayer: Kimetsu no Yaiba", 2019, false, 2024);
    const mugen = e("Demon Slayer: Kimetsu no Yaiba - The Movie: Mugen Train", 2020, true);
    const m = franchiseMerges([jjk, jjk0, jjk2, jjk3, ds, mugen]);
    expect(m.get(jjk0.id)).toBe(jjk.id);
    expect(m.get(jjk2.id)).toBe(jjk.id);
    expect(m.get(jjk3.id)).toBe(jjk.id);
    expect(m.get(mugen.id)).toBe(ds.id);
    expect(m.has(jjk.id) || m.has(ds.id)).toBe(false);
  });

  it("keeps Naruto / Shippuden and Bleach / TYBW apart, but files each film with the right one", () => {
    const naruto = e("Naruto", 2002, false, 2007);
    const shippuden = e("Naruto Shippuden", 2007, false, 2017);
    const narutoFilm = e("Naruto the Movie: Ninja Clash in the Land of Snow", 2004, true);
    const shipFilm = e("Naruto Shippuden the Movie: Bonds", 2008, true);
    const bleach = e("Bleach", 2004, false, 2012);
    const tybw = e("Bleach: Thousand-Year Blood War", 2022, false, 2024);
    const bleachFilm = e("Bleach: Memories of Nobody", 2006, true);
    const yourName = e("Your Name.", 2016, true);
    const m = franchiseMerges([naruto, shippuden, narutoFilm, shipFilm, bleach, tybw, bleachFilm, yourName]);
    expect(m.has(shippuden.id)).toBe(false);
    expect(m.has(tybw.id)).toBe(false);
    expect(m.get(narutoFilm.id)).toBe(naruto.id);
    expect(m.get(shipFilm.id)).toBe(shippuden.id);
    expect(m.get(bleachFilm.id)).toBe(bleach.id);
    expect(m.has(yourName.id)).toBe(false);
  });
});

import { freshDb } from "./helpers";
import { countMedia, createMedia, getMediaDetail } from "@/lib/repo/media";
import { aliasFor, groupAnimeFranchises } from "@/lib/repo/franchise";
import { getDb } from "@/lib/db";

describe("grouping anime in the library", () => {
  it("folds JJK 0 and JJK Season 2 into JJK, keeping ratings and reviews", () => {
    freshDb();
    const ep = (n: number, y: string) => ({ number: n, title: null, airDate: y, overview: null, providerRef: null });
    const jjk = createMedia({ type: "anime", metadata: { title: "Jujutsu Kaisen", year: 2020 }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 2, episodes: [ep(1, "2020"), ep(2, "2021")] }] });
    createMedia({ type: "anime", metadata: { title: "Jujutsu Kaisen 0", year: 2021, imdbId: "tt14331144" }, review: { rating: 4.5, body: "Loved Yuta." } }, { source: "letterboxd" });
    createMedia({ type: "anime", metadata: { title: "Jujutsu Kaisen Season 2", year: 2023 }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 2, episodes: [ep(1, "2023"), ep(2, "2023")] }] });
    createMedia({ type: "anime", metadata: { title: "Naruto Shippuden", year: 2007 } });
    createMedia({ type: "anime", metadata: { title: "Naruto", year: 2002 }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 1 }] });
    const done = groupAnimeFranchises();
    expect(done.map((d) => d.title).sort()).toEqual(["Jujutsu Kaisen 0", "Jujutsu Kaisen Season 2"]);
    expect(countMedia().anime).toBe(3);
    const d = getMediaDetail(jjk.id)!;
    expect(d.segments.map((s) => [s.kind, s.label])).toEqual([["season", "Season 1"], ["movie", "Jujutsu Kaisen 0"], ["season", "Season 2"]]);
    expect(d.segments[1].episodes[0]).toMatchObject({ state: "watched", rating: 4.5 });
    expect(d.review.body).toContain("Loved Yuta.");
    expect(aliasFor(getDb(), { imdbId: "tt14331144" })?.mediaId).toBe(jjk.id);
    expect(groupAnimeFranchises()).toEqual([]);
  });
});
