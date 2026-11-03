import { z } from "zod";
import { HttpError, ownerApi, readJson } from "@/lib/guard";
import { letterboxdRssUrl, parseLetterboxdCsv, parseLetterboxdRss } from "@/lib/domain/letterboxd";
import { previewLetterboxd } from "@/lib/repo/imports";
import { ProviderError } from "@/lib/providers/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  source: z.enum(["rss_url", "rss_text", "csv_text"]),
  value: z.string().min(1).max(20_000_000),
});

/** Preview only. Nothing is written until the owner confirms on the commit endpoint. */
export const POST = ownerApi(async (req) => {
  const { source, value } = schema.parse(await readJson(req));
  let xml = value;
  if (source === "rss_url") {
    const url = letterboxdRssUrl(value);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: "no-store", redirect: "follow" });
      if (!res.ok) throw new ProviderError("letterboxd", `HTTP ${res.status}`);
      xml = await res.text();
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError("letterboxd", "couldn't fetch the RSS feed — paste the feed or upload your export CSV instead");
    } finally {
      clearTimeout(t);
    }
  }
  const entries = source === "csv_text" ? parseLetterboxdCsv(value) : parseLetterboxdRss(xml);
  if (!entries.length) throw new HttpError(400, "No films found in that input.");
  return { rows: previewLetterboxd(entries) };
});
