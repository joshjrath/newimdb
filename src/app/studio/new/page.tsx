import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { NewEntry } from "@/components/studio/NewEntry";
import { providerStatus } from "@/lib/providers";
import { MEDIA_TYPES, type MediaType } from "@/lib/domain/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add title" };

export default async function NewPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requireOwnerPage("/studio/new");
  const { type } = await searchParams;
  return (
    <Shell active="studio">
      <h1 style={{ margin: "24px 0" }}>Add a title</h1>
      <NewEntry initialType={MEDIA_TYPES.includes(type as MediaType) ? (type as MediaType) : "movie"} providers={providerStatus()} />
    </Shell>
  );
}
