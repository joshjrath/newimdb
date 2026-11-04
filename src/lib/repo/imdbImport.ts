import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataSubdir, getDb, nowIso, type DB } from "../db";
import { guessMediaType, imdbKind, isLikelyAnimeCandidate, type ImdbRating } from "../domain/imdb";
import { defaultSegmentLabel, MEDIA_TYPES, type MediaType } from "../domain/types";
import type { EpisodeLookup } from "../imdb/datasets";
import { audit } from "./audit";
import { fillEmptyMetadata, insertMedia, restoreAssessments, titleMatcher, touchWatched } from "./media";

/**
 * A one-time IMDb ratings import, in two steps: build a plan (preview), then commit it
 * with the owner's corrections. The plan is kept on disk so 8,000 rows don't have to
 * travel back and forth; only the owner's overrides do.
 */

export interface PlanEpisode {
  imdbId: string;
  episode: number;
  title: string | null;
  /** IMDb only knows the year; "TBA" when it doesn't even know that (not out yet). */
  airDate: string | null;
  rating: number | null;
  ratedOn: string | null;
}

export interface PlanTitle {
  imdbId: string;
  kind: "movie" | "show";
  guess: MediaType;
  /** Animated titles are worth a second look: the anime guess is a heuristic. */
  animated: boolean;
  title: string;
  originalTitle: string | null;
  year: number | null;
  genres: string[];
  runtimeMin: number | null;
  imdbRating: number | null;
  titleType: string;
  /** The owner's own rating of the film or the series itself (not its episodes). */
  rating: number | null;
  ratedOn: string | null;
  /** Full season structure when the episode lookup ran. */
  seasons: { season: number; episodes: PlanEpisode[] }[];
  ratedEpisodes: number;
  existingId: number | null;
}

export interface ImdbPlan {
  id: string;
  createdAt: string;
  titles: PlanTitle[];
  unresolved: { imdbId: string; title: string; rating: number; reason: string }[];
  skipped: { imdbId: string; title: string; titleType: string }[];
  invalid: number;
  lookup: { used: boolean; error: string | null };
}

const existingByImdb = (db: DB, imdbId: string) =>
  (db.prepare(`SELECT id FROM media WHERE imdb_id = ? ORDER BY id LIMIT 1`).get(imdbId) as { id: number } | undefined)?.id ?? null;

/**
 * Is this title already in the library? First by IMDb id; otherwise by title and year,
 * because entries from Letterboxd or added by hand often have no IMDb id. One title is
 * only ever reviewed once.
 */
function existingFinder(db: DB) {
  const matchers = new Map<MediaType, ReturnType<typeof titleMatcher>>();
  const matcher = (type: MediaType) => {
    if (!matchers.has(type)) matchers.set(type, titleMatcher(type, db));
    return matchers.get(type)!;
  };
  return (t: { imdbId: string; kind: "movie" | "show"; title: string; originalTitle: string | null; year: number | null }): number | null => {
    const byId = existingByImdb(db, t.imdbId);
    if (byId) return byId;
    const types: MediaType[] = t.kind === "movie" ? ["movie", "anime"] : ["tv", "anime"];
    for (const type of types) {
      const hit = matcher(type)(t.title, t.year) ?? (t.originalTitle ? matcher(type)(t.originalTitle, t.year) : null);
      if (hit) return hit;
    }
    return null;
  };
}

