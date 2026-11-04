/**
 * What's new, in plain words, newest first. Add an entry with every update you want the
 * bell to announce; its `id` must never change once shipped. The bell shows the entries
 * that arrived with each deploy.
 */
export interface ChangelogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-11-04-update-bell",
    date: "2026-11-04",
    title: "Update notices and safer updates",
    items: [
      "This bell tells you when an update has finished and what changed.",
      "Every update makes a backup of your library first.",
      "A warning appears if your data isn't on permanent storage.",
    ],
  },
  {
    id: "2026-11-04-easier-sign-in",
    date: "2026-11-04",
    title: "Easier sign-in on Railway",
    items: ["Set your password straight in Railway's variables.", "The sign-in page says what's wrong if it can't sign you in."],
  },
  {
    id: "2026-11-04-imdb-import",
    date: "2026-11-04",
    title: "Import from IMDb",
    items: [
      "Bring in every rating from IMDb's ratings export in one go.",
      "Same-named titles stay apart, and episode ratings land in the right season.",
    ],
  },
  {
    id: "2026-11-03-specular-design",
    date: "2026-11-03",
    title: "New look",
    items: ["Specular's design, with a colour for each of Movies, TV Shows and Anime."],
  },
];
