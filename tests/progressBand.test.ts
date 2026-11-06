import { describe, expect, it } from "vitest";
import { progressBand } from "@/lib/domain/progressBand";

describe("progress colours", () => {
  it("has five bands, green only at 100%", () => {
    expect([0, 24, 24.9, 25, 49, 50, 74, 75, 99, 99.9, 100].map(progressBand)).toEqual(["p0", "p0", "p0", "p1", "p1", "p2", "p2", "p3", "p3", "p3", "p4"]);
  });
});
