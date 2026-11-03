import { decodeEntities, htmlToText, normalizeParagraphs } from "./text";
import { isValidRating } from "./rating";
import crypto from "node:crypto";

/** A normalized Letterboxd entry, from RSS or from the CSV export. */
export interface LetterboxdEntry {
  externalId: string; // RSS guid or CSV "Letterboxd URI"
  kind: "review" | "watch" | "rating";
  filmTitle: string;
  filmYear: number | null;
  rating: number | null;
  watchedDate: string | null; // YYYY-MM-DD
  rewatch: boolean;
  reviewText: string; // cleaned, paragraphs preserved, boilerplate removed
  spoiler: boolean;
  link: string | null;
  tmdbId: number | null;
  posterUrl: string | null;
  tags: string[];
  contentHash: string;
}

const SPOILER_RE = /^\s*this review may contain spoilers\.?\s*$/i;
const WATCHED_RE = /^\s*(watched|rewatched) on [a-z]+ [a-z]+ \d{1,2},? \d{4}\.?\s*$/i;

/** Removes Letterboxd boilerplate paragraphs (not the owner's prose). Returns whether a spoiler notice was found. */
export function cleanReviewText(text: string): { text: string; spoiler: boolean } {
  let spoiler = false;
  const paras = normalizeParagraphs(text)
    .split(/\n{2,}/)
    .filter((p) => {
      if (SPOILER_RE.test(p)) {
        spoiler = true;
        return false;
      }
      if (WATCHED_RE.test(p)) return false;
      return true;
    });
  return { text: paras.join("\n\n"), spoiler };
}

function tag(block: string, name: string): string | null {
  const re = new RegExp(`<${name.replace(/[:]/g, "\\:")}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace(/[:]/g, "\\:")}>`, "i");
  const m = re.exec(block);
  if (!m) return null;
  const raw = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(raw);
  return cdata ? cdata[1] : raw;
}

export function hashEntry(e: Omit<LetterboxdEntry, "contentHash">): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([e.filmTitle, e.filmYear, e.rating, e.watchedDate, e.reviewText, e.spoiler]))
    .digest("hex")
    .slice(0, 32);
}

function finish(e: Omit<LetterboxdEntry, "contentHash">): LetterboxdEntry {
  return { ...e, contentHash: hashEntry(e) };
}

export function parseLetterboxdRss(xml: string): LetterboxdEntry[] {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  const out: LetterboxdEntry[] = [];
  for (const item of items) {
    const guid = tag(item, "guid")?.trim() ?? "";
    if (/letterboxd-list-/.test(guid)) continue; // lists aren't reviews
    const filmTitle = tag(item, "letterboxd:filmTitle");
    if (!filmTitle) continue;
    const description = tag(item, "description") ?? "";
    const posterMatch = /<img[^>]+src="([^"]+)"/i.exec(description);
    const bodyHtml = description.replace(/<p>\s*<img[^>]*>\s*<\/p>/gi, "").replace(/<img[^>]*>/gi, "");
    const cleaned = cleanReviewText(htmlToText(bodyHtml));
    const ratingStr = tag(item, "letterboxd:memberRating");
    const rating = ratingStr != null && isValidRating(Number(ratingStr)) ? Number(ratingStr) : null;
    const yearStr = tag(item, "letterboxd:filmYear");
    const tmdbStr = tag(item, "tmdb:movieId") ?? tag(item, "tmdb:tvId");
    const link = tag(item, "link");
    out.push(
      finish({
        externalId: guid || link || `${filmTitle}-${yearStr}`,
        kind: /letterboxd-review-/.test(guid) ? "review" : cleaned.text ? "review" : "watch",
        filmTitle: decodeEntities(filmTitle).trim(),
        filmYear: yearStr && /^\d{4}$/.test(yearStr.trim()) ? Number(yearStr) : null,
        rating,
        watchedDate: tag(item, "letterboxd:watchedDate")?.trim() || null,
        rewatch: /^yes$/i.test(tag(item, "letterboxd:rewatch")?.trim() ?? ""),
        reviewText: cleaned.text,
        spoiler: cleaned.spoiler || /\(contains spoilers\)/i.test(tag(item, "title") ?? ""),
        link: link ? decodeEntities(link).trim() : null,
        tmdbId: tmdbStr && /^\d+$/.test(tmdbStr.trim()) ? Number(tmdbStr) : null,
        posterUrl: posterMatch ? decodeEntities(posterMatch[1]) : null,
        tags: [],
      }),
    );
  }
  return out;
}

/** RFC 4180 CSV with quoted newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Letterboxd export: reviews.csv, diary.csv, ratings.csv or watched.csv. */
export function parseLetterboxdCsv(text: string): LetterboxdEntry[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iName = col("name"),
    iYear = col("year"),
    iUri = col("letterboxd uri"),
    iRating = col("rating"),
    iRewatch = col("rewatch"),
    iReview = col("review"),
    iTags = col("tags"),
    iWatched = col("watched date"),
    iDate = col("date");
  if (iName < 0) throw new Error("This CSV doesn't look like a Letterboxd export (no Name column).");
  const out: LetterboxdEntry[] = [];
  for (const r of rows.slice(1)) {
    const name = r[iName]?.trim();
    if (!name) continue;
    const rawReview = iReview >= 0 ? r[iReview] ?? "" : "";
    const cleaned = cleanReviewText(/<[a-z][^>]*>/i.test(rawReview) ? htmlToText(rawReview) : decodeEntities(rawReview));
    const rating = iRating >= 0 && isValidRating(Number(r[iRating])) ? Number(r[iRating]) : null;
    const uri = iUri >= 0 ? r[iUri]?.trim() : "";
    const year = iYear >= 0 && /^\d{4}$/.test(r[iYear]?.trim() ?? "") ? Number(r[iYear]) : null;
    const watched = (iWatched >= 0 ? r[iWatched] : iDate >= 0 ? r[iDate] : "")?.trim() || null;
    out.push(
      finish({
        externalId: uri || `${name}-${year}-${watched}`,
        kind: iReview >= 0 ? "review" : iRating >= 0 && iWatched < 0 ? "rating" : "watch",
        filmTitle: decodeEntities(name),
        filmYear: year,
        rating,
        watchedDate: watched && /^\d{4}-\d{2}-\d{2}$/.test(watched) ? watched : null,
        rewatch: iRewatch >= 0 && /^yes$/i.test(r[iRewatch]?.trim() ?? ""),
        reviewText: cleaned.text,
        spoiler: cleaned.spoiler,
        link: uri || null,
        tmdbId: null,
        posterUrl: null,
        tags:
          iTags >= 0 && r[iTags]
            ? r[iTags]
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
      }),
    );
  }
  return out;
}

export function letterboxdRssUrl(usernameOrUrl: string): string {
  const s = usernameOrUrl.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?letterboxd\.com\/([a-z0-9_]+)\/?/i.exec(s);
  const user = m ? m[1] : s.replace(/^@/, "");
  if (!/^[a-z0-9_]{1,40}$/i.test(user)) throw new Error("That doesn't look like a Letterboxd username.");
  return `https://letterboxd.com/${user}/rss/`;
}
