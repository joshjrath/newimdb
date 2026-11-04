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
