import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { PeopleSettings } from "@/components/studio/PeopleSettings";
import { listPeople } from "@/lib/repo/people";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireOwnerPage("/studio/settings");
  return (
    <Shell active="settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="sub">Private to you.</p>
        </div>
      </header>
      <PeopleSettings initial={listPeople()} />
    </Shell>
  );
}
