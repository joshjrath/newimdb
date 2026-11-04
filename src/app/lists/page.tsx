import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { ListsIndex } from "@/components/lists/ListsIndex";
import { listLists } from "@/lib/repo/lists";

export const metadata = { title: "Lists" };

export default async function ListsPage() {
  await requireOwnerPage("/lists");
  return (
    <Shell active="lists">
      <header className="page-head">
        <div>
          <h1>Lists</h1>
          <p className="sub">Your own collections. Mix movies, shows and anime.</p>
        </div>
      </header>
      <ListsIndex initial={listLists()} />
    </Shell>
  );
}
