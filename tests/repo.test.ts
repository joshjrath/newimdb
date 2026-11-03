import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import {
  applyMetadataRefresh, applyProviderEpisodes, bulkAssess, bulkUpdate, countMedia, createMedia, getMediaDetail,
  listMedia, listWatching, RepoError, saveStructure, setAssessment, updateMedia,
} from "@/lib/repo/media";
import { commitLetterboxd, previewLetterboxd } from "@/lib/repo/imports";
import { exportAll, restoreBackup, summarizeBackup } from "@/lib/repo/backup";
import { parseLetterboxdRss } from "@/lib/domain/letterboxd";
import { activePointer, computeProgress } from "@/lib/domain/progress";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "watch-test-"));

let db: ReturnType<typeof freshDb>;
beforeEach(() => {
  db = freshDb();
});

const show = (title = "Test Show", seasons = [10, 8]) =>
  createMedia({
    type: "tv",
    metadata: { title, year: 2020, tmdbId: 1399, imdbId: "tt0944947" },
    review: { rating: 4, body: "Para one.\n\nPara two.", status: "watching" },
    tags: ["Drama", "drama", "HBO"],
    segments: seasons.map((n, i) => ({ kind: "season", label: `Season ${i + 1}`, seasonNumber: i + 1, courNumber: null, episodeCount: n })),
  });

describe("media CRUD", () => {
  it("creates, keeps provider ids and tags, and defaults to private", () => {
    const m = show();
    const d = getMediaDetail(m.id)!;
    expect(d.tmdbId).toBe(1399);
    expect(d.imdbId).toBe("tt0944947");
    expect(d.tags).toEqual(["Drama", "HBO"]);
    expect(d.review.visibility).toBe("private");
    expect(d.review.body).toBe("Para one.\n\nPara two.");
    expect(d.segments.map((s) => s.episodes.length)).toEqual([10, 8]);
  });

  it("updates with optimistic versioning", () => {
    const m = show();
    const u = updateMedia(m.id, { version: m.version, review: { rating: 4.5 }, metadata: { malId: 5 } });
    expect(u.review.rating).toBe(4.5);
    expect(u.malId).toBe(5);
    expect(u.tmdbId).toBe(1399);
    expect(() => updateMedia(m.id, { version: m.version, review: { rating: 1 } })).toThrow(RepoError);
  });

  it("refuses invalid ratings at the database level too", () => {
    const m = show();
    expect(() => db.prepare(`UPDATE review SET rating = 4.3 WHERE media_id = ?`).run(m.id)).toThrow();
  });

  it("counts accurately (no '0 reviews')", () => {
    show("A"); show("B");
    createMedia({ type: "movie", metadata: { title: "M" } });
    expect(countMedia()).toMatchObject({ tv: 2, movie: 1, anime: 0, total: 3 });
    expect(listMedia({ type: "tv" }).total).toBe(2);
  });

  it("metadata refresh never touches review, ratings, or locked fields", () => {
    const m = show();
    const d = getMediaDetail(m.id)!;
    setAssessment(m.id, d.segments[0].episodes[0].id, { rating: 5 });
    updateMedia(m.id, { version: m.version, metadata: { lockedFields: ["title"] } });
    const r = applyMetadataRefresh(m.id, { title: "Other", overview: "New overview", imdbId: null, genres: [] });
    expect(r.title).toBe("Test Show");
    expect(r.overview).toBe("New overview");
    expect(r.imdbId).toBe("tt0944947");
    expect(r.review.rating).toBe(4);
    expect(getMediaDetail(m.id)!.segments[0].episodes[0].rating).toBe(5);
  });

  it("bulk feature / status / tag / delete", () => {
    const a = show("A"), b = show("B");
    expect(bulkUpdate([a.id, b.id], "feature", {})).toBe(2);
    expect(listMedia({ featured: true }).total).toBe(2);
    bulkUpdate([a.id], "set_status", { status: "dropped" });
    expect(listMedia({ status: "dropped" }).items.map((i) => i.title)).toEqual(["A"]);
    bulkUpdate([b.id], "add_tag", { tag: "MCU" });
    expect(listMedia({ tag: "mcu" }).total).toBe(1);
    expect(bulkUpdate([a.id, b.id], "delete", {})).toBe(2);
    expect(countMedia().total).toBe(0);
  });
});

