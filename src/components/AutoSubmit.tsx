"use client";
export function AutoSubmit({ children }: { children: React.ReactNode }) {
  return (
    <span
      onChange={(e) => {
        (e.target as HTMLSelectElement).form?.requestSubmit();
      }}
    >
      {children}
    </span>
  );
}
