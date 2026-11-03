export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
