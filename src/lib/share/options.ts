/**
 * The Share image studio's settings: sizes for every platform, layouts, backgrounds,
 * colours, fonts and what to show. Pure data, so it can be tested and saved per device.
 */

export interface SizePreset {
  key: string;
  platform: string;
  label: string;
  w: number;
  h: number;
}

export const SIZE_PRESETS: SizePreset[] = [
  { key: "ig-portrait", platform: "Instagram", label: "Post, portrait (4:5)", w: 1080, h: 1350 },
  { key: "ig-square", platform: "Instagram", label: "Post, square", w: 1080, h: 1080 },
  { key: "ig-story", platform: "Instagram", label: "Story / Reel", w: 1080, h: 1920 },
  { key: "ig-land", platform: "Instagram", label: "Post, landscape", w: 1080, h: 566 },
  { key: "x-post", platform: "X / Twitter", label: "Post (16:9)", w: 1600, h: 900 },
  { key: "x-header", platform: "X / Twitter", label: "Header", w: 1500, h: 500 },
  { key: "dc-chat", platform: "Discord", label: "Chat image", w: 1200, h: 675 },
  { key: "dc-banner", platform: "Discord", label: "Server banner", w: 960, h: 540 },
  { key: "dc-profile", platform: "Discord", label: "Profile banner", w: 680, h: 240 },
  { key: "yt-thumb", platform: "YouTube", label: "Thumbnail", w: 1280, h: 720 },
  { key: "yt-post", platform: "YouTube", label: "Community post", w: 1080, h: 1080 },
  { key: "yt-banner", platform: "YouTube", label: "Channel banner", w: 2560, h: 1440 },
  { key: "tiktok", platform: "TikTok", label: "Video cover", w: 1080, h: 1920 },
  { key: "threads", platform: "Threads", label: "Post", w: 1080, h: 1350 },
  { key: "bsky", platform: "Bluesky", label: "Post", w: 1200, h: 675 },
  { key: "fb", platform: "Facebook", label: "Post / link", w: 1200, h: 630 },
  { key: "pin", platform: "Pinterest", label: "Pin (2:3)", w: 1000, h: 1500 },
  { key: "reddit", platform: "Reddit", label: "Post", w: 1200, h: 900 },
  { key: "phone", platform: "Other", label: "Phone wallpaper", w: 1170, h: 2532 },
  { key: "desktop", platform: "Other", label: "Desktop wallpaper", w: 1920, h: 1080 },
];

export const SIZE_MIN = 200;
export const SIZE_MAX = 4096;
export const clampSize = (n: number) => Math.round(Math.max(SIZE_MIN, Math.min(SIZE_MAX, Number.isFinite(n) ? n : 1080)));

export const LAYOUTS = [
  { key: "classic", label: "Classic", hint: "Poster beside the title, review below" },
  { key: "hero", label: "Poster hero", hint: "A big poster front and centre" },
  { key: "cinematic", label: "Cinematic", hint: "Full-bleed artwork, text over a fade" },
  { key: "spotlight", label: "Big score", hint: "Your rating, huge" },
  { key: "minimal", label: "Minimal", hint: "Type only, centred and clean" },
] as const;
export type LayoutKey = (typeof LAYOUTS)[number]["key"];

export const BG_KINDS = [
  { key: "auto", label: "From the poster" },
  { key: "blur", label: "Blurred artwork" },
  { key: "palette", label: "Palette" },
  { key: "gradient", label: "Gradient" },
  { key: "solid", label: "Solid colour" },
  { key: "image", label: "Your image" },
] as const;
export type BgKind = (typeof BG_KINDS)[number]["key"];

