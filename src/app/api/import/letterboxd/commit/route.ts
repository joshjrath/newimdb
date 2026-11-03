import { ownerApi, readJson } from "@/lib/guard";
import { commitLetterboxd, commitSchema } from "@/lib/repo/imports";

export const POST = ownerApi(async (req) => ({ counts: commitLetterboxd((await readJson(req, commitSchema)).items) }));
