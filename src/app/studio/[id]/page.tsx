import { notFound } from "next/navigation";
import { isOwner, requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { EditEntry } from "@/components/studio/EditEntry";
import { getMediaDetail } from "@/lib/repo/media";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return { title: "Sign in" };
  const m = getMediaDetail(Number((await params).id));
  return { title: m ? `Edit ${m.title}` : "Not found" };
}

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireOwnerPage(`/studio/${id}`);
  const m = /^\d+$/.test(id) ? getMediaDetail(Number(id)) : null;
  if (!m) notFound();
  return (
    <Shell active="studio">
      <EditEntry initial={m} />
    </Shell>
  );
}
