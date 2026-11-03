import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { guessMediaType, imdbKind, parseImdbRatings } from "@/lib/domain/imdb";
import { lookupEpisodes } from "@/lib/imdb/datasets";
import { buildImdbPlan, commitImdbPlan } from "@/lib/repo/imdbImport";
import { countMedia, getMediaDetail, listMedia, updateMedia } from "@/lib/repo/media";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "watch-imdb-"));

const CSV = [
  "Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors",
  'tt0386676,9,2024-01-03,The Office,The Office,https://www.imdb.com/title/tt0386676/,TV Series,9.0,22,2005,"Comedy",700000,2005-03-24,',
  'tt0290978,8,2023-05-01,The Office,The Office,https://www.imdb.com/title/tt0290978/,TV Series,8.5,30,2001,"Comedy",100000,2001-07-09,',
  'tt1375666,10,2022-02-02,Inception,Inception,https://www.imdb.com/title/tt1375666/,Movie,8.8,148,2010,"Action, Sci-Fi",2500000,2010-07-16,Christopher Nolan',
  'tt2560140,9,2024-06-01,Attack on Titan,Shingeki no Kyojin,https://www.imdb.com/title/tt2560140/,TV Series,9.1,24,2013,"Action, Animation, Drama",500000,2013-04-07,',
  'tt0096697,7,2021-01-01,The Simpsons,The Simpsons,https://www.imdb.com/title/tt0096697/,TV Series,8.7,22,1989,"Animation, Comedy",400000,1989-12-17,',
  'tt0664521,7,2024-01-05,The Office: Pilot,Pilot,https://www.imdb.com/title/tt0664521/,TV Episode,7.4,23,2005,"Comedy",10000,2005-03-24,',
  'tt0664522,8,2024-01-06,The Office: Diversity Day,Diversity Day,https://www.imdb.com/title/tt0664522/,TV Episode,8.2,22,2005,"Comedy",10000,2005-03-29,',
  'tt2772262,10,2024-06-02,Attack on Titan: To You,Ni sen nen go no kimi e,https://www.imdb.com/title/tt2772262/,TV Episode,9.0,24,2013,"Animation",8000,2013-04-07,',
  'tt9999901,6,2024-07-01,Lost Episode,Lost Episode,https://www.imdb.com/title/tt9999901/,TV Episode,7.0,40,2020,"Drama",10,2020-01-01,',
  'tt7777777,9,2024-07-02,Some Game,Some Game,https://www.imdb.com/title/tt7777777/,Video Game,8.0,,2020,"Action",10,,',
  'garbage,11,,x,x,,Movie,,,,,,,',
].join("\n");

function datasets() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imdb-ds-"));
  const episode = [
    "tconst\tparentTconst\tseasonNumber\tepisodeNumber",
    "tt0664521\ttt0386676\t1\t1",
    "tt0664522\ttt0386676\t1\t2",
    "tt0664523\ttt0386676\t1\t3",
    "tt0664600\ttt0386676\t2\t1",
    "tt2772262\ttt2560140\t1\t1",
    "tt2772263\ttt2560140\t1\t2",
    "tt5000000\ttt0290978\t\\N\t\\N",
    "tt8888888\ttt1234567\t1\t1",
  ].join("\n");
  const basics = [
    "tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres",
    "tt0386676\ttvSeries\tThe Office\tThe Office\t0\t2005\t2013\t22\tComedy",
    "tt0664521\ttvEpisode\tPilot\tPilot\t0\t2005\t\\N\t23\tComedy",
    "tt0664522\ttvEpisode\tDiversity Day\tDiversity Day\t0\t2005\t\\N\t22\tComedy",
    "tt0664523\ttvEpisode\tHealth Care\tHealth Care\t0\t2005\t\\N\t22\tComedy",
    "tt0664600\ttvEpisode\tThe Dundies\tThe Dundies\t0\t2005\t\\N\t22\tComedy",
    "tt2772262\ttvEpisode\tTo You, in 2000 Years\tNi sen nen go no kimi e\t0\t2013\t\\N\t24\tAnimation",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "title.episode.tsv.gz"), gzipSync(episode));
  fs.writeFileSync(path.join(dir, "title.basics.tsv.gz"), gzipSync(basics));
  return dir;
}

const noDownload = async () => {
  throw new Error("should use the local files");
};

