import { requireOwnerPage } from "@/lib/guard";
import { Shell } from "@/components/Shell";
import { PeopleSettings } from "@/components/studio/PeopleSettings";
import { EpisodeSyncSettings } from "@/components/studio/EpisodeSyncSettings";
import { listPeople } from "@/lib/repo/people";
import { GenreSettings } from "@/components/studio/GenreSettings";
import { genreState } from "@/lib/genres/state";

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
      <div className="stack">
        <PeopleSettings initial={listPeople()} />
        <GenreSettings initial={genreState()} />
        <EpisodeSyncSettings />
      </div>
    </Shell>
  );
}
