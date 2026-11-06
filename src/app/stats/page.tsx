import Link from "next/link";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { Poster } from "@/components/Poster";
import { formatMinutes, getStats, type TheaterVisit } from "@/lib/repo/stats";
import { plural } from "@/lib/domain/text";
import { formatDate } from "@/lib/format";
import { TYPE_LABEL } from "@/lib/domain/types";

export const metadata = { title: "Statistics" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}`;
const DAY = 86_400_000;

function theaterSummary(all: TheaterVisit[]) {
  const visits = all.filter((v): v is TheaterVisit & { date: string } => Boolean(v.date));
  if (!all.length) return null;
  if (!visits.length) return { total: all.length, thisYear: 0, averageGap: null, longestGap: null, busiest: null, sinceLast: null };
  const dates = visits.map((v) => Date.parse(v.date + "T12:00:00Z"));
  const gaps = dates.slice(1).map((d, i) => (d - dates[i]) / DAY);
  const byMonth = new Map<string, number>();
  for (const v of visits) byMonth.set(v.date.slice(0, 7), (byMonth.get(v.date.slice(0, 7)) ?? 0) + 1);
  const busiest = [...byMonth].sort((a, b) => b[1] - a[1])[0];
  const thisYear = visits.filter((v) => v.date.startsWith(new Date().toISOString().slice(0, 4))).length;
  return {
    total: visits.length,
    thisYear,
    averageGap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    longestGap: gaps.length ? Math.round(Math.max(...gaps)) : null,
    busiest,
    sinceLast: Math.round((Date.now() - dates[dates.length - 1]) / DAY),
  };
}

export default async function StatsPage() {
  await requireOwnerPage("/stats");
  const s = getStats();
  const totalMinutes = s.minutesWatched.movie + s.minutesWatched.tv + s.minutesWatched.anime;
  const maxMonth = Math.max(1, ...s.months.map((m) => m.minutes));
  const maxRating = Math.max(1, ...s.ratingHistogram.map((r) => r.count));
  const maxPerson = Math.max(1, ...s.people.map((p) => p.minutes));
  const maxGenre = Math.max(1, ...s.genres.map((g) => g.count));
  const leftTotal = s.timeLeft.reduce((a, t) => a + t.minutesLeft, 0);
  const maxLeft = Math.max(1, ...s.timeLeft.map((t) => t.minutesLeft));
  const theater = theaterSummary(s.theater);
  const dated = s.theater.filter((v): v is typeof v & { date: string } => Boolean(v.date));
  const undated = s.theater.filter((v) => !v.date);
  const years = [...new Set(dated.map((v) => v.date.slice(0, 4)))].sort().reverse();

  return (
    <Shell active="stats">
      <header className="page-head">
        <div>
          <h1>Statistics</h1>
          <p className="sub">Everything you&apos;ve watched, in numbers.</p>
        </div>
      </header>

      <section className="stat-tiles" aria-label="Totals">
        <div className="stat-tile big">
          <span className="label">Time watched</span>
          <b>{formatMinutes(totalMinutes)}</b>
          <span className="hint">≈ {plural(Math.round(totalMinutes / 1440), "day", "days")} of your life</span>
        </div>
        <div className="stat-tile cat-movies">
          <span className="label">Movies</span>
          <b>{s.moviesWatched.toLocaleString("en-GB")}</b>
          <span className="hint">{formatMinutes(s.minutesWatched.movie)}</span>
        </div>
        <div className="stat-tile cat-tv">
          <span className="label">TV episodes</span>
          <b>{s.episodesWatched.tv.toLocaleString("en-GB")}</b>
          <span className="hint">{formatMinutes(s.minutesWatched.tv)} · {plural(s.counts.tv, "show", "shows")}</span>
        </div>
        <div className="stat-tile cat-anime">
          <span className="label">Anime episodes</span>
          <b>{s.episodesWatched.anime.toLocaleString("en-GB")}</b>
          <span className="hint">{formatMinutes(s.minutesWatched.anime)} · {plural(s.counts.anime, "series", "series")}</span>
        </div>
        <div className="stat-tile">
          <span className="label">Average rating</span>
          <b>{s.averageRating != null ? `★ ${s.averageRating.toFixed(2)}` : "–"}</b>
          <span className="hint">{plural(s.ratingHistogram.reduce((a, r) => a + r.count, 0), "rating", "ratings")}</span>
        </div>
        <div className="stat-tile">
          <span className="label">TV time left</span>
          <b>{formatMinutes(leftTotal)}</b>
          <span className="hint">on {plural(s.timeLeft.length, "show you've started", "shows you've started")}</span>
        </div>
      </section>

      <section className="panel" aria-labelledby="month-h">
        <header>
          <h2 id="month-h">Watched per month</h2>
          <span className="hint">Hours, last 24 months. Hover a bar for details.</span>
        </header>
        <div className="vbars" role="list">
          {s.months.map((m) => (
            <div key={m.month} className="vbar" role="listitem" tabIndex={0} aria-label={`${monthLabel(m.month)}: ${formatMinutes(m.minutes)}, ${m.movies} movies, ${m.episodes} episodes`}>
              <span className="vbar-n" aria-hidden="true">{m.minutes >= 60 ? Math.round(m.minutes / 60) : ""}</span>
              <div className="vbar-col">
                {m.minutes > 0 && <span className="vbar-fill" style={{ height: `${Math.max(2, (m.minutes / maxMonth) * 100)}%` }} />}
              </div>
              <span className="vbar-x">{monthLabel(m.month).slice(0, 3)}</span>
              <span className="tip">
                <b>{monthLabel(m.month)}</b>
                {formatMinutes(m.minutes)}
                <br />
                {plural(m.movies, "movie", "movies")} · {plural(m.episodes, "episode", "episodes")}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="theater-h">
        <header>
          <h2 id="theater-h">🎬 At the theater</h2>
          <span className="hint">Movies marked &quot;Theater&quot;. Without a watch date, the day you rated or logged it is used.</span>
        </header>
        {!theater ? (
          <p className="hint">No theater trips yet. Mark a movie as watched in a theater on its Studio page (or pick several in Studio and use &quot;Watched in…&quot;).</p>
        ) : (
          <>
            <div className="stat-tiles small">
              <div className="stat-tile"><span className="label">Visits</span><b>{theater.total}</b><span className="hint">{theater.thisYear} this year</span></div>
              <div className="stat-tile"><span className="label">Every</span><b>{theater.averageGap != null ? `${theater.averageGap} d` : "–"}</b><span className="hint">on average</span></div>
              <div className="stat-tile"><span className="label">Longest gap</span><b>{theater.longestGap != null ? `${theater.longestGap} d` : "–"}</b><span className="hint">between visits</span></div>
              <div className="stat-tile"><span className="label">Busiest month</span><b>{theater.busiest ? theater.busiest[1] : "–"}</b><span className="hint">{theater.busiest ? monthLabel(theater.busiest[0]) : "no dates yet"}</span></div>
              <div className="stat-tile"><span className="label">Last visit</span><b>{theater.sinceLast != null ? `${theater.sinceLast} d` : "–"}</b><span className="hint">ago</span></div>
            </div>
            <div className="theater-timeline">
              <div className="tt-head" aria-hidden="true">
                <span />
                {MONTHS.map((m) => <span key={m}>{m}</span>)}
              </div>
              {years.map((y) => (
                <div key={y} className="tt-row">
                  <span className="tt-year">{y}<small>{dated.filter((v) => v.date.startsWith(y)).length}</small></span>
                  {MONTHS.map((_, i) => {
                    const k = `${y}-${String(i + 1).padStart(2, "0")}`;
                    const here = dated.filter((v) => v.date.startsWith(k));
                    return (
                      <div key={k} className={`tt-month${here.length ? " on" : ""}`}>
                        {here.map((v) => (
                          <Link key={v.id} href={`/studio/${v.id}`} className="tt-visit" aria-label={`${v.title}, ${formatDate(v.date)}`}>
                            <Poster url={v.posterUrl} title={v.title} />
                            <span className="tip"><b>{v.title}</b>{v.approximate ? "around " : ""}{formatDate(v.date)}{v.rating != null ? ` · ★ ${v.rating}` : ""}</span>
                          </Link>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
              {undated.length > 0 && (
                <div className="tt-row tt-undated">
                  <span className="tt-year">No date<small>{undated.length}</small></span>
                  <div className="tt-month on">
                    {undated.map((v) => (
                      <Link key={v.id} href={`/studio/${v.id}`} className="tt-visit" aria-label={`${v.title}, no watch date`}>
                        <Poster url={v.posterUrl} title={v.title} />
                        <span className="tip"><b>{v.title}</b>Add a watch date on its page</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="left-h">
        <header>
          <h2 id="left-h">Time left on shows you&apos;ve started</h2>
          <span className="hint">{formatMinutes(leftTotal)} in all · aired episodes only</span>
        </header>
        {s.timeLeft.length === 0 ? (
          <p className="hint">Nothing left: every show you&apos;ve started is finished, or not out yet.</p>
        ) : (
          <ul className="hbars">
            {s.timeLeft.slice(0, 40).map((t) => (
              <li key={t.id}>
                <Link href={`/studio/${t.id}`} className="hbar-label">{t.title}<small>{TYPE_LABEL[t.type]} · {t.percent}% watched</small></Link>
                <div className="hbar-track" title={`${plural(t.episodesLeft, "episode", "episodes")} left`}>
                  <span className={`hbar-fill ${t.type === "anime" ? "cat-anime" : "cat-tv"}`} style={{ width: `${Math.max(2, (t.minutesLeft / maxLeft) * 100)}%` }} />
                </div>
                <span className="hbar-value">{formatMinutes(t.minutesLeft)}<small>{plural(t.episodesLeft, "ep", "eps")}</small></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="stats-grid">
        <section className="panel" aria-labelledby="people-stats-h">
          <header><h2 id="people-stats-h">Who you watch with</h2></header>
          {s.people.length === 0 ? (
            <p className="hint">Add people in Settings and pick them on titles to see this.</p>
          ) : (
            <ul className="hbars">
              {s.people.map((p) => (
                <li key={p.id}>
                  <Link href={`/studio?with=${p.id || "alone"}`} className="hbar-label">{p.name}<small>{plural(p.titles, "title", "titles")}</small></Link>
                  <div className="hbar-track"><span className="hbar-fill" style={{ width: `${Math.max(2, (p.minutes / maxPerson) * 100)}%` }} /></div>
                  <span className="hbar-value">{formatMinutes(p.minutes)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="ratings-h">
          <header><h2 id="ratings-h">Your ratings</h2><span className="hint">How many titles at each star rating</span></header>
          <div className="vbars short" role="list">
            {s.ratingHistogram.map((r) => (
              <div key={r.rating} className="vbar" role="listitem" tabIndex={0} aria-label={`${r.rating} stars: ${r.count}`}>
                <span className="vbar-n">{r.count || ""}</span>
                <div className="vbar-col">{r.count > 0 && <span className="vbar-fill" style={{ height: `${Math.max(2, (r.count / maxRating) * 100)}%` }} />}</div>
                <span className="vbar-x">{r.rating}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" aria-labelledby="genre-stats-h">
          <header><h2 id="genre-stats-h">Top genres</h2></header>
          <ul className="hbars">
            {s.genres.map((g) => (
              <li key={g.name}>
                <span className="hbar-label">{g.name}<small>{g.average != null ? `avg ★ ${g.average}` : "unrated"}</small></span>
                <div className="hbar-track"><span className="hbar-fill" style={{ width: `${(g.count / maxGenre) * 100}%` }} /></div>
                <span className="hbar-value">{g.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel" aria-labelledby="top-h">
          <header><h2 id="top-h">Your highest rated</h2></header>
          <ol className="top-list">
            {s.topRated.map((t) => (
              <li key={t.id}>
                <Link href={`/studio/${t.id}`}>
                  <Poster url={t.posterUrl} title={t.title} />
                  <span>{t.title}<small>{TYPE_LABEL[t.type]} · ★ {t.rating}</small></span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </Shell>
  );
}
