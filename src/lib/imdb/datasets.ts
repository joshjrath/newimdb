import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { dataSubdir } from "../db";

/**
 * IMDb's public datasets (https://datasets.imdbws.com, free for personal use) say which
 * series each episode belongs to and its season/episode number. The ratings export doesn't.
 * Files are downloaded once into DATA_DIR/cache/imdb and reused; you can also drop them
 * there by hand.
 */
const BASE = "https://datasets.imdbws.com";
const MAX_AGE_DAYS = 30;
type DatasetName = "title.episode.tsv.gz" | "title.basics.tsv.gz";

export interface EpisodeInfo {
  imdbId: string;
  parentId: string;
  season: number | null;
  episode: number | null;
}

export interface BasicsInfo {
  imdbId: string;
  titleType: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  runtimeMin: number | null;
  genres: string[];
}

export interface EpisodeLookup {
  /** Rated episode → its series and numbers. */
  episodeOf: Map<string, EpisodeInfo>;
  /** Every episode of each series involved, for the full season structure. */
  episodesByParent: Map<string, EpisodeInfo[]>;
  /** Titles, years and genres for those series and episodes. */
  basics: Map<string, BasicsInfo>;
}

export interface LookupOptions {
  dir?: string;
  download?: (url: string, file: string) => Promise<void>;
}

async function downloadTo(url: string, file: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`IMDb datasets download failed (HTTP ${res.status}).`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, file);
}

async function ensureFile(name: DatasetName, opts: LookupOptions): Promise<string> {
  const dir = opts.dir ?? dataSubdir("cache/imdb");
  const file = path.join(dir, name);
  const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE_DAYS * 86400_000;
  if (!fresh) await (opts.download ?? downloadTo)(`${BASE}/${name}`, file);
  return file;
}

const nul = (v: string | undefined) => (v == null || v === "\\N" || v === "" ? null : v);
const int = (v: string | undefined) => {
  const s = nul(v);
  return s != null && /^\d+$/.test(s) ? Number(s) : null;
};

/** Stream a gzipped TSV, calling `row` for each data line (header skipped). */
async function eachRow(file: string, row: (cols: string[]) => void) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    row(line.split("\t"));
  }
}

/**
 * Two passes over title.episode (find the series of each rated episode, then every episode
 * of those series) and one over title.basics (their titles and genres).
 */
export async function lookupEpisodes(ratedEpisodeIds: Set<string>, seriesIds: Set<string>, opts: LookupOptions = {}): Promise<EpisodeLookup> {
  const episodeFile = await ensureFile("title.episode.tsv.gz", opts);
  const toInfo = (c: string[]): EpisodeInfo => ({ imdbId: c[0], parentId: c[1], season: int(c[2]), episode: int(c[3]) });

  const episodeOf = new Map<string, EpisodeInfo>();
  await eachRow(episodeFile, (c) => {
    if (ratedEpisodeIds.has(c[0])) episodeOf.set(c[0], toInfo(c));
  });
  const parents = new Set([...seriesIds, ...[...episodeOf.values()].map((e) => e.parentId)]);

  const episodesByParent = new Map<string, EpisodeInfo[]>();
  await eachRow(episodeFile, (c) => {
    if (!parents.has(c[1])) return;
    const list = episodesByParent.get(c[1]) ?? [];
    list.push(toInfo(c));
    episodesByParent.set(c[1], list);
  });

  const wanted = new Set(parents);
  for (const list of episodesByParent.values()) for (const e of list) wanted.add(e.imdbId);
  const basics = new Map<string, BasicsInfo>();
  const basicsFile = await ensureFile("title.basics.tsv.gz", opts);
  await eachRow(basicsFile, (c) => {
    if (!wanted.has(c[0])) return;
    const title = nul(c[2]) ?? c[0];
    const orig = nul(c[3]);
    basics.set(c[0], {
      imdbId: c[0],
      titleType: c[1],
      title,
      originalTitle: orig && orig !== title ? orig : null,
      year: int(c[5]),
      runtimeMin: int(c[7]),
      genres: (nul(c[8]) ?? "").split(",").filter(Boolean),
    });
  });
  return { episodeOf, episodesByParent, basics };
}
