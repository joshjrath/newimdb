import type { EpisodeState } from "./types";

export interface Assessment {
  state: EpisodeState;
  rating: number | null;
  filler: boolean;
  /** One of your favourite episodes (only ever on a watched one). */
  favorite?: boolean;
}

export interface AssessmentPatch {
  state?: EpisodeState;
  rating?: number | null;
  filler?: boolean;
  favorite?: boolean;
}

/**
 * The episode assessment rules, shared by the server write path, backup restore
 * and the optimistic UI:
 *  - giving a rating marks the episode watched;
 *  - any state other than watched has no rating;
 *  - filler is independent of both;
 *  - favouriting an episode marks it watched, and only watched episodes stay favourites.
 */
export function resolveAssessment(cur: Assessment, patch: AssessmentPatch): Assessment {
  const state: EpisodeState = patch.rating != null || patch.favorite === true ? "watched" : (patch.state ?? cur.state);
  const rating = state === "watched" ? (patch.rating !== undefined ? patch.rating : cur.rating) : null;
  const favorite = state === "watched" ? (patch.favorite ?? Boolean(cur.favorite)) : false;
  return { state, rating, filler: patch.filler ?? cur.filler, favorite };
}

export const UNASSESSED: Assessment = { state: "unwatched", rating: null, filler: false, favorite: false };
