import { z } from "zod";
import { idParams, ownerApi, readJson } from "@/lib/guard";
import { EPISODE_VIEWS } from "@/lib/domain/episodeViews";
import { setEpisodeView } from "@/lib/repo/arcs";

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ view: z.enum(EPISODE_VIEWS.map((v) => v.key) as [string, ...string[]]) }).strict();

export const PATCH = ownerApi<Ctx>(async (req, { params }) => {
  const { id } = await idParams(params);
  const { view } = await readJson(req, schema);
  setEpisodeView(id, view as never);
  return { view };
});
