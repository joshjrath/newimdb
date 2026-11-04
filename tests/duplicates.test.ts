import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { createMedia, getMedia, listMedia, countMedia } from "@/lib/repo/media";
import { parseImdbRatings } from "@/lib/domain/imdb";
import { buildImdbPlan, commitImdbPlan } from "@/lib/repo/imdbImport";
import { commitLetterboxd, previewLetterboxd } from "@/lib/repo/imports";
import { parseLetterboxdRss } from "@/lib/domain/letterboxd";
import { findDuplicates, mergeDuplicates } from "@/lib/repo/duplicates";
import { createPerson } from "@/lib/repo/people";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "watch-dupes-"));
const rss = fs.readFileSync(path.join(__dirname, "fixtures/letterboxd.rss.xml"), "utf8");
const IMDB = [
  "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres",
  "tt13238346,6,2024-02-01,Past Lives,Past Lives,,Movie,7.8,105,2023,Drama",
  "tt15239678,7,2024-03-05,Dune: Part Two,Dune: Part Two,,Movie,8.5,166,2024,Sci-Fi",
].join("\n");

beforeEach(() => {
  freshDb();
});

const importImdb = () => {
  const { rows, invalid } = parseImdbRatings(IMDB);
  return commitImdbPlan(buildImdbPlan(rows, invalid, null), {}, "overwrite");
};
const importLetterboxd = () => {
  const p = previewLetterboxd(parseLetterboxdRss(rss));
  commitLetterboxd(p.map((r) => ({ entry: r.entry, action: r.defaultAction, mediaId: r.mediaId })));
  return p;
};

describe("one review per title across Letterboxd and IMDb", () => {
  it("Letterboxd first, then IMDb: no duplicates, Letterboxd's rating wins, IMDb id remembered", () => {
    importLetterboxd();
    const c = importImdb();
    expect(c).toMatchObject({ created: 0, updated: 2 });
    expect(countMedia().movie).toBe(2);
    const pl = listMedia({ q: "Past Lives" }).items[0];
    expect(pl.review).toMatchObject({ rating: 4.5, source: "letterboxd" }); // not IMDb's 3
    expect(pl.imdbId).toBe("tt13238346");
  });

  it("IMDb first, then Letterboxd: the Letterboxd review replaces IMDb's", () => {
    importImdb();
    const p = importLetterboxd();
    expect(p.map((r) => [r.match, r.defaultAction])).toEqual([["conflict", "overwrite"], ["conflict", "overwrite"]]);
    expect(countMedia().movie).toBe(2);
    const pl = listMedia({ q: "Past Lives" }).items[0];
    expect(pl.review).toMatchObject({ rating: 4.5, source: "letterboxd", spoiler: true });
    expect(pl.review.body).toMatch(/Quiet & devastating/);
  });
});

describe("merging existing duplicates", () => {
  it("keeps the Letterboxd copy, folds the IMDb one in, keeps tags and people", () => {
    const sam = createPerson("Sam");
    const lb = createMedia({ type: "movie", metadata: { title: "Past Lives", year: 2023 }, review: { rating: 4.5, body: "Mine" }, tags: ["Romance"] }, { source: "letterboxd" });
    const im = createMedia({ type: "movie", metadata: { title: "Past Lives", year: 2023, imdbId: "tt13238346", posterUrl: "https://image.tmdb.org/t/p/w500/p.jpg" }, review: { rating: 3 }, tags: ["IMDb"], people: [sam.id] }, { source: "imdb" });
    createMedia({ type: "movie", metadata: { title: "Past Lives", year: 1999 } }); // different film
    createMedia({ type: "tv", metadata: { title: "Past Lives", year: 2023 } }); // a show is never the same as a film
    const groups = findDuplicates();
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe(lb.id);
    expect(groups[0].remove.map((r) => r.id)).toEqual([im.id]);
    expect(mergeDuplicates().removed).toBe(1);
    expect(getMedia(im.id)).toBeNull();
    const kept = getMedia(lb.id)!;
    expect(kept.review).toMatchObject({ rating: 4.5, body: "Mine", source: "letterboxd" });
    expect(kept).toMatchObject({ imdbId: "tt13238346", posterUrl: "https://image.tmdb.org/t/p/w500/p.jpg" });
    expect(kept.tags.sort()).toEqual(["IMDb", "Romance"]);
    expect(kept.people.map((p) => p.name)).toEqual(["Sam"]);
    expect(findDuplicates()).toEqual([]);
  });
});