/** Ready-made two-colour backgrounds (with a text colour that reads well on them). */
export const PALETTES: { key: string; label: string; c1: string; c2: string; text: string; accent: string }[] = [
  { key: "midnight", label: "Midnight", c1: "#151a33", c2: "#05060d", text: "#ffffff", accent: "#f5c518" },
  { key: "sunset", label: "Sunset", c1: "#ff7a59", c2: "#6b1d5c", text: "#ffffff", accent: "#ffe27a" },
  { key: "ocean", label: "Ocean", c1: "#1fa2c7", c2: "#0b1f4b", text: "#ffffff", accent: "#9ff0ff" },
  { key: "forest", label: "Forest", c1: "#3f7d4e", c2: "#0d2117", text: "#ffffff", accent: "#d6f5a3" },
  { key: "candy", label: "Candy", c1: "#ffb3d9", c2: "#9b8cff", text: "#1b1030", accent: "#ffffff" },
  { key: "ember", label: "Ember", c1: "#e8452c", c2: "#1a0705", text: "#ffffff", accent: "#ffc861" },
  { key: "paper", label: "Paper", c1: "#f6f1e7", c2: "#e4dccb", text: "#1d1a16", accent: "#c2410c" },
  { key: "mono", label: "Mono", c1: "#2b2b2f", c2: "#0c0c0e", text: "#ffffff", accent: "#ffffff" },
  { key: "gold", label: "Gold", c1: "#f5c518", c2: "#b27a00", text: "#111111", accent: "#111111" },
  { key: "aurora", label: "Aurora", c1: "#43e7b0", c2: "#2b2a8c", text: "#ffffff", accent: "#f8f871" },
  { key: "noir", label: "Noir", c1: "#000000", c2: "#000000", text: "#f2f2f2", accent: "#e50914" },
  { key: "lilac", label: "Lilac", c1: "#c7b6f6", c2: "#5b4b9a", text: "#ffffff", accent: "#fff3a6" },
];

