import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, SIZE_PRESETS, clampSize, excerptOf, normalizeOptions, readableOn, shapeOf } from "@/lib/share/options";

describe("share image settings", () => {
  it("repairs saved settings and keeps good ones", () => {
    expect(normalizeOptions(null)).toEqual(DEFAULT_OPTIONS);
    const o = normalizeOptions({ w: 99999, h: 10, layout: "nope", text: "red", accent: "#ABCDEF", show: { poster: false, bogus: true }, footer: "@me", scale: 2 });
    expect([o.w, o.h, o.layout, o.text, o.accent, o.show.poster, o.show.title, o.footer, o.scale]).toEqual([4096, 200, "classic", "#ffffff", "#ABCDEF", false, true, "@me", 2]);
    expect("bogus" in o.show).toBe(false);
  });

  it("has sizes for every platform and sensible shapes", () => {
    for (const p of ["Instagram", "X / Twitter", "Discord", "YouTube", "TikTok"]) expect(SIZE_PRESETS.some((s) => s.platform === p)).toBe(true);
    expect([shapeOf(1080, 1350), shapeOf(1080, 1080), shapeOf(1280, 720), shapeOf(1500, 500)]).toEqual(["portrait", "square", "landscape", "banner"]);
    expect(clampSize(NaN)).toBe(1080);
  });

  it("cuts excerpts at a word and picks readable text", () => {
    expect(excerptOf("short", 100)).toBe("short");
    expect(excerptOf("The quick brown fox jumps over the lazy dog", 22)).toBe("The quick brown fox…");
    expect(readableOn("#f6f1e7")).toBe("#111111");
    expect(readableOn("#151a33", "#05060d")).toBe("#ffffff");
  });
});
