/** Library sort orders. Pure, so client components can list them too. */
export const SORT_OPTIONS = [
  { key: "recent", label: "Recently watched", reverse: "Oldest watched", natural: "desc" },
  { key: "rating", label: "My rating: highest", reverse: "My rating: lowest", natural: "desc" },
  { key: "imdb", label: "IMDb rating: highest", reverse: "IMDb rating: lowest", natural: "desc" },
  { key: "title", label: "Title A → Z", reverse: "Title Z → A", natural: "asc" },
  { key: "year", label: "Newest releases", reverse: "Oldest releases", natural: "desc" },
  { key: "added", label: "Recently added", reverse: "First added", natural: "desc" },
  { key: "progress", label: "Most progress", reverse: "Least progress", natural: "desc" },
] as const;
export type SortKey = (typeof SORT_OPTIONS)[number]["key"];
export type SortDir = "asc" | "desc";

/** The label for a sort in a direction ("Recently watched" ↔ "Oldest watched"). */
export function sortLabel(key: SortKey, dir?: SortDir): string {
  const o = SORT_OPTIONS.find((s) => s.key === key) ?? SORT_OPTIONS[0];
  return !dir || dir === o.natural ? o.label : o.reverse;
}

export const naturalDir = (key: SortKey): SortDir => (SORT_OPTIONS.find((s) => s.key === key)?.natural ?? "desc") as SortDir;
