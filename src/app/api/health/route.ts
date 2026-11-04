import fs from "node:fs";
import { dataDir, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Is the app able to open your library? Says why not (e.g. the volume is full), without
 * revealing anything from it. Used when the site shows "Application error".
 */
export async function GET() {
  const out: Record<string, unknown> = { ok: true };
  try {
    const st = fs.statfsSync(dataDir());
    out.diskFreeMb = Math.round((st.bavail * st.bsize) / 1048576);
    out.diskTotalMb = Math.round((st.blocks * st.bsize) / 1048576);
  } catch {}
  try {
    getDb().prepare(`SELECT 1`).get();
  } catch (e) {
    out.ok = false;
    out.error = String((e as Error).message ?? e).replace(/\/[^\s'"]+/g, "…").slice(0, 300);
  }
  return Response.json(out, { status: out.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
