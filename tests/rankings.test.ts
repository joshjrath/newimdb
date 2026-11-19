import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { createMedia } from "@/lib/repo/media";
import { getRankings, setTierList, setTopList } from "@/lib/repo/rankings";
import { exportAll, restoreBackup } from "@/lib/repo/backup";
import { tierForRating } from "@/lib/domain/rankings";

beforeEach(() => {
  freshDb();
});

describe("rankings", () => {
  it("keeps a numbered top list per kind and a tier list, and backs them up", async () => {
    const heat = createMedia({ type: "movie", metadata: { title: "Heat" }, review: { rating: 5 } });
    const thief = createMedia({ type: "movie", metadata: { title: "Thief" }, review: { rating: 4 } });
    const show = createMedia({ type: "tv", metadata: { title: "Severance" }, review: { rating: 5 } });
    createMedia({ type: "movie", metadata: { title: "Not seen" }, review: { status: "plan" } });
    setTopList("movie", [thief.id, heat.id, show.id]); // a show can't be in the movie list
    expect(getRankings("movie").top.map((i) => i.title)).toEqual(["Thief", "Heat"]);
    expect(getRankings("movie").pool.map((i) => i.title)).toEqual(["Heat", "Thief"]); // plan-to-watch isn't in the tray
    setTierList("movie", { S: [heat.id], C: [thief.id] });
    const r = getRankings("movie");
    expect([r.tiers.S.map((i) => i.title), r.tiers.C.map((i) => i.title), r.pool.length]).toEqual([["Heat"], ["Thief"], 0]);
    expect(getRankings("tv").pool.map((i) => i.title)).toEqual(["Severance"]);
    expect([5, 4.5, 4, 3, 2, null].map(tierForRating)).toEqual(["S", "A", "B", "C", "F", null]);
    const b = exportAll();
    freshDb();
    await restoreBackup(b, "replace");
    const after = getRankings("movie");
    expect(after.top.map((i) => i.title)).toEqual(["Thief", "Heat"]);
    expect(after.tiers.S.map((i) => i.title)).toEqual(["Heat"]);
  });
});
