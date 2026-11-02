import Image from "next/image";
import Link from "next/link";

// Site navbar, rendered on every page via `_app.tsx`. It uses the Budaya Lab
// paper, serif wordmark, and sans-serif navigation styles.
export default function Navbar() {
  return (
    <header className="border-b border-ink/[0.12] bg-cream">
      <nav className="mx-auto flex h-[88px] max-w-6xl items-center justify-between px-6 sm:px-16">
        <Link
          href="/"
          className="flex items-center gap-3 text-ink no-underline"
          aria-label="Budaya Lab Data Portal — home"
        >
          <Image
            unoptimized
            src="/favicon.png"
            alt=""
            width={40}
            height={40}
            className="shrink-0"
          />
          <span className="flex flex-col gap-1">
            <span className="font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
              Budaya Lab
            </span>
            <span className="font-serif text-[21px] font-semibold leading-tight">
              Data Portal
            </span>
          </span>
        </Link>
        <Link
          href="/search"
          className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink/75 transition-colors hover:text-accent"
        >
          Search
        </Link>
      </nav>
    </header>
  );
}
