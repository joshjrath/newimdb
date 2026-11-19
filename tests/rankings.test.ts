import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { getDb } from "@/lib/db";
import { createMedia } from "@/lib/repo/media";
import { getRankings, setTierList, setTopList } from "@/lib/repo/rankings";
import { exportAll, restoreBackup } from "@/lib/repo/backup";
import { tierForRating } from "@/lib/domain/rankings";
import { createBoard, deleteBoard, getBoard, listBoards, setBoardTiers, setBoardTop, updateBoard } from "@/lib/repo/boards";
import { createList, listLists, reorderLists } from "@/lib/repo/lists";

beforeEach(() => {
  freshDb();
});

describe("rankings", () => {
  it("keeps a numbered top list per kind and a tier list, and backs them up", async () => {
    const heat = createMedia({ type: "movie", metadata: { title: "Heat" }, review: { rating: 5 } });
    const thief = createMedia({ type: "movie", metadata: { title: "Thief" }, review: { rating: 4 } });
    const show = createMedia({ type: "tv", metadata: { title: "Severance" }, review: { rating: 5, status: "completed" } });
    createMedia({ type: "movie", metadata: { title: "Not seen" }, review: { status: "plan" } });
    setTopList("movie", [thief.id, heat.id, show.id]); // a show can't be in the movie list
    expect(getRankings("movie").top.map((i) => i.title)).toEqual(["Thief", "Heat"]);
    expect(getRankings("movie").pool.map((i) => i.title)).toEqual(["Heat", "Thief"]); // plan-to-watch isn't in the tray
    setTierList("movie", { S: [heat.id], C: [thief.id] });
    const r = getRankings("movie");
    expect([r.tiers.S.map((i) => i.title), r.tiers.C.map((i) => i.title), r.pool.length]).toEqual([["Heat"], ["Thief"], 0]);
    expect(getRankings("tv").pool.map((i) => i.title)).toEqual(["Severance"]);
    expect([5, 4.5, 4, 3, 2, 1, null].map(tierForRating)).toEqual(["S", "A", "B", "C", "D", "F", null]);
    const b = exportAll();
    freshDb();
    await restoreBackup(b, "replace");
    const after = getRankings("movie");
    expect(after.top.map((i) => i.title)).toEqual(["Thief", "Heat"]);
    expect(after.tiers.S.map((i) => i.title)).toEqual(["Heat"]);
  });

  it("lets you make your own rankings from a list, a kind, or anything", () => {
    const heat = createMedia({ type: "movie", metadata: { title: "Heat" }, review: { rating: 5 } });
    const thief = createMedia({ type: "movie", metadata: { title: "Thief" }, review: { rating: 4 } });
    const show = createMedia({ type: "tv", metadata: { title: "Severance" }, review: { rating: 5, status: "completed" } });
    const list = createList({ name: "Mann", mediaIds: [heat.id, thief.id] });
    const fromList = createBoard({ name: "Mann ranked", source: "list", sourceRef: String(list) });
    let v = getBoard(fromList);
    expect(v.board.sourceLabel).toBe("From your list Mann");
    expect(v.pool.map((i) => i.title)).toEqual(["Heat", "Thief"]); // nothing auto-ranked
    setBoardTiers(fromList, { A: [thief.id] });
    v = getBoard(fromList);
    expect([v.tiers.A.map((i) => i.title), v.pool.map((i) => i.title)]).toEqual([["Thief"], ["Heat"]]);
    // the built-in movie tier list is untouched
    expect(getRankings("movie").tiers.A).toEqual([]);

    const any = createBoard({ name: "Comfort watches", source: "any", mode: "top" });
    setBoardTop(any, [show.id, heat.id]);
    expect(getBoard(any).top.map((i) => i.title)).toEqual(["Severance", "Heat"]);
    expect(getBoard(any).pool.map((i) => i.title).sort()).toEqual(["Heat", "Severance"]);
    updateBoard(any, { name: "Cozy", mode: "tiers" });
    expect(listBoards().find((b) => b.id === any)).toMatchObject({ name: "Cozy", mode: "tiers", count: 2 });
    const tv = createBoard({ name: "TV", source: "kind", sourceRef: "tv" });
    expect(getBoard(tv).pool.map((i) => i.title)).toEqual(["Severance"]);
    expect(() => createBoard({ name: "Bad", source: "kind", sourceRef: "nope" })).toThrow();
    deleteBoard(any);
    expect(listBoards().map((b) => b.id).sort()).toEqual([fromList, tv].sort());
  });

  it("keeps your lists in the order you put them", () => {
    const a = createList({ name: "A" });
    const b = createList({ name: "B" });
    const c = createList({ name: "C" });
    reorderLists([c, a, b]);
    expect(listLists().map((l) => l.name)).toEqual(["C", "A", "B"]);
  });

  it("only ranks shows you finished or dropped, and keeps a place while you're back watching", () => {
    const done = createMedia({ type: "tv", metadata: { title: "Done" }, review: { rating: 5, status: "completed" } });
    const dropped = createMedia({ type: "tv", metadata: { title: "Dropped" }, review: { status: "dropped" } });
    const partway = createMedia({ type: "tv", metadata: { title: "Partway" }, review: { rating: 4, status: "watching" } });
    expect(getRankings("tv").pool.map((i) => i.title)).toEqual(["Done", "Dropped"]);
    setTopList("tv", [partway.id, done.id]);
    expect(getRankings("tv").top.map((i) => i.title)).toEqual(["Done"]);
    setTierList("tv", { S: [done.id, partway.id], D: [dropped.id] });
    expect(getRankings("tv").tiers.S.map((i) => i.title)).toEqual(["Done"]);
    expect(getRankings("tv").tiers.D.map((i) => i.title)).toEqual(["Dropped"]);
    // a new season puts Done back to watching: hidden, but its S place survives other edits
    getDb().prepare(`UPDATE review SET status = 'watching' WHERE media_id = ?`).run(done.id);
    setTierList("tv", { D: [dropped.id] });
    expect(getRankings("tv").tiers.S).toEqual([]);
    getDb().prepare(`UPDATE review SET status = 'completed' WHERE media_id = ?`).run(done.id);
    expect(getRankings("tv").tiers.S.map((i) => i.title)).toEqual(["Done"]);
    const b = createBoard({ name: "Any", source: "any" });
    setBoardTiers(b, { A: [partway.id, done.id] });
    expect(getBoard(b).tiers.A.map((i) => i.title)).toEqual(["Done"]);
  });
});
