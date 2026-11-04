import { normalizeTitle } from "./text";

/**
 * Which anime entries are really one show. Films, OVAs and specials go with their series
 * (Jujutsu Kaisen 0 → Jujutsu Kaisen, Mugen Train → Demon Slayer), and so does an entry
 * that's just another season ("Jujutsu Kaisen Season 2", "Part 2", "The Final Season").
 * A differently named series stays its own show (Naruto vs Naruto Shippuden), and so does a
 * continuation that came years later (Bleach vs Bleach: Thousand-Year Blood War).
 */

const SEASON_MARKER = /\b(season\s*\d+|\d+(st|nd|rd|th)\s+season|(the\s+)?final\s+season|part\s*\d+|cour\s*\d+|s\d{1,2})\b/i;

/** The franchise name: the part before a subtitle, without "the movie", "0", "season 2"… */
export function franchiseBase(title: string): string {
  let t = title.replace(/\([^)]*\)/g, " ").replace(/[’']/g, "'");
  t = t.split(/\s*[:：]\s*|\s+[-–—]\s+/)[0];
  t = t
    .replace(/\s+(the\s+)?movie\b.*$/i, "")
    .replace(/\s+(season\s*\d+|\d+(st|nd|rd|th)\s+season|(the\s+)?final\s+season|part\s*\d+|cour\s*\d+|s\d{1,2})\b.*$/i, "")
    .replace(/(\S)\s+(0|\d{1,2})$/, "$1") // "Jujutsu Kaisen 0", "Kaguya-sama 2"
    .trim();
  return normalizeTitle(t);
}

/** "Season 2", "Part 2", "The Final Season": this entry is another season of its base show. */
export function isSeasonEntry(title: string): boolean {
  const after = title.replace(/\([^)]*\)/g, " ");
  return SEASON_MARKER.test(after) || /\S\s+\d{1,2}$/.test(after.trim());
}

/** The season number a season entry names, if it says one. */
export function seasonNumberIn(title: string): number | null {
  const m = /season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s+season|part\s*(\d+)|\bs(\d{1,2})\b|\s(\d{1,2})$/i.exec(title.trim());
  const n = m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** What's left after the franchise name, for a segment label ("Mugen Train", "0"). */
export function subtitleOf(title: string): string {
  const parts = title.split(/\s*[:：]\s*|\s+[-–—]\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : title;
  return last.replace(/^(the\s+)?movie\s*/i, "").trim() || title;
}

export interface FranchiseEntry {
  id: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  /** A film, OVA or special (no seasons of its own). */
  standalone: boolean;
  lastYear: number | null;
}

/** For each entry that belongs inside another one: which entry it goes into. */
export function franchiseMerges(entries: FranchiseEntry[], sequelGapYears = 4): Map<number, number> {
  const bases = (e: FranchiseEntry) => [...new Set([e.title, e.originalTitle].filter((x): x is string => Boolean(x)).map(franchiseBase).filter(Boolean))];
  const series = entries.filter((e) => !e.standalone);
  const out = new Map<number, number>();
  const lastYear = new Map(entries.map((e) => [e.id, e.lastYear ?? e.year]));
  // Oldest first, so Season 2 joins before Season 3 and the gap is measured from the newest season.
  for (const e of [...entries].sort((a, b) => (a.year ?? 0) - (b.year ?? 0))) {
    const mine = bases(e);
    // The series this could belong to: same franchise name, not itself, not a season entry itself.
    const hosts = series.filter((s) => s.id !== e.id && !isSeasonEntry(s.title) && bases(s).some((b) => mine.includes(b)));
    if (!hosts.length) continue;
    if (!e.standalone) {
      if (!isSeasonEntry(e.title)) continue; // a differently named series: its own show
    }
    // Prefer the plain-named series ("Bleach" over "Bleach: Thousand-Year Blood War"), then the closest in time.
    const plain = (s: FranchiseEntry) => (bases(s).includes(normalizeTitle(s.title)) ? 0 : 1);
    const host = [...hosts].sort((a, b) => plain(a) - plain(b) || Math.abs((a.year ?? 0) - (e.year ?? 0)) - Math.abs((b.year ?? 0) - (e.year ?? 0)))[0];
    const hostLast = lastYear.get(host.id);
    if (!e.standalone && hostLast != null && e.year != null && e.year - hostLast > sequelGapYears) continue;
    out.set(e.id, host.id);
    lastYear.set(host.id, Math.max(hostLast ?? 0, lastYear.get(e.id) ?? 0) || null);
  }
  return out;
}
