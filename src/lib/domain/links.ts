import { TYPE_TO_CATEGORY, type MediaType } from "./types";
import { slugify } from "./text";

/** Canonical private permalink for an entry, e.g. /watch/tv/12-breaking-bad */
export function mediaHref(m: { id: number; type: MediaType; title: string }): string {
  return `/watch/${TYPE_TO_CATEGORY[m.type]}/${m.id}-${slugify(m.title)}`;
}
