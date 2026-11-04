import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import { freshDb } from "./helpers";
import { createMedia, getMediaDetail, setAssessment } from "@/lib/repo/media";
import { audit } from "@/lib/repo/audit";
import { repairDone, repairInflatedShows } from "@/lib/episodes/repair";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "watch-repair-"));

function datasets() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imdb-rep-"));
  const ep = ["tconst\tparentTconst\tseasonNumber\tepisodeNumber"];
  const basics = ["tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres", "tt0434665\ttvSeries\tBleach\tBleach\t0\t2004\t2012\t24\tAnimation"];
  for (const [season, n, year] of [[1, 3, 2004], [2, 2, 2005]] as const)
    for (let i = 1; i <= n; i++) {
      const id = `tt9${season}0${i}`;
      ep.push(`${id}\ttt0434665\t${season}\t${i}`);
      basics.push(`${id}\ttvEpisode\tEp ${season}-${i}\tEp ${season}-${i}\t0\t${year}\t\\N\t24\tAnimation`);
    }
  fs.writeFileSync(path.join(dir, "title.episode.tsv.gz"), gzipSync(ep.join("\n")));
  fs.writeFileSync(path.join(dir, "title.basics.tsv.gz"), gzipSync(basics.join("\n")));
  return dir;
}

beforeEach(() => {
  freshDb();
});

describe("repairing shows the old sync inflated", () => {
  it("puts Bleach back to IMDb's structure, keeping everything you watched", async () => {
    const e = (n: number) => ({ number: n, title: null, airDate: "2010-01-01", overview: null, providerRef: String(n) });
    const m = createMedia({
      type: "anime",
      metadata: { title: "Bleach", imdbId: "tt0434665" },
      segments: [
        { kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 6, episodes: [1, 2, 3, 4, 5, 6].map(e) },
        { kind: "season", label: "Season 2", seasonNumber: 2, courNumber: null, episodeCount: 5, episodes: [1, 2, 3, 4, 5].map(e) },
        { kind: "season", label: "Season 3", seasonNumber: 3, courNumber: null, episodeCount: 2, provider: "tvmaze", providerRef: "1:3", episodes: [1, 2].map(e) },
      ],
    });
    const d = getMediaDetail(m.id)!;
    setAssessment(m.id, d.segments[1].episodes[4].id, { rating: 4 }); // you rated an extra one: kept
    audit((await import("@/lib/db")).getDb(), "sync_episodes", "media", m.id, { added: 8 });
    const r = await repairInflatedShows(undefined, { dir: datasets(), download: async () => { throw new Error("offline"); } });
    expect(r).toMatchObject({ shows: 1, removedEpisodes: 3, removedSeasons: 1 });
    const after = getMediaDetail(m.id)!.segments;
    expect(after.map((s) => s.episodes.length)).toEqual([3, 5]); // season 2 keeps up to the one you rated
    expect(after[0].episodes[0]).toMatchObject({ airDate: "2004", title: "Ep 1-1" });
    expect(after[1].episodes[2].rating).toBe(null);
    expect(after[1].episodes.find((x) => x.number === 5)?.rating).toBe(4);
    expect(repairDone()).toBe(true);
    expect(await repairInflatedShows()).toBeNull(); // runs once
  });
});
