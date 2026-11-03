import Link from "next/link";
import { SignOutButton, ThemeToggle } from "./ShellClient";

export function Shell({ children, active }: { children: React.ReactNode; active?: "watch" | "studio" | "import" }) {
  return (
    <div className="page">
      <header className="topbar">
        <Link href="/watch/movies" className="brand">
          Watch Journal<small>Private</small>
        </Link>
        <nav className="topnav" aria-label="Main">
          <Link href="/watch/movies" aria-current={active === "watch" ? "page" : undefined}>Library</Link>
          <Link href="/studio" aria-current={active === "studio" ? "page" : undefined}>Studio</Link>
          <Link href="/studio/import" aria-current={active === "import" ? "page" : undefined}>Import &amp; backup</Link>
          <ThemeToggle />
          <SignOutButton />
        </nav>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}
