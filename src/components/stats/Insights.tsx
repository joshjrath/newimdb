import Link from "next/link";
import type { Insights, Stats } from "@/lib/repo/stats";
import { formatMinutes } from "@/lib/repo/stats";
import { formatDate } from "@/lib/format";
import { plural } from "@/lib/domain/text";
import { STATUS_LABEL, TYPE_LABEL, type WatchStatus } from "@/lib/domain/types";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Where your time goes: one bar split by kind, labelled directly. */
export function TimeSplit({ s }: { s: Stats }) {
  const parts = [
    { key: "movie", label: "Movies", min: s.minutesWatched.movie, cls: "t-movie" },
    { key: "tv", label: "TV", min: s.minutesWatched.tv, cls: "t-tv" },
    { key: "anime", label: "Anime", min: s.minutesWatched.anime, cls: "t-anime" },
  ].filter((p) => p.min > 0);
  const total = parts.reduce((a, p) => a + p.min, 0);
  if (!total) return null;
  return (
    <section className="panel" aria-labelledby="split-h">
      <header>
        <h2 id="split-h">Where your time goes</h2>
        <span className="hint">{formatMinutes(total)} in all</span>
      </header>
      <div className="split-bar" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.min / total) * 100)}%`).join(", ")}>
        {parts.map((p) => (
          <span key={p.key} className={p.cls} style={{ flexGrow: p.min }} title={`${p.label}: ${formatMinutes(p.min)}`} />
        ))}
      </div>
      <ul className="split-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <span className={`swatch ${p.cls}`} />
            <b>{p.label}</b> {Math.round((p.min / total) * 100)}% · {formatMinutes(p.min)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A year of watching, one square per day (GitHub-style), with your streaks. */
export function ActivityCalendar({ i }: { i: Insights }) {
  const byDay = new Map(i.days.map((d) => [d.date, d]));
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const dow = (end.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(end.getTime() - (52 * 7 + dow) * DAY);
  const weeks: { date: string; n: number; ep: number; mv: number }[][] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    const day = byDay.get(d);
    const w = Math.floor((t - start.getTime()) / (7 * DAY));
    (weeks[w] ??= []).push({ date: d, n: (day?.episodes ?? 0) + (day?.movies ?? 0), ep: day?.episodes ?? 0, mv: day?.movies ?? 0 });
  }
  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);
  const active = i.days.filter((d) => d.date >= start.toISOString().slice(0, 10)).length;
  return (
    <section className="panel" aria-labelledby="cal-h">
      <header>
        <h2 id="cal-h">Your year of watching</h2>
        <span className="hint">{plural(active, "day", "days")} with something watched in the last 12 months</span>
      </header>
      <div className="stat-tiles small">
        <div className="stat-tile"><span className="label">Current streak</span><b>{i.streak.current} {i.streak.current === 1 ? "day" : "days"}</b><span className="hint">{i.streak.current ? "keep it going" : "watch something today"}</span></div>
        <div className="stat-tile"><span className="label">Longest streak</span><b>{i.streak.longest} {i.streak.longest === 1 ? "day" : "days"}</b><span className="hint">{i.streak.longestEnd ? `ended ${formatDate(i.streak.longestEnd)}` : "–"}</span></div>
        <div className="stat-tile"><span className="label">Busiest day</span><b>{i.bingeDays[0] ? `${i.bingeDays[0].episodes} eps` : "–"}</b><span className="hint">{i.bingeDays[0] ? `${i.bingeDays[0].title}, ${formatDate(i.bingeDays[0].date)}` : ""}</span></div>
      </div>
      <div className="cal-wrap">
        <div className="cal" role="img" aria-label="Days you watched something over the last year">
          <div className="cal-months" aria-hidden="true">
            {weeks.map((w, k) => {
              const first = w.find((d) => d.date.endsWith("-01"));
              return <span key={k}>{first ? MONTHS[Number(first.date.slice(5, 7)) - 1] : ""}</span>;
            })}
          </div>
          <div className="cal-grid">
            <div className="cal-days" aria-hidden="true">
              {WEEKDAYS.map((d, k) => <span key={d}>{k % 2 === 0 ? d : ""}</span>)}
            </div>
            {weeks.map((w, k) => (
              <div key={k} className="cal-week">
                {w.map((d) => (
                  <span key={d.date} className={`cal-day l${level(d.n)}`} title={`${formatDate(d.date)}: ${d.n ? [d.ep && plural(d.ep, "episode", "episodes"), d.mv && plural(d.mv, "movie", "movies")].filter(Boolean).join(", ") : "nothing"}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="cal-key" aria-hidden="true">Less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`cal-day l${l}`} />)} More</div>
      </div>
    </section>
  );
}

