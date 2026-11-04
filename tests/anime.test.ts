import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers";
import { decideAnime, sameAnime } from "@/lib/domain/animeDetect";
import { animeCandidates, runAnimeCheck } from "@/lib/anime/job";
import { bulkUpdate, createMedia, getMedia } from "@/lib/repo/media";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  freshDb();
  (globalThis as { __animeCheck?: unknown }).__animeCheck = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("anime detection", () => {
  it("reads TVmaze, TMDB and AniList", () => {
    expect(decideAnime({ tvmaze: { language: "Japanese", genres: ["Anime", "Action"], type: "Animation" } })).toBe("anime");
    expect(decideAnime({ tvmaze: { language: "Japanese", genres: ["Action"], type: "Animation" } })).toBe("anime");
    expect(decideAnime({ tvmaze: { language: "English", genres: ["Action"], type: "Animation" } })).toBe("other");
    expect(decideAnime({ tvmaze: { language: "Korean", genres: [], type: "Animation" } })).toBeNull();
    expect(decideAnime({ tmdb: { language: "ja", countries: ["JP"], genres: ["Animation", "Drama"] } })).toBe("anime");
    expect(decideAnime({ tmdb: { language: "en", countries: ["US"], genres: ["Animation"] } })).toBe("other");
    expect(decideAnime({ anilist: true })).toBe("anime");
    expect(decideAnime({})).toBeNull();
    expect(sameAnime("Your Name.", 2016, { titles: ["Your Name.", "Kimi no Na wa."], year: 2016 })).toBe(true);
    expect(sameAnime("Monster", 2004, { titles: ["Monster"], year: 2019 })).toBe(false);
  });

  it("moves Bleach to Anime, leaves Korra in TV Shows, and never overrides you", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const bleach = createMedia({ type: "tv", metadata: { title: "Bleach", year: 2004, genres: ["Animation", "Action"], imdbId: "tt0434665" } }, { source: "imdb" });
    const korra = createMedia({ type: "tv", metadata: { title: "The Legend of Korra", year: 2012, genres: ["Animation", "Action"], imdbId: "tt1695360" } }, { source: "imdb" });
    const mine = createMedia({ type: "tv", metadata: { title: "Monster", year: 2004, genres: ["Animation"], imdbId: "tt0434706" } }, { source: "imdb" });
    createMedia({ type: "tv", metadata: { title: "The Office", year: 2005, genres: ["Comedy"], imdbId: "tt0386676" } }, { source: "imdb" });
    bulkUpdate([mine.id], "set_type", { mediaType: "tv" }); // you said it's TV: it stays
    expect(animeCandidates().map((c) => c.title)).toEqual(["Bleach", "The Legend of Korra"]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("tt0434665")) return json({ id: 1, name: "Bleach", language: "Japanese", genres: ["Anime", "Action"], type: "Animation" });
      if (url.includes("tt1695360")) return json({ id: 2, name: "The Legend of Korra", language: "English", genres: ["Action"], type: "Animation" });
      return json({}, 404);
    }));
    const p = runAnimeCheck();
    await vi.runAllTimersAsync();
    const s = await p;
    expect(s.moved).toEqual([{ id: bleach.id, title: "Bleach", from: "tv", to: "anime" }]);
    expect(getMedia(bleach.id)!.type).toBe("anime");
    expect(getMedia(korra.id)!.type).toBe("tv");
    expect(getMedia(mine.id)!.type).toBe("tv");
    expect(animeCandidates()).toEqual([]); // each title is checked once
  });
});
