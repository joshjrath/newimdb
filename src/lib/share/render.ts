import { STAR_PATH } from "@/components/Stars";
import { STATUS_LABEL, TYPE_LABEL, type MediaType, type WatchStatus } from "@/lib/domain/types";
import { paragraphs } from "@/lib/domain/text";
import { FONTS, PALETTES, excerptOf, shapeOf, type ShareOptions } from "./options";

/** Everything about a title that can go on a share image. */
export interface ShareData {
  title: string;
  year: number | null;
  type: MediaType;
  posterUrl: string | null;
  backdropUrl?: string | null;
  rating: number | null;
  ratingLabel: string | null;
  status: WatchStatus | null;
  body: string;
  spoiler: boolean;
  imdb?: number | null;
  genres?: string[];
  watchedOn?: string | null;
  watchedIn?: "theater" | "streaming" | null;
  people?: string[];
}

export interface Art {
  poster: HTMLImageElement | null;
  backdrop: HTMLImageElement | null;
  upload: HTMLImageElement | null;
  base: [number, number, number];
}

const STATUS_COLOR: Record<WatchStatus, string> = { watching: "#8fb4ff", completed: "#6fdc98", dropped: "#ff7d7d", plan: "#c6b8f0", on_hold: "#e6c56f" };

/* ---------------- small helpers ---------------- */

export function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const shade = ([r, g, b]: [number, number, number], f: number) => `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;

/** Average of the more saturated pixels: a usable "dominant" colour. */
export function dominantColor(img: HTMLImageElement): [number, number, number] {
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
    const w = 0.2 + (max === 0 ? 0 : (max - min) / max) * 2;
    r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
  }
  return n ? [r / n, g / n, b / n] : [40, 52, 80];
}

type Source = HTMLImageElement | HTMLCanvasElement;
const dims = (img: Source) => ({ w: img instanceof HTMLImageElement ? img.naturalWidth : img.width, h: img instanceof HTMLImageElement ? img.naturalHeight : img.height });

/** Fill a box with an image, cropping (not stretching) it. */
function cover(ctx: CanvasRenderingContext2D, img: Source, x: number, y: number, w: number, h: number) {
  const d = dims(img);
  const r = Math.max(w / d.w, h / d.h);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (d.w - sw) / 2, (d.h - sh) / 2, sw, sh, x, y, w, h);
}

/** A soft blur that works in every browser: shrink a lot, then scale back up smoothly. */
function blurred(img: Source, w: number, h: number, amount: number): HTMLCanvasElement {
  const side = Math.round(8 + (1 - amount) * 140);
  const tiny = document.createElement("canvas");
  tiny.width = side;
  tiny.height = Math.max(4, Math.round((side * h) / w));
  const t = tiny.getContext("2d")!;
  t.imageSmoothingQuality = "high";
  cover(t, img, 0, 0, tiny.width, tiny.height);
  let cur: HTMLCanvasElement = tiny;
  while (cur.width * 4 < w) {
    const next = document.createElement("canvas");
    next.width = cur.width * 4;
    next.height = cur.height * 4;
    const n = next.getContext("2d")!;
    n.imageSmoothingQuality = "high";
    n.drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const o = out.getContext("2d")!;
  o.imageSmoothingQuality = "high";
  o.drawImage(cur, 0, 0, w, h);
  return out;
}

let grainTile: HTMLCanvasElement | null = null;
function grain() {
  if (grainTile) return grainTile;
  grainTile = document.createElement("canvas");
  grainTile.width = grainTile.height = 160;
  const g = grainTile.getContext("2d")!;
  const id = g.createImageData(160, 160);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.random() * 255;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = Math.random() * 26;
  }
  g.putImageData(id, 0, 0);
  return grainTile;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    let line = "";
    for (const w of raw.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width <= width || !line) line = test;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/** Cut a line to fit, ending in an ellipsis. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, width: number) {
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t.replace(/[\s,.;:]+$/, "")}…`;
}