/** Longest runs of back-to-back 5/5 episodes, and your best seasons. */
export function PerfectRuns({ i }: { i: Insights }) {
  const max = Math.max(1, ...i.perfectRuns.map((r) => r.length));
  return (
    <div className="stats-grid">
      <section className="panel" aria-labelledby="runs-h">
        <header>
          <h2 id="runs-h">Longest runs of 5/5s</h2>
          <span className="hint">Back-to-back episodes you rated 5 stars</span>
        </header>
        {i.perfectRuns.length === 0 ? (
          <p className="hint">No runs yet: rate two episodes in a row 5/5 and they show up here.</p>
        ) : (
          <ol className="runs">
            {i.perfectRuns.map((r, k) => (
              <li key={`${r.mediaId}-${r.from}`}>
                <span className="runs-rank">{k + 1}</span>
                <div className="runs-body">
                  <Link href={`/studio/${r.mediaId}`} className="runs-title">{r.title}</Link>
                  <span className="hint">{r.from} → {r.to}</span>
                  <div className="runs-stars" aria-hidden="true" style={{ width: `${(r.length / max) * 100}%` }}>
                    {Array.from({ length: Math.min(r.length, 40) }, (_, n) => <span key={n}>★</span>)}
                  </div>
                </div>
                <b className="runs-n">{r.length}<small>in a row</small></b>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="panel" aria-labelledby="seasons-h">
        <header>
          <h2 id="seasons-h">Your best seasons</h2>
          <span className="hint">Highest average, 4+ rated episodes</span>
        </header>
        {i.bestSeasons.length === 0 ? (
          <p className="hint">Rate a few episodes and your best seasons appear here.</p>
        ) : (
          <ul className="hbars">
            {i.bestSeasons.map((x) => (
              <li key={`${x.mediaId}-${x.season}`}>
                <Link href={`/studio/${x.mediaId}`} className="hbar-label">{x.title}<small>{x.season} · {x.rated} rated</small></Link>
                <div className="hbar-track"><span className="hbar-fill gold" style={{ width: `${(x.average / 5) * 100}%` }} /></div>
                <span className="hbar-value">★ {x.average.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** You vs IMDb: are you a harsh critic? And the titles you disagree with IMDb about most. */
export function VersusImdb({ i }: { i: Insights }) {
  const v = i.vsImdb;
  if (!v.compared) return null;
  const take = (t: Insights["hotTakes"]["loved"][number]) => (
    <li key={t.id}>
      <Link href={`/studio/${t.id}`}>{t.title}</Link>
      <span className="hint">{TYPE_LABEL[t.type]}</span>
      <span className="take-scores">
        <span className="mine">You {(t.mine * 2).toFixed(1)}</span>
        <span className="imdb-badge"><b>IMDb</b> {t.imdb.toFixed(1)}</span>
      </span>
    </li>
  );
  const gap = v.averageGap ?? 0;
  return (
    <section className="panel" aria-labelledby="vs-h">
      <header>
        <h2 id="vs-h">You vs IMDb</h2>
        <span className="hint">{plural(v.compared, "title", "titles")} you&apos;ve rated that IMDb rates too (yours ×2, out of 10)</span>
      </header>
      <div className="vs-head">
        <div className="vs-gauge" aria-hidden="true">
          <span className="vs-mid" />
          <span className="vs-dot" style={{ left: `${50 + Math.max(-50, Math.min(50, gap * 20))}%` }} />
        </div>
        <p className="vs-verdict">
          {Math.abs(gap) < 0.25 ? (
            <>You and IMDb mostly agree.</>
          ) : gap > 0 ? (
            <>You rate <b>{gap.toFixed(1)} points higher</b> than IMDb on average: a generous critic.</>
          ) : (
            <>You rate <b>{Math.abs(gap).toFixed(1)} points lower</b> than IMDb on average: a tough critic.</>
          )}{" "}
          <span className="hint">Higher on {v.higher}, lower on {v.lower}.</span>
        </p>
      </div>
      <div className="stats-grid">
        <div>
          <h3 className="takes-h">🔥 You loved it more</h3>
          {i.hotTakes.loved.length ? <ul className="takes">{i.hotTakes.loved.map(take)}</ul> : <p className="hint">No big disagreements.</p>}
        </div>
        <div>
          <h3 className="takes-h">🧊 You liked it less</h3>
          {i.hotTakes.disliked.length ? <ul className="takes">{i.hotTakes.disliked.map(take)}</ul> : <p className="hint">No big disagreements.</p>}
        </div>
      </div>
    </section>
  );
}

/** When and what: weekdays, decades, binge days and how your shows are going. */
export function Habits({ i }: { i: Insights }) {
  const maxW = Math.max(1, ...i.weekdays);
  const maxD = Math.max(1, ...i.decades.map((d) => d.count));
  const totalShows = i.showStatus.reduce((a, x) => a + x.count, 0);
  const statusName = (s: string) => (s === "none" ? "No status" : STATUS_LABEL[s as WatchStatus] ?? s);
  return (
    <div className="stats-grid">
      <section className="panel" aria-labelledby="wd-h">
        <header><h2 id="wd-h">Your watching days</h2></header>
        <div className="vbars short" role="list">
          {i.weekdays.map((n, k) => (
            <div key={k} className="vbar" role="listitem" tabIndex={0} aria-label={`${WEEKDAYS[k]}: ${n}`}>
              <span className="vbar-n">{n || ""}</span>
              <div className="vbar-col">{n > 0 && <span className="vbar-fill" style={{ height: `${Math.max(3, (n / maxW) * 100)}%` }} />}</div>
              <span className="vbar-x">{WEEKDAYS[k]}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="dec-h">
        <header><h2 id="dec-h">Decades you watch</h2><span className="hint">By release year</span></header>
        <div className="vbars short" role="list">
          {i.decades.map((d) => (
            <div key={d.decade} className="vbar" role="listitem" tabIndex={0} aria-label={`${d.decade}s: ${d.count}`}>
              <span className="vbar-n">{d.count}</span>
              <div className="vbar-col"><span className="vbar-fill" style={{ height: `${Math.max(3, (d.count / maxD) * 100)}%` }} /></div>
              <span className="vbar-x">{`'${String(d.decade).slice(2)}s`}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="binge-h">
        <header><h2 id="binge-h">Biggest binge days</h2><span className="hint">Most episodes of one show in a day</span></header>
        {i.bingeDays.length === 0 ? (
          <p className="hint">Watch a few episodes in a day to see your binges here.</p>
        ) : (
          <ol className="binges">
            {i.bingeDays.map((b, k) => (
              <li key={`${b.date}-${b.mediaId}`}>
                <span className="runs-rank">{k + 1}</span>
                <Link href={`/studio/${b.mediaId}`}>{b.title}</Link>
                <span className="hint">{formatDate(b.date)}</span>
                <b>{b.episodes} eps</b>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="panel" aria-labelledby="ss-h">
        <header><h2 id="ss-h">How your shows are going</h2><span className="hint">{plural(totalShows, "show", "shows")} and anime</span></header>
        <ul className="hbars">
          {i.showStatus.map((x) => (
            <li key={x.status}>
              <span className="hbar-label">{statusName(x.status)}</span>
              <div className="hbar-track"><span className={`hbar-fill st-${x.status}`} style={{ width: `${(x.count / Math.max(1, totalShows)) * 100}%` }} /></div>
              <span className="hbar-value">{x.count}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The episodes you starred as favourites. */
export function FavoriteEpisodes({ i }: { i: Insights }) {
  return (
    <section className="panel" aria-labelledby="favs-h">
      <header>
        <h2 id="favs-h">★ Your favourite episodes</h2>
        <span className="hint">{i.favorites.length ? plural(i.favorites.length, "episode", "episodes") : "Press ★ on an episode (or *) to add it here"}</span>
      </header>
      {i.favorites.length > 0 && (
        <ul className="favs">
          {i.favorites.map((f) => (
            <li key={`${f.mediaId}-${f.code}`}>
              <Link href={`/studio/${f.mediaId}`}>
                <b>{f.title} · {f.code}</b>
                <small>{f.episodeTitle && !/^episode\s*#?\d/i.test(f.episodeTitle) ? f.episodeTitle : TYPE_LABEL[f.type]}{f.rating != null ? ` · ★ ${f.rating}` : ""}</small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
