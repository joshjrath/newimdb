import { z } from "zod";
import { HttpError, ownerApi, readJson } from "@/lib/guard";
import { parseImdbRatings } from "@/lib/domain/imdb";
import { getJob, startPreviewJob, type PreviewJob } from "@/lib/imdb/jobs";

const schema = z.object({ csv: z.string().min(1).max(30_000_000), lookupEpisodes: z.boolean() });

const view = (j: PreviewJob) => ({ jobId: j.id, state: j.state, stage: j.stage, fraction: j.fraction, error: j.error ?? null, summary: j.summary ?? null });

/** Start preparing a preview in the background. Nothing is imported yet. */
export const POST = ownerApi(async (req) => {
  const { csv, lookupEpisodes } = await readJson(req, schema);
  let parsed;
  try {
    parsed = parseImdbRatings(csv);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  if (!parsed.rows.length) throw new HttpError(400, "No ratings found in that file.");
  return view(startPreviewJob(parsed.rows, parsed.invalid, lookupEpisodes));
});

/** Progress of a preview job; carries the preview once it's ready. */
export const GET = ownerApi(async (req) => {
  const id = new URL(req.url).searchParams.get("job") ?? "";
  const job = getJob(id);
  if (!job) {
    throw new HttpError(
      410,
      "The server restarted while preparing your import, usually because a new version was deploying. Nothing was imported. Wait until the deploy is finished, then choose Preview import again.",
      { code: "job_lost" },
    );
  }
  return view(job);
});
