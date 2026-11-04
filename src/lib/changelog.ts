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
    id: "2026-11-04-anime-sorting-and-no-duplicates",
    date: "2026-11-04",
    title: "Anime in the right place, and no more duplicates",
    items: [
      "Anime filed under TV Shows or Movies (like Bleach) moves to Anime by itself, checked against TVmaze, AniList and TMDB.",
      "Move any title between Movies, TV Shows and Anime from Studio's \"Move to\" menu; your choice is never changed again.",
      "Duplicates are merged automatically after every import and in the background, matching English or original titles and years one apart. Letterboxd's review always wins.",
    ],
  },
  {
    id: "2026-11-04-posters-automatic",
    date: "2026-11-04",
    title: "Posters fill in by themselves",
    items: [
      "Any show, anime or movie missing a poster now gets one in the background, with no button to press.",
      "The new-episode check also picks up a show's poster.",
    ],
  },
  {
    id: "2026-11-04-genres-and-new-episodes",
    date: "2026-11-04",
    title: "Genre filters, new episodes and faster rating",
    items: [
      "Add the genres you care about (True Crime, Superhero, Action…) in Settings; every title that fits is tagged straight away, and new ones as they arrive.",
      "Filter any library page by genre, and add or remove a genre on a title from its Studio page.",
      "Shows and anime check for new episodes by themselves, so there's no need to re-import.",
      "Episodes that aren't out yet show as TBA and don't count against your progress.",
      "Rate episodes from the keyboard: select a cell and type a number, use arrows to move, shift-click to select a range, and edit seasons right on the title's page.",
    ],
  },
  {
    id: "2026-11-04-posters-and-duplicates",
    date: "2026-11-04",
    title: "Posters, and one review per title",
    items: [
      "Titles imported from IMDb get their posters filled in automatically.",
      "A film from both Letterboxd and IMDb is only kept once, with Letterboxd's rating and review.",
      "Import & backup can merge any duplicates already in your library.",
      "Library pages end on a full row, with no empty slot.",
    ],
  },
  {
    id: "2026-11-04-watched-with",
    date: "2026-11-04",
    title: "Who you watched with",
    items: [
      "Add the people you watch with in Settings.",
      "On any title, pick everyone who watched it with you: nobody, one person or several.",
      "Filter your library by who you watched with, and add or remove people on many titles at once in Studio.",
    ],
  },
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
