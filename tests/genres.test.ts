import { describe, expect, it } from "vitest";
import { openDatabase, setDbForTests } from "@/lib/db";
import { createMedia, getMedia, listMedia, updateMedia } from "@/lib/repo/media";
import { applyGenres, createGenre, deleteGenre, listGenres } from "@/lib/repo/genres";
import { matchesGenre, rulesForCustom } from "@/lib/domain/genres";
import { exportAll, restoreBackup } from "@/lib/repo/backup";

const fresh = () => {
  const db = openDatabase(":memory:");
  setDbForTests(db);
  return db;
};

describe("genre rules", () => {
  it("matches any genre, all genres, or a keyword, ignoring case and punctuation", () => {
    expect(matchesGenre({ genres: ["Sci-Fi"] }, ["sci fi"], [])).toBe(true);
    expect(matchesGenre({ allGenres: ["Documentary", "Crime"] }, ["Crime"], [])).toBe(false);
    expect(matchesGenre({ allGenres: ["Documentary", "Crime"] }, ["Crime", "Documentary"], [])).toBe(true);
    expect(matchesGenre({ keywords: ["superhero"] }, ["Action"], ["Superhero"])).toBe(true);
    expect(rulesForCustom("true crime").allGenres).toEqual(["Documentary", "Crime"]);
    expect(rulesForCustom("Kaiju")).toEqual({ genres: ["Kaiju"], keywords: ["kaiju"] });
  });
});

describe("genre filters", () => {
  it("tags the whole library when added, and new titles as they arrive", () => {
    const db = fresh();
    const a = createMedia({ type: "movie", metadata: { title: "Heat", genres: ["Action", "Crime"] } }, {}, db);
    createMedia({ type: "tv", metadata: { title: "Making a Murderer", genres: ["Documentary", "Crime"] } }, {}, db);
    createMedia({ type: "movie", metadata: { title: "Amélie", genres: ["Comedy", "Romance"] } }, {}, db);
    const { genre: action, tagged } = createGenre("Action", undefined, db);
    expect(tagged).toBe(1);
    const { genre: tc } = createGenre("True Crime", undefined, db);
    expect(listMedia({ genre: tc.id }, db).items.map((m) => m.title)).toEqual(["Making a Murderer"]);
    expect(getMedia(a.id, db)!.genreFilters).toEqual([{ id: action.id, name: "Action", state: "auto" }]);
    const b = createMedia({ type: "movie", metadata: { title: "John Wick", genres: ["Action"] } }, {}, db);
    expect(getMedia(b.id, db)!.genreFilters.map((g) => g.name)).toEqual(["Action"]);
    expect(listGenres(db).find((g) => g.name === "Action")!.count).toBe(2);
    expect(() => createGenre("action", undefined, db)).toThrow(/already/);
  });

  it("keeps your own choices over the rules", () => {
    const db = fresh();
    const m = createMedia({ type: "movie", metadata: { title: "Heat", genres: ["Action"] } }, {}, db);
    const { genre: action } = createGenre("Action", undefined, db);
    const { genre: drama } = createGenre("Drama", undefined, db);
    // Remove Action, add Drama by hand.
    const v = getMedia(m.id, db)!.version;
    updateMedia(m.id, { version: v, genreFilters: [drama.id] }, db);
    applyGenres(db);
    expect(getMedia(m.id, db)!.genreFilters).toEqual([{ id: drama.id, name: "Drama", state: "manual" }]);
    expect(listMedia({ genre: action.id }, db).total).toBe(0);
    // Changing the title's genres re-tags automatically, but still respects the removal.
    updateMedia(m.id, { version: v + 1, metadata: { genres: ["Action", "Thriller"] } }, db);
    expect(getMedia(m.id, db)!.genreFilters.map((g) => g.name)).toEqual(["Drama"]);
    deleteGenre(drama.id, db);
    expect(getMedia(m.id, db)!.genreFilters).toEqual([]);
  });

  it("survives a backup and restore", async () => {
    const db = fresh();
    createMedia({ type: "movie", metadata: { title: "Heat", genres: ["Action"] } }, {}, db);
    const m = createMedia({ type: "movie", metadata: { title: "Up", genres: ["Animation"] } }, {}, db);
    const { genre: action } = createGenre("Action", undefined, db);
    updateMedia(m.id, { version: getMedia(m.id, db)!.version, genreFilters: [action.id] }, db);
    const b = exportAll(db);
    const db2 = fresh();
    await restoreBackup(b, "replace", db2);
    const items = listMedia({}, db2).items;
    expect(items.length).toBe(2);
    expect(items.every((i) => i.genreFilters.map((g) => g.name).join() === "Action")).toBe(true);
  });
});
