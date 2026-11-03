import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { ImportTools } from "@/components/studio/ImportTools";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import & backup" };

export default async function ImportPage() {
  await requireOwnerPage("/studio/import");
  return (
    <Shell active="import">
      <h1 style={{ margin: "24px 0" }}>Import &amp; backup</h1>
      <ImportTools />
    </Shell>
  );
}
