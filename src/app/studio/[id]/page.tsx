import { notFound } from "next/navigation";
import { intParamOrNull, loadOwnerMedia, requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { EditEntry } from "@/components/studio/EditEntry";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const m = await loadOwnerMedia(intParamOrNull((await params).id));
  return { title: m ? `Edit ${m.title}` : "Watch Journal" };
}

export default async function EditPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireOwnerPage(`/studio/${id}`);
  const m = await loadOwnerMedia(intParamOrNull(id));
  if (!m) notFound();
  return (
    <Shell active="studio">
      <EditEntry initial={m} />
    </Shell>
  );
}
