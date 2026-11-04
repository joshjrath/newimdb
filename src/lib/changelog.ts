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
    id: "2026-11-04-sort-both-ways",
    date: "2026-11-04",
    title: "Sort both ways, and more quick filters",
    items: [
      "A new sort menu with an ↑↓ arrow to reverse any sort: Recently ↔ Oldest watched, Highest ↔ Lowest rated, A→Z ↔ Z→A and more.",
      "Watched with: tap several people to see only what you watched with all of them.",
      "Select mode on Movies has Theater and Streaming buttons.",
      "One-time tidy-up: shows you started but haven't touched in 6 months are set to Dropped (watch an episode to bring one back).",
      "Episode grids have an Unwatched filter and Hide filler.",
    ],
  },
  {
    id: "2026-11-04-anime-filler-progress",
    date: "2026-11-04",
    title: "Anime filler doesn't count against you",
    items: [
      "For anime, filler you haven't watched is left out of % watched, so finishing every canon episode is 100% (and Completed).",
      "Up next skips filler, and time left on a show doesn't include it. Filler you did watch still counts.",
      "When a show you've completed gets a new episode or season, it moves back to Currently watching by itself.",
    ],
  },
  {
    id: "2026-11-04-smarter-picks-views-filler",
    date: "2026-11-04",
    title: "Smarter picks, anime views, filler, and select many",
    items: [
      "Recommended learns from every rating you've given (genres, keywords, studios, decades), needs two or more of your favourites behind each pick, and shows its IMDb rating.",
      "Anime pages can group episodes by story order, release order, seasons, cours, your own arcs, or one long run.",
      "Filler episodes are marked automatically from animefillerlist.com.",
      "Tap Select on any library page to pick many titles and add who you watched with, a tag, a genre, a status or a list in one go.",
      "Placeholder seasons IMDb lists before they exist (like Spider-Man's Season 2–4) are removed.",
    ],
  },
  {
    id: "2026-11-04-stats-recs-lists",
    date: "2026-11-04",
    title: "Recommended, Lists, Statistics, and fairer automatic status",
    items: [
      "Recommended: picks for Anime, TV and Movies from your ratings and favourite genres, with where to watch them (Netflix, Hulu, Apple TV+…). Add to Plan to watch in one tap.",
      "Lists: make your own (an MCU list, comfort shows…), mixing movies, shows and anime, in your own order or by release, with a progress bar.",
      "Statistics: time watched, watched per month, who you watch with, ratings, top genres, your theater trips on a timeline, and time left on shows you've started.",
      "Automatic status no longer counts episodes that aren't out (or undated placeholders) against you, and the 30/90-day clock starts today for every show.",
      "Movies: mark where you watched them (theater or streaming).",
    ],
  },
  {
    id: "2026-11-04-episode-fixes-airing-grouping",
    date: "2026-11-04",
    title: "Fixed episode counts, Currently airing, and grouped anime",
    items: [
      "Shows the new-episode check had inflated (like Bleach at ~700 episodes) are put back to IMDb's seasons. The check can no longer add episodes that don't line up.",
      "New seasons only count episodes with a real air date as out.",
      "TV Shows and Anime have Currently airing (until the finale, back for the next premiere) and Upcoming rows.",
      "Anime films, OVAs and extra seasons are grouped into their series (JJK 0 and Season 2 inside Jujutsu Kaisen); Naruto Shippuden and Bleach: TYBW stay separate.",
      "Marvel, DC, Star Wars, Pixar, Ghibli and A24 genre filters match by title, studio and franchise. Filters you'd already added are upgraded.",
    ],
  },
  {
    id: "2026-11-04-new-seasons",
    date: "2026-11-04",
    title: "New seasons of shows you finished",
    items: [
      "TV Shows and Anime open with a \"New seasons\" row: shows you'd finished that are back, with how many new episodes are out, or when an announced season starts.",
      "Their cards get a \"New\" or \"Soon\" badge that jumps straight to the new season. Set a show to Dropped to hide it.",
      "An announced episode IMDb only lists by this year (like the next Tires premiere) no longer counts against your progress.",
    ],
  },
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
