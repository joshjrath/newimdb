import { MEDIA_TYPES, WATCH_STATUSES, type MediaType, type WatchStatus } from "./domain/types";
import { SORT_OPTIONS, type SortKey } from "./domain/sort";
import type { ListQuery } from "./repo/media";

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

const pick = <T extends string>(list: readonly T[], v: string | undefined): T | undefined => (list.includes(v as T) ? (v as T) : undefined);

/** One parser for library, Studio and API list filters. Unknown values are ignored, never errors. */
export function parseListQuery(params: Params, defaults: { sort?: SortKey; pageSize?: number } = {}): ListQuery {
  const get = (k: string): string | undefined => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const status = get("status");
  return {
    type: pick<MediaType>(MEDIA_TYPES, get("type")),
    status: status === "none" ? "none" : pick<WatchStatus>(WATCH_STATUSES, status),
    tag: get("tag"),
    withPerson: Number(get("with")) > 0 ? Number(get("with")) : undefined,
    genre: Number(get("genre")) > 0 ? Number(get("genre")) : undefined,
    q: get("q"),
    featured: get("featured") === "1" || undefined,
    sort: pick(SORT_OPTIONS.map((s) => s.key), get("sort")) ?? defaults.sort ?? "recent",
    page: Math.max(1, Number(get("page")) || 1),
    pageSize: Number(get("pageSize")) || defaults.pageSize,
  };
}