describe("episode assessments", () => {
  it("distinguishes unrated, skipped, filler, and keeps ratings when filler toggles", () => {
    const m = show();
    const eps = getMediaDetail(m.id)!.segments[0].episodes;
    setAssessment(m.id, eps[0].id, { rating: 4.5 });
    setAssessment(m.id, eps[1].id, { state: "skipped" });
    setAssessment(m.id, eps[2].id, { rating: 3 });
    setAssessment(m.id, eps[2].id, { filler: true });
    const after = getMediaDetail(m.id)!.segments[0].episodes;
    expect(after[0]).toMatchObject({ state: "watched", rating: 4.5, filler: false });
    expect(after[1]).toMatchObject({ state: "skipped", rating: null });
    expect(after[2]).toMatchObject({ state: "watched", rating: 3, filler: true });
    expect(after[3]).toMatchObject({ state: "unwatched", rating: null });
    // skipping a rated episode clears the rating (skipped is not watched)
    setAssessment(m.id, eps[0].id, { state: "skipped" });
    expect(getMediaDetail(m.id)!.segments[0].episodes[0]).toMatchObject({ state: "skipped", rating: null });
  });

  it("rejects episodes from another show", () => {
    const a = show("A"), b = show("B");
    const epB = getMediaDetail(b.id)!.segments[0].episodes[0].id;
    expect(() => setAssessment(a.id, epB, { rating: 4 })).toThrow(RepoError);
  });

  it("updates Recently Watched when an episode of an existing show is rated", async () => {
    const a = show("Old");
    const b = show("Newer");
    db.prepare(`UPDATE review SET last_watched_at = '2020-01-01T00:00:00.000Z'`).run();
    expect(listMedia({ type: "tv" }).items[0].title).toBe("Newer");
    setAssessment(a.id, getMediaDetail(a.id)!.segments[1].episodes[0].id, { rating: 4 });
    expect(listMedia({ type: "tv" }).items[0].title).toBe("Old");
  });

  it("bulk quick-set and progress", () => {
    const m = show("S", [4]);
    const ids = getMediaDetail(m.id)!.segments[0].episodes.map((e) => e.id);
    bulkAssess(m.id, ids.slice(0, 2), "rate", 4);
    bulkAssess(m.id, ids, "rate_unrated", 3);
    const eps = getMediaDetail(m.id)!.segments[0].episodes;
    expect(eps.map((e) => e.rating)).toEqual([4, 4, 3, 3]);
    expect(computeProgress(eps).percent).toBe(100);
  });

  it("watching strip points at the active season, not the highest", () => {
    const m = show("Long", Array(15).fill(10));
    const segs = getMediaDetail(m.id)!.segments;
    for (let s = 0; s < 6; s++) bulkAssess(m.id, segs[s].episodes.map((e) => e.id), "watched", null);
    setAssessment(m.id, segs[6].episodes[0].id, { rating: 4 });
    const [w] = listWatching("tv");
    expect(w.pointer.segment?.label).toBe("Season 7");
    expect(w.pointer.nextEpisode?.number).toBe(2);
  });
});

describe("structure editing after creation", () => {
  it("renames, reorders, adds OVA mid-season and keeps ratings", () => {
    const m = createMedia({
      type: "anime",
      metadata: { title: "Anime", malId: 1 },
      segments: [
        { kind: "cour", label: "S1 Part 1", seasonNumber: 1, courNumber: 1, episodeCount: 12 },
        { kind: "cour", label: "S1 Part 2", seasonNumber: 1, courNumber: 2, episodeCount: 12 },
      ],
    });
    let d = getMediaDetail(m.id)!;
    setAssessment(m.id, d.segments[1].episodes[0].id, { rating: 5 });
    d = getMediaDetail(m.id)!;
    const segs = saveStructure(m.id, {
      version: d.version,
      segments: [
        { id: d.segments[0].id, kind: "cour", label: "Season 1 · Cour 1", seasonNumber: 1, courNumber: 1, episodeCount: 12 },
        { kind: "ova", label: "OVA", seasonNumber: null, courNumber: null, episodeCount: 2 },
        { id: d.segments[1].id, kind: "cour", label: "Season 1 · Cour 2", seasonNumber: 1, courNumber: 2, episodeCount: 13 },
        { kind: "movie", label: "Movie 1", seasonNumber: null, courNumber: null, episodeCount: 1 },
      ],
    });
    expect(segs.map((s) => s.label)).toEqual(["Season 1 · Cour 1", "OVA", "Season 1 · Cour 2", "Movie 1"]);
    expect(segs[2].episodes).toHaveLength(13);
    expect(segs[2].episodes[0].rating).toBe(5);
    // persists across reload
    expect(getMediaDetail(m.id)!.segments.map((s) => s.episodes.length)).toEqual([12, 2, 13, 1]);
  });

  it("asks for confirmation before deleting rated episodes", () => {
    const m = show("X", [5]);
    let d = getMediaDetail(m.id)!;
    setAssessment(m.id, d.segments[0].episodes[4].id, { rating: 2 });
    d = getMediaDetail(m.id)!;
    const input = { version: d.version, segments: [{ id: d.segments[0].id, kind: "season" as const, label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 3 }] };
    try {
      saveStructure(m.id, input);
      expect.unreachable();
    } catch (e) {
      expect((e as RepoError).code).toBe("needs_confirmation");
    }
    expect(getMediaDetail(m.id)!.segments[0].episodes).toHaveLength(5);
    saveStructure(m.id, { ...input, confirmLoss: true });
    expect(getMediaDetail(m.id)!.segments[0].episodes).toHaveLength(3);
  });

  it("provider episode refresh fills titles without deleting or overwriting ratings", () => {
    const m = show("Y", [2]);
    const d = getMediaDetail(m.id)!;
    setAssessment(m.id, d.segments[0].episodes[0].id, { rating: 4 });
    applyProviderEpisodes(d.segments[0].id, [
      { number: 1, title: "Pilot", airDate: "2020-01-01", overview: null, providerRef: "a" },
      { number: 3, title: "Third", airDate: null, overview: null, providerRef: "c", filler: true },
    ], { grow: true });
    const eps = getMediaDetail(m.id)!.segments[0].episodes;
    expect(eps.map((e) => e.title)).toEqual(["Pilot", null, "Third"]);
    expect(eps[0].rating).toBe(4);
    expect(eps[2].filler).toBe(true);
  });
});