const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export function buildImdbPlan(rows: ImdbRating[], invalid: number, lookup: EpisodeLookup | null, lookupError: string | null = null, db = getDb()): ImdbPlan {
  const titles = new Map<string, PlanTitle>();
  const findExisting = existingFinder(db);
  const unresolved: ImdbPlan["unresolved"] = [];
  const skipped: ImdbPlan["skipped"] = [];

  const addTitle = (t: Omit<PlanTitle, "guess" | "animated" | "seasons" | "ratedEpisodes" | "existingId">) => {
    const pt: PlanTitle = {
      ...t,
      guess: guessMediaType(t.kind === "movie" ? "movie" : "series", t.genres, t.title, t.originalTitle),
      animated: isLikelyAnimeCandidate(t.genres),
      seasons: [],
      ratedEpisodes: 0,
      existingId: findExisting(t),
    };
    titles.set(t.imdbId, pt);
    return pt;
  };

  const episodes: ImdbRating[] = [];
  for (const r of rows) {
    const kind = imdbKind(r.titleType);
    if (kind === "skip") skipped.push({ imdbId: r.imdbId, title: r.title, titleType: r.titleType });
    else if (kind === "episode") episodes.push(r);
    else {
      const { imdbId, title, originalTitle, year, genres, runtimeMin, imdbRating, titleType, rating, ratedOn } = r;
      addTitle({ imdbId, kind: kind === "movie" ? "movie" : "show", title, originalTitle, year, genres, runtimeMin, imdbRating, titleType, rating, ratedOn });
    }
  }

  if (!lookup) {
    for (const e of episodes) unresolved.push({ imdbId: e.imdbId, title: e.title, rating: e.rating, reason: lookupError ? `Episode lookup failed: ${lookupError}` : "Episode lookup was turned off." });
  } else {
    // Make sure every series a rated episode belongs to exists in the plan.
    const rated = new Map(episodes.map((e) => [e.imdbId, e]));
    for (const e of episodes) {
      const info = lookup.episodeOf.get(e.imdbId);
      if (!info) {
        unresolved.push({ imdbId: e.imdbId, title: e.title, rating: e.rating, reason: "Not found in IMDb's episode list." });
        continue;
      }
      if (info.season == null || info.episode == null) {
        unresolved.push({ imdbId: e.imdbId, title: e.title, rating: e.rating, reason: "IMDb has no season or episode number for it." });
        continue;
      }
      if (!titles.has(info.parentId)) {
        const b = lookup.basics.get(info.parentId);
        addTitle({
          imdbId: info.parentId,
          kind: "show",
          title: b?.title ?? `Unknown series ${info.parentId}`,
          originalTitle: b?.originalTitle ?? null,
          year: b?.year ?? null,
          genres: b?.genres ?? [],
          runtimeMin: b?.runtimeMin ?? null,
          imdbRating: null,
          titleType: b?.titleType ?? "tvSeries",
          rating: null,
          ratedOn: null,
        });
      }
    }
    // Season structure for every show: all of IMDb's numbered episodes, rated ones carrying the owner's rating.
    for (const t of titles.values()) {
      if (t.kind !== "show") continue;
      const bySeason = new Map<number, Map<number, PlanEpisode>>();
      for (const info of lookup.episodesByParent.get(t.imdbId) ?? []) {
        if (info.season == null || info.episode == null || info.episode < 1) continue;
        const r = rated.get(info.imdbId);
        const season = bySeason.get(info.season) ?? new Map<number, PlanEpisode>();
        if (!season.has(info.episode) || r) {
          const b = lookup.basics.get(info.imdbId);
          season.set(info.episode, { imdbId: info.imdbId, episode: info.episode, title: b?.title ?? null, airDate: b ? (b.year != null ? String(b.year) : "TBA") : null, rating: r?.rating ?? null, ratedOn: r?.ratedOn ?? null });
        }
        bySeason.set(info.season, season);
      }
      t.seasons = [...bySeason.entries()]
        .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b)) // specials (season 0) go last
        .map(([season, eps]) => ({ season, episodes: [...eps.values()].sort((a, b) => a.episode - b.episode) }));
      const ratedEps = t.seasons.flatMap((s) => s.episodes).filter((e) => e.rating != null);
      t.ratedEpisodes = ratedEps.length;
      t.ratedOn = ratedEps.reduce((d, e) => latest(d, e.ratedOn), t.ratedOn);
    }
  }

  return {
    id: crypto.randomBytes(12).toString("hex"),
    createdAt: nowIso(),
    titles: [...titles.values()].sort((a, b) => (b.ratedOn ?? "").localeCompare(a.ratedOn ?? "")),
    unresolved,
    skipped,
    invalid,
    lookup: { used: Boolean(lookup), error: lookupError },
  };
}

/* ---- plan storage ---- */

const planFile = (id: string) => {
  if (!/^[0-9a-f]{24}$/.test(id)) throw new Error("Unknown import.");
  return path.join(dataSubdir("cache/imdb-plans"), `${id}.json`);
};

export function savePlan(plan: ImdbPlan) {
  fs.writeFileSync(planFile(plan.id), JSON.stringify(plan), { mode: 0o600 });
}

export function loadPlan(id: string): ImdbPlan | null {
  try {
    return JSON.parse(fs.readFileSync(planFile(id), "utf8")) as ImdbPlan;
  } catch {
    return null;
  }
}