export const FONTS = {
  display: { label: "Bold grotesque", head: `"Bricolage Grotesque Variable", "Bricolage Grotesque", system-ui, sans-serif`, body: `"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` },
  sans: { label: "Clean sans", head: `"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`, body: `"Archivo", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif` },
  serif: { label: "Classic serif", head: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif`, body: `Georgia, "Times New Roman", serif` },
  mono: { label: "Typewriter", head: `ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace`, body: `ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace` },
} as const;
export type FontKey = keyof typeof FONTS;

export type ReviewMode = "fit" | "carousel" | "excerpt";

export interface ShareOptions {
  w: number;
  h: number;
  sizeKey: string;
  layout: LayoutKey;
  bg: BgKind;
  palette: string;
  color1: string;
  color2: string;
  angle: number;
  /** Where blurred / cinematic artwork comes from. */
  art: "poster" | "backdrop";
  /** 0–0.9: darken the background so text reads. */
  dim: number;
  blur: number;
  grain: boolean;
  vignette: boolean;
  text: string;
  accent: string;
  font: FontKey;
  align: "left" | "center";
  /** 0.7–1.5: everything's text size. */
  textScale: number;
  /** 0.5–2: space around the edges. */
  margin: number;
  posterRadius: number;
  posterShadow: boolean;
  posterBorder: boolean;
  shadowText: boolean;
  show: {
    poster: boolean;
    kicker: boolean;
    title: boolean;
    meta: boolean;
    genres: boolean;
    stars: boolean;
    score: boolean;
    label: boolean;
    status: boolean;
    imdb: boolean;
    watched: boolean;
    people: boolean;
    review: boolean;
    spoiler: boolean;
    pages: boolean;
  };
  kicker: string;
  footer: string;
  reviewMode: ReviewMode;
  excerpt: number;
  quote: boolean;
  format: "png" | "jpeg";
  quality: number;
  /** 1 or 2: export at double resolution. */
  scale: number;
}

export const DEFAULT_OPTIONS: ShareOptions = {
  w: 1080,
  h: 1350,
  sizeKey: "ig-portrait",
  layout: "classic",
  bg: "auto",
  palette: "midnight",
  color1: "#26305a",
  color2: "#0a0c18",
  angle: 160,
  art: "poster",
  dim: 0.35,
  blur: 0.6,
  grain: true,
  vignette: true,
  text: "#ffffff",
  accent: "#f5c518",
  font: "display",
  align: "left",
  textScale: 1,
  margin: 1,
  posterRadius: 18,
  posterShadow: true,
  posterBorder: false,
  shadowText: true,
  show: { poster: true, kicker: true, title: true, meta: true, genres: true, stars: true, score: true, label: true, status: true, imdb: true, watched: false, people: false, review: true, spoiler: true, pages: true },
  kicker: "My review",
  footer: "",
  reviewMode: "fit",
  excerpt: 280,
  quote: true,
  format: "png",
  quality: 0.92,
  scale: 1,
};

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const pick = <T extends string>(v: unknown, keys: readonly T[], d: T): T => (keys.includes(v as T) ? (v as T) : d);
const hex = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v) ? v : d);

/** Settings from storage (or anywhere), with anything missing or broken put back to its default. */
export function normalizeOptions(raw: unknown): ShareOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_OPTIONS;
  const show = (o.show && typeof o.show === "object" ? o.show : {}) as Record<string, unknown>;
  return {
    w: clampSize(num(o.w, SIZE_MIN, SIZE_MAX, d.w)),
    h: clampSize(num(o.h, SIZE_MIN, SIZE_MAX, d.h)),
    sizeKey: typeof o.sizeKey === "string" ? o.sizeKey.slice(0, 40) : d.sizeKey,
    layout: pick(o.layout, LAYOUTS.map((l) => l.key), d.layout),
    bg: pick(o.bg, BG_KINDS.map((b) => b.key), d.bg),
    palette: pick(o.palette, PALETTES.map((p) => p.key), d.palette),
    color1: hex(o.color1, d.color1),
    color2: hex(o.color2, d.color2),
    angle: num(o.angle, 0, 360, d.angle),
    art: o.art === "backdrop" ? "backdrop" : "poster",
    dim: num(o.dim, 0, 0.9, d.dim),
    blur: num(o.blur, 0, 1, d.blur),
    grain: typeof o.grain === "boolean" ? o.grain : d.grain,
    vignette: typeof o.vignette === "boolean" ? o.vignette : d.vignette,
    text: hex(o.text, d.text),
    accent: hex(o.accent, d.accent),
    font: pick(o.font, Object.keys(FONTS) as FontKey[], d.font),
    align: o.align === "center" ? "center" : "left",
    textScale: num(o.textScale, 0.7, 1.5, d.textScale),
    margin: num(o.margin, 0.5, 2, d.margin),
    posterRadius: num(o.posterRadius, 0, 60, d.posterRadius),
    posterShadow: typeof o.posterShadow === "boolean" ? o.posterShadow : d.posterShadow,
    posterBorder: typeof o.posterBorder === "boolean" ? o.posterBorder : d.posterBorder,
    shadowText: typeof o.shadowText === "boolean" ? o.shadowText : d.shadowText,
    show: Object.fromEntries(Object.entries(d.show).map(([k, v]) => [k, typeof show[k] === "boolean" ? show[k] : v])) as ShareOptions["show"],
    kicker: typeof o.kicker === "string" ? o.kicker.slice(0, 60) : d.kicker,
    footer: typeof o.footer === "string" ? o.footer.slice(0, 80) : d.footer,
    reviewMode: pick(o.reviewMode, ["fit", "carousel", "excerpt"] as const, d.reviewMode),
    excerpt: num(o.excerpt, 60, 2000, d.excerpt),
    quote: typeof o.quote === "boolean" ? o.quote : d.quote,
    format: o.format === "jpeg" ? "jpeg" : "png",
    quality: num(o.quality, 0.5, 1, d.quality),
    scale: o.scale === 2 ? 2 : 1,
  };
}

/** A review cut to about n characters, at a word, with an ellipsis. */
export function excerptOf(text: string, n: number): string {
  const t = text.trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const at = cut.lastIndexOf(" ");
  return `${(at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

/** Relative luminance 0–1 of a #rrggbb colour. */
export function luminance(hexColor: string): number {
  const v = HEX.test(hexColor) ? hexColor : "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(v.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Black or white, whichever reads better on these background colours. */
export const readableOn = (...colors: string[]) => (colors.reduce((a, c) => a + luminance(c), 0) / colors.length > 0.4 ? "#111111" : "#ffffff");

export const shapeOf = (w: number, h: number): "portrait" | "square" | "landscape" | "banner" => {
  const r = w / h;
  if (r >= 2.2) return "banner";
  if (r > 1.15) return "landscape";
  if (r < 0.87) return "portrait";
  return "square";
};
