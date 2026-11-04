import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { bulkAssess, bulkUpdate, createMedia, getMedia, getMediaDetail, listMedia } from "@/lib/repo/media";
import { applyAutoStatus, statusFor } from "@/lib/repo/autoStatus";
import { getDb } from "@/lib/db";

beforeEach(() => {
  freshDb();
});

const show = (title: string, n: number) =>
  createMedia({ type: "tv", metadata: { title }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: n }] });
const ids = (id: number) => getMediaDetail(id)!.segments.flatMap((s) => s.episodes.map((e) => e.id));
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe("status follows progress", () => {
  it("has the rules", () => {
    expect(statusFor({ watched: 0, denominator: 5, lastActivity: null, returning: false })).toBeNull();
    expect(statusFor({ watched: 5, denominator: 5, lastActivity: ago(200), returning: false })).toBe("completed");
    expect(statusFor({ watched: 2, denominator: 5, lastActivity: ago(2), returning: false })).toBe("watching");
    expect(statusFor({ watched: 2, denominator: 5, lastActivity: ago(31), returning: false })).toBe("on_hold");
    expect(statusFor({ watched: 2, denominator: 5, lastActivity: ago(91), returning: false })).toBe("dropped");
    expect(statusFor({ watched: 4, denominator: 5, lastActivity: ago(91), returning: true })).toBe("completed");
  });

  it("moves shows as you watch, waits on your own pick, and sorts by progress", () => {
    const a = show("A", 4);
    const b = show("B", 4);
    bulkAssess(a.id, ids(a.id), "watched", undefined);
    expect(getMedia(a.id)!.review.status).toBe("completed");
    bulkAssess(b.id, ids(b.id).slice(0, 1), "watched", undefined);
    expect(getMedia(b.id)!.review.status).toBe("watching");
    getDb().prepare(`UPDATE episode_assessment SET watched_at = ? WHERE episode_id = ?`).run(ago(40), ids(b.id)[0]);
    getDb().prepare(`INSERT OR REPLACE INTO app_flag (key, at) VALUES ('status-clock-start', ?)`).run(ago(365)); // clock started long ago
    applyAutoStatus();
    expect(getMedia(b.id)!.review.status).toBe("on_hold");
    bulkUpdate([b.id], "set_status", { status: "watching" }); // your pick holds
    applyAutoStatus();
    expect(getMedia(b.id)!.review.status).toBe("watching");
    const c = show("C", 4);
    bulkAssess(c.id, ids(c.id).slice(0, 3), "watched", undefined);
    expect(listMedia({ type: "tv", sort: "progress" }).items.map((m) => m.title)).toEqual(["C", "B"]); // A is 100%: left out
  });
});

describe("unaired episodes never make a show look abandoned", () => {
  it("counts a caught-up show as Completed, ignores specials, and starts the clock today", () => {
    const e = (n: number, airDate: string | null) => ({ number: n, title: null, airDate, overview: null, providerRef: null });
    const m = createMedia({
      type: "tv",
      metadata: { title: "Tires" },
      segments: [
        { kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 2, episodes: [e(1, "2024-05-01"), e(2, "2024-05-08")] },
        { kind: "special", label: "Specials", seasonNumber: 0, courNumber: null, episodeCount: 1, episodes: [e(1, "2024-12-01")] },
        { kind: "season", label: "Season 4", seasonNumber: 4, courNumber: null, episodeCount: 2, episodes: [e(1, null), e(2, null)] }, // IMDb placeholder, no dates
      ],
    });
    const s1 = getMediaDetail(m.id)!.segments.find((s) => s.label === "Season 1")!.episodes.map((x) => x.id);
    bulkAssess(m.id, s1, "watched", undefined);
    getDb().prepare(`UPDATE episode_assessment SET watched_at = ?`).run(ago(400));
    applyAutoStatus();
    expect(getMedia(m.id)!.review.status).toBe("completed");
    // The undated placeholders are now TBA, so the progress bar is 100% too.
    expect(listMedia({ type: "tv" }).items.find((x) => x.id === m.id)!.progress).toMatchObject({ unaired: 2 });

    // A show you're midway through, last watched long ago: the clock starts today, so it's Watching.
    const b = show("Old", 4);
    bulkAssess(b.id, ids(b.id).slice(0, 1), "watched", undefined);
    getDb().prepare(`UPDATE episode_assessment SET watched_at = ? WHERE episode_id = ?`).run(ago(400), ids(b.id)[0]);
    applyAutoStatus();
    expect(getMedia(b.id)!.review.status).toBe("watching");
  });
});

describe("anime filler doesn't count towards progress", () => {
  it("is 100% (and Completed) once every canon episode is watched", async () => {
    const { computeProgress, activePointer } = await import("@/lib/domain/progress");
    const a = createMedia({ type: "anime", metadata: { title: "Naruto Shippuden" }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 5 }] });
    const eps = getMediaDetail(a.id)!.segments[0].episodes;
    bulkAssess(a.id, [eps[2].id, eps[3].id], "filler_on", undefined);
    bulkAssess(a.id, [eps[0].id, eps[1].id], "watched", undefined);
    const p = listMedia({ type: "anime" }).items[0].progress!;
    expect(p).toMatchObject({ watched: 2, filler: 2, denominator: 3 });
    const segs = getMediaDetail(a.id)!.segments;
    expect(computeProgress(segs[0].episodes, { ignoreFiller: true }).percent).toBeCloseTo(66.7);
    expect(activePointer(segs, { ignoreFiller: true }).nextEpisode?.number).toBe(5); // Up next skips filler
    bulkAssess(a.id, [eps[4].id], "watched", undefined);
    expect(listMedia({ type: "anime" }).items[0].progress).toMatchObject({ percent: 100 });
    expect(getMedia(a.id)!.review.status).toBe("completed");
    // A TV show's "filler" flag doesn't change its progress.
    const t = show("Procedural", 2);
    bulkAssess(t.id, ids(t.id).slice(0, 1), "filler_on", undefined);
    expect(listMedia({ type: "tv" }).items.find((x) => x.id === t.id)!.progress).toMatchObject({ denominator: 2 });
  });
});

