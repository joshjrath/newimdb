import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataSubdir } from "../db";

const POSTER_HOSTS = new Set([
  "image.tmdb.org",
  "cdn.myanimelist.net",
  "static.tvmaze.com",
  "a.ltrbxd.com",
  "s.ltrbxd.com",
  "s4.anilist.co",
  "m.media-amazon.com",
]);

const MAX_BYTES = 10 * 1024 * 1024;

export interface Image {
  data: Buffer;
  mime: string;
}

export function isAllowedPosterUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && POSTER_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Identify image type from magic bytes — never trust the extension or the declared type. */
export function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (["GIF87a", "GIF89a"].includes(buf.subarray(0, 6).toString())) return { mime: "image/gif", ext: "gif" };
  if (buf.subarray(4, 12).toString() === "ftypavif") return { mime: "image/avif", ext: "avif" };
  return null;
}

async function readImage(file: string): Promise<Image | null> {
  const data = await fs.readFile(file).catch(() => null);
  const t = data && sniffImage(data);
  return t ? { data: data!, mime: t.mime } : null;
}

/** Download an allowlisted image, following redirects only to allowlisted hosts. */
async function download(src: string): Promise<Image | null> {
  let url = src;
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000), cache: "no-store" }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      url = new URL(loc, url).toString();
      if (!isAllowedPosterUrl(url)) return null;
      continue;
    }
    if (!res.ok || Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    const data = Buffer.from(await res.arrayBuffer());
    const t = data.length <= MAX_BYTES ? sniffImage(data) : null;
    return t ? { data, mime: t.mime } : null;
  }
  return null;
}

const inFlight = new Map<string, Promise<Image | null>>();

/** Allowlisted poster with a private on-disk cache. Concurrent requests for the same image share one download. */
export function getPoster(src: string): Promise<Image | null> {
  if (!isAllowedPosterUrl(src)) return Promise.resolve(null);
  const key = crypto.createHash("sha256").update(src).digest("hex");
  const pending = inFlight.get(key);
  if (pending) return pending;
  const file = path.join(dataSubdir("cache/posters"), key);
  const p = (async () => {
    const cached = await readImage(file);
    if (cached) return cached;
    const img = await download(src);
    if (img) await fs.writeFile(file, img.data, { mode: 0o600 });
    return img;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

export async function saveUpload(buf: Buffer): Promise<string> {
  if (buf.length > MAX_BYTES) throw new Error("Images must be under 10 MB.");
  const t = sniffImage(buf);
  if (!t) throw new Error("That file isn't a JPEG, PNG, WebP, GIF or AVIF image.");
  const name = `${crypto.randomUUID()}.${t.ext}`;
  await fs.writeFile(path.join(dataSubdir("uploads"), name), buf, { mode: 0o600 });
  return name;
}

export function readUpload(name: string): Promise<Image | null> {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif|avif)$/.test(name)) return Promise.resolve(null);
  return readImage(path.join(dataSubdir("uploads"), name));
}

/** Private, cacheable image response (shared by the poster proxy and uploads). */
export function imageResponse(img: Image): Response {
  return new Response(new Uint8Array(img.data), {
    headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
  });
}
