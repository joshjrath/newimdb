/** Progress bar colour by how far you are: 0–24, 25–49, 50–74, 75–99, and green only at 100%. */
export function progressBand(percent: number): "p0" | "p1" | "p2" | "p3" | "p4" {
  if (percent >= 100) return "p4";
  if (percent >= 75) return "p3";
  if (percent >= 50) return "p2";
  if (percent >= 25) return "p1";
  return "p0";
}
