"use client";
import { useState } from "react";
import { useToast } from "./Toasts";

export function SpoilerReveal({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  if (shown) return <>{children}</>;
  return (
    <div className="spoiler-box">
      <p>This review contains spoilers.</p>
      <div><button className="btn" onClick={() => setShown(true)}>Show review</button></div>
    </div>
  );
}

/** Copies the private permalink. It only opens for a signed-in owner. */
export function CopyLink() {
  const toast = useToast();
  return (
    <button
      className="btn ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.origin + window.location.pathname);
          toast.push("ok", "Private link copied. It only works when you're signed in.");
        } catch {
          toast.push("error", "Couldn't copy. Copy the address bar instead.");
        }
      }}
    >
      Copy private link
    </button>
  );
}