export function discardPlan(id: string) {
  try {
    fs.unlinkSync(planFile(id));
  } catch {}
}

/** What the browser gets: everything except the per-episode lists. */
export function planSummary(plan: ImdbPlan) {
  return {
    id: plan.id,
    titles: plan.titles.map(({ seasons, ...t }) => ({ ...t, seasonCount: seasons.length, episodeCount: seasons.reduce((n, s) => n + s.episodes.length, 0) })),
    unresolved: plan.unresolved,
    skipped: plan.skipped,
    invalid: plan.invalid,
    lookup: plan.lookup,
  };
}

/* ---- commit ---- */

export const imdbCommitSchema = z.object({
  planId: z.string().regex(/^[0-9a-f]{24}$/),
  /** imdbId → the owner's choice, when it differs from the guess. */
  overrides: z.record(z.string().regex(/^tt\d{5,12}$/), z.enum([...MEDIA_TYPES, "skip"])),
  /** "fill": only set ratings that are empty here. "overwrite": IMDb's rating wins. */
  mode: z.enum(["fill", "overwrite"]),
});

const imdbUrl = (id: string) => `https://www.imdb.com/title/${id}/`;

function recordImport(db: DB, imdbId: string, mediaId: number, decision: string) {
  db.prepare(
    `INSERT INTO import_record (source, external_id, media_id, decision, imported_at) VALUES ('imdb', ?, ?, ?, ?)
     ON CONFLICT(source, external_id) DO UPDATE SET media_id=excluded.media_id, decision=excluded.decision, imported_at=excluded.imported_at`,
  ).run(imdbId, mediaId, decision, nowIso());
}

const segmentsOf = (t: PlanTitle) =>
  t.seasons.map((s) => ({
    kind: (s.season === 0 ? "special" : "season") as "special" | "season",
    label: defaultSegmentLabel("season", { season: s.season }),
    seasonNumber: s.season,
    courNumber: null,
    episodeCount: Math.max(0, ...s.episodes.map((e) => e.episode)),
    episodes: s.episodes.map((e) => ({ number: e.episode, title: e.title, airDate: e.airDate ?? null, overview: null, providerRef: e.imdbId })),
  }));

const assessmentsOf = (eps: PlanEpisode[]) =>
  eps.filter((e) => e.rating != null).map((e) => ({ number: e.episode, state: "watched" as const, rating: e.rating, filler: false, watchedAt: e.ratedOn }));

/** Create the entry for one plan title. Returns rated-episode count written. */
function createTitle(db: DB, t: PlanTitle, type: MediaType): { id: number; episodes: number } {
  const asMovie = type === "movie";
  const id = insertMedia(
    {
      type,
      metadata: {
        title: t.title,
        originalTitle: t.originalTitle,
        year: t.year,
        genres: t.genres,
        runtimeMin: t.runtimeMin,
        imdbId: t.imdbId,
        metadataSource: "imdb",
        thirdPartyRating: t.imdbRating,
        thirdPartyRatingSource: t.imdbRating != null ? "IMDb" : null,
      },
      review: { rating: t.rating, watchedOn: asMovie ? t.ratedOn : null, status: asMovie ? "completed" : null, visibility: "private" },
      segments: asMovie ? [] : segmentsOf(t),
    },
    { source: "imdb", sourceRef: imdbUrl(t.imdbId) },
    db,
  );
  let episodes = 0;
  if (!asMovie) {
    const segIds = (db.prepare(`SELECT id FROM segment WHERE media_id = ? ORDER BY position`).all(id) as { id: number }[]).map((r) => r.id);
    t.seasons.forEach((s, i) => {
      const a = assessmentsOf(s.episodes);
      restoreAssessments(db, segIds[i], a);
      episodes += a.length;
    });
  }
  // Recently Watched follows when you rated it on IMDb, not when it was imported.
  db.prepare(`UPDATE review SET last_watched_at = ? WHERE media_id = ?`).run(t.ratedOn, id);
  return { id, episodes };
}

