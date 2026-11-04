import { notFound } from "next/navigation";
import { intParamOrNull, loadOwnerMedia, requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { EditEntry } from "@/components/studio/EditEntry";
import { TYPE_TO_CATEGORY } from "@/lib/domain/types";
import { listPeople } from "@/lib/repo/people";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const m = await loadOwnerMedia(intParamOrNull((await params).id));
  return { title: m ? `Edit ${m.title}` : "Watch" };
}

export default async function EditPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireOwnerPage(`/studio/${id}`);
  const m = await loadOwnerMedia(intParamOrNull(id));
  if (!m) notFound();
  return (
    <Shell active="studio" category={TYPE_TO_CATEGORY[m.type]}>
      <EditEntry initial={m} people={listPeople().map(({ id, name }) => ({ id, name }))} />
    </Shell>
  );
}
