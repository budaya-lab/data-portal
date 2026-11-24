import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import {
  type KeywordCount,
  keywordCounts,
  keywordPresentation,
  type StructuredKeywordKind,
} from "../lib/datasets";
import { provider } from "../lib/providers";

const keywordCardStyles: Record<StructuredKeywordKind, string> = {
  task: "border-accent/25 bg-accent-soft/60 hover:border-accent/50",
  stage: "border-indigo/25 bg-indigo-soft/70 hover:border-indigo/50",
  project: "border-teal-700/20 bg-teal-50 hover:border-teal-700/50",
};

const keywordKindStyles: Record<StructuredKeywordKind, string> = {
  task: "text-accent",
  stage: "text-indigo",
  project: "text-teal-800",
};

const keywordKindLabels: Record<StructuredKeywordKind, string> = {
  task: "Task",
  stage: "Stage",
  project: "Project",
};

// Keyword cards are derived from the portal's dataset metadata at build time.
export async function getStaticProps() {
  return {
    props: { keywords: keywordCounts(await provider.listDatasets()) },
  };
}

// Home surface: a portal name, one-line description, and search as the primary
// call to action, followed by searchable keyword cards.
export default function Home({ keywords }: { keywords: KeywordCount[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const search = (q: string) => {
    const trimmed = q.trim();
    router.push(
      trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search",
    );
  };

  return (
    <>
      <Head>
        <title>Budaya Lab Data Portal</title>
      </Head>
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-16 sm:px-16 sm:pt-[104px]">
        <div className="mb-6 font-sans text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          Budaya Lab
        </div>
        <h1 className="mb-7 font-serif text-[44px] font-semibold leading-[1.06] tracking-[-0.01em] text-ink sm:text-[62px]">
          Data Portal
        </h1>
        <p className="mb-11 max-w-[520px] font-serif text-xl leading-[1.55] text-ink/70">
          Browse datasets catalogued by the{" "}
          <Link
            className="underline decoration-1 underline-offset-[3px] hover:text-accent"
            href="https://budaya-lab.org/"
          >
            Budaya Lab
          </Link>
          .
        </p>

        {/* Search is the primary call to action — submitting navigates to /search. */}
        <search>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              search(query);
            }}
            className="mb-12"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search datasets…"
              aria-label="Search datasets"
              className="w-full border-0 border-b border-ink/30 bg-transparent pb-3.5 font-serif text-lg italic text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
            />
          </form>
        </search>

        {keywords.length > 0 && (
          <section aria-labelledby="keywords-heading" className="mb-12">
            <h2
              id="keywords-heading"
              className="mb-3.5 font-sans text-[11px] font-semibold uppercase tracking-[0.1em] text-ink/45"
            >
              Explore by keyword
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {keywords.map(({ keyword, count, kind }) => {
                const { label } = keywordPresentation(keyword);
                return (
                  <Link
                    key={keyword}
                    href={`/search?q=${encodeURIComponent(keyword)}`}
                    className={`flex min-h-20 items-center justify-between gap-4 border px-4 py-3 text-ink no-underline transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      kind
                        ? keywordCardStyles[kind]
                        : "border-ink/15 hover:border-accent hover:bg-cream-panel"
                    }`}
                  >
                    <span className="min-w-0">
                      {kind && (
                        <span
                          className={`mb-1 block font-sans text-[10px] font-semibold uppercase tracking-[0.08em] ${keywordKindStyles[kind]}`}
                        >
                          {keywordKindLabels[kind]}
                        </span>
                      )}
                      <span className="font-serif text-base font-medium">
                        {label}
                      </span>
                    </span>
                    <span className="shrink-0 font-sans text-xs text-ink/55">
                      {count} {count === 1 ? "record" : "records"}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-12">
          <Link
            href="/search"
            className="border-b border-accent pb-[3px] font-serif text-[17px] font-medium italic text-ink no-underline hover:text-accent"
          >
            Browse all datasets &rarr;
          </Link>
        </div>
      </main>
    </>
  );
}
