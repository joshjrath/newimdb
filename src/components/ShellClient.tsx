"use client";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<string>("system");
  useEffect(() => {
    try {
      setTheme(localStorage.getItem("theme") ?? "system");
    } catch {}
  }, []);
  const next = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
  return (
    <button
      className="linkish"
      type="button"
      onClick={() => {
        setTheme(next);
        try {
          if (next === "system") localStorage.removeItem("theme");
          else localStorage.setItem("theme", next);
        } catch {}
        if (next === "system") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = next;
      }}
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
    >
      Theme: {theme}
    </button>
  );
}

export function SignOutButton() {
  return (
    <button
      className="linkish"
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
