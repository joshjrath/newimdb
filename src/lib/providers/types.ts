import type { MediaType, SegmentKind } from "../domain/types";
import type { MetadataInput, ProviderEpisode } from "../schemas";

export type ProviderName = "tmdb" | "tvmaze" | "jikan" | "anilist";

export interface SearchResult {
  provider: ProviderName;
  providerId: string;
  type: MediaType;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  note: string | null; // e.g. "TV · 28 episodes"
}

export interface ProposedSegment {
  kind: SegmentKind;
  label: string;
  seasonNumber: number | null;
  courNumber: number | null;
  episodeCount: number;
  provider: ProviderName;
  providerRef: string;
  episodes?: ProviderEpisode[];
}

export interface ProviderDetails {
  provider: ProviderName;
  metadata: Partial<MetadataInput> & { title: string };
  segments: ProposedSegment[];
  warnings: string[];
}
