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
type DatasetName = "title.episode.tsv.gz" | "title.basics.tsv.gz" | "title.ratings.tsv.gz";

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

export interface LookupProgress {
  stage: string;
  /** 0–1 when known. */
  fraction: number | null;
}

export interface LookupOptions {
  dir?: string;
  download?: (url: string, file: string, onBytes?: (done: number, total: number | null) => void) => Promise<void>;
  onProgress?: (p: LookupProgress) => void;
}

async function downloadTo(url: string, file: string, onBytes?: (done: number, total: number | null) => void) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`IMDb datasets download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || null;
  const tmp = `${file}.part`;
  const body = Readable.fromWeb(res.body as never);
  let done = 0;
  body.on("data", (chunk: Buffer) => {
    done += chunk.length;
    onBytes?.(done, total);
  });
  await pipeline(body, fs.createWriteStream(tmp));
  fs.renameSync(tmp, file); // only a complete file ever gets the real name
}

async function ensureFile(name: DatasetName, label: string, opts: LookupOptions): Promise<string> {
  const dir = opts.dir ?? dataSubdir("cache/imdb");
  const file = path.join(dir, name);
  const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE_DAYS * 86400_000;
  if (!fresh) {
    opts.onProgress?.({ stage: `Downloading ${label}`, fraction: null });
    await (opts.download ?? downloadTo)(`${BASE}/${name}`, file, (done, total) =>
      opts.onProgress?.({ stage: `Downloading ${label}`, fraction: total ? done / total : null }),
    );
  }
  return file;
}

const nul = (v: string | undefined) => (v == null || v === "\\N" || v === "" ? null : v);
const int = (v: string | undefined) => {
  const s = nul(v);
  return s != null && /^\d+$/.test(s) ? Number(s) : null;
};

/** Stream a gzipped TSV, calling `row` for each data line (header skipped). */
async function eachRow(file: string, row: (cols: string[]) => void, onFraction?: (f: number) => void) {
  const size = fs.statSync(file).size;
  const input = fs.createReadStream(file);
  let read = 0;
  input.on("data", (chunk) => {
    read += chunk.length;
    onFraction?.(size ? read / size : 0);
  });
  const rl = readline.createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
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
  const step = (stage: string) => (f: number) => opts.onProgress?.({ stage, fraction: f });
  const episodeFile = await ensureFile("title.episode.tsv.gz", "IMDb's episode list", opts);
  const toInfo = (c: string[]): EpisodeInfo => ({ imdbId: c[0], parentId: c[1], season: int(c[2]), episode: int(c[3]) });

  const episodeOf = new Map<string, EpisodeInfo>();
  await eachRow(episodeFile, (c) => {
    if (ratedEpisodeIds.has(c[0])) episodeOf.set(c[0], toInfo(c));
  }, step("Finding the show for each rated episode"));
  const parents = new Set([...seriesIds, ...[...episodeOf.values()].map((e) => e.parentId)]);

  const episodesByParent = new Map<string, EpisodeInfo[]>();
  await eachRow(episodeFile, (c) => {
    if (!parents.has(c[1])) return;
    const list = episodesByParent.get(c[1]) ?? [];
    list.push(toInfo(c));
    episodesByParent.set(c[1], list);
  }, step("Building each show's seasons"));

  const wanted = new Set(parents);
  for (const list of episodesByParent.values()) for (const e of list) wanted.add(e.imdbId);
  const basics = new Map<string, BasicsInfo>();
  const basicsFile = await ensureFile("title.basics.tsv.gz", "IMDb's title list", opts);
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
  }, step("Reading episode titles and genres"));
  return { episodeOf, episodesByParent, basics };
}

/** IMDb's public rating (out of 10) and vote count for these titles, from IMDb's daily file. */
export async function imdbRatings(ids: Set<string>, opts: LookupOptions = {}): Promise<Map<string, { rating: number; votes: number }>> {
  const out = new Map<string, { rating: number; votes: number }>();
  if (!ids.size) return out;
  const file = await ensureFile("title.ratings.tsv.gz", "IMDb's ratings", opts);
  await eachRow(file, (c) => {
    if (ids.has(c[0])) out.set(c[0], { rating: Number(c[1]), votes: Number(c[2]) });
  });
  return out;
}

/**
 * IMDb's episode and title files are large (≈250 MB), so they're deleted a day after
 * they were last needed; an import or repair downloads them again if it ever needs them.
 */
export function pruneDatasetCache(maxAgeHours = 24, dir = dataSubdir("cache/imdb")): number {
  let freed = 0;
  for (const name of ["title.episode.tsv.gz", "title.basics.tsv.gz"]) {
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (Date.now() - Math.max(st.mtimeMs, st.atimeMs) > maxAgeHours * 3600_000) {
        fs.rmSync(file, { force: true });
        freed += st.size;
      }
    } catch {}
    fs.rmSync(`${file}.part`, { force: true });
  }
  return freed;
}
