# Watch Journal

A private, owner-only journal for **Movies**, **TV Shows** and **Anime**. You can write reviews, rate every episode on a heatmap, manage seasons, cours, OVAs, movies and specials, import from Letterboxd, keep backups, and make Instagram-ready review images.

Everything is private in this release. No page, API, image or export can be opened without signing in as the owner.

## Quick start

Requires Node 22.18 or newer (the `scripts/*.ts` helpers run directly with Node's built-in TypeScript support).

```bash
npm install
cp .env.example .env.local       # set OWNER_PASSWORD (12+ characters)
npm run build && npm start       # http://localhost:3000
```

Optional sample content (clearly marked "SAMPLE", tagged `Sample`):

```bash
OWNER_PASSWORD='your password' npm run seed
```

Development: `npm run dev` (any password length is accepted there).

### Environment

| Variable | Purpose |
|---|---|
| `OWNER_PASSWORD` | **Required** (or the hash below). The sign-in password; at least 12 characters on a live site. |
| `OWNER_PASSWORD_HASH` | Optional instead: a scrypt hash from `npm run hash-password`. Used first when set. |
| `DATA_DIR` | Database, uploads, poster cache and backups. Default: a Railway volume's mount path when one is attached, else `./data`. Keep it private and backed up. |
| `TMDB_READ_TOKEN` / `TMDB_API_KEY` | Optional. Enables movie search and the preferred TV provider. |
| `PROVIDER_TIMEOUT_MS` | Per-provider timeout before falling back. Default 6000. |
| `COOKIE_SECURE` | Optional. The sign-in cookie is Secure automatically over https; set `true`/`false` only to force it. |

## Hosting

### Railway (no local setup needed)
1. Deploy this repo/branch as a service. Railway runs `npm run build` and `npm start` on its own.
2. **Variables:** add `OWNER_PASSWORD` (12+ characters). Optionally `TMDB_READ_TOKEN`.
3. **Volume:** add a volume to the service (any mount path, e.g. `/data`). The app stores everything there automatically. Without it, every deploy wipes your library.
4. Redeploy, open the Railway URL, sign in.

The app uses SQLite on local disk, so it needs a host with a **persistent filesystem**: a VPS, Fly.io with a volume, Railway with a volume, or a home server. Serverless hosting without persistent disk, such as default Vercel, would lose data. Moving to Postgres later only means swapping the repository layer in `src/lib/repo/`.

Back up `DATA_DIR`. `npm run backup` writes a consistent SQLite snapshot to `DATA_DIR/backups/` and is safe to run while the app is up (for example from cron). Studio → Import & backup also exports and restores a full JSON backup, and every restore takes a snapshot first.

### Updates never touch your data
- Your library lives only in the database on the volume (`DATA_DIR`). Deploying new code never deletes or rewrites it. Database changes only ever add things, and a full copy is saved to `DATA_DIR/backups/` before any of them runs.
- Every new deploy also saves an automatic backup. The newest 10 automatic backups are kept; backups you make yourself are never deleted.
- On Railway, if the data isn't on a volume (and so would be wiped by the next deploy), a red warning shows on every page and in the update bell.

### Update bell
The bell at the top right shows each deploy with what changed, and a badge for ones you haven't opened. A yellow "Update complete" card appears after a deploy, including one that finishes while the site is open (with a Reload button). The "what changed" text comes from `src/lib/changelog.ts`: add an entry there with each update you want announced. Otherwise the bell shows the commit message.

## Privacy model

- **Server-side checks everywhere.** Every page calls `requireOwnerPage()` and every API route is wrapped in `ownerApi()`. Both check the session token against the database. The middleware redirect is only a convenience; security doesn't depend on it.
- Sessions are random 256-bit tokens, stored only as SHA-256 hashes, in an httpOnly, SameSite=Lax cookie, marked Secure whenever the site is served over https. Failed logins are throttled.
- Writes need a same-origin `Origin` header (CSRF protection) and a JSON body.
- No static generation: every route is dynamic. Responses send `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` and a strict CSP. `robots.txt` blocks everything (courtesy only, not security).
- Posters are fetched through an authenticated proxy (`/api/poster`) limited to known image hosts. It follows redirects only to those same hosts and checks the actual image bytes. So `img-src 'self'` holds, and the browser never contacts third parties directly.
- Uploaded images are checked by magic bytes and served only to the owner.
- **Publishing is switched off.** `visibility` exists in the schema for a future opt-in, but the database `CHECK` and the API both accept only `private`. Turning on publishing would need a migration and a new explicit decision.
- Letterboxd is **import only**. Nothing is ever posted anywhere. The Instagram image is drawn in the browser and downloaded.

## How it behaves

### Ratings
- Five stars with half steps (0.5–5), for both the overall rating and episode ratings.
- The **overall show rating is always set by you**. Episode and season averages are calculated, labelled as calculated, and shown separately. They never overwrite your rating.
- Optional rating label, for example "Perfect". Suggestions are offered but never applied automatically.

### Heatmap cell states
These states are kept separate on purpose:

| Cell | Meaning |
|---|---|
| Coloured with a number | Rated. Green is high, then yellow, orange/red, and purple is low. The number is always shown, so colour is never the only signal. |
| Solid neutral with ✓ | Watched, no rating. |
| Hollow outline with `?` | A real episode you haven't watched or rated yet. |
| Hatched with `N/A` | Skipped on purpose. |
| `F` badge in the corner | Filler. Works with any state, and keeps the rating. |
| Empty space, no cell | Padding: that season simply has fewer episodes. It isn't an episode. |
| Brass outline | Your next episode. |
| Dashed with `TBA` | Announced but not out yet. Left out of progress until it airs. |

**Fast editing.** Click a cell to select it, then type: `4` rates 4, `4` then `5` (or `.`) rates 4.5. Arrows move, `w` watched, `s` skip, `f` filler, `u` watched up to here, Backspace clears. Shift-click or shift-arrows selects a range, Ctrl/Cmd-click adds cells, and the bar that appears acts on the whole selection. "Edit seasons" on the title page changes the structure in place.

### Progress policy
The source requirements left this open, so this is the choice made: **skipped episodes are removed from the total** and listed separately ("12/20 watched, 3 skipped"). They never count as watched. Filler counts like any other episode. Episodes that aren't out yet (future date, future year, or "TBA") are left out until they air, so a confirmed-but-unreleased season doesn't stop you being at 100%.

### New episodes, automatically
Every TV show and anime is re-checked in the background (TVmaze, plus TMDB when its key is set): shows you're watching every 6 hours, everything else daily. New episodes are added to the right season, new seasons are created, and nothing you've rated is ever removed. Settings → New episodes shows the last check and has "Check all shows now". Set `EPISODE_SYNC=off` to turn it off.

### Current season and next episode
These are worked out from real progress: find the furthest watched episode in watch order, and the next episode is the first later one that isn't watched or skipped. If a season is finished, the next season becomes current. Empty future seasons are never chosen, so you won't see a blank "Season 15" while you're on Season 7.

### Recently Watched
The default sort. It updates whenever an episode is marked watched or rated, and when a movie's watch date changes, not only when a review is first created.

### Anime structure
A show is an ordered list of segments: **Season, Cour, OVA, Movie, Special**. The order is your watch order, so an OVA can sit between two cours. Segments can be added, renamed, retyped, reordered, resized or removed at any time. Renaming or reordering keeps ratings, because segments keep their IDs. Removing episodes that have ratings asks for confirmation first.

### Ratings as text (Studio)
```
S1C1E1: 4.5
S1C1E2: 4 filler
S1E7: skip
S2E1: watched
"OVA" E1: 5
"Movie 1" E1: 4
```
If any line can't be matched, the errors are listed and **nothing is applied** until they're fixed.

### Metadata providers
Providers are chosen by media type, so anime is never sent to TMDB TV endpoints:

| Type | Providers, in order |
|---|---|
| Movies | TMDB |
| TV | TMDB, then TVmaze (no key needed) |
| Anime | Jikan/MyAnimeList, then AniList |

Each provider has a timeout before the next one is tried. A refresh only updates **unlocked** fields that the provider actually returned. It never touches your review, ratings, status, tags or structure. Episode-title fetches add missing episodes but never delete any. Manual entry always works without any provider.

### Letterboxd import
Sources: your username (RSS feed, recent ~50 entries), pasted RSS, or the export CSVs (`reviews.csv`, `diary.csv`, `ratings.csv`).

- Paragraph breaks are kept and HTML entities are decoded.
- The "This review may contain spoilers." line is removed and becomes the spoiler flag instead. "Watched on …" boilerplate is removed too.
- You get a preview first. Each row is marked new, no change, changed on Letterboxd, already here, or rewatch, and you choose the action per row.
- Re-syncing never creates duplicates: entries are matched by Letterboxd GUID or URI, then TMDB ID, then title and year.
- Your own manual reviews are never overwritten unless you choose "Replace".
- Imports are private and never featured.

### IMDb import (one time, all your ratings)
Studio → Import & backup → **Import from IMDb**.

1. On IMDb open **Your ratings → ⋯ → Export**, then download the CSV from the **Exports** page.
2. Upload it and choose **Preview import**. Nothing is written yet.
3. Check the preview, correct anything, then choose **Import**.

How it works:
- **Same-named titles stay apart.** Every row is matched by IMDb's own ID (`tt…`), never by title.
- **Ratings convert exactly.** IMDb's 1–10 becomes 0.5–5 stars (8 → 4, 7 → 3.5).
- **Sorting by IMDb's title type:**
  - Movie, TV Movie, Short, Video and TV Special become **Movies**.
  - TV Series and TV Mini Series become **TV Shows**.
  - Video games, podcasts and music videos are left out.
- **Anime is a guess.** IMDb has no anime type, so the app suggests Anime for animated titles whose original title differs from the English one. The preview has an "Animated: check these" filter with one-click "→ Anime" / "→ TV" buttons, and every row can be switched to Movie, TV, Anime or Skip.
- **Episode ratings land in their show and season.** IMDb's free public episode lists (`title.episode`, `title.basics` from datasets.imdbws.com) are downloaded once to `DATA_DIR/cache/imdb` and reused for 30 days. Shows get their full season structure, so episodes you haven't rated appear as `?`. Episodes IMDb has no season/episode number for are listed as not placed.
- **Re-running is safe.** Titles already in the library (same IMDb ID) are updated, never duplicated. You choose whether ratings you've changed here are kept or replaced.
- Recently Watched follows the date you rated each title on IMDb. Everything imported is private.

### Posters and duplicates
- **Posters.** Titles imported from IMDb have no artwork, so posters are filled in afterwards in the background. TMDB finds them for movies, shows and anime; without a TMDB key, TVmaze finds them for shows. Only empty fields are filled. It runs by itself in the background (shortly after each start, then every 15 minutes, for anything still missing; titles nobody has a poster for are retried daily), and Import & backup has a "Fetch missing posters" button with progress.
- **One review per title.** Imports match what's already in the library by IMDb id, then by title and year, so a film from both Letterboxd and IMDb is kept once. Letterboxd's rating and review win over IMDb's.
- **Existing duplicates.** Import & backup lists any title that's in the library twice and merges them in one click. Merging keeps the Letterboxd copy (then yours, then IMDb's), fills gaps from the others, and keeps every tag and everyone you watched with. A backup is saved first.