describe("IMDb export parsing", () => {
  it("reads ids, halves ratings exactly, skips invalid rows", () => {
    const { rows, invalid } = parseImdbRatings(CSV);
    expect(invalid).toBe(1);
    expect(rows).toHaveLength(10);
    const inception = rows.find((r) => r.imdbId === "tt1375666")!;
    expect(inception).toMatchObject({ rating: 5, ratedOn: "2022-02-02", year: 2010, genres: ["Action", "Sci-Fi"], runtimeMin: 148, imdbRating: 8.8 });
    expect(rows.find((r) => r.imdbId === "tt0664521")!.rating).toBe(3.5);
  });
  it("rejects other CSVs", () => {
    expect(() => parseImdbRatings("Name,Year\nx,2000")).toThrow(/IMDb ratings export/);
  });
  it("sorts title types and guesses anime", () => {
    expect(imdbKind("TV Mini Series")).toBe("series");
    expect(imdbKind("tvEpisode")).toBe("episode");
    expect(imdbKind("TV Movie")).toBe("movie");
    expect(imdbKind("Video Game")).toBe("skip");
    expect(guessMediaType("series", ["Animation"], "Attack on Titan", "Shingeki no Kyojin")).toBe("anime");
    expect(guessMediaType("series", ["Animation"], "Spirited Away", "千と千尋の神隠し")).toBe("anime");
    expect(guessMediaType("series", ["Animation", "Comedy"], "The Simpsons", null)).toBe("tv");
    expect(guessMediaType("movie", ["Drama"], "Amélie", "Le fabuleux destin d'Amélie Poulain")).toBe("movie");
  });
});

describe("IMDb import", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  async function plan() {
    const { rows, invalid } = parseImdbRatings(CSV);
    const lookup = await lookupEpisodes(
      new Set(rows.filter((r) => imdbKind(r.titleType) === "episode").map((r) => r.imdbId)),
      new Set(rows.filter((r) => imdbKind(r.titleType) === "series").map((r) => r.imdbId)),
      { dir: datasets(), download: noDownload },
    );
    return buildImdbPlan(rows, invalid, lookup);
  }

  it("keeps same-titled shows apart and builds full season structure", async () => {
    const p = await plan();
    const offices = p.titles.filter((t) => t.title === "The Office");
    expect(offices.map((t) => t.imdbId).sort()).toEqual(["tt0290978", "tt0386676"]);
    const us = p.titles.find((t) => t.imdbId === "tt0386676")!;
    expect(us.seasons.map((s) => [s.season, s.episodes.map((e) => [e.episode, e.title, e.rating])])).toEqual([
      [1, [[1, "Pilot", 3.5], [2, "Diversity Day", 4], [3, "Health Care", null]]],
      [2, [[1, "The Dundies", null]]],
    ]);
    expect(us.ratedEpisodes).toBe(2);
    expect(p.titles.find((t) => t.imdbId === "tt2560140")!.guess).toBe("anime");
    expect(p.titles.find((t) => t.imdbId === "tt0096697")).toMatchObject({ guess: "tv", animated: true });
    expect(p.unresolved.map((u) => u.imdbId)).toEqual(["tt9999901"]);
    expect(p.skipped.map((s) => s.titleType)).toEqual(["Video Game"]);
  });

  it("imports into the right categories, with episode ratings, and re-imports without duplicates", async () => {
    const first = commitImdbPlan(await plan(), { tt0096697: "skip" }, "fill");
    expect(first).toMatchObject({ created: 4, skipped: 1, episodes: 3, byType: { movie: 1, tv: 2, anime: 1 } });
    expect(countMedia()).toMatchObject({ movie: 1, tv: 2, anime: 1 });
    const us = listMedia({ type: "tv", q: "Office" }).items.find((m) => m.imdbId === "tt0386676")!;
    const d = getMediaDetail(us.id)!;
    expect(d.review).toMatchObject({ rating: 4.5, source: "imdb", visibility: "private" });
    expect(d.segments.map((s) => s.label)).toEqual(["Season 1", "Season 2"]);
    expect(d.segments[0].episodes.map((e) => [e.title, e.state, e.rating])).toEqual([["Pilot", "watched", 3.5], ["Diversity Day", "watched", 4], ["Health Care", "unwatched", null]]);
    const movie = listMedia({ type: "movie" }).items[0];
    expect(movie.review).toMatchObject({ rating: 5, watchedOn: "2022-02-02", status: "completed" });

    // The owner changes a rating here, then imports again.
    updateMedia(us.id, { version: d.version, review: { rating: 2 } });
    const again = commitImdbPlan(await plan(), { tt0096697: "skip" }, "fill");
    expect(again).toMatchObject({ created: 0, updated: 4 });
    expect(countMedia().total).toBe(4);
    expect(getMediaDetail(us.id)!.review.rating).toBe(2);
    commitImdbPlan(await plan(), {}, "overwrite");
    expect(getMediaDetail(us.id)!.review.rating).toBe(4.5);
    expect(countMedia()).toMatchObject({ tv: 3 }); // The Simpsons, no longer skipped
  });

  it("without the episode lookup, shows still import and episodes are listed as unplaced", async () => {
    const { rows, invalid } = parseImdbRatings(CSV);
    const p = buildImdbPlan(rows, invalid, null, "offline");
    expect(p.unresolved).toHaveLength(4);
    expect(p.unresolved[0].reason).toMatch(/offline/);
    const c = commitImdbPlan(p, {}, "fill");
    expect(c.created).toBe(5);
  });
});
