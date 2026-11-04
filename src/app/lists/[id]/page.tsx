import { notFound } from "next/navigation";
import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { ListDetail } from "@/components/lists/ListDetail";
import { getList } from "@/lib/repo/lists";

export const metadata = { title: "List" };

export default async function ListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireOwnerPage(`/lists/${id}`);
  const list = getList(Number(id));
  if (!list) notFound();
  return (
    <Shell active="lists">
      <ListDetail initial={list} />
    </Shell>
  );
}
