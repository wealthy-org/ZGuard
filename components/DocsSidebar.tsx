"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

type NavGroup = { title: string; pages: { slug: string; title: string; keywords: string }[] };

export default function DocsSidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const current = groups.flatMap((group) => group.pages).find((page) => pathname === `/docs/${page.slug}`);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return groups;
    return groups
      .map((group) => ({ ...group, pages: group.pages.filter((page) => `${page.title} ${page.keywords} ${group.title}`.toLowerCase().includes(needle)) }))
      .filter((group) => group.pages.length > 0);
  }, [groups, query]);

  return (
    <>
      <button type="button" className="pd-menu" aria-expanded={open} aria-controls="pd-side" onClick={() => setOpen((value) => !value)}>
        <span>{current?.title || "Docs"}</span><b aria-hidden="true">{open ? "✕" : "☰"}</b>
      </button>
      <aside id="pd-side" className={`pd-side${open ? " open" : ""}`} aria-label="Docs navigation">
        <label className="pd-search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search docs" aria-label="Search docs" />
        </label>
        {filtered.map((group) => (
          <div className="pd-group" key={group.title}>
            <h5>{group.title.toUpperCase()}</h5>
            {group.pages.map((page) => (
              <Link key={page.slug} href={`/docs/${page.slug}`} className={pathname === `/docs/${page.slug}` ? "on" : undefined} aria-current={pathname === `/docs/${page.slug}` ? "page" : undefined} onClick={() => setOpen(false)}>
                {page.title}
              </Link>
            ))}
          </div>
        ))}
        {filtered.length === 0 && <p className="pd-empty">No page matches “{query}”.</p>}
      </aside>
    </>
  );
}
