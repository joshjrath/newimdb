import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { NewEntry } from "@/components/studio/NewEntry";
import { providerStatus } from "@/lib/providers";
import { MEDIA_TYPES, type MediaType } from "@/lib/domain/types";

export const metadata = { title: "Add title" };

export default async function NewPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireOwnerPage("/studio/new");
  const { type } = await searchParams;
  return (
    <Shell active="studio">
      <div className="page-head"><h1>Add a title</h1></div>
      <NewEntry initialType={MEDIA_TYPES.includes(type as MediaType) ? (type as MediaType) : "movie"} providers={providerStatus()} />
    </Shell>
  );
}
