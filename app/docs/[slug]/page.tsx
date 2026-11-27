import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import AudioToggle from "@/components/AudioToggle";
import Footer from "@/components/Footer";
import DocsSidebar from "@/components/DocsSidebar";
import { DOC_NAV, DOC_PAGES, TRY_LINKS, getDoc } from "@/lib/docs/content";

type Params = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const doc = getDoc((await params).slug);
  if (!doc) return {};
  return { title: `${doc.page.title} · Docs`, description: doc.page.description };
}

export default async function DocPage({ params }: Params) {
  const doc = getDoc((await params).slug);
  if (!doc) notFound();
  const { page, previous, next } = doc;

  return (
    <main className="app-page pd-page light-app">
      <Header extra={<AudioToggle />} />
      <div className="app-aurora" aria-hidden="true"><i /><i /><i /></div>

      <div className="pd-layout app-enter">
        <DocsSidebar groups={DOC_NAV} />

        <article className="pd-main">
          <div className="pd-crumb">{page.group}</div>
          <h1>{page.title}</h1>
          <p className="pd-lead">{page.lead}</p>

          {page.sections.map((section) => (
            <section key={section.id} className="pd-section">
              <h2 id={section.id}>{section.title}</h2>
              {section.body}
            </section>
          ))}

          <div className="pd-try">
            <span>Try it on Perm</span>
            {TRY_LINKS.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}
          </div>

          <nav className="pd-pn" aria-label="Previous and next page">
            {previous && <Link href={`/docs/${previous.slug}`}><small>Previous</small>{previous.title}</Link>}
            {next && <Link className="nx" href={`/docs/${next.slug}`}><small>Next</small>{next.title}</Link>}
          </nav>
        </article>

        <aside className="pd-toc" aria-label="On this page">
          <h5>ON THIS PAGE</h5>
          {page.sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.title}</a>)}
        </aside>
      </div>

      <div className="footer-shell app-footer"><Footer /></div>
    </main>
  );
}
