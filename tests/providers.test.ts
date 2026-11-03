import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDetails, fetchSegmentEpisodes, searchMetadata } from "@/lib/providers";
import { groupTvmazeEpisodes } from "@/lib/providers/tvmaze";
import { isAllowedPosterUrl, sniffImage } from "@/lib/files/images";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TMDB_READ_TOKEN;
  delete process.env.PROVIDER_TIMEOUT_MS;
});

describe("provider routing", () => {
  it("never sends anime to TMDB and falls back from Jikan to AniList", async () => {
    process.env.TMDB_READ_TOKEN = "x";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("jikan")) return json({}, 500);
      return json({ data: { Page: { media: [{ id: 1, idMal: 2, title: { romaji: "Frieren", english: null, native: null }, startDate: { year: 2023 }, coverImage: { large: null, extraLarge: null }, description: null, episodes: 28, format: "TV", genres: [], averageScore: 90 }] } } });
    }));
    const r = await searchMetadata("anime", "frieren");
    expect(r.provider).toBe("anilist");
    expect(r.results[0]).toMatchObject({ title: "Frieren", type: "anime" });
    expect(urls.some((u) => u.includes("themoviedb"))).toBe(false);
  });

  it("times out slow providers and falls back (TV: TMDB → TVmaze)", async () => {
    process.env.TMDB_READ_TOKEN = "x";
    process.env.PROVIDER_TIMEOUT_MS = "50";
    vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
      if (url.includes("themoviedb")) {
        return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      }
      return Promise.resolve(json([{ show: { id: 169, name: "Breaking Bad", premiered: "2008-01-20", summary: "<p>Chem</p>", image: null, genres: [], externals: { imdb: "tt0903747", thetvdb: null }, rating: { average: 9 }, averageRuntime: 60, runtime: 60 } }]));
    }));
    const r = await searchMetadata("tv", "breaking bad");
    expect(r.provider).toBe("tvmaze");
    expect(r.errors[0]).toMatch(/timed out/);
    expect(r.results[0].overview).toBe("Chem");
  });

  it("refuses mismatched type/provider combos and bad ids", async () => {
    await expect(fetchDetails("anime", "tmdb", "1")).rejects.toThrow();
    await expect(fetchDetails("tv", "jikan", "1")).rejects.toThrow();
    await expect(fetchDetails("movie", "tmdb", "../etc")).rejects.toThrow();
    await expect(fetchSegmentEpisodes("anime", "tmdb", "1:1")).rejects.toThrow();
  });

  it("maps TVmaze seasons and keeps the IMDb id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      id: 169, name: "Show", premiered: "2008-01-01", summary: null, image: null, genres: ["Drama"], externals: { imdb: "tt0903747", thetvdb: 1 }, rating: { average: null }, averageRuntime: 47, runtime: null,
      _embedded: { episodes: [ { id: 1, season: 1, number: 1, name: "Pilot", airdate: "2008-01-20", summary: null }, { id: 2, season: 1, number: 2, name: "Two", airdate: "", summary: null }, { id: 3, season: 2, number: 1, name: "S2", airdate: "", summary: null }, { id: 4, season: 2, number: null, name: "Special", airdate: "", summary: null } ] },
    })));
    const d = await fetchDetails("tv", "tvmaze", "169");
    expect(d.metadata).toMatchObject({ imdbId: "tt0903747", tvmazeId: 169 });
    expect(d.segments.map((s) => [s.label, s.episodeCount, s.providerRef])).toEqual([["Season 1", 2, "169:1"], ["Season 2", 1, "169:2"]]);
  });

  it("groups episodes and ignores un-numbered specials", () => {
    expect(groupTvmazeEpisodes(1, [{ id: 9, season: 3, number: null, name: "x", airdate: "", summary: null }])).toEqual([]);
  });
});

describe("images", () => {
  it("allowlists poster hosts", () => {
    expect(isAllowedPosterUrl("https://image.tmdb.org/t/p/w500/a.jpg")).toBe(true);
    expect(isAllowedPosterUrl("http://image.tmdb.org/a.jpg")).toBe(false);
    expect(isAllowedPosterUrl("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedPosterUrl("https://image.tmdb.org.evil.com/a.jpg")).toBe(false);
  });
  it("sniffs image types by bytes", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>    "))).toBeNull();
  });
});