### Who you watched with
- **Settings → People you watch with:** add, rename and remove people.
- **On any title in Studio:** tap everyone who watched it with you. You can pick nobody, one person or several, or add someone new on the spot.
- **Title page and library cards:** show who you watched with. Each library has a "Watched with" filter.
- **Studio's bulk menu:** adds or removes a person on many titles at once.
- **Removing a person** only takes them off titles. The titles stay. Backups include who you watched with.

### Anime sorting
IMDb doesn't say whether animation is anime ("Bleach" looks just like "The Legend of Korra"), so every animated title is checked once in the background: TVmaze's language and Anime tag, then TMDB's original language (with a key), then AniList by name and year. Japanese anime moves to Anime; animation guessed as anime on import that isn't moves out; Chinese and Korean animation is left where it is. Settings → Anime sorting lists what moved, with "Move back". Studio's "Move to" menu moves titles by hand, and a title you've placed yourself is never moved again.

### No duplicates
The same film or show is merged into one entry automatically: after every Letterboxd or IMDb import, on start-up and every 15 minutes. Two entries are the same when they share an IMDb, TMDB or Letterboxd id, or the same English or original title (ignoring punctuation and a leading "The") with years at most one apart. Entries with different IMDb ids are never merged. Letterboxd's review wins, then yours, then IMDb's; a database backup is taken before each merge.

