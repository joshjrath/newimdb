import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers";
import { createMedia, getMediaDetail, setAssessment } from "@/lib/repo/media";
import { findSlug, parseFillerPage, parseShowIndex } from "@/lib/providers/animefiller";
import { runFillerCheck } from "@/lib/anime/filler";

const page = (types: string[]) => `<table class="EpisodeList"><thead><tr><th>#</th></tr></thead><tbody>
${types.map((t, i) => `<tr class="${t} ${i % 2 ? "even" : "odd"}" id="eps-${i + 1}"><td class="Number">${i + 1}</td><td class="Title"><a href="/shows/bleach/x">Ep</a></td><td class="Type"><span>${t}</span></td><td class="Date">2004-10-05</td></tr>`).join("\n")}
</tbody></table>`;
const index = `<div class="Group"><a href="/shows/bleach">Bleach</a><a href="/shows/naruto-shippuden">Naruto Shippuden</a><a href="/shows/one-piece">One Piece</a></div>`;
const html = (body: string) => new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });

beforeEach(() => {
  freshDb();
  (globalThis as { __aflIndex?: unknown }).__aflIndex = undefined;
});
afterEach(() => vi.unstubAllGlobals());

describe("animefillerlist.com", () => {
  it("reads filler, mixed and canon episodes, and finds shows by name", () => {
    const k = parseFillerPage(page(["manga_canon", "filler", "mixed_canon/filler", "anime_canon"]));
    expect([...k.values()]).toEqual(["canon", "filler", "mixed", "anime_canon"]);
    const idx = parseShowIndex(index);
    expect(findSlug(idx, ["Your Name."])).toBe(null);
    expect(findSlug(idx, ["Naruto Shippuden"])).toBe("naruto-shippuden");
    expect(findSlug(idx, ["Bleach"])).toBe("bleach");
  });

  it("marks filler across seasons in order, once, and leaves your own un-marking alone", async () => {
    const ep = (n: number) => ({ number: n, title: null, airDate: "2005", overview: null, providerRef: null });
    const m = createMedia({
      type: "anime",
      metadata: { title: "Bleach" },
      segments: [
        { kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 3, episodes: [1, 2, 3].map(ep) },
        { kind: "movie", label: "Memories of Nobody", seasonNumber: null, courNumber: null, episodeCount: 1 },
        { kind: "season", label: "Season 2", seasonNumber: 2, courNumber: null, episodeCount: 3, episodes: [1, 2, 3].map(ep) },
      ],
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => html(url.endsWith("/shows") ? index : page(["manga_canon", "manga_canon", "filler", "filler", "mixed_canon/filler", "manga_canon"]))));
    expect(await runFillerCheck()).toEqual({ checked: 1, marked: 2 });
    const segs = getMediaDetail(m.id)!.segments;
    expect(segs[0].episodes.map((e) => e.filler)).toEqual([false, false, true]);
    expect(segs[2].episodes.map((e) => e.filler)).toEqual([true, false, false]);
    expect(segs[1].episodes[0].filler).toBe(false); // the film isn't numbered there
    // You un-mark one: a later check doesn't put it back.
    setAssessment(m.id, segs[0].episodes[2].id, { filler: false });
    const { getDb } = await import("@/lib/db");
    getDb().prepare(`UPDATE media SET filler_checked_at = '2000-01-01'`).run();
    await runFillerCheck();
    expect(getMediaDetail(m.id)!.segments[0].episodes[2].filler).toBe(false);
  });
});

describe("checking one anime now", () => {
  it("uses a page you paste, and says why when the site says no", async () => {
    const { checkFillerFor } = await import("@/lib/anime/filler");
    const { slugFrom } = await import("@/lib/providers/animefiller");
    expect(slugFrom("https://www.animefillerlist.com/shows/my-hero-academia")).toBe("my-hero-academia");
    const ep = (n: number) => ({ number: n, title: null, airDate: "2016", overview: null, providerRef: null });
    const m = createMedia({ type: "anime", metadata: { title: "Boku no Hero Academia" }, segments: [{ kind: "season", label: "Season 1", seasonNumber: 1, courNumber: null, episodeCount: 4, episodes: [1, 2, 3, 4].map(ep) }] });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/shows") ? html(index) : url.includes("my-hero-academia") ? html(page(["manga_canon", "manga_canon", "filler", "filler"])) : new Response("no", { status: 403 }))));
    // Not found by name, and the guessed address is refused:
    const first = await checkFillerFor(m.id);
    expect(first.note?.error).toMatch(/refused/);
    // You paste the right page:
    const r = await checkFillerFor(m.id, { slug: slugFrom("https://www.animefillerlist.com/shows/my-hero-academia")! });
    expect(r).toMatchObject({ marked: 2, note: { slug: "my-hero-academia", manual: true } });
    expect(getMediaDetail(m.id)!.segments[0].episodes.map((e) => e.filler)).toEqual([false, false, true, true]);
  });
});
