import Link from "next/link";

export const pageCount = (total: number, pageSize: number) => Math.max(1, Math.ceil(total / pageSize));

/** Previous / next links. `href(page)` builds the URL for a page number. */
export function Pager({ page, pages, href, label }: { page: number; pages: number; href: (page: number) => string; label?: string }) {
  if (pages <= 1 && !label) return null;
  return (
    <nav className="pager" aria-label="Pages">
      {page > 1 && <Link className="btn small" href={href(page - 1)}>Previous</Link>}
      <span>{label ? `${label} · ` : ""}Page {page} of {pages}</span>
      {page < pages && <Link className="btn small" href={href(page + 1)}>Next</Link>}
    </nav>
  );
}