function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, value: number, accent: string, empty: string) {
  const path = new Path2D(STAR_PATH);
  const gap = size * 0.14;
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.translate(x + i * (size + gap), y);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = empty;
    ctx.fill(path);
    const fill = Math.max(0, Math.min(1, value - i));
    if (fill > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 24 * fill, 24);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fill(path);
      ctx.restore();
    }
    ctx.restore();
  }
  return 5 * size + 4 * gap;
}

const fmtScore = (r: number) => (Number.isInteger(r) ? String(r) : r.toFixed(1));
const fmtDate = (d: string) => {
  const t = new Date(`${d}T12:00:00`);
  return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/* ---------------- the renderer ---------------- */

type Line = { text: string; gapBefore: boolean };
interface Box { x: number; y: number; w: number; h: number }

/**
 * Draws the share image(s). Several canvases come back only when the review is set to
 * continue across a carousel.
 */
export function renderSlides(data: ShareData, o: ShareOptions, art: Art): HTMLCanvasElement[] {
  const W = Math.round(o.w), H = Math.round(o.h);
  const shape = shapeOf(W, H);
  const wide = shape === "landscape" || shape === "banner";
  // Scale by the image's area (so tall stories and wide posts both get big, readable type),
  // but never so big that a narrow side can't hold it.
  const u = Math.min(Math.sqrt(W * H) / 1080, (Math.min(W, H) / 1080) * 1.45);
  const s = o.textScale;
  const P = Math.round(Math.min(W, H) * 0.066 * o.margin);
  const font = FONTS[o.font];
  const tc = (a: number) => rgba(o.text, a);
  const center = o.align === "center";
  const layout = o.layout;
  const show = o.show;
  const posterImg = art.poster;
  const artImg = (o.art === "backdrop" ? art.backdrop : null) ?? art.poster ?? art.backdrop;
  const bodyText = show.review ? (o.reviewMode === "excerpt" ? excerptOf(data.body, o.excerpt) : data.body.trim()) : "";
  const showPoster = show.poster && layout !== "minimal" && layout !== "cinematic";
  const imageBg = o.bg === "blur" || o.bg === "image" || layout === "cinematic";

  const textShadow = (ctx: CanvasRenderingContext2D, on: boolean) => {
    if (on && o.shadowText) {
      ctx.shadowColor = "rgba(0,0,0,0.38)";
      ctx.shadowBlur = 18 * u;
      ctx.shadowOffsetY = 2 * u;
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
  };

  /* background */
  const paintBg = (ctx: CanvasRenderingContext2D) => {
    const lin = (c1: string, c2: string) => {
      const a = ((o.angle - 90) * Math.PI) / 180;
      const r = Math.hypot(W, H) / 2;
      const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * r, H / 2 - Math.sin(a) * r, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
      g.addColorStop(0, c1);
      g.addColorStop(1, c2);
      return g;
    };
    let dimmed = false;
    if (o.bg === "solid") ctx.fillStyle = o.color1;
    else if (o.bg === "gradient") ctx.fillStyle = lin(o.color1, o.color2);
    else if (o.bg === "palette") {
      const p = PALETTES.find((x) => x.key === o.palette) ?? PALETTES[0];
      ctx.fillStyle = lin(p.c1, p.c2);
    } else {
      const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
      g.addColorStop(0, shade(art.base, 0.62));
      g.addColorStop(0.55, shade(art.base, 0.32));
      g.addColorStop(1, shade(art.base, 0.14));
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, W, H);
    const src = o.bg === "image" ? art.upload : o.bg === "blur" ? artImg : null;
    if (src) {
      if (o.bg === "image" && o.blur < 0.05) cover(ctx, src, 0, 0, W, H);
      else ctx.drawImage(blurred(src, W, H, o.bg === "image" ? o.blur : Math.max(0.35, o.blur)), 0, 0);
      dimmed = true;
    }
    if (layout === "cinematic" && artImg) {
      cover(ctx, artImg, 0, 0, W, H);
      const g = ctx.createLinearGradient(0, wide ? 0 : H * 0.2, 0, H);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(wide ? 0.35 : 0.45, "rgba(0,0,0,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0.9)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      if (wide) {
        const side = ctx.createLinearGradient(0, 0, W * 0.75, 0);
        side.addColorStop(0, "rgba(0,0,0,0.75)");
        side.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = side;
        ctx.fillRect(0, 0, W, H);
      }
      dimmed = true;
    }
    if (o.dim > 0 && (dimmed || o.bg === "auto")) {
      ctx.fillStyle = `rgba(0,0,0,${o.dim * (layout === "cinematic" ? 0.6 : 1)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (o.vignette) {
      const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, "rgba(0,0,0,0.42)");
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    if (o.grain) {
      ctx.fillStyle = ctx.createPattern(grain(), "repeat")!;
      ctx.fillRect(0, 0, W, H);
    }
  };

  const drawPoster = (ctx: CanvasRenderingContext2D, b: Box) => {
    const r = o.posterRadius * u;
    ctx.save();
    textShadow(ctx, false);
    if (o.posterShadow) {
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 48 * u;
      ctx.shadowOffsetY = 18 * u;
    }
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, r);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, r);
    ctx.clip();
    if (posterImg) cover(ctx, posterImg, b.x, b.y, b.w, b.h);
    else {
      ctx.fillStyle = tc(0.8);
      ctx.font = `700 ${Math.round(b.w / 9)}px ${font.head}`;
      ctx.textAlign = "left";
      wrap(ctx, data.title, b.w * 0.8).slice(0, 6).forEach((l, i) => ctx.fillText(l, b.x + b.w * 0.1, b.y + b.w * 0.22 + i * (b.w / 7.5)));
    }
    ctx.restore();
    if (o.posterBorder) {
      ctx.save();
      ctx.strokeStyle = rgba(o.accent, 0.9);
      ctx.lineWidth = Math.max(2, 5 * u);
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, r);
      ctx.stroke();
      ctx.restore();
    }
  };

  /** Text at x within a column of width w, honouring the alignment. */
  const put = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, al = o.align) => {
    ctx.textAlign = al === "center" ? "center" : "left";
    ctx.fillText(text, al === "center" ? x + w / 2 : x, y);
  };

  /** Title, kicker, meta, stars, label and chips. Returns the y below it. */
  const header = (ctx: CanvasRenderingContext2D, x: number, y0: number, w: number, opt: { titleSize: number; maxLines: number; noScore?: boolean; al?: "left" | "center" }) => {
    const al = opt.al ?? o.align;
    let y = y0;
    textShadow(ctx, imageBg);
    if (show.kicker && o.kicker.trim()) {
      const k = Math.round(22 * u * s);
      ctx.font = `800 ${k}px ${font.head}`;
      ctx.fillStyle = o.accent;
      if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${(k * 0.16).toFixed(1)}px`;
      y += k;
      put(ctx, o.kicker.trim().toUpperCase(), x, y, w, al);
      if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
      y += k * 0.9;
    }
    if (show.title) {
      let size = Math.round(opt.titleSize * u * s);
      const min = Math.round(30 * u * s);
      let lines: string[];
      for (;;) {
        ctx.font = `800 ${size}px ${font.head}`;
        lines = wrap(ctx, data.title, w);
        if (lines.length <= opt.maxLines || size <= min) break;
        size = Math.max(min, Math.round(size * 0.9));
      }
      if (lines.length > opt.maxLines) lines = [...lines.slice(0, opt.maxLines - 1), ellipsize(ctx, lines.slice(opt.maxLines - 1).join(" "), w)];
      ctx.fillStyle = o.text;
      for (const l of lines) {
        y += size * 1.02;
        put(ctx, l, x, y, w, al);
        y += size * 0.08;
      }
      y += size * 0.12;
    }
    if (show.meta || (show.genres && data.genres?.length)) {
      const m = Math.round(26 * u * s);
      ctx.font = `500 ${m}px ${font.body}`;
      ctx.fillStyle = tc(0.72);
      const bits = [...(show.meta ? [data.year, TYPE_LABEL[data.type]] : []), ...(show.genres ? (data.genres ?? []).slice(0, 3) : [])].filter(Boolean).join("  ·  ");
      if (bits) {
        for (const l of wrap(ctx, bits, w).slice(0, 2)) {
          y += m * 1.45;
          put(ctx, l, x, y, w, al);
        }
        y += m * 0.2;
      }
    }
    const scoreOn = show.score && !opt.noScore;
    if (data.rating != null && (show.stars || scoreOn)) {
      const st = Math.round(46 * u * s);
      y += st * 0.45;
      const scoreFont = `800 ${Math.round(st * 0.92)}px ${font.head}`;
      ctx.font = scoreFont;
      const scoreText = fmtScore(data.rating);
      const scoreW = scoreOn ? ctx.measureText(scoreText).width + ctx.measureText("/5").width * 0.6 + st * 0.4 : 0;
      const starsW = show.stars ? 5 * st + 4 * st * 0.14 : 0;
      const total = starsW + (show.stars && scoreOn ? st * 0.45 : 0) + scoreW;
      let cx = al === "center" ? x + (w - total) / 2 : x;
      if (show.stars) {
        textShadow(ctx, false);
        cx += drawStars(ctx, cx, y, st, data.rating, o.accent, tc(0.2)) + (scoreOn ? st * 0.45 : 0);
        textShadow(ctx, imageBg);
      }
      if (scoreOn) {
        ctx.textAlign = "left";
        ctx.font = scoreFont;
        ctx.fillStyle = o.text;
        ctx.fillText(scoreText, cx, y + st * 0.86);
        const sw = ctx.measureText(scoreText).width;
        ctx.font = `700 ${Math.round(st * 0.55)}px ${font.head}`;
        ctx.fillStyle = tc(0.6);
        ctx.fillText("/5", cx + sw + st * 0.08, y + st * 0.86);
      }
      y += st * 1.15;
    }
    if (show.label && data.ratingLabel && data.rating != null) {
      const l = Math.round(30 * u * s);
      ctx.font = `700 ${l}px ${font.head}`;
      ctx.fillStyle = tc(0.92);
      y += l * 1.2;
      put(ctx, data.ratingLabel, x, y, w, al);
      y += l * 0.25;
    }
    // chips
    const chips: { text: string; color?: string; fill?: string; ink?: string }[] = [];
    if (show.status && data.status) chips.push({ text: STATUS_LABEL[data.status], color: STATUS_COLOR[data.status] });
    if (show.imdb && data.imdb != null) chips.push({ text: `IMDb ${data.imdb.toFixed(1)}`, fill: "#f5c518", ink: "#000" });
    if (show.watched && (data.watchedIn || data.watchedOn)) chips.push({ text: [data.watchedIn === "theater" ? "In a theater" : data.watchedIn === "streaming" ? "Streaming" : null, data.watchedOn ? fmtDate(data.watchedOn) : null].filter(Boolean).join(" · ") });
    if (show.people) chips.push({ text: data.people?.length ? `With ${data.people.slice(0, 3).join(", ")}${data.people.length > 3 ? ` +${data.people.length - 3}` : ""}` : "Watched alone" });
    if (show.spoiler && data.spoiler && show.review && bodyText) chips.push({ text: "Spoilers", fill: "#ff5b5b", ink: "#fff" });
    if (chips.length) {
      const ch = Math.round(42 * u * s);
      const f = Math.round(22 * u * s);
      ctx.font = `700 ${f}px ${font.body}`;
      const widths = chips.map((c) => ctx.measureText(c.text).width + ch * (c.color ? 1.25 : 0.8));
      const gap = ch * 0.25;
      const rows: number[][] = [[]];
      let rw = 0;
      widths.forEach((cw, i) => {
        if (rw + cw > w && rows[rows.length - 1].length) {
          rows.push([]);
          rw = 0;
        }
        rows[rows.length - 1].push(i);
        rw += cw + gap;
      });
      y += ch * 0.45;
      textShadow(ctx, false);
      for (const row of rows) {
        const total = row.reduce((a, i) => a + widths[i], 0) + gap * (row.length - 1);
        let cx = al === "center" ? x + (w - total) / 2 : x;
        for (const i of row) {
          const c = chips[i];
          ctx.beginPath();
          ctx.roundRect(cx, y, widths[i], ch, ch / 2);
          if (c.fill) {
            ctx.fillStyle = c.fill;
            ctx.fill();
          } else {
            ctx.fillStyle = tc(0.1);
            ctx.fill();
            ctx.strokeStyle = c.color ?? tc(0.35);
            ctx.lineWidth = Math.max(1.5, 2 * u);
            ctx.stroke();
          }
          let tx = cx + ch * 0.4;
          if (c.color) {
            ctx.fillStyle = c.color;
            ctx.beginPath();
            ctx.arc(cx + ch * 0.48, y + ch / 2, ch * 0.13, 0, Math.PI * 2);
            ctx.fill();
            tx = cx + ch * 0.85;
          }
          ctx.fillStyle = c.ink ?? (c.color ?? o.text);
          ctx.textAlign = "left";
          ctx.fillText(c.text, tx, y + ch * 0.66);
          cx += widths[i] + gap;
        }
        y += ch + gap;
      }
      textShadow(ctx, imageBg);
    }
    return y;
  };

  /** The huge number for the "Big score" layout. */
  const bigScore = (ctx: CanvasRenderingContext2D, x: number, y0: number, w: number, size: number) => {
    if (data.rating == null) return y0;
    const n = fmtScore(data.rating);
    let sz = Math.round(size * u * s);
    ctx.font = `900 ${sz}px ${font.head}`;
    while (ctx.measureText(`${n}/5`).width > w && sz > 40) {
      sz = Math.round(sz * 0.9);
      ctx.font = `900 ${sz}px ${font.head}`;
    }
    textShadow(ctx, imageBg);
    const nw = ctx.measureText(n).width;
    ctx.font = `800 ${Math.round(sz * 0.3)}px ${font.head}`;
    const sw = ctx.measureText("/5").width;
    const x0 = o.align === "center" ? x + (w - nw - sw) / 2 : x;
    ctx.textAlign = "left";
    ctx.font = `900 ${sz}px ${font.head}`;
    ctx.fillStyle = o.accent;
    ctx.fillText(n, x0, y0 + sz * 0.82);
    ctx.font = `800 ${Math.round(sz * 0.3)}px ${font.head}`;
    ctx.fillStyle = tc(0.6);
    ctx.fillText("/5", x0 + nw + sz * 0.04, y0 + sz * 0.82);
    return y0 + sz * 0.92;
  };

  /* review text */
  const layoutBody = (ctx: CanvasRenderingContext2D, size: number, width: number): Line[] => {
    ctx.font = `400 ${size}px ${font.body}`;
    const out: Line[] = [];
    paragraphs(bodyText).forEach((p, pi) => wrap(ctx, p, width).forEach((l, li) => out.push({ text: l, gapBefore: pi > 0 && li === 0 })));
    return out;
  };
  const adv = (l: Line, size: number) => size * 1.45 + (l.gapBefore ? size * 0.6 : 0);
  const hOf = (ls: Line[], size: number) => ls.reduce((a, l) => a + adv(l, size), 0);
  const quoteH = (size: number) => (o.quote ? size * 1.5 : 0);
  /** Fit the review into a box: shrink to a floor, then cut with an ellipsis. */
  const fitBody = (ctx: CanvasRenderingContext2D, width: number, avail: number, base: number, floor: number) => {
    let size = base;
    let lines = layoutBody(ctx, size, width);
    while (size > floor && hOf(lines, size) + quoteH(size) > avail) {
      size = Math.max(floor, Math.round(size * 0.93));
      lines = layoutBody(ctx, size, width);
    }
    if (hOf(lines, size) + quoteH(size) <= avail) return { size, lines, rest: [] as Line[] };
    const keep: Line[] = [];
    let used = quoteH(size);
    for (const l of lines) {
      if (used + adv(l, size) > avail) break;
      keep.push(l);
      used += adv(l, size);
    }
    return { size, lines: keep, rest: lines.slice(keep.length) };
  };
  const drawBody = (ctx: CanvasRenderingContext2D, x: number, y0: number, w: number, size: number, lines: Line[], cut: boolean, quote: boolean) => {
    let y = y0;
    textShadow(ctx, imageBg);
    if (quote && o.quote && lines.length) {
      ctx.font = `900 ${Math.round(size * 3.2)}px ${font.head}`;
      ctx.fillStyle = rgba(o.accent, 0.85);
      put(ctx, "“", x, y + size * 2.15, w);
      y += quoteH(size);
    }
    ctx.font = `400 ${size}px ${font.body}`;
    ctx.fillStyle = tc(0.95);
    lines.forEach((l, i) => {
      y += adv(l, size);
      const text = cut && i === lines.length - 1 ? ellipsize(ctx, `${l.text} …`, w) : l.text;
      put(ctx, text, x, y - size * 0.35, w);
    });
    return y;
  };

  const footerOn = (pages: number) => Boolean(o.footer.trim()) || (pages > 1 && show.pages);
  const footerH = (pages: number) => (footerOn(pages) ? Math.round(46 * u * s) : 0);
  const drawFooter = (ctx: CanvasRenderingContext2D, page: number, pages: number) => {
    if (!footerOn(pages)) return;
    const f = Math.round(24 * u * s);
    const y = H - P * 0.75;
    ctx.font = `600 ${f}px ${font.body}`;
    ctx.fillStyle = tc(0.72);
    textShadow(ctx, imageBg);
    if (o.footer.trim()) put(ctx, o.footer.trim(), P, y, W - P * 2, pages > 1 && show.pages ? "left" : o.align);
    if (pages > 1 && show.pages) {
      // dots, the current one filled
      const r = f * 0.22, gap = f * 0.7;
      const total = (pages - 1) * gap;
      const x0 = W - P - total;
      textShadow(ctx, false);
      for (let i = 0; i < pages; i++) {
        ctx.beginPath();
        ctx.arc(x0 + i * gap, y - f * 0.32, i === page - 1 ? r * 1.35 : r, 0, Math.PI * 2);
        ctx.fillStyle = i === page - 1 ? o.accent : tc(0.35);
        ctx.fill();
      }
    }
  };

  /* plan the first slide */
  const probe = document.createElement("canvas").getContext("2d")!;
  const carousel = o.reviewMode === "carousel";
  const fH = footerH(carousel ? 2 : 1);
  const gap = Math.round(40 * u);
  const bodyBase = Math.round((wide ? 36 : 42) * u * s);
  const bodyFloor = Math.round((carousel ? 30 : 22) * u * s);

  type Plan = {
    poster: Box | null;
    score: Box | null;
    head: { x: number; y: number; w: number; titleSize: number; maxLines: number; noScore?: boolean };
    body: { x: number; w: number };
    /** where the body may go, given where the header ends */
    bodyTop: (headBottom: number, scoreBottom: number) => number;
    bottom: number;
    anchor: "top" | "bottom" | "center";
    /** most height the header + body block may take (bottom / center anchors) */
    maxBlock?: number;
    /** the poster sits above the header and moves with it when centring */
    posterMoves?: boolean;
  };

  const plan = (): Plan => {
    const bottom = H - P - fH;
    if (layout === "hero") {
      if (wide) {
        const ph = H - P * 2, pw = ph / 1.5;
        const colW = W - P * 3 - pw;
        return { poster: showPoster ? { x: W - P - pw, y: P, w: pw, h: ph } : null, score: null, head: { x: P, y: P, w: showPoster ? colW : W - P * 2, titleSize: 72, maxLines: 3 }, body: { x: P, w: showPoster ? colW : W - P * 2 }, bodyTop: (hb) => hb + gap * 0.6, bottom, anchor: "center", maxBlock: H - P * 2 - fH };
      }
      const pw = Math.min(W * (shape === "portrait" ? 0.5 : 0.36), (H * (shape === "portrait" ? 0.4 : 0.42)) / 1.5);
      const ph = pw * 1.5;
      const poster = showPoster ? { x: (W - pw) / 2, y: P, w: pw, h: ph } : null;
      const top = poster ? P + ph + gap * 1.1 : P;
      return { poster, posterMoves: true, score: null, head: { x: P, y: top, w: W - P * 2, titleSize: 66, maxLines: 2 }, body: { x: P, w: W - P * 2 }, bodyTop: (hb) => hb + gap * 0.6, bottom, anchor: "center", maxBlock: H - P * 2 - fH - (poster ? ph + gap * 1.1 : 0) };
    }
    if (layout === "cinematic") {
      const colW = wide ? W * 0.58 : W - P * 2;
      return { poster: null, score: null, head: { x: P, y: P, w: colW, titleSize: wide ? 74 : 80, maxLines: 3 }, body: { x: P, w: colW }, bodyTop: (hb) => hb + gap * 0.6, bottom, anchor: "bottom", maxBlock: (H - P - fH) * (wide ? 0.92 : 0.72) };
    }
    if (layout === "minimal") {
      return { poster: null, score: null, head: { x: P * 1.4, y: P, w: W - P * 2.8, titleSize: wide ? 84 : 92, maxLines: 3 }, body: { x: P * 1.4, w: W - P * 2.8 }, bodyTop: (hb) => hb + gap, bottom, anchor: "center", maxBlock: H - P * 2 - fH };
    }
    if (layout === "spotlight") {
      if (wide) {
        const ph = H - P * 2, pw = ph / 1.5;
        const x = showPoster ? P * 2 + pw : P;
        const w = W - x - P;
        return { poster: showPoster ? { x: P, y: P, w: pw, h: ph } : null, score: { x, y: P, w, h: 0 }, head: { x, y: P, w, titleSize: 54, maxLines: 2, noScore: true }, body: { x, w }, bodyTop: (hb) => hb + gap * 0.5, bottom, anchor: "top" };
      }
      const pw = W * (shape === "portrait" ? 0.34 : 0.3), ph = pw * 1.5;
      const scoreW = showPoster ? W - P * 2 - pw - gap : W - P * 2;
      return {
        poster: showPoster ? { x: W - P - pw, y: P, w: pw, h: ph } : null,
        score: { x: P, y: P, w: scoreW, h: 0 },
        head: { x: P, y: P, w: W - P * 2, titleSize: 60, maxLines: 2, noScore: true },
        body: { x: P, w: W - P * 2 },
        bodyTop: (hb) => hb + gap * 0.6,
        bottom,
        anchor: "top",
      };
    }
    // classic
    if (wide) {
      const ph = H - P * 2 - (shape === "banner" ? 0 : fH), pw = ph / 1.5;
      const x = showPoster ? P + pw + gap * 1.2 : P;
      const w = W - x - P;
      return { poster: showPoster ? { x: P, y: P, w: pw, h: ph } : null, score: null, head: { x, y: P, w, titleSize: 60, maxLines: 2 }, body: { x, w }, bodyTop: (hb) => hb + gap * 0.6, bottom, anchor: "top" };
    }
    const pw = W * (shape === "portrait" ? 0.3 : 0.27), ph = pw * 1.5;
    const hx = showPoster ? P + pw + gap : P;
    const posterBottom = showPoster ? P + ph : 0;
    return {
      poster: showPoster ? { x: P, y: P, w: pw, h: ph } : null,
      score: null,
      head: { x: hx, y: P, w: W - hx - P, titleSize: 56, maxLines: 4 },
      body: { x: P, w: W - P * 2 },
      bodyTop: (hb) => Math.max(hb, posterBottom) + gap * 1.1,
      bottom,
      anchor: "top",
    };
  };

  const pl = plan();
  // Measure the header (and big score) on a scratch canvas.
  probe.canvas.width = W;
  probe.canvas.height = H;
  const scoreBottom0 = pl.score ? bigScore(probe, pl.score.x, pl.score.y, pl.score.w, wide ? 230 : 280) : 0;
  const headY0 = pl.score ? (pl.poster && !wide ? Math.max(scoreBottom0, pl.poster.y + pl.poster.h) + gap * 0.6 : scoreBottom0 + gap * 0.3) : pl.head.y;
  const headBottom0 = header(probe, pl.head.x, headY0, pl.head.w, pl.head);
  const headH = headBottom0 - headY0;

  // Body room on slide 1.
  let bodyTop = pl.bodyTop(headBottom0, scoreBottom0);
  let avail = pl.bottom - bodyTop;
  if (pl.anchor !== "top") avail = (pl.maxBlock ?? H) - headH - gap;
  const hasBody = Boolean(bodyText);
  let fit = hasBody && avail > bodyFloor * 2.2 ? fitBody(probe, pl.body.w, avail, bodyBase, bodyFloor) : { size: bodyBase, lines: [] as Line[], rest: hasBody ? layoutBody(probe, bodyBase, pl.body.w) : [] };

  // Carousel: the rest continues on more slides at the same size.
  const pages: Line[][] = [fit.lines];
  if (carousel && fit.rest.length) {
    const size = fit.size;
    const rest = fit.lines.length ? fit.rest : layoutBody(probe, size, W - P * 2);
    const room = H - P * 2 - fH - Math.round(70 * u * s);
    let cur: Line[] = [];
    let used = 0;
    for (const l0 of rest) {
      const l = cur.length ? l0 : { ...l0, gapBefore: false };
      if (used + adv(l, size) > room && cur.length) {
        pages.push(cur);
        cur = [];
        used = 0;
      }
      cur.push(cur.length ? l : { ...l, gapBefore: false });
      used += adv(l, size);
    }
    if (cur.length) pages.push(cur);
    fit = { ...fit, rest: [] };
  }
  const total = pages.length;
  const cut = !carousel && fit.rest.length > 0;

  const slides: HTMLCanvasElement[] = [];
  for (let p = 0; p < total; p++) {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.textBaseline = "alphabetic";
    paintBg(ctx);
    if (p === 0) {
      const bodyH = fit.lines.length ? hOf(fit.lines, fit.size) + quoteH(fit.size) : 0;
      let offset = 0;
      if (pl.anchor === "bottom") offset = pl.bottom - (headH + (bodyH ? gap * 0.6 + bodyH : 0)) - headY0;
      if (pl.anchor === "center") {
        const blockTop = pl.posterMoves && pl.poster ? pl.poster.y : headY0;
        const total = headY0 - blockTop + headH + (bodyH ? gap + bodyH : 0);
        offset = Math.max(P - blockTop, (H - fH - total) / 2 - blockTop);
      }
      if (pl.poster) drawPoster(ctx, pl.posterMoves ? { ...pl.poster, y: pl.poster.y + offset } : pl.poster);
      if (pl.score) bigScore(ctx, pl.score.x, pl.score.y + offset, pl.score.w, wide ? 230 : 280);
      const hb = header(ctx, pl.head.x, headY0 + offset, pl.head.w, pl.head);
      bodyTop = pl.anchor === "top" ? pl.bodyTop(hb, scoreBottom0) : hb + (pl.anchor === "center" ? gap : gap * 0.6);
      if (fit.lines.length) drawBody(ctx, pl.body.x, bodyTop, pl.body.w, fit.size, fit.lines, cut, true);
    } else {
      const k = Math.round(28 * u * s);
      textShadow(ctx, imageBg);
      ctx.font = `800 ${k}px ${font.head}`;
      ctx.fillStyle = tc(0.7);
      const cont = `${data.title} — continued`;
      put(ctx, ctx.measureText(cont).width <= W - P * 2 ? cont : ellipsize(ctx, cont, W - P * 2), P, P + k, W - P * 2);
      drawBody(ctx, P, P + k + Math.round(40 * u * s), W - P * 2, fit.size, pages[p], false, false);
    }
    drawFooter(ctx, p + 1, total);
    slides.push(c);
  }
  return slides;
}
