import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../db";

export const POSTER_HOSTS = [
  "image.tmdb.org",
  "cdn.myanimelist.net",
  "static.tvmaze.com",
  "a.ltrbxd.com",
  "s.ltrbxd.com",
  "s4.anilist.co",
  "m.media-amazon.com",
];

export function isAllowedPosterUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && POSTER_HOSTS.includes(url.hostname);
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
  if (buf.subarray(0, 6).toString() === "GIF87a" || buf.subarray(0, 6).toString() === "GIF89a") return { mime: "image/gif", ext: "gif" };
  if (buf.subarray(4, 12).toString() === "ftypavif") return { mime: "image/avif", ext: "avif" };
  return null;
}

export function privateDir(name: "uploads" | "cache/posters"): string {
  const d = path.join(dataDir(), name);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Fetch an allowlisted poster, following redirects only to allowlisted hosts, with an on-disk private cache. */
export async function getPoster(src: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!isAllowedPosterUrl(src)) return null;
  const key = crypto.createHash("sha256").update(src).digest("hex");
  const dir = privateDir("cache/posters");
  const file = path.join(dir, key);
  if (fs.existsSync(file)) {
    const data = fs.readFileSync(file);
    const t = sniffImage(data);
    if (t) return { data, mime: t.mime };
  }
  let url = src;
  for (let hop = 0; hop < 4; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { redirect: "manual", signal: ctrl.signal, cache: "no-store" });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        url = new URL(loc, url).toString();
        if (!isAllowedPosterUrl(url)) return null;
        continue;
      }
      if (!res.ok) return null;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BYTES) return null;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length > MAX_BYTES) return null;
      const t = sniffImage(data);
      if (!t) return null;
      fs.writeFileSync(file, data, { mode: 0o600 });
      return { data, mime: t.mime };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

export function saveUpload(buf: Buffer): string {
  if (buf.length > MAX_BYTES) throw new Error("Images must be under 10 MB.");
  const t = sniffImage(buf);
  if (!t) throw new Error("That file isn't a JPEG, PNG, WebP, GIF or AVIF image.");
  const name = `${crypto.randomUUID()}.${t.ext}`;
  fs.writeFileSync(path.join(privateDir("uploads"), name), buf, { mode: 0o600 });
  return name;
}

export function readUpload(name: string): { data: Buffer; mime: string } | null {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|gif|avif)$/.test(name)) return null;
  const file = path.join(privateDir("uploads"), name);
  if (!fs.existsSync(file)) return null;
  const data = fs.readFileSync(file);
  const t = sniffImage(data);
  return t ? { data, mime: t.mime } : null;
}