describe("letterboxd import", () => {
  const rss = fs.readFileSync(path.join(__dirname, "fixtures/letterboxd.rss.xml"), "utf8");

  it("previews, creates private entries, re-syncs without duplication, and respects manual reviews", () => {
    const manual = createMedia({ type: "movie", metadata: { title: "Dune: Part Two", year: 2024 }, review: { body: "My own words", rating: 5 } });
    const entries = parseLetterboxdRss(rss);
    const preview = previewLetterboxd(entries);
    expect(preview.map((p) => p.match)).toEqual(["new", "conflict"]);
    expect(preview[1].mediaId).toBe(manual.id);
    const counts = commitLetterboxd(preview.map((p) => ({ entry: p.entry, action: p.defaultAction, mediaId: p.mediaId })));
    expect(counts).toMatchObject({ created: 1, linked: 1 });
    const dune = getMediaDetail(manual.id)!;
    expect(dune.review.body).toBe("My own words");
    expect(dune.review.rating).toBe(5);
    const pl = listMedia({ q: "Past Lives" }).items[0];
    expect(pl.review).toMatchObject({ visibility: "private", featured: false, spoiler: true, source: "letterboxd", watchedOn: "2024-01-05" });
    expect(pl.review.body).toContain("\n\n");

    // second sync: nothing changes, no duplicates
    const again = previewLetterboxd(parseLetterboxdRss(rss));
    expect(again.map((p) => p.match)).toEqual(["unchanged", "unchanged"]);

    // review edited on Letterboxd → update, stale text replaced
    const edited = parseLetterboxdRss(rss.replace("Quiet &amp; devastating.", "Edited text."));
    const p3 = previewLetterboxd(edited);
    expect(p3[0].match).toBe("update");
    commitLetterboxd(p3.map((p) => ({ entry: p.entry, action: p.defaultAction, mediaId: p.mediaId })));
    expect(getMediaDetail(pl.id)!.review.body).toMatch(/^Edited text\./);
    expect(countMedia().movie).toBe(2);
  });
});

describe("backup", () => {
  it("round-trips all structures and ratings", async () => {
    const m = createMedia({
      type: "anime",
      metadata: { title: "A", malId: 9 },
      tags: ["Shonen"],
      segments: [
        { kind: "cour", label: "S1 C1", seasonNumber: 1, courNumber: 1, episodeCount: 3 },
        { kind: "ova", label: "OVA", seasonNumber: null, courNumber: null, episodeCount: 1 },
      ],
    });
    const d = getMediaDetail(m.id)!;
    setAssessment(m.id, d.segments[0].episodes[0].id, { rating: 4.5 });
    setAssessment(m.id, d.segments[0].episodes[1].id, { state: "skipped" });
    setAssessment(m.id, d.segments[1].episodes[0].id, { filler: true, state: "watched" });
    const backup = JSON.parse(JSON.stringify(exportAll()));
    expect(summarizeBackup(backup)).toMatchObject({ entries: 1, wouldReplace: 1 });
    await restoreBackup(backup, "replace");
    const [item] = listMedia({}).items;
    const r = getMediaDetail(item.id)!;
    expect(r.uid).toBe(m.uid);
    expect(r.malId).toBe(9);
    expect(r.tags).toEqual(["Shonen"]);
    expect(r.segments.map((s) => s.label)).toEqual(["S1 C1", "OVA"]);
    expect(r.segments[0].episodes.map((e) => [e.state, e.rating])).toEqual([["watched", 4.5], ["skipped", null], ["unwatched", null]]);
    expect(r.segments[1].episodes[0]).toMatchObject({ filler: true, state: "watched" });
    expect(activePointer(r.segments).lastWatched?.segmentId).toBe(r.segments[1].id);
  });
});
