import { NextResponse } from "next/server";
import { ownerApi } from "@/lib/guard";
import { exportAll } from "@/lib/repo/backup";

export const dynamic = "force-dynamic";

export const GET = ownerApi(async () => {
  const data = exportAll();
  const name = `watch-backup-${data.exportedAt.slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}"` },
  });
});
