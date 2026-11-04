import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { bulkUpdate, createMedia, getMedia, listMedia, RepoError, updateMedia } from "@/lib/repo/media";
import { createPerson, deletePerson, listPeople, renamePerson } from "@/lib/repo/people";
import { exportAll, restoreBackup } from "@/lib/repo/backup";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "watch-people-"));

let db: ReturnType<typeof freshDb>;
beforeEach(() => {
  db = freshDb();
});

describe("watched with", () => {
  it("lets a title have nobody, one person or several, and filters by person", () => {
    const sam = createPerson("Sam");
    const alex = createPerson("  Alex  ");
    expect(alex.name).toBe("Alex");
    const a = createMedia({ type: "tv", metadata: { title: "Show A" }, people: [sam.id, alex.id] });
    const b = createMedia({ type: "tv", metadata: { title: "Show B" }, people: [sam.id] });
    const c = createMedia({ type: "movie", metadata: { title: "Film C" } });
    expect(getMedia(a.id)!.people.map((p) => p.name)).toEqual(["Alex", "Sam"]);
    expect(getMedia(c.id)!.people).toEqual([]);
    expect(listMedia({ withPeople: [sam.id] }).items.map((m) => m.title).sort()).toEqual(["Show A", "Show B"]);
    expect(listMedia({ withPeople: [alex.id], type: "tv" }).total).toBe(1);
    // Both people: only what you watched with both of them.
    expect(listMedia({ withPeople: [sam.id, alex.id] }).items.map((m) => m.title)).toEqual(["Show A"]);
    expect(listPeople().map((p) => [p.name, p.count])).toEqual([["Alex", 1], ["Sam", 2]]);
    expect(listPeople(db, "movie").every((p) => p.count === 0)).toBe(true);

    // editing replaces the set
    const u = updateMedia(b.id, { version: getMedia(b.id)!.version, people: [alex.id] });
    expect(u.people.map((p) => p.name)).toEqual(["Alex"]);
  });

  it("refuses duplicates (any capitalisation) and unknown people", () => {
    createPerson("Sam");
    expect(() => createPerson("sam")).toThrow(RepoError);
    const m = createMedia({ type: "movie", metadata: { title: "X" } });
    expect(() => updateMedia(m.id, { version: m.version, people: [999] })).toThrow(/removed in Settings/);
  });

  it("rename shows everywhere; removing a person keeps the titles", () => {
    const sam = createPerson("Sam");
    const m = createMedia({ type: "movie", metadata: { title: "X" }, people: [sam.id] });
    renamePerson(sam.id, "Samantha");
    expect(getMedia(m.id)!.people[0].name).toBe("Samantha");
    expect(deletePerson(sam.id)).toBe(1);
    expect(getMedia(m.id)!.people).toEqual([]);
    expect(listMedia({}).total).toBe(1);
  });

  it("bulk adds and removes a person", () => {
    const sam = createPerson("Sam");
    const ids = [createMedia({ type: "movie", metadata: { title: "A" } }).id, createMedia({ type: "movie", metadata: { title: "B" } }).id];
    expect(bulkUpdate(ids, "add_person", { personId: sam.id })).toBe(2);
    expect(listMedia({ withPeople: [sam.id] }).total).toBe(2);
    bulkUpdate([ids[0]], "remove_person", { personId: sam.id });
    expect(listMedia({ withPeople: [sam.id] }).total).toBe(1);
  });

  it("survives a backup and restore", async () => {
    const sam = createPerson("Sam");
    createMedia({ type: "movie", metadata: { title: "A" }, people: [sam.id] });
    const backup = JSON.parse(JSON.stringify(exportAll()));
    expect(backup.media[0].people).toEqual(["Sam"]);
    db.prepare(`DELETE FROM person`).run();
    await restoreBackup(backup, "replace");
    expect(listMedia({}).items[0].people.map((p) => p.name)).toEqual(["Sam"]);
  });
});
