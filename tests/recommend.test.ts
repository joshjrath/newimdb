import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "watch-recs-"));
import { freshDb } from "./helpers";
import { createMedia } from "@/lib/repo/media";
import { buildRecommendations, dismissRecommendation, listRecommendations } from "@/lib/recommend/job";
import { genreAffinity, pickSeeds, tasteProfile } from "@/lib/domain/recommend";
import { cleanProviderName } from "@/lib/providers/tmdb";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  freshDb();
  process.env.TMDB_READ_TOKEN = "t";
  process.env.WATCH_REGION = "US";
  (globalThis as { __recommend?: unknown }).__recommend = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TMDB_READ_TOKEN;
});

describe("taste", () => {
  it("likes what you rate above your average, and dislikes the rest", () => {
    const lib = [
      { id: 1, type: "movie" as const, title: "A", year: 2020, rating: 5, status: null, genres: ["Horror"], lastWatchedAt: null },
      { id: 2, type: "movie" as const, title: "B", year: 2020, rating: 4.5, status: null, genres: ["Horror"], lastWatchedAt: null },
      { id: 3, type: "movie" as const, title: "C", year: 2020, rating: 1, status: null, genres: ["Romance"], lastWatchedAt: null },
    ];
    const t = tasteProfile(lib);
    expect(genreAffinity(t, ["Horror"])).toBeGreaterThan(0);
    expect(genreAffinity(t, ["Romance"])).toBeLessThan(0);
    const seeds = pickSeeds(lib, t);
    expect(seeds.find((s) => s.id === 1)!.weight).toBeGreaterThan(0);
    expect(seeds.find((s) => s.id === 3)!.weight).toBeLessThan(0);
    expect(cleanProviderName("Netflix basic with Ads")).toBe("Netflix");
    expect(cleanProviderName("Paramount Plus Apple TV Channel")).toBe("Paramount+");
  });
});

describe("recommendations", () => {
  it("suggests what your favourites point to, skips what you have, and says where to watch", async () => {
    createMedia({ type: "movie", metadata: { title: "Heat", year: 1995, tmdbId: 949, genres: ["Crime"] }, review: { rating: 5 } });
    createMedia({ type: "movie", metadata: { title: "Collateral", year: 2004, tmdbId: 1538, genres: ["Crime"] }, review: { rating: 4.5 } });
    createMedia({ type: "movie", metadata: { title: "Already Seen", year: 2001, tmdbId: 3 }, review: { rating: 3 } });
    const rec = (id: number, title: string, extra = {}) => ({ id, title, release_date: "2010-01-01", genre_ids: [80], vote_average: 7.6, vote_count: 900, poster_path: "/p.jpg", original_language: "en", ...extra });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/genre/")) return json({ genres: [{ id: 80, name: "Crime" }, { id: 16, name: "Animation" }] });
      if (url.includes("/949/recommendations")) return json({ results: [rec(10, "Thief"), rec(3, "Already Seen"), rec(20, "Akira", { genre_ids: [16], original_language: "ja" })] });
      if (url.includes("/1538/recommendations")) return json({ results: [rec(10, "Thief"), rec(11, "Drive"), rec(20, "Akira", { genre_ids: [16], original_language: "ja" })] });
      if (url.includes("/movie/10?")) return json({ genres: [{ name: "Crime" }], imdb_id: "tt0081613", keywords: { keywords: [{ name: "heist" }] } });
      if (url.includes("title.ratings.tsv.gz")) return new Response(gzipSync("tconst\taverageRating\tnumVotes\ntt0081613\t7.3\t30000\n"), { status: 200 });
      if (url.includes("/watch/providers")) return json({ results: { US: { link: "https://tmdb/watch", flatrate: [{ provider_name: "Netflix", logo_path: "/n.jpg" }, { provider_name: "Netflix basic with Ads", logo_path: "/n2.jpg" }, { provider_name: "Hulu", logo_path: "/h.jpg" }] } } });
      return json({ results: [] });
    }));
    await buildRecommendations();
    const { byType } = listRecommendations();
    expect(byType.movie.map((r) => r.title)).toEqual(["Thief"]); // backed by both favourites; Drive has only one
    expect(byType.movie[0].because).toEqual(["Heat", "Collateral"]);
    expect(byType.movie[0].imdb).toEqual({ id: "tt0081613", rating: 7.3, votes: 30000 });
    expect(byType.movie[0].watch.map((w) => w.name)).toEqual(["Netflix", "Hulu"]);
    expect(byType.anime.map((r) => r.title)).toEqual(["Akira"]); // Japanese animation goes under Anime
    dismissRecommendation(byType.movie[0].key);
    expect(listRecommendations().byType.movie).toEqual([]);
  });
});
