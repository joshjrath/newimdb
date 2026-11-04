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
