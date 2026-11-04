import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers";
import { createMedia, getMedia, missingPosterIds } from "@/lib/repo/media";
import { currentPosterJob, startPosterJob } from "@/lib/posters/job";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  freshDb();
  (globalThis as { __posterJob?: unknown }).__posterJob = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TMDB_READ_TOKEN;
});

async function finish() {
  for (let i = 0; i < 200 && currentPosterJob()?.state === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  return currentPosterJob()!;
}

describe("poster fetch", () => {
  it("fills missing posters from TMDB by IMDb id, never overwriting", async () => {
    process.env.TMDB_READ_TOKEN = "x";
    const movie = createMedia({ type: "movie", metadata: { title: "Inception", imdbId: "tt1375666" } });
    const anime = createMedia({ type: "anime", metadata: { title: "Attack on Titan", imdbId: "tt2560140" } });
    const mine = createMedia({ type: "tv", metadata: { title: "Mine", imdbId: "tt0000001", posterUrl: "https://image.tmdb.org/t/p/w500/mine.jpg" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("tt1375666")) return json({ movie_results: [{ id: 27205, poster_path: "/inc.jpg", backdrop_path: "/b.jpg", overview: "Dreams" }], tv_results: [] });
      if (url.includes("tt2560140")) return json({ movie_results: [], tv_results: [{ id: 1429, poster_path: "/aot.jpg", backdrop_path: null }] });
      return json({ movie_results: [], tv_results: [] });
    }));
    expect(missingPosterIds().map((m) => m.id)).toEqual([movie.id, anime.id]);
    startPosterJob();
    const j = await finish();
    expect(j).toMatchObject({ state: "done", total: 2, found: 2 });
    expect(getMedia(movie.id)).toMatchObject({ posterUrl: "https://image.tmdb.org/t/p/w500/inc.jpg", tmdbId: 27205, overview: "Dreams" });
    expect(getMedia(anime.id)!.posterUrl).toBe("https://image.tmdb.org/t/p/w500/aot.jpg");
    expect(getMedia(mine.id)!.posterUrl).toBe("https://image.tmdb.org/t/p/w500/mine.jpg");
    expect(missingPosterIds()).toEqual([]);
  });

  it("without a TMDB key, uses TVmaze for shows and skips movies", async () => {
    createMedia({ type: "movie", metadata: { title: "Film", imdbId: "tt1000001" } });
    const show = createMedia({ type: "tv", metadata: { title: "Show", imdbId: "tt1000002" } });
    createMedia({ type: "tv", metadata: { title: "Unknown", imdbId: "tt1000003" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("tt1000002")) return json({ id: 77, name: "Show", image: { original: "https://static.tvmaze.com/x.jpg" }, summary: "<p>Hi</p>" });
      return json({}, 404);
    }));
    startPosterJob();
    const j = await finish();
    expect(j).toMatchObject({ found: 1, notFound: 1, needsKey: 1, failed: 0 });
    expect(getMedia(show.id)).toMatchObject({ posterUrl: "https://static.tvmaze.com/x.jpg", tvmazeId: 77 });
  });
});
