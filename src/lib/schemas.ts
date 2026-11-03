import { z } from "zod";
import { isValidRating } from "./domain/rating";
import { EPISODE_STATES, MEDIA_TYPES, PROVIDERS, SEGMENT_KINDS, WATCH_STATUSES } from "./domain/types";

export const ratingSchema = z
  .number()
  .refine(isValidRating, "Ratings are 0.5–5 in half-star steps.")
  .nullable();

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .nullable();

const optInt = z.number().int().positive().nullable();
const optText = (max: number) => z.string().trim().max(max).nullable();

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => u === "" || /^https?:\/\//i.test(u) || u.startsWith("/api/uploads/"), "Must be an http(s) URL.")
  .transform((u) => (u === "" ? null : u))
  .nullable();

export const mediaTypeSchema = z.enum(MEDIA_TYPES);
export const statusSchema = z.enum(WATCH_STATUSES).nullable();
export const segmentKindSchema = z.enum(SEGMENT_KINDS);
export const episodeStateSchema = z.enum(EPISODE_STATES);
export const providerSchema = z.enum(PROVIDERS);

/** Every external ID is listed explicitly so validation can never silently strip one. */
export const metadataSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(300),
  originalTitle: optText(300),
  year: z.number().int().min(1870).max(2100).nullable(),
  overview: optText(5000),
  posterUrl: httpUrl,
  backdropUrl: httpUrl,
  runtimeMin: z.number().int().min(0).max(100000).nullable(),
  genres: z.array(z.string().trim().min(1).max(60)).max(30),
  tmdbId: optInt,
  imdbId: z
    .string()
    .trim()
    .regex(/^(tt\d{5,12})?$/, "IMDb IDs look like tt0903747.")
    .transform((v) => v || null)
    .nullable(),
  malId: optInt,
  tvmazeId: optInt,
  anilistId: optInt,
  letterboxdUrl: httpUrl,
  metadataSource: optText(40),
  lockedFields: z.array(z.string().max(40)).max(40),
  thirdPartyRating: z.number().min(0).max(10).nullable(),
  thirdPartyRatingSource: optText(40),
});
export const METADATA_KEYS = metadataSchema.keyof().options;

export const reviewSchema = z.object({
  rating: ratingSchema,
  ratingLabel: optText(40),
  body: z.string().max(50000),
  watchedOn: date,
  spoiler: z.boolean(),
  status: statusSchema,
  featured: z.boolean(),
  // Publishing is disabled in this release. Only "private" is accepted.
  visibility: z.literal("private"),
});

const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(50);

export const mediaPatchSchema = z
  .object({
    version: z.number().int().positive(),
    metadata: metadataSchema.partial().optional(),
    review: reviewSchema.partial().optional(),
    tags: tagsSchema.optional(),
  })
  .strict();

const segmentFields = {
  kind: segmentKindSchema,
  label: z.string().trim().min(1).max(60),
  seasonNumber: z.number().int().min(0).max(999).nullable(),
  courNumber: z.number().int().min(1).max(99).nullable(),
  provider: optText(20).optional(),
  providerRef: optText(60).optional(),
};

export const segmentInputSchema = z.object({
  id: z.number().int().positive().optional(),
  ...segmentFields,
  episodeCount: z.number().int().min(0).max(5000),
});

export const structureSchema = z.object({
  version: z.number().int().positive(),
  segments: z.array(segmentInputSchema).max(500),
  confirmLoss: z.boolean().optional(),
});

export const providerEpisodeSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().max(300).nullable(),
  airDate: z.string().max(20).nullable(),
  overview: z.string().max(5000).nullable(),
  providerRef: z.string().max(60).nullable(),
  filler: z.boolean().optional(),
});

export const createMediaSchema = z.object({
  type: mediaTypeSchema,
  metadata: metadataSchema.partial().extend({ title: metadataSchema.shape.title }),
  review: reviewSchema.partial().optional(),
  tags: tagsSchema.optional(),
  segments: z
    .array(segmentInputSchema.omit({ id: true }).extend({ episodes: z.array(providerEpisodeSchema).max(5000).optional() }))
    .max(500)
    .optional(),
});

export const assessmentSchema = z.object({
  state: episodeStateSchema.optional(),
  rating: ratingSchema.optional(),
  filler: z.boolean().optional(),
  title: optText(300).optional(),
});

export const BULK_ASSESS_ACTIONS = ["watched", "unwatched", "skipped", "rate", "rate_unrated", "filler_on", "filler_off"] as const;
export type BulkAssessAction = (typeof BULK_ASSESS_ACTIONS)[number];

export const bulkAssessSchema = z.object({
  episodeIds: z.array(z.number().int().positive()).min(1).max(5000),
  action: z.enum(BULK_ASSESS_ACTIONS),
  rating: ratingSchema.optional(),
});

export const BULK_MEDIA_ACTIONS = ["feature", "unfeature", "delete", "set_status", "add_tag", "remove_tag"] as const;
export type BulkMediaAction = (typeof BULK_MEDIA_ACTIONS)[number];

export const bulkMediaSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
  action: z.enum(BULK_MEDIA_ACTIONS),
  status: statusSchema.optional(),
  tag: z.string().trim().min(1).max(40).optional(),
});

/* ---- backup file: built from the same field schemas as the live API ---- */

export const backupEpisodeSchema = providerEpisodeSchema.omit({ providerRef: true, filler: true }).extend({
  overview: providerEpisodeSchema.shape.overview.optional(),
  state: episodeStateSchema,
  rating: ratingSchema,
  filler: z.boolean(),
  watchedAt: z.string().nullable(),
});

export const backupSegmentSchema = z.object({
  ...segmentFields,
  provider: z.string().max(20).nullable(),
  providerRef: z.string().max(60).nullable(),
  episodes: z.array(backupEpisodeSchema).max(5000),
});

export type MetadataInput = z.infer<typeof metadataSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type SegmentInput = z.infer<typeof segmentInputSchema>;
export type ProviderEpisode = z.infer<typeof providerEpisodeSchema>;
export type CreateMediaInput = z.infer<typeof createMediaSchema>;
