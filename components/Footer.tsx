import Link from "next/link";
import { version } from "../package.json";

export default function Footer() {
  return (
    <footer className="shrink-0 border-t border-ink/[0.12] bg-cream">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-start sm:justify-between sm:gap-10 sm:px-16">
        <div>
          <Link
            href="/"
            className="font-serif font-semibold text-ink no-underline hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            Budaya Lab Data Portal
          </Link>
          <p className="mt-2 max-w-sm font-sans text-xs leading-relaxed text-ink/65">
            <code className="tabular-nums text-accent">v{version}</code>
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:items-end">
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-6 gap-y-2 font-sans text-xs font-medium text-ink/75"
          >
            <Link
              href="/search"
              className="py-1 underline decoration-ink/25 underline-offset-4 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              Browse datasets
            </Link>
            <Link
              href="https://budaya-lab.org/"
              className="py-1 underline decoration-ink/25 underline-offset-4 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
            >
              Budaya Lab
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
