import { fetchWithTimeout } from "./http";
import { normalizeTitle } from "../domain/text";

/**
 * animefillerlist.com: which episodes of a long anime are filler. Episode numbers there
 * run across the whole show (Bleach 1–366), so they're matched to your seasons in order.
 */

const BASE = "https://www.animefillerlist.com";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; SpecularWatch/1.0; personal library)", Accept: "text/html" };

export type EpisodeKind = "canon" | "mixed" | "filler" | "anime_canon";

/** Parse a show page's episode table: episode number → kind. */
export function parseFillerPage(html: string): Map<number, EpisodeKind> {
  const out = new Map<number, EpisodeKind>();
  for (const m of html.matchAll(/<tr\b[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const num = /<td[^>]*class="[^"]*\bNumber\b[^"]*"[^>]*>\s*(\d+)\s*<\/td>/i.exec(m[2]);
    if (!num) continue;
    const cls = m[1].toLowerCase().split(/\s+/);
    const typeText = (/<td[^>]*class="[^"]*\bType\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(m[2])?.[1] ?? "").replace(/<[^>]+>/g, "").trim().toLowerCase();
    const kind: EpisodeKind = cls.includes("filler") || typeText === "filler"
      ? "filler"
      : cls.some((c) => c.includes("mixed")) || typeText.includes("mixed")
        ? "mixed"
        : cls.includes("anime_canon") || typeText === "anime canon"
          ? "anime_canon"
          : "canon";
    out.set(Number(num[1]), kind);
  }
  return out;
}

/** Parse the shows index: normalized show name → slug. */
export function parseShowIndex(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href="\/shows\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = m[2].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").trim();
    if (name) out.set(normalizeTitle(name), m[1]);
  }
  return out;
}

const g = globalThis as unknown as { __aflIndex?: { at: number; map: Map<string, string> } };

export async function fillerShowIndex(): Promise<Map<string, string>> {
  if (g.__aflIndex && Date.now() - g.__aflIndex.at < 7 * 86_400_000) return g.__aflIndex.map;
  const res = await fetchWithTimeout("animefillerlist", `${BASE}/shows`, { headers: HEADERS }, 15000);
  const map = parseShowIndex(await res.text());
  g.__aflIndex = { at: Date.now(), map };
  return map;
}

/** The slug for a show, trying its title, original title, and the obvious URL form. */
export function findSlug(index: Map<string, string>, titles: (string | null)[]): string | null {
  for (const t of titles) {
    if (!t) continue;
    const hit = index.get(normalizeTitle(t)) ?? index.get(normalizeTitle(t.split(/\s*[:：]\s*/)[0]));
    if (hit) return hit;
  }
  return null;
}

export async function fillerEpisodes(slug: string): Promise<Map<number, EpisodeKind>> {
  const res = await fetchWithTimeout("animefillerlist", `${BASE}/shows/${encodeURIComponent(slug)}`, { headers: HEADERS }, 15000);
  return parseFillerPage(await res.text());
}