describe("a new episode of a finished show", () => {
  it("moves it from Completed back to Currently watching", async () => {
    const { syncShowEpisodes } = await import("@/lib/repo/episodeSync");
    const e = (n: number, d: string) => ({ number: n, title: `E${n}`, airDate: d, overview: null, providerRef: null });
    const m = createMedia({ type: "tv", metadata: { title: "The Bear" }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 2, episodes: [e(1, "2022-06-23"), e(2, "2022-06-23")] }] });
    bulkAssess(m.id, ids(m.id), "watched", undefined);
    getDb().prepare(`UPDATE episode_assessment SET watched_at = ?`).run(ago(400));
    applyAutoStatus();
    expect(getMedia(m.id)!.review.status).toBe("completed");
    // Season 2 premieres (yesterday): back to watching, not on hold.
    syncShowEpisodes(m.id, new Map([[1, [e(1, "2022-06-23"), e(2, "2022-06-23")]], [2, [e(1, ago(1).slice(0, 10)), e(2, "2099-01-01")]]]), { provider: "tvmaze", showRef: "1" });
    applyAutoStatus();
    expect(getMedia(m.id)!.review.status).toBe("watching");
  });
});

describe("one-time Dropped for shows untouched in 6 months", () => {
  it("drops unfinished shows last watched over 6 months ago, once, and it sticks", async () => {
    const { dropStaleOnce } = await import("@/lib/repo/autoStatus");
    const old = show("Old", 4);
    const done = show("Done", 2);
    const recent = show("Recent", 4);
    bulkAssess(old.id, ids(old.id).slice(0, 2), "watched", undefined);
    bulkAssess(done.id, ids(done.id), "watched", undefined);
    bulkAssess(recent.id, ids(recent.id).slice(0, 1), "watched", undefined);
    getDb().prepare(`UPDATE episode_assessment SET watched_at = ? WHERE episode_id IN (SELECT e.id FROM episode e JOIN segment s ON s.id = e.segment_id WHERE s.media_id IN (?, ?))`).run(ago(200), old.id, done.id);
    expect(dropStaleOnce()).toBe(1);
    applyAutoStatus();
    expect(getMedia(old.id)!.review.status).toBe("dropped"); // the 30-day clock doesn't undo it
    expect(getMedia(done.id)!.review.status).toBe("completed");
    expect(getMedia(recent.id)!.review.status).toBe("watching");
    expect(dropStaleOnce()).toBe(0); // only ever once
    bulkAssess(old.id, ids(old.id).slice(2, 3), "watched", undefined); // you pick it back up
    expect(getMedia(old.id)!.review.status).toBe("watching");
  });
});

describe("between seasons isn't abandoned", () => {
  it("a finished show with an unstarted new season stays Watching, and wrongly dropped ones come back", async () => {
    const { undoBetweenSeasonDrops } = await import("@/lib/repo/autoStatus");
    const e = (n: number, d: string) => ({ number: n, title: `E${n}`, airDate: d, overview: null, providerRef: null });
    const m = createMedia({
      type: "tv",
      metadata: { title: "Finished" },
      segments: [
        { kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 2, episodes: [e(1, "2020-01-01"), e(2, "2020-01-08")] },
        { kind: "special", label: "Specials", seasonNumber: 0, courNumber: null, episodeCount: 1, episodes: [e(1, "2020-06-01")] },
        { kind: "season", label: "Season 2", seasonNumber: 2, courNumber: null, episodeCount: 1, episodes: [e(1, "2025-01-01")] }, // out long ago
      ],
    });
    const s1 = getMediaDetail(m.id)!.segments.find((s) => s.label === "Season 1")!.episodes.map((x) => x.id);
    bulkAssess(m.id, s1, "watched", undefined);
    getDb().prepare(`UPDATE episode_assessment SET watched_at = ?`).run(ago(700));
    getDb().prepare(`INSERT OR REPLACE INTO app_flag (key, at) VALUES ('status-clock-start', ?)`).run(ago(365));
    applyAutoStatus();
    expect(getMedia(m.id)!.review.status).toBe("watching"); // not dropped
    // As if the 6-month tidy-up had dropped it:
    const ran = new Date().toISOString();
    getDb().prepare(`INSERT OR REPLACE INTO app_flag (key, at) VALUES ('one-time-drop-6-months', ?)`).run(ran);
    getDb().prepare(`UPDATE review SET status = 'dropped', status_manual_at = ? WHERE media_id = ?`).run(ran, m.id);
    expect(undoBetweenSeasonDrops()).toBe(1);
    expect(getMedia(m.id)!.review.status).toBe("watching");
  });
});
