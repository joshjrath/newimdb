"use client";
import { useEffect, useRef, useState } from "react";
import { posterSrc } from "@/lib/client/api";
import { STAR_PATH } from "./Stars";
import { STATUS_LABEL, TYPE_LABEL, type MediaType, type WatchStatus } from "@/lib/domain/types";
import { paragraphs } from "@/lib/domain/text";

export interface ShareData {
  title: string;
  year: number | null;
  type: MediaType;
  posterUrl: string | null;
  rating: number | null;
  ratingLabel: string | null;
  status: WatchStatus | null;
  body: string;
  spoiler: boolean;
}

const PRESETS = { portrait: { w: 1080, h: 1350, label: "Portrait 1080×1350" }, square: { w: 1080, h: 1080, label: "Square 1080×1080" } };
const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;
const SANS = `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
const STATUS_COLOR: Record<WatchStatus, string> = { watching: "#8fb4ff", completed: "#6fdc98", dropped: "#ff7d7d", plan: "#c6b8f0", on_hold: "#e6c56f" };

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Average of the more saturated pixels — a usable "dominant" colour for the gradient. */
function dominantColor(img: HTMLImageElement): [number, number, number] {
  const c = document.createElement("canvas");
  c.width = c.height = 24;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
    const sat = max === 0 ? 0 : (max - min) / max;
    const w = 0.2 + sat * 2;
    r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; n += w;
  }
  return n ? [r / n, g / n, b / n] : [40, 52, 80];
}

/** Darken so white text always has strong contrast. */
function shade([r, g, b]: [number, number, number], f: number) {
  return `rgb(${Math.round(r * f)}, ${Math.round(g * f)}, ${Math.round(b * f)})`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split("\n")) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
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

type Line = { text: string; gapBefore: boolean };

function layoutBody(ctx: CanvasRenderingContext2D, body: string, width: number, size: number): Line[] {
  ctx.font = `${size}px ${SERIF}`;
  const lines: Line[] = [];
  paragraphs(body).forEach((p, pi) => {
    wrap(ctx, p, width).forEach((l, li) => lines.push({ text: l, gapBefore: pi > 0 && li === 0 }));
  });
  return lines;
}

function linesHeight(lines: Line[], size: number) {
  const lh = size * 1.45;
  return lines.reduce((h, l) => h + lh + (l.gapBefore ? size * 0.7 : 0), 0);
}

function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, value: number) {
  const path = new Path2D(STAR_PATH);
  for (let i = 0; i < 5; i++) {
    ctx.save();
    ctx.translate(x + i * (size + 6), y);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fill(path);
    const fill = Math.max(0, Math.min(1, value - i));
    if (fill > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, 24 * fill, 24);
      ctx.clip();
      ctx.fillStyle = "#f4bf55";
      ctx.fill(path);
      ctx.restore();
    }
    ctx.restore();
  }
}

interface Rendered {
  slides: HTMLCanvasElement[];
  fontSize: number;
}

async function render(data: ShareData, preset: keyof typeof PRESETS, brand: string): Promise<Rendered> {
  const { w, h } = PRESETS[preset];
  const src = posterSrc(data.posterUrl);
  const img = src ? await loadImage(src) : null;
  const base = img ? dominantColor(img) : ([46, 60, 96] as [number, number, number]);
  const pad = 72;
  const posterW = preset === "portrait" ? 300 : 240;
  const posterH = posterW * 1.5;
  const textW = w - pad * 2;
  const footerH = 70;

  const paint = (ctx: CanvasRenderingContext2D) => {
    const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, shade(base, 0.62));
    g.addColorStop(0.55, shade(base, 0.32));
    g.addColorStop(1, shade(base, 0.14));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  const footer = (ctx: CanvasRenderingContext2D, page: number, pages: number) => {
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = `500 26px ${SANS}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(brand, pad, h - pad + 18);
    if (pages > 1) {
      const t = `${page} / ${pages}`;
      ctx.fillText(t, w - pad - ctx.measureText(t).width, h - pad + 18);
    }
  };

  // Measure the header on slide 1 to know how much room the review gets.
  const probe = document.createElement("canvas").getContext("2d")!;
  const headX = pad + posterW + 40;
  const headW = w - headX - pad;
  probe.font = `700 54px ${SERIF}`;
  const titleLines = wrap(probe, data.title, headW).slice(0, 4);
  const bodyTop1 = pad + posterH + 48;
  const avail1 = h - bodyTop1 - pad - footerH;
  const availN = h - pad * 2 - footerH - 60;
  const body = data.body.trim();

  // Fit: shrink from 40px to 26px; if it still doesn't fit, continue on extra slides.
  let size = 40;
  let lines = layoutBody(probe, body, textW, size);
  while (size > 26 && linesHeight(lines, size) > avail1) {
    size -= 2;
    lines = layoutBody(probe, body, textW, size);
  }
  const pagesLines: Line[][] = [[]];
  let room = avail1;
  let used = 0;
  for (const l of lines) {
    const lh = size * 1.45 + (l.gapBefore ? size * 0.7 : 0);
    if (used + lh > room && pagesLines[pagesLines.length - 1].length) {
      pagesLines.push([]);
      room = availN;
      used = 0;
      l.gapBefore = false;
    }
    pagesLines[pagesLines.length - 1].push(l);
    used += size * 1.45 + (l.gapBefore ? size * 0.7 : 0);
  }
  const pages = pagesLines.length;

  const slides: HTMLCanvasElement[] = [];
  for (let p = 0; p < pages; p++) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    paint(ctx);
    let y: number;
    if (p === 0) {
      // poster
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 16;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(pad, pad, posterW, posterH);
      ctx.restore();
      if (img) {
        // cover-fit into 2:3 without distorting
        const r = Math.max(posterW / img.width, posterH / img.height);
        const sw = posterW / r, sh = posterH / r;
        ctx.drawImage(img, (img.width - sw) / 2, 0, sw, sh, pad, pad, posterW, posterH);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = `600 30px ${SERIF}`;
        wrap(ctx, data.title, posterW - 40).slice(0, 5).forEach((l, i) => ctx.fillText(l, pad + 20, pad + 60 + i * 38));
      }
      // header
      let hy = pad + 50;
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 54px ${SERIF}`;
      titleLines.forEach((l) => {
        ctx.fillText(l, headX, hy);
        hy += 62;
      });
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `400 28px ${SANS}`;
      ctx.fillText([data.year, TYPE_LABEL[data.type]].filter(Boolean).join("  ·  "), headX, hy + 4);
      hy += 40;
      if (data.rating != null) {
        drawStars(ctx, headX, hy, 46, data.rating);
        hy += 86;
        if (data.ratingLabel) {
          ctx.fillStyle = "rgba(255,255,255,0.88)";
          ctx.font = `italic 30px ${SERIF}`;
          ctx.fillText(data.ratingLabel, headX, hy - 6);
          hy += 30;
        }
      }
      if (data.status) {
        const label = STATUS_LABEL[data.status];
        ctx.font = `600 24px ${SANS}`;
        const tw = ctx.measureText(label).width;
        const py = hy + 8;
        ctx.strokeStyle = STATUS_COLOR[data.status];
        ctx.fillStyle = STATUS_COLOR[data.status];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(headX, py, tw + 52, 40, 20);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(headX + 22, py + 20, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(label, headX + 36, py + 29);
      }
      y = bodyTop1;
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `600 30px ${SERIF}`;
      ctx.fillText(`${data.title}, continued`, pad, pad + 24);
      y = pad + 90;
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = `${size}px ${SERIF}`;
    for (const l of pagesLines[p]) {
      if (l.gapBefore) y += size * 0.7;
      y += size * 1.45;
      ctx.fillText(l.text, pad, y - size * 0.35);
    }
    footer(ctx, p + 1, pages);
    slides.push(c);
  }
  return { slides, fontSize: size };
}

export function ShareDialog({ data }: { data: ShareData }) {
  const ref = useRef<HTMLDialogElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [preset, setPreset] = useState<keyof typeof PRESETS>("portrait");
  const [brand, setBrand] = useState("specular.blog");
  const [result, setResult] = useState<Rendered | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    render(data, preset, brand).then((r) => {
      if (cancelled || !holder.current) return;
      holder.current.replaceChildren(...r.slides);
      r.slides.forEach((c, i) => c.setAttribute("aria-label", `Slide ${i + 1} of ${r.slides.length}`));
      setResult(r);
    });
    return () => {
      cancelled = true;
    };
  }, [opened, preset, brand, data]);

  const download = () => {
    result?.slides.forEach((c, i) => {
      c.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${data.title.replace(/[^\w-]+/g, "-").toLowerCase()}-${preset}${result.slides.length > 1 ? `-${i + 1}` : ""}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }, "image/png");
    });
  };

  return (
    <>
      <button className="btn" onClick={() => { setOpened(true); ref.current?.showModal(); }}>Make Instagram image</button>
      <dialog ref={ref} className="modal wide" aria-labelledby="share-h" onClose={() => setOpened(false)}>
        <div className="share-layout">
          <div style={{ display: "grid", gap: 12 }}>
            <h2 id="share-h">Instagram image</h2>
            <div className="share-previews" ref={holder} />
          </div>
          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <label className="field">
              <span>Size</span>
              <select className="select" value={preset} onChange={(e) => setPreset(e.target.value as keyof typeof PRESETS)}>
                {Object.entries(PRESETS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Footer text</span>
              <input className="input" value={brand} maxLength={40} onChange={(e) => setBrand(e.target.value)} />
            </label>
            {data.spoiler && <div className="notice warn">This review is marked as containing spoilers.</div>}
            {result && result.slides.length > 1 && (
              <p className="hint">The full review didn&apos;t fit on one image, so it continues across {result.slides.length} slides for a carousel post.</p>
            )}
            <p className="hint">The image is made on this device and downloaded. Nothing is posted or uploaded anywhere.</p>
            <div className="actions">
              <button className="btn ghost" onClick={() => ref.current?.close()}>Close</button>
              <button className="btn primary" onClick={download} disabled={!result}>
                Download {result && result.slides.length > 1 ? `${result.slides.length} PNGs` : "PNG"}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
