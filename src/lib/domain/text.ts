const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", eacute: "é", egrave: "è", aacute: "á", agrave: "à",
  iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", ouml: "ö", uuml: "ü", auml: "ä", ccedil: "ç",
  copy: "©", reg: "®", trade: "™", deg: "°", frac12: "½", middot: "·", bull: "•", times: "×", star: "☆",
};

/** Decodes HTML entities, including double-encoded ones like `&amp;amp;` → `&`. */
export function decodeEntities(input: string): string {
  let s = input;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ent: string) => {
      if (ent[0] === "#") {
        const code = ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return NAMED[ent.toLowerCase()] ?? m;
    });
    if (next === s) break;
    s = next;
  }
  return s;
}

/** HTML → plain text with paragraph breaks preserved (blank line between paragraphs). */
export function htmlToText(html: string): string {
  const s = html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|blockquote|h[1-6]|li)\s*>/gi, "\n\n")
    .replace(/<\s*(p|div|blockquote|h[1-6])(\s[^>]*)?>/gi, "\n\n")
    .replace(/<\s*li(\s[^>]*)?>/gi, "\n• ")
    .replace(/<[^>]+>/g, "");
  return normalizeParagraphs(decodeEntities(s));
}

export function normalizeParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function paragraphs(text: string): string[] {
  return normalizeParagraphs(text).split(/\n{2,}/).filter(Boolean);
}

export function wordCount(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length;
}

export function excerpt(text: string, maxWords = 60): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ").replace(/[,;:.!?-]+$/, "") + "…";
}

export function slugify(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

export function normalizeTitle(s: string): string {
  return slugify(s).replace(/-/g, "");
}

/** Parses "/watch/tv/12-breaking-bad" style id prefix. */
export function idFromSlug(slug: string): number | null {
  const m = /^(\d+)(?:-|$)/.exec(slug);
  return m ? Number(m[1]) : null;
}
