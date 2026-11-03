import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanReviewText, letterboxdRssUrl, parseLetterboxdCsv, parseLetterboxdRss } from "@/lib/domain/letterboxd";

const rss = fs.readFileSync(path.join(__dirname, "fixtures/letterboxd.rss.xml"), "utf8");

describe("letterboxd rss", () => {
  const entries = parseLetterboxdRss(rss);
  it("skips lists and reads films", () => {
    expect(entries.map((e) => e.filmTitle)).toEqual(["Past Lives", "Dune: Part Two"]);
  });
  it("strips spoiler boilerplate, sets the flag, keeps paragraphs and decodes entities", () => {
    const e = entries[0];
    expect(e.spoiler).toBe(true);
    expect(e.reviewText).toBe("Quiet & devastating. The bar scene — wow.\n\nSecond paragraph\nwith a line break.");
    expect(e).toMatchObject({ rating: 4.5, filmYear: 2023, watchedDate: "2024-01-05", tmdbId: 666277, kind: "review" });
    expect(e.posterUrl).toContain("a.ltrbxd.com");
  });
  it("treats watch-only entries as having no review text", () => {
    expect(entries[1]).toMatchObject({ kind: "watch", reviewText: "", spoiler: false, rating: 4 });
  });
  it("doesn't remove real prose that mentions spoilers", () => {
    expect(cleanReviewText("No spoilers here, but this review may contain spoilers for book readers.").text).toContain("book readers");
  });
});

describe("letterboxd csv", () => {
  it("parses reviews.csv with quoted newlines", () => {
    const csv = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-01-06,"Past Lives",2023,https://boxd.it/abc,4.5,,"Line one, with comma.\n\nPara two &amp; more",romance,2024-01-05\n';
    const [e] = parseLetterboxdCsv(csv);
    expect(e).toMatchObject({ filmTitle: "Past Lives", filmYear: 2023, rating: 4.5, watchedDate: "2024-01-05", externalId: "https://boxd.it/abc", tags: ["romance"] });
    expect(e.reviewText).toBe("Line one, with comma.\n\nPara two & more");
  });
  it("rejects non-letterboxd csv", () => {
    expect(() => parseLetterboxdCsv("a,b\n1,2")).toThrow();
  });
  it("builds rss urls", () => {
    expect(letterboxdRssUrl("https://letterboxd.com/sample/films/")).toBe("https://letterboxd.com/sample/rss/");
    expect(() => letterboxdRssUrl("../../etc")).toThrow();
  });
});
