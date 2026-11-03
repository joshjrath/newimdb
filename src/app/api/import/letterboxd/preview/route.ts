import { z } from "zod";
import { HttpError, ownerApi, readJson } from "@/lib/guard";
import { letterboxdRssUrl, parseLetterboxdCsv, parseLetterboxdRss } from "@/lib/domain/letterboxd";
import { previewLetterboxd } from "@/lib/repo/imports";
import { fetchWithTimeout, ProviderError } from "@/lib/providers/http";

const schema = z.object({
  source: z.enum(["rss_url", "rss_text", "csv_text"]),
  value: z.string().min(1).max(20_000_000),
});

async function fetchRss(username: string): Promise<string> {
  try {
    return await (await fetchWithTimeout("letterboxd", letterboxdRssUrl(username), {}, 10_000)).text();
  } catch (e) {
    throw e instanceof ProviderError ? e : new ProviderError("letterboxd", "couldn't fetch the RSS feed — paste the feed or upload your export CSV instead");
  }
}

/** Preview only. Nothing is written until the owner confirms on the commit endpoint. */
export const POST = ownerApi(async (req) => {
  const { source, value } = await readJson(req, schema);
  const entries =
    source === "csv_text" ? parseLetterboxdCsv(value) : parseLetterboxdRss(source === "rss_url" ? await fetchRss(value) : value);
  if (!entries.length) throw new HttpError(400, "No films found in that input.");
  return { rows: previewLetterboxd(entries) };
});
