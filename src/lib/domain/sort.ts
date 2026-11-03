/** Library sort orders. Pure, so client components can list them too. */
export const SORT_OPTIONS = [
  { key: "recent", label: "Recently watched" },
  { key: "rating", label: "Highest rated" },
  { key: "title", label: "Title" },
  { key: "year", label: "Release year" },
  { key: "added", label: "Recently added" },
] as const;
export type SortKey = (typeof SORT_OPTIONS)[number]["key"];
