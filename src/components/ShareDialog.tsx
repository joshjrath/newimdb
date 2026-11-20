"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { posterSrc } from "@/lib/client/api";
import { slugify } from "@/lib/domain/text";
import { BG_KINDS, DEFAULT_OPTIONS, FONTS, LAYOUTS, PALETTES, SIZE_MAX, SIZE_MIN, SIZE_PRESETS, clampSize, luminance, normalizeOptions, readableOn, type ShareOptions } from "@/lib/share/options";
import { dominantColor, renderSlides, type Art, type ShareData } from "@/lib/share/render";

export type { ShareData };

const STORE = "share-style-v2";
const TABS = [
  { key: "size", label: "Size" },
  { key: "layout", label: "Layout" },
  { key: "bg", label: "Background" },
  { key: "type", label: "Text" },
  { key: "show", label: "Show" },
  { key: "export", label: "Export" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const SWATCHES = ["#ffffff", "#f2efe8", "#111111", "#f5c518", "#ff7f7f", "#7cc4ff", "#6fd3c7", "#c7b6f6", "#57d48c", "#ff9f43", "#e50914"];
const SHOW_LABELS: [keyof ShareOptions["show"], string][] = [
  ["poster", "Poster"],
  ["kicker", "Small heading"],
  ["title", "Title"],
  ["meta", "Year and kind"],
  ["genres", "Genres"],
  ["stars", "Stars"],
  ["score", "Score (4.5/5)"],
  ["label", "Rating words"],
  ["status", "Status"],
  ["imdb", "IMDb rating"],
  ["watched", "Where & when watched"],
  ["people", "Watched with"],
  ["review", "Review"],
  ["spoiler", "Spoiler tag"],
  ["pages", "Slide dots"],
];

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const blobOf = (c: HTMLCanvasElement, o: ShareOptions) => new Promise<Blob | null>((r) => c.toBlob(r, o.format === "jpeg" ? "image/jpeg" : "image/png", o.quality));

/** Share: a studio for making an image of your rating and review for any platform. */
export function ShareDialog({ data }: { data: ShareData }) {
  const ref = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [opened, setOpened] = useState(false);
  const [tab, setTab] = useState<Tab>("size");
  const [o, setO] = useState<ShareOptions>(DEFAULT_OPTIONS);
  const [art, setArt] = useState<Art | null>(null);
  const [slides, setSlides] = useState<HTMLCanvasElement[]>([]);
  const [current, setCurrent] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canShareFiles = typeof navigator !== "undefined" && "canShare" in navigator;

  // Your style, remembered on this device.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) setO(normalizeOptions(JSON.parse(raw)));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch {}
  }, [o]);
  const set = (patch: Partial<ShareOptions>) => setO((x) => ({ ...x, ...patch }));
  const setShow = (k: keyof ShareOptions["show"], v: boolean) => setO((x) => ({ ...x, show: { ...x.show, [k]: v } }));

  // Artwork, once per open.
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    (async () => {
      await document.fonts.ready;
      const [poster, backdrop] = await Promise.all([data.posterUrl ? loadImage(posterSrc(data.posterUrl)!) : null, data.backdropUrl ? loadImage(posterSrc(data.backdropUrl)!) : null]);
      if (!cancelled) setArt((a) => ({ poster, backdrop, upload: a?.upload ?? null, base: poster ? dominantColor(poster) : backdrop ? dominantColor(backdrop) : [46, 60, 96] }));
    })();
    return () => {
      cancelled = true;
    };
  }, [opened, data.posterUrl, data.backdropUrl]);

  // Redraw shortly after any change.
  useEffect(() => {
    if (!art || !opened) return;
    const t = setTimeout(() => {
      try {
        const next = renderSlides(data, o, art);
        setSlides(next);
        setCurrent((c) => Math.min(c, next.length - 1));
      } catch (e) {
        setNote(`Couldn't draw that: ${(e as Error).message}`);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [art, o, data, opened]);

  useEffect(() => {
    const c = slides[current];
    if (c && stage.current) {
      c.setAttribute("aria-label", `Preview, slide ${current + 1} of ${slides.length}`);
      c.setAttribute("role", "img");
      stage.current.replaceChildren(c);
    }
  }, [slides, current]);

  const thumbs = useMemo(() => slides.map((c) => c.toDataURL("image/jpeg", 0.5)), [slides]);

  /** Full-quality slides (double size when asked). */
  const exportSlides = () => (o.scale === 2 && art ? renderSlides(data, { ...o, w: o.w * 2, h: o.h * 2 }, art) : slides);
  const fileName = (i: number, n: number) => `${slugify(data.title)}-${o.w}x${o.h}${n > 1 ? `-${i + 1}` : ""}.${o.format === "jpeg" ? "jpg" : "png"}`;

  const download = async () => {
    setBusy(true);
    const list = exportSlides();
    for (let i = 0; i < list.length; i++) {
      const blob = await blobOf(list[i], o);
      if (!blob) continue;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName(i, list.length);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }
    setBusy(false);
    setNote(list.length > 1 ? `Downloaded ${list.length} images.` : "Downloaded.");
  };
  const copy = async () => {
    try {
      const c = exportSlides()[current];
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) throw new Error("no image");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNote("Copied. Paste it straight into Discord, X or a message.");
    } catch {
      setNote("This browser won't copy images. Use Download instead.");
    }
  };
  const share = async () => {
    try {
      const list = exportSlides();
      const files = (await Promise.all(list.map((c) => blobOf(c, o)))).map((b, i) => new File([b!], fileName(i, list.length), { type: b!.type }));
      if (!navigator.canShare?.({ files })) throw new Error("no");
      await navigator.share({ files, title: data.title });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Sharing files isn't supported here. Use Download or Copy.");
    }
  };
  const upload = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const img = await loadImage(String(reader.result));
      if (img) {
        setArt((a) => (a ? { ...a, upload: img } : a));
        set({ bg: "image", ...(luminance(o.text) < 0.4 ? { text: "#ffffff", accent: "#f5c518" } : {}) });
      }
    };
    reader.readAsDataURL(f);
  };
  const pickPalette = (key: string) => {
    const p = PALETTES.find((x) => x.key === key)!;
    set({ bg: "palette", palette: key, text: p.text, accent: p.accent });
  };
  const pickLayout = (key: ShareOptions["layout"]) => set({ layout: key, align: key === "minimal" || key === "hero" ? "center" : key === "classic" ? "left" : o.align });
  const platforms = [...new Set(SIZE_PRESETS.map((p) => p.platform))];
  const ratio = o.w / o.h;

  return (
    <>
      <button className="btn" onClick={() => { setOpened(true); ref.current?.showModal(); }}>
        <span aria-hidden="true">↗</span> Share
      </button>
      <dialog ref={ref} className="modal share-modal" aria-labelledby="share-h" onClose={() => setOpened(false)}>
        <div className="share-studio">
          <div className="share-stage-col">
            <div className="share-top">
              <h2 id="share-h">Share</h2>
              <span className="hint">{o.w} × {o.h}{o.scale === 2 ? ` (exports at ${o.w * 2} × ${o.h * 2})` : ""}</span>
              <button type="button" className="btn small ghost push-left" onClick={() => ref.current?.close()} aria-label="Close">✕</button>
            </div>
            <div className="share-stage" style={{ aspectRatio: `${o.w} / ${o.h}`, maxWidth: `min(100%, calc(66vh * ${ratio.toFixed(3)}))`, ["--r" as string]: ratio.toFixed(3) }}>
              <div ref={stage} className="share-canvas" />
              {!art && <div className="share-loading">Loading artwork…</div>}
            </div>
            {slides.length > 1 && (
              <div className="share-thumbs" role="tablist" aria-label="Slides">
                {thumbs.map((t, i) => (
                  <button key={i} type="button" role="tab" aria-selected={i === current} onClick={() => setCurrent(i)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t} alt={`Slide ${i + 1}`} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="share-panel">
            <div className="share-tabs" role="tablist" aria-label="Settings">
              {TABS.map((t) => (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>
              ))}
            </div>

            <div className="share-tab-body">
              {tab === "size" && (
                <>
                  {platforms.map((pf) => (
                    <div key={pf} className="share-group">
                      <span className="share-group-h">{pf}</span>
                      <div className="share-sizes">
                        {SIZE_PRESETS.filter((p) => p.platform === pf).map((p) => (
                          <button key={p.key} type="button" aria-pressed={o.sizeKey === p.key} onClick={() => set({ w: p.w, h: p.h, sizeKey: p.key })}>
                            <span className="ratio-box" aria-hidden="true" style={{ aspectRatio: `${p.w} / ${p.h}`, [p.w >= p.h ? "width" : "height"]: 26 }} />
                            <span>{p.label}<small>{p.w}×{p.h}</small></span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div className="share-group">
                    <span className="share-group-h">Custom</span>
                    <div className="share-custom">
                      <label>W<input className="input" type="number" min={SIZE_MIN} max={SIZE_MAX} value={o.w} onChange={(e) => set({ w: clampSize(Number(e.target.value)), sizeKey: "custom" })} /></label>
                      <button type="button" className="btn small ghost" title="Swap width and height" onClick={() => set({ w: o.h, h: o.w, sizeKey: "custom" })}>⇄</button>
                      <label>H<input className="input" type="number" min={SIZE_MIN} max={SIZE_MAX} value={o.h} onChange={(e) => set({ h: clampSize(Number(e.target.value)), sizeKey: "custom" })} /></label>
                    </div>
                    <p className="hint">Any size from {SIZE_MIN} to {SIZE_MAX} px. Everything rearranges to fit.</p>
                  </div>
                </>
              )}

              {tab === "layout" && (
                <>
                  <div className="share-layouts">
                    {LAYOUTS.map((l) => (
                      <button key={l.key} type="button" aria-pressed={o.layout === l.key} onClick={() => pickLayout(l.key)}>
                        <span className={`layout-thumb lt-${l.key}`} aria-hidden="true"><i /><b /><em /></span>
                        <span>{l.label}<small>{l.hint}</small></span>
                      </button>
                    ))}
                  </div>
                  <Seg label="Alignment" value={o.align} options={[["left", "Left"], ["center", "Centre"]]} onChange={(v) => set({ align: v as ShareOptions["align"] })} />
                  <Range label="Margins" value={o.margin} min={0.5} max={2} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ margin: v })} />
                  <Range label="Poster corners" value={o.posterRadius} min={0} max={60} step={1} fmt={(v) => `${v}px`} onChange={(v) => set({ posterRadius: v })} />
                  <Check label="Poster shadow" checked={o.posterShadow} onChange={(v) => set({ posterShadow: v })} />
                  <Check label="Poster outline (accent colour)" checked={o.posterBorder} onChange={(v) => set({ posterBorder: v })} />
                  <span className="share-group-h">If the review is long</span>
                  <Seg label="Long reviews" value={o.reviewMode} options={[["fit", "Shrink to fit"], ["carousel", "Carousel"], ["excerpt", "Excerpt"]]} onChange={(v) => set({ reviewMode: v as ShareOptions["reviewMode"] })} />
                  {o.reviewMode === "excerpt" && <Range label="Excerpt length" value={o.excerpt} min={60} max={1200} step={20} fmt={(v) => `${v} characters`} onChange={(v) => set({ excerpt: v })} />}
                  {o.reviewMode === "carousel" && <p className="hint">The review continues across extra slides, ready for an Instagram carousel or a thread.</p>}
                </>
              )}

              {tab === "bg" && (
                <>
                  <div className="share-chips">
                    {BG_KINDS.map((b) => (
                      <button key={b.key} type="button" aria-pressed={o.bg === b.key} onClick={() => (b.key === "palette" ? pickPalette(o.palette) : set({ bg: b.key, ...(b.key !== "solid" && b.key !== "gradient" && luminance(o.text) < 0.4 ? { text: "#ffffff", accent: "#f5c518" } : {}) }))}>{b.label}</button>
                    ))}
                  </div>
                  {o.bg === "palette" && (
                    <div className="share-palettes">
                      {PALETTES.map((p) => (
                        <button key={p.key} type="button" aria-pressed={o.palette === p.key} onClick={() => pickPalette(p.key)} title={p.label} style={{ background: `linear-gradient(135deg, ${p.c1}, ${p.c2})`, color: p.text }}>
                          <span>{p.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {(o.bg === "solid" || o.bg === "gradient") && (
                    <div className="share-colors">
                      <Color label={o.bg === "solid" ? "Colour" : "From"} value={o.color1} onChange={(v) => set({ color1: v })} />
                      {o.bg === "gradient" && <Color label="To" value={o.color2} onChange={(v) => set({ color2: v })} />}
                      <button type="button" className="btn small ghost" onClick={() => set({ text: readableOn(o.color1, o.bg === "gradient" ? o.color2 : o.color1) })}>Readable text</button>
                    </div>
                  )}
                  {(o.bg === "gradient" || o.bg === "palette") && <Range label="Gradient angle" value={o.angle} min={0} max={360} step={5} fmt={(v) => `${v}°`} onChange={(v) => set({ angle: v })} />}
                  {(o.bg === "blur" || o.layout === "cinematic") && (
                    <Seg label="Artwork" value={o.art} options={[["poster", "Poster"], ["backdrop", data.backdropUrl ? "Backdrop still" : "Backdrop (none)"]]} onChange={(v) => set({ art: v as ShareOptions["art"] })} />
                  )}
                  {o.bg === "image" && (
                    <label className="share-upload">
                      <input type="file" accept="image/*" onChange={(e) => upload(e.target.files?.[0])} />
                      <span>{art?.upload ? "Change image…" : "Choose an image…"}</span>
                      <small>Stays on this device. Nothing is uploaded.</small>
                    </label>
                  )}
                  {(o.bg === "blur" || o.bg === "image") && <Range label="Blur" value={o.blur} min={o.bg === "blur" ? 0.35 : 0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ blur: v })} />}
                  {(o.bg === "auto" || o.bg === "blur" || o.bg === "image" || o.layout === "cinematic") && <Range label="Darken" value={o.dim} min={0} max={0.9} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ dim: v })} />}
                  <Check label="Film grain" checked={o.grain} onChange={(v) => set({ grain: v })} />
                  <Check label="Vignette (darker edges)" checked={o.vignette} onChange={(v) => set({ vignette: v })} />
                </>
              )}

              {tab === "type" && (
                <>
                  <span className="share-group-h">Font</span>
                  <div className="share-fonts">
                    {(Object.keys(FONTS) as (keyof typeof FONTS)[]).map((k) => (
                      <button key={k} type="button" aria-pressed={o.font === k} onClick={() => set({ font: k })} style={{ fontFamily: FONTS[k].head }}>
                        <b>Aa</b>
                        <small>{FONTS[k].label}</small>
                      </button>
                    ))}
                  </div>
                  <Range label="Text size" value={o.textScale} min={0.7} max={1.5} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ textScale: v })} />
                  <Swatches label="Text colour" value={o.text} onChange={(v) => set({ text: v })} />
                  <Swatches label="Accent (stars, heading, quote)" value={o.accent} onChange={(v) => set({ accent: v })} />
                  <Check label="Soft shadow behind text" checked={o.shadowText} onChange={(v) => set({ shadowText: v })} />
                  <Check label="Big quote mark before the review" checked={o.quote} onChange={(v) => set({ quote: v })} />
                  <label className="field">
                    <span>Small heading</span>
                    <input className="input" value={o.kicker} maxLength={60} placeholder="e.g. My review, Hot take, Rewatch" onChange={(e) => set({ kicker: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Footer</span>
                    <input className="input" value={o.footer} maxLength={80} placeholder="Optional: your @handle, a hashtag…" onChange={(e) => set({ footer: e.target.value })} />
                  </label>
                </>
              )}

              {tab === "show" && (
                <div className="share-toggles">
                  {SHOW_LABELS.map(([k, label]) => (
                    <label key={k} className={`share-toggle${o.show[k] ? " on" : ""}`}>
                      <input type="checkbox" checked={o.show[k]} onChange={(e) => setShow(k, e.target.checked)} />
                      {label}
                    </label>
                  ))}
                  {o.layout === "cinematic" && <p className="hint">Cinematic uses the artwork as the whole background, so there&apos;s no separate poster.</p>}
                  {o.layout === "minimal" && <p className="hint">Minimal is type only: the poster stays off.</p>}
                </div>
              )}

              {tab === "export" && (
                <>
                  <Seg label="Format" value={o.format} options={[["png", "PNG (sharpest)"], ["jpeg", "JPEG (smaller)"]]} onChange={(v) => set({ format: v as ShareOptions["format"] })} />
                  {o.format === "jpeg" && <Range label="JPEG quality" value={o.quality} min={0.5} max={1} step={0.02} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ quality: v })} />}
                  <Seg label="Resolution" value={String(o.scale)} options={[["1", `1× (${o.w}×${o.h})`], ["2", `2× (${o.w * 2}×${o.h * 2})`]]} onChange={(v) => set({ scale: Number(v) })} />
                  <p className="hint">Made on this device. Nothing is posted or uploaded anywhere.</p>
                </>
              )}
            </div>

            {data.spoiler && o.show.review && <div className="notice warn">This review is marked as containing spoilers.</div>}
            {note && <p className="hint share-note" role="status">{note}</p>}
            <div className="share-actions">
              <button type="button" className="btn ghost small" onClick={() => setO({ ...DEFAULT_OPTIONS, w: o.w, h: o.h, sizeKey: o.sizeKey })} title="Back to the default look (keeps the size)">Reset look</button>
              <button type="button" className="btn" onClick={copy} disabled={!slides.length}>Copy</button>
              {canShareFiles && <button type="button" className="btn" onClick={share} disabled={!slides.length}>Share…</button>}
              <button type="button" className="btn primary" onClick={download} disabled={!slides.length || busy}>
                Download{slides.length > 1 ? ` ${slides.length}` : ""} {o.format === "jpeg" ? "JPEG" : "PNG"}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

/* ---------------- little controls ---------------- */

function Seg({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="share-seg" role="radiogroup" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

function Range({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="share-range">
      <span>{label}<b>{fmt(value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="share-color">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <span>{label}<small>{value}</small></span>
    </label>
  );
}

function Swatches({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="share-swatches">
      <span className="share-group-h">{label}</span>
      <div>
        {SWATCHES.map((c) => (
          <button key={c} type="button" aria-pressed={value.toLowerCase() === c} aria-label={c} style={{ background: c }} onClick={() => onChange(c)} />
        ))}
        <label className="swatch-custom" title="Any colour">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: any colour`} />
        </label>
      </div>
    </div>
  );
}
