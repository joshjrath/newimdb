import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { ImportTools } from "@/components/studio/ImportTools";

export const metadata = { title: "Import & backup" };

export default async function ImportPage() {
  await requireOwnerPage("/studio/import");
  return (
    <Shell active="import">
      <div className="page-head"><h1>Import &amp; backup</h1></div>
      <ImportTools />
    </Shell>
  );
}
