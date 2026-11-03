import type { EpisodeState } from "./types";

export interface Assessment {
  state: EpisodeState;
  rating: number | null;
  filler: boolean;
}

export interface AssessmentPatch {
  state?: EpisodeState;
  rating?: number | null;
  filler?: boolean;
}

/**
 * The episode assessment rules, shared by the server write path, backup restore
 * and the optimistic UI:
 *  - giving a rating marks the episode watched;
 *  - any state other than watched has no rating;
 *  - filler is independent of both.
 */
export function resolveAssessment(cur: Assessment, patch: AssessmentPatch): Assessment {
  const state: EpisodeState = patch.rating != null ? "watched" : (patch.state ?? cur.state);
  const rating = state === "watched" ? (patch.rating !== undefined ? patch.rating : cur.rating) : null;
  return { state, rating, filler: patch.filler ?? cur.filler };
}

export const UNASSESSED: Assessment = { state: "unwatched", rating: null, filler: false };
