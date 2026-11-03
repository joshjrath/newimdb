import type { SegmentKind } from "../domain/types";
import { fetchJson, ProviderError, yearOf } from "./http";
import type { ProposedSegment, ProviderDetails, SearchResult } from "./types";

/* ---------------- Jikan (MyAnimeList) ---------------- */

const JIKAN = "https://api.jikan.moe/v4";

interface JikanAnime {
  mal_id: number;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  type: string | null; // TV, OVA, Movie, Special, ONA
  episodes: number | null;
  year: number | null;
  aired?: { from: string | null };
  synopsis: string | null;
  images: { jpg?: { large_image_url?: string; image_url?: string }; webp?: { large_image_url?: string } };
  genres?: { name: string }[];
  themes?: { name: string }[];
  score: number | null;
  duration?: string | null;
}

export function kindForAnimeType(t: string | null | undefined): SegmentKind {
  const s = (t ?? "").toLowerCase();
  if (s === "ova" || s === "ona") return s === "ova" ? "ova" : "season";
  if (s === "movie") return "movie";
  if (s === "special" || s === "tv special") return "special";
  return "season";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function jikanSearch(q: string): Promise<SearchResult[]> {
  const r = await fetchJson<{ data: JikanAnime[] }>("jikan", `${JIKAN}/anime?q=${encodeURIComponent(q)}&limit=12&sfw=true`);
  return r.data.map((a) => ({
    provider: "jikan",
    providerId: String(a.mal_id),
    type: "anime",
    title: a.title_english || a.title,
    originalTitle: a.title_english && a.title_english !== a.title ? a.title : null,
    year: a.year ?? yearOf(a.aired?.from),
    posterUrl: a.images.jpg?.large_image_url ?? a.images.jpg?.image_url ?? null,
    overview: a.synopsis,
    note: [a.type, a.episodes ? `${a.episodes} episodes` : null].filter(Boolean).join(" · ") || null,
  }));
}

export async function jikanEpisodes(malId: string) {
  const out: { number: number; title: string | null; airDate: string | null; overview: null; providerRef: string; filler: boolean }[] = [];
  for (let page = 1; page <= 40; page++) {
    const r = await fetchJson<{
      data: { mal_id: number; title: string | null; aired: string | null; filler: boolean; recap: boolean }[];
      pagination: { has_next_page: boolean };
    }>("jikan", `${JIKAN}/anime/${encodeURIComponent(malId)}/episodes?page=${page}`);
    for (const e of r.data) {
      out.push({ number: e.mal_id, title: e.title, airDate: e.aired?.slice(0, 10) ?? null, overview: null, providerRef: `${malId}:${e.mal_id}`, filler: Boolean(e.filler) });
    }
    if (!r.pagination.has_next_page) break;
    await sleep(400); // Jikan allows ~3 requests/second
  }
  return out;
}

export async function jikanDetails(malId: string, segmentLabel?: string): Promise<ProviderDetails> {
  const { data: a } = await fetchJson<{ data: JikanAnime }>("jikan", `${JIKAN}/anime/${encodeURIComponent(malId)}/full`);
  const warnings: string[] = [];
  let episodes: Awaited<ReturnType<typeof jikanEpisodes>> | undefined;
  try {
    episodes = await jikanEpisodes(malId);
  } catch (e) {
    warnings.push(`Episode titles unavailable (${(e as Error).message}). Episode count used instead.`);
  }
  const kind = kindForAnimeType(a.type);
  const count = Math.max(a.episodes ?? 0, episodes?.length ?? 0, kind === "movie" ? 1 : 0);
  const segment: ProposedSegment = {
    kind,
    label: segmentLabel ?? (kind === "season" ? "Season 1" : kind === "movie" ? "Movie 1" : kind === "ova" ? "OVA" : "Special"),
    seasonNumber: kind === "season" ? 1 : null,
    courNumber: null,
    episodeCount: count,
    provider: "jikan",
    providerRef: String(a.mal_id),
    episodes: episodes?.length ? episodes : undefined,
  };
  return {
    provider: "jikan",
    metadata: {
      title: a.title_english || a.title,
      originalTitle: a.title_english && a.title_english !== a.title ? a.title : a.title_japanese,
      year: a.year ?? yearOf(a.aired?.from),
      overview: a.synopsis,
      posterUrl: a.images.jpg?.large_image_url ?? a.images.jpg?.image_url ?? null,
      genres: [...(a.genres ?? []), ...(a.themes ?? [])].map((g) => g.name),
      malId: a.mal_id,
      metadataSource: "jikan",
      thirdPartyRating: a.score,
      thirdPartyRatingSource: a.score ? "MyAnimeList" : null,
    },
    segments: count > 0 ? [segment] : [],
    warnings,
  };
}

/* ---------------- AniList (fallback) ---------------- */

const ANILIST = "https://graphql.anilist.co";

interface AniMedia {
  id: number;
  idMal: number | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  startDate: { year: number | null };
  coverImage: { extraLarge: string | null; large: string | null };
  description: string | null;
  episodes: number | null;
  format: string | null;
  genres: string[];
  averageScore: number | null;
}

const FIELDS = `id idMal title { romaji english native } startDate { year } coverImage { extraLarge large } description(asHtml: false) episodes format genres averageScore`;

async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetchJson<{ data: T; errors?: { message: string }[] }>("anilist", ANILIST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (r.errors?.length) throw new ProviderError("anilist", r.errors[0].message);
  return r.data;
}

export async function anilistSearch(q: string): Promise<SearchResult[]> {
  const d = await anilist<{ Page: { media: AniMedia[] } }>(
    `query ($q: String) { Page(perPage: 12) { media(search: $q, type: ANIME, isAdult: false) { ${FIELDS} } } }`,
    { q },
  );
  return d.Page.media.map((m) => ({
    provider: "anilist",
    providerId: String(m.id),
    type: "anime",
    title: m.title.english || m.title.romaji || m.title.native || "Untitled",
    originalTitle: m.title.english ? m.title.romaji : null,
    year: m.startDate.year,
    posterUrl: m.coverImage.extraLarge ?? m.coverImage.large,
    overview: m.description?.replace(/<[^>]+>/g, "") ?? null,
    note: [m.format, m.episodes ? `${m.episodes} episodes` : null].filter(Boolean).join(" · ") || null,
  }));
}

export async function anilistDetails(id: string, segmentLabel?: string): Promise<ProviderDetails> {
  const d = await anilist<{ Media: AniMedia }>(`query ($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`, { id: Number(id) });
  const m = d.Media;
  const kind = kindForAnimeType(m.format === "TV_SHORT" ? "TV" : m.format);
  const count = Math.max(m.episodes ?? 0, kind === "movie" ? 1 : 0);
  return {
    provider: "anilist",
    metadata: {
      title: m.title.english || m.title.romaji || "Untitled",
      originalTitle: m.title.english ? m.title.romaji : m.title.native,
      year: m.startDate.year,
      overview: m.description?.replace(/<[^>]+>/g, "") ?? null,
      posterUrl: m.coverImage.extraLarge ?? m.coverImage.large,
      genres: m.genres,
      anilistId: m.id,
      malId: m.idMal,
      metadataSource: "anilist",
      thirdPartyRating: m.averageScore != null ? m.averageScore / 10 : null,
      thirdPartyRatingSource: m.averageScore != null ? "AniList" : null,
    },
    segments:
      count > 0
        ? [{ kind, label: segmentLabel ?? (kind === "season" ? "Season 1" : kind === "movie" ? "Movie 1" : "OVA"), seasonNumber: kind === "season" ? 1 : null, courNumber: null, episodeCount: count, provider: "anilist", providerRef: String(m.id) }]
        : [],
    warnings: ["AniList doesn't provide episode titles; counts only."],
  };
}
