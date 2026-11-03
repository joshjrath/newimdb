"use client";
import { useEffect, useState } from "react";
import { applyTheme, THEME_KEY } from "@/lib/client/theme";

const NEXT = { system: "dark", dark: "light", light: "system" } as const;
type Choice = keyof typeof NEXT;

export function ThemeToggle() {
  const [theme, setTheme] = useState<Choice>("system");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") setTheme(saved);
    } catch {}
  }, []);
  const next = NEXT[theme];
  return (
    <button
      className="linkish"
      type="button"
      onClick={() => {
        setTheme(next);
        try {
          if (next === "system") localStorage.removeItem(THEME_KEY);
          else localStorage.setItem(THEME_KEY, next);
        } catch {}
        applyTheme(next === "system" ? null : next);
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
