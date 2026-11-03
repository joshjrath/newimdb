"use client";
import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const password = String(new FormData(e.currentTarget).get("password") ?? "");
        try {
          const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? "Sign-in failed.");
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
