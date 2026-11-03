import { z } from "zod";
import { ownerApi, readJson } from "@/lib/guard";
import { backupSchema, restoreBackup, summarizeBackup } from "@/lib/repo/backup";

const schema = z.object({ backup: backupSchema, mode: z.enum(["merge", "replace"]), dryRun: z.boolean().optional() });

export const POST = ownerApi(async (req) => {
  const { backup, mode, dryRun } = await readJson(req, schema);
  return dryRun ? { summary: summarizeBackup(backup) } : { result: await restoreBackup(backup, mode) };
});
