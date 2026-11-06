import Link from "next/link";
import { countMedia } from "@/lib/repo/media";
import { CATEGORY_LABEL, CATEGORY_TO_TYPE, type Category } from "@/lib/domain/types";
import { SignOutButton } from "./ShellClient";
import { UpdateBell } from "./UpdateBell";
import { RailSearch } from "./RailSearch";
import { updatesSummary } from "@/lib/repo/releases";

export type ShellActive = Category | "all" | "studio" | "new" | "import" | "settings" | "stats" | "recommended" | "lists";

const CATEGORIES = Object.keys(CATEGORY_TO_TYPE) as Category[];
const STUDIO: { key: ShellActive; href: string; label: string }[] = [
  { key: "studio", href: "/studio", label: "Manage" },
  { key: "new", href: "/studio/new", label: "Add title" },
  { key: "import", href: "/studio/import", label: "Import & backup" },
  { key: "settings", href: "/studio/settings", label: "Settings" },
];

/** Specular's shell: a rounded rail on the left, the page on the right. `category` sets the block colour. */
export function Shell({ children, active, category }: { children: React.ReactNode; active?: ShellActive; category?: Category }) {
  const counts = countMedia();
  const updates = updatesSummary();
  const cat = category ?? (CATEGORIES.includes(active as Category) ? (active as Category) : undefined);
  return (
    <div className={`shell${cat ? ` cat-${cat}` : ""}`}>
      <aside className="rail">
        <div className="inner">
          <Link className="mark" href="/watch/movies">
            Specular<small>Watch</small>
          </Link>
          <RailSearch />
          <Link className="rail-feature" href="/recommended" aria-current={active === "recommended" ? "page" : undefined}>
            <span className="rail-feature-icon" aria-hidden="true">✦</span>
            <span>Recommended<small>Picked for you</small></span>
          </Link>
          <nav aria-label="Library">
            {CATEGORIES.map((c) => (
              <Link key={c} className={`cat-${c}`} href={`/watch/${c}`} aria-current={active === c ? "page" : undefined}>
                <span className="dot" />
                {CATEGORY_LABEL[c]}
                <span className="n">{counts[CATEGORY_TO_TYPE[c]]}</span>
              </Link>
            ))}
            <Link className="cat-all" href="/watch/all" aria-current={active === "all" ? "page" : undefined}>
              <span className="dot" />
              All Media
              <span className="n">{counts.total}</span>
            </Link>
          </nav>
          <nav className="studio" aria-label="More">
            <Link href="/lists" aria-current={active === "lists" ? "page" : undefined}>Lists</Link>
            <Link href="/stats" aria-current={active === "stats" ? "page" : undefined}>Statistics</Link>
          </nav>
          <h3>Studio</h3>
          <nav className="studio" aria-label="Studio">
            {STUDIO.map((s) => (
              <Link key={s.key} href={s.href} aria-current={active === s.key ? "page" : undefined}>
                {s.label}
              </Link>
            ))}
          </nav>
          <div className="live">
            <span className="pulse" />
            Private · only you
            <SignOutButton />
          </div>
        </div>
      </aside>
      <main id="main">
        <div className="topline">
          <UpdateBell initial={updates} />
        </div>
        {updates.storage.warning && (
          <div className="storage-warning" role="alert">
            <b>Your data isn&apos;t safe yet.</b> {updates.storage.warning}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
