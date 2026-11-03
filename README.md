# Watch Journal

A private, owner-only journal for **Movies**, **TV Shows** and **Anime**. You can write reviews, rate every episode on a heatmap, manage seasons, cours, OVAs, movies and specials, import from Letterboxd, keep backups, and make Instagram-ready review images.

Everything is private in this release. No page, API, image or export can be opened without signing in as the owner.

## Quick start

Requires Node 22.18 or newer (the `scripts/*.ts` helpers run directly with Node's built-in TypeScript support).

```bash
npm install
npm run hash-password            # prints OWNER_PASSWORD_HASH=...
cp .env.example .env.local       # paste the hash in, set DATA_DIR if you want
npm run build && npm start       # http://localhost:3000
```

Optional sample content (clearly marked "SAMPLE", tagged `Sample`):

```bash
OWNER_PASSWORD='your password' npm run seed
```

Development: `npm run dev`. For local dev only, you can set `OWNER_PASSWORD` in plain text instead of a hash. The app ignores it when `NODE_ENV=production`.

### Environment

| Variable | Purpose |
|---|---|
| `OWNER_PASSWORD_HASH` | **Required.** scrypt hash from `npm run hash-password`. |
| `DATA_DIR` | Database, uploads, poster cache and backups. Default `./data`. Keep it private and backed up. |
| `TMDB_READ_TOKEN` / `TMDB_API_KEY` | Optional. Enables movie search and the preferred TV provider. |
| `PROVIDER_TIMEOUT_MS` | Per-provider timeout before falling back. Default 6000. |
| `COOKIE_SECURE` | Set `false` only when running the production build over plain http on localhost. |

## Hosting

The app uses SQLite on local disk, so it needs a host with a **persistent filesystem**: a VPS, Fly.io with a volume, Railway with a volume, or a home server. Serverless hosting without persistent disk, such as default Vercel, would lose data. Moving to Postgres later only means swapping the repository layer in `src/lib/repo/`.

Back up `DATA_DIR`. `npm run backup` writes a consistent SQLite snapshot to `DATA_DIR/backups/` and is safe to run while the app is up (for example from cron). Studio → Import & backup also exports and restores a full JSON backup, and every restore takes a snapshot first.

## Privacy model

- **Server-side checks everywhere.** Every page calls `requireOwnerPage()` and every API route is wrapped in `ownerApi()`. Both check the session token against the database. The middleware redirect is only a convenience; security doesn't depend on it.
- Sessions are random 256-bit tokens, stored only as SHA-256 hashes, in an httpOnly, SameSite=Lax, Secure (in production) cookie. Failed logins are throttled.
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

### Progress policy
The source requirements left this open, so this is the choice made: **skipped episodes are removed from the total** and listed separately ("12/20 watched, 3 skipped"). They never count as watched. Filler counts like any other episode.

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
npm test                         # 45 unit/integration tests (domain, repository, import, backup, providers)
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