### Genre filters
- **Settings → Genres:** add only the genres you want as filters, from suggestions (Action, True Crime, Superhero, Sitcom…) or your own. Adding one tags every movie, show and anime that fits straight away; new titles are tagged as they arrive.
- **Rules:** a filter matches any of its genres, all of a set (True Crime = Documentary + Crime), or a TMDB keyword (Superhero, Heist…). Edit a filter to change its rules. Keywords are fetched once per title in the background and need a TMDB key.
- **Your choice wins:** on a title's Studio page, tap a genre on or off. A genre you removed is never re-added automatically.
- Each library page has a "Genre" filter row, and Studio has a genre dropdown. Backups include your filters and choices.

### Editing safety
- Saves use optimistic versioning. If an entry was changed in another tab, you get a clear conflict message and your form is kept.
- "Saved" appears only after the server confirms the save. Failed saves show a persistent error and keep your edits.
- Episode ratings update instantly on screen and roll back if the save fails.
- You're warned before leaving a page with unsaved changes (Ctrl/⌘+S saves).

## Code map

```
src/lib/db.ts               SQLite schema + migrations, prepared-statement cache
src/lib/domain/types.ts     every enum (types, statuses, segment kinds, providers) — schemas and UI derive from it
src/lib/domain/assessment.ts  episode rules shared by server, restore and the optimistic UI
src/lib/auth.ts, guard.ts   sessions, owner checks, request-cached loaders, API policy and error mapping
src/lib/password.ts         scrypt hashing (also used by scripts/hash-password.ts)
src/lib/schemas.ts          zod validation (every external ID listed explicitly)
src/lib/domain/             pure logic: ratings, progress/active episode, text syntax, Letterboxd parsing
src/lib/repo/               media, structure, assessments, tags, imports, backup, audit log
src/lib/providers/          TMDB, TVmaze, Jikan, AniList with timeout + fallback
src/app/watch/              library and detail pages
src/app/studio/             manage, add, edit, import & backup
src/app/api/                JSON API (all owner-only)
src/components/             heatmap, share image exporter, studio editors
```

Personal data (`review`, `episode_assessment`, `media_tag`) is stored apart from third-party metadata (`media`, `episode`). Every change is written to `audit_event`.

## Tests

```bash
npm test                         # 71 unit/integration tests (domain, repository, import, backup, providers)
npm run build && npm run test:e2e   # browser tests against the production build
```

The end-to-end tests cover:
- Signed-out and forged-cookie access to every page and API (including a fresh browser context)
- Cross-origin writes and attempts to publish
- Multi-paragraph review save and reload
- Simulated save failure that keeps the edits, plus the unsaved-changes warning
- Click-to-rate, skip, progress and Recently Watched
- Adding an OVA between cours after creation, without losing ratings
- Phone-width layouts with no horizontal scroll

## Known limits
- The live provider APIs (TMDB, TVmaze, Jikan, AniList, Letterboxd RSS) were built to their documented formats and tested with mocked responses. The build environment had no outbound network, so they haven't been tested against the real services yet.
- No real data has been imported. Only sample content was used.
- Single owner account. No passkeys or 2FA yet.
- Login throttling is in memory, so it resets when the process restarts.
