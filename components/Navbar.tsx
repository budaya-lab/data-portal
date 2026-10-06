import Link from 'next/link'

// Site navbar, rendered on every page via `_app.tsx`. Editorial style imported
// from the Claude Design mockups: a tall hairline-ruled bar with a Newsreader
// italic wordmark on the left and an uppercase Work Sans "Search" link on the
// right, over the warm cream canvas.
//
// The wordmark is the portal name, set in Newsreader italic.
export default function Navbar() {
  return (
    <header className="border-b border-ink/[0.12] bg-cream">
      <nav className="mx-auto flex h-[88px] max-w-6xl items-center justify-between px-6 sm:px-16">
        <Link
          href="/"
          className="font-serif text-[21px] font-medium italic text-ink no-underline"
          aria-label="Data Portal — home"
        >
          Data Portal
        </Link>
        <Link
          href="/search"
          className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink/75 transition-colors hover:text-accent"
        >
          Search
        </Link>
      </nav>
    </header>
  )
}