/** Merge into an entry that already exists here (same IMDb id). Never deletes anything. */
function mergeTitle(db: DB, id: number, t: PlanTitle, mode: "fill" | "overwrite"): { episodes: number; notPlaced: number } {
  const source = (db.prepare(`SELECT source FROM review WHERE media_id = ?`).get(id) as { source: string } | undefined)?.source;
  // Letterboxd's rating and review always win over IMDb's.
  if (t.rating != null && source !== "letterboxd") {
    db.prepare(`UPDATE review SET rating = ?, updated_at = ? WHERE media_id = ? AND (? = 'overwrite' OR rating IS NULL)`).run(t.rating, nowIso(), id, mode);
  }
  // Remember the IMDb id (so the next import matches instantly) and fill any empty details.
  fillEmptyMetadata(id, { imdbId: t.imdbId, year: t.year, originalTitle: t.originalTitle, genres: t.genres, runtimeMin: t.runtimeMin, thirdPartyRating: t.imdbRating, thirdPartyRatingSource: t.imdbRating != null ? "IMDb" : null }, db);
  if (t.ratedOn) touchWatched(db, id, t.ratedOn);
  const segs = db.prepare(`SELECT id, season_number FROM segment WHERE media_id = ? AND cour_number IS NULL`).all(id) as { id: number; season_number: number | null }[];
  const hasAny = Boolean(db.prepare(`SELECT 1 FROM segment WHERE media_id = ?`).get(id));
  let episodes = 0,
    notPlaced = 0;
  t.seasons.forEach((s, i) => {
    const rated = s.episodes.filter((e) => e.rating != null);
    if (!rated.length && hasAny) return;
    let seg = segs.find((x) => x.season_number === s.season);
    if (!seg && !hasAny) {
      // No structure yet: add IMDb's.
      const [def] = segmentsOf({ ...t, seasons: [s] });
      const segId = (db.prepare(
        `INSERT INTO segment (media_id, kind, label, season_number, cour_number, position, created_at, updated_at) VALUES (?,?,?,?,NULL,?,?,?) RETURNING id`,
      ).get(id, def.kind, def.label, s.season, i, nowIso(), nowIso()) as { id: number }).id;
      const ins = db.prepare(`INSERT OR IGNORE INTO episode (segment_id, number, title, provider_ref) VALUES (?,?,?,?)`);
      for (let n = 1; n <= def.episodeCount; n++) {
        const e = s.episodes.find((x) => x.episode === n);
        ins.run(segId, n, e?.title ?? null, e?.imdbId ?? null);
      }
      seg = { id: segId, season_number: s.season };
    }
    if (!seg) {
      notPlaced += rated.length;
      return;
    }
    for (const e of rated) {
      const ep = db.prepare(`SELECT e.id, a.state FROM episode e LEFT JOIN episode_assessment a ON a.episode_id = e.id WHERE e.segment_id = ? AND e.number = ?`).get(seg.id, e.episode) as
        | { id: number; state: string | null }
        | undefined;
      if (!ep) {
        notPlaced++;
        continue;
      }
      if (mode === "fill" && ep.state && ep.state !== "unwatched") continue;
      restoreAssessments(db, seg.id, assessmentsOf([e]));
      episodes++;
    }
  });
  if (!hasAny && t.seasons.length) db.prepare(`UPDATE media SET version = version + 1 WHERE id = ?`).run(id);
  return { episodes, notPlaced };
}

export function commitImdbPlan(plan: ImdbPlan, overrides: Record<string, MediaType | "skip">, mode: "fill" | "overwrite", db = getDb()) {
  const counts = { created: 0, updated: 0, skipped: 0, episodes: 0, notPlaced: 0, byType: { movie: 0, tv: 0, anime: 0 } as Record<MediaType, number> };
  db.transaction(() => {
    const findExisting = existingFinder(db);
    for (const t of plan.titles) {
      const choice = overrides[t.imdbId] ?? t.guess;
      if (choice === "skip") {
        counts.skipped++;
        continue;
      }
      const existing = findExisting(t);
      if (existing) {
        const r = mergeTitle(db, existing, t, mode);
        counts.updated++;
        counts.episodes += r.episodes;
        counts.notPlaced += r.notPlaced;
        recordImport(db, t.imdbId, existing, `merge_${mode}`);
      } else {
        const r = createTitle(db, t, choice);
        counts.created++;
        counts.byType[choice]++;
        counts.episodes += r.episodes;
        recordImport(db, t.imdbId, r.id, "create");
      }
    }
    audit(db, "import_imdb", "import", plan.id, counts);
  })();
  return counts;
}
