"use client";
import { useState } from "react";
import { api } from "@/lib/client/api";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/api/auth/login", { body: { password: String(new FormData(e.currentTarget).get("password") ?? "") } });
          // The password was right; make sure the browser kept the session before moving on.
          const check = await fetch("/api/tags", { cache: "no-store" });
          if (check.status === 401) {
            throw new Error(
              "Your password is right, but the browser didn't keep the sign-in. This happens when the site is opened over http:// while the server expects https://. Open it with https://, or set COOKIE_SECURE=false and restart.",
            );
          }
          window.location.href = next;
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span>Password</span>
        <input className="input" type="password" name="password" autoComplete="current-password" required autoFocus />
      </label>
      {error && <div className="notice error" role="alert">{error}</div>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
