import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { bulkAssess, createMedia, getMediaDetail } from "@/lib/repo/media";
import { addToList, createList, getList, listLists, reorderList, updateList } from "@/lib/repo/lists";

beforeEach(() => {
  freshDb();
});

describe("lists", () => {
  it("mixes movies and shows, sorts, reorders, and shows progress", () => {
    const im = createMedia({ type: "movie", metadata: { title: "Iron Man", year: 2008 }, review: { rating: 4 } });
    const cap = createMedia({ type: "movie", metadata: { title: "Captain America: The First Avenger", year: 2011 } });
    const loki = createMedia({ type: "tv", metadata: { title: "Loki", year: 2021 }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 4 }] });
    bulkAssess(loki.id, getMediaDetail(loki.id)!.segments[0].episodes.slice(0, 2).map((e) => e.id), "watched", undefined);
    const id = createList({ name: "MCU", mediaIds: [im.id, loki.id] });
    expect(addToList(id, [cap.id, im.id])).toBe(1); // no duplicates
    let l = getList(id)!;
    expect(l.items.map((i) => i.title)).toEqual(["Iron Man", "Loki", "Captain America: The First Avenger"]);
    expect(l.percent).toBe(50); // 1 + 0.5 + 0 of 3
    reorderList(id, [cap.id, im.id, loki.id]); // story order
    expect(getList(id)!.items.map((i) => i.title)[0]).toBe("Captain America: The First Avenger");
    updateList(id, { sort: "release" });
    l = getList(id)!;
    expect(l.items.map((i) => i.year)).toEqual([2008, 2011, 2021]);
    expect(listLists()[0]).toMatchObject({ name: "MCU", count: 3, finished: 1 });
  });
});

describe("release order to the day", () => {
  it("puts Supergirl (June) before Lanterns (August), same year", async () => {
    const sg = createMedia({ type: "movie", metadata: { title: "Supergirl", year: 2026, releaseDate: "2026-06-26" } });
    const ln = createMedia({ type: "tv", metadata: { title: "Lanterns", year: 2026 }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 1, episodes: [{ number: 1, title: "Pilot", airDate: "2026-08-16", overview: null, providerRef: null }] }] });
    const id = createList({ name: "DCU", mediaIds: [ln.id, sg.id], sort: "release" });
    expect(getList(id)!.items.map((i) => [i.title, i.releaseDate])).toEqual([["Supergirl", "2026-06-26"], ["Lanterns", "2026-08-16"]]);
  });
});

describe("sorting both ways", () => {
  it("reverses any sort", async () => {
    const { listMedia: lm } = await import("@/lib/repo/media");
    createMedia({ type: "movie", metadata: { title: "Alpha", year: 1990 }, review: { rating: 2 } });
    createMedia({ type: "movie", metadata: { title: "Beta", year: 2020 }, review: { rating: 5 } });
    const t = (sort: "rating" | "title" | "year", dir?: "asc" | "desc") => lm({ type: "movie", sort, dir }).items.map((m) => m.title);
    expect(t("rating")).toEqual(["Beta", "Alpha"]);
    expect(t("rating", "asc")).toEqual(["Alpha", "Beta"]);
    expect(t("title")).toEqual(["Alpha", "Beta"]);
    expect(t("title", "desc")).toEqual(["Beta", "Alpha"]);
    expect(t("year", "asc")).toEqual(["Alpha", "Beta"]);
  });
});
