import { defaultSegmentLabel, type SegmentKind } from "../domain/types";
import { htmlToTextOrNull } from "../domain/text";
import type { ProviderEpisode } from "../schemas";
import { fetchJson, ProviderError, yearOf } from "./http";
import type { DetailsOptions, ProposedSegment, ProviderDetails, ProviderName, SearchResult } from "./types";

/** The single segment an anime entry starts with (MAL/AniList list each season as its own entry). */
function firstSegment(kind: SegmentKind, episodeCount: number, provider: ProviderName, providerRef: string, episodes?: ProviderEpisode[]): ProposedSegment[] {
  const count = Math.max(episodeCount, kind === "movie" ? 1 : 0);
  if (count === 0) return [];
  return [
    {
      kind,
      label: defaultSegmentLabel(kind, { season: kind === "season" ? 1 : null }),
      seasonNumber: kind === "season" ? 1 : null,
      courNumber: null,
      episodeCount: count,
      provider,
      providerRef,
      episodes: episodes?.length ? episodes : undefined,
    },
  ];
}

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

export async function jikanDetails(malId: string, opts: DetailsOptions = {}): Promise<ProviderDetails> {
  const warnings: string[] = [];
  // The two requests are independent; start the episode list straight away.
  const episodesP =
    opts.episodes === false
      ? Promise.resolve(undefined)
      : jikanEpisodes(malId).catch((e) => {
          warnings.push(`Episode titles unavailable (${(e as Error).message}). Episode count used instead.`);
          return undefined;
        });
  const [{ data: a }, episodes] = await Promise.all([
    fetchJson<{ data: JikanAnime }>("jikan", `${JIKAN}/anime/${encodeURIComponent(malId)}/full`),
    episodesP,
  ]);
  const kind = kindForAnimeType(a.type);
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
    segments: firstSegment(kind, Math.max(a.episodes ?? 0, episodes?.length ?? 0), "jikan", String(a.mal_id), episodes),
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
    overview: htmlToTextOrNull(m.description),
    note: [m.format, m.episodes ? `${m.episodes} episodes` : null].filter(Boolean).join(" · ") || null,
  }));
}

export interface AniRec {
  id: number;
  idMal: number | null;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  overview: string | null;
  genres: string[];
  format: string | null;
  averageScore: number | null;
  popularity: number;
  /** How many AniList users backed this recommendation. */
  votes: number;
  streaming: { site: string; url: string; icon: string | null; color: string | null }[];
}

const REC_FIELDS = `id idMal title { romaji english } startDate { year } coverImage { extraLarge large } bannerImage description(asHtml: false) genres format averageScore popularity externalLinks { site url type icon color }`;
type AniFull = { id: number; idMal: number | null; title: { romaji: string | null; english: string | null }; startDate: { year: number | null }; coverImage: { extraLarge: string | null; large: string | null }; bannerImage: string | null; description: string | null; genres: string[]; format: string | null; averageScore: number | null; popularity: number | null; externalLinks: { site: string; url: string; type: string; icon: string | null; color: string | null }[] | null };

const toAniRec = (m: AniFull, votes: number): AniRec => ({
  id: m.id,
  idMal: m.idMal,
  title: m.title.english || m.title.romaji || "Untitled",
  originalTitle: m.title.english ? m.title.romaji : null,
  year: m.startDate.year,
  posterUrl: m.coverImage.extraLarge ?? m.coverImage.large,
  backdropUrl: m.bannerImage,
  overview: htmlToTextOrNull(m.description),
  genres: m.genres ?? [],
  format: m.format,
  averageScore: m.averageScore,
  popularity: m.popularity ?? 0,
  votes,
  streaming: (m.externalLinks ?? []).filter((l) => l.type === "STREAMING").map(({ site, url, icon, color }) => ({ site, url, icon, color })),
});

/** AniList's community recommendations for an anime (by AniList id, or found by title). */
export async function anilistRecommendations(ref: { anilistId?: number | null; malId?: number | null; title?: string }): Promise<AniRec[]> {
  const q = `query ($id: Int, $mal: Int, $q: String) { Media(id: $id, idMal: $mal, search: $q, type: ANIME) { id recommendations(sort: RATING_DESC, perPage: 15) { nodes { rating mediaRecommendation { ${REC_FIELDS} isAdult } } } } }`;
  const vars = ref.anilistId ? { id: ref.anilistId } : ref.malId ? { mal: ref.malId } : { q: ref.title };
  const d = await anilist<{ Media: { recommendations: { nodes: { rating: number; mediaRecommendation: (AniFull & { isAdult?: boolean }) | null }[] } } | null }>(q, vars);
  return (d.Media?.recommendations.nodes ?? [])
    .filter((n) => n.mediaRecommendation && !n.mediaRecommendation.isAdult && n.rating > 0)
    .map((n) => toAniRec(n.mediaRecommendation!, n.rating));
}

/** Streaming links AniList knows for an anime. */
export async function anilistStreaming(id: number): Promise<AniRec["streaming"]> {
  const d = await anilist<{ Media: AniFull | null }>(`query ($id: Int) { Media(id: $id, type: ANIME) { ${REC_FIELDS} } }`, { id });
  return d.Media ? toAniRec(d.Media, 0).streaming : [];
}

/** AniList entries with this title (English or romaji), to confirm a title is anime. */
export async function anilistFind(title: string): Promise<{ titles: string[]; year: number | null; format: string | null; idMal: number | null; id: number }[]> {
  const d = await anilist<{ Page: { media: AniMedia[] } }>(
    `query ($q: String) { Page(perPage: 8) { media(search: $q, type: ANIME, isAdult: false) { id idMal title { romaji english native } synonyms startDate { year } format } } }`,
    { q: title },
  );
  return d.Page.media.map((m) => ({
    id: m.id,
    idMal: m.idMal,
    year: m.startDate.year,
    format: m.format,
    titles: [m.title.english, m.title.romaji, ...((m as AniMedia & { synonyms?: string[] }).synonyms ?? [])].filter((x): x is string => Boolean(x)),
  }));
}

export async function anilistDetails(id: string): Promise<ProviderDetails> {
  const d = await anilist<{ Media: AniMedia }>(`query ($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`, { id: Number(id) });
  const m = d.Media;
  const kind = kindForAnimeType(m.format === "TV_SHORT" ? "TV" : m.format);
  return {
    provider: "anilist",
    metadata: {
      title: m.title.english || m.title.romaji || "Untitled",
      originalTitle: m.title.english ? m.title.romaji : m.title.native,
      year: m.startDate.year,
      overview: htmlToTextOrNull(m.description),
      posterUrl: m.coverImage.extraLarge ?? m.coverImage.large,
      genres: m.genres,
      anilistId: m.id,
      malId: m.idMal,
      metadataSource: "anilist",
      thirdPartyRating: m.averageScore != null ? m.averageScore / 10 : null,
      thirdPartyRatingSource: m.averageScore != null ? "AniList" : null,
    },
    segments: firstSegment(kind, m.episodes ?? 0, "anilist", String(m.id)),
    warnings: ["AniList doesn't provide episode titles; counts only."],
  };
}
