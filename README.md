# CSSH Data Portal

A public catalogue of research datasets for CSSH. Use it to discover records by publisher and keywords, then follow links to the systems that hold the data. The catalogue is **metadata-first**: most data stays in GitHub repositories or other source systems, and access to restricted sources is enforced there, not by this public site. See [ARCHITECTURE.md](ARCHITECTURE.md) for the decisions and planned work.

## Run locally

Requires Node.js 22+ and pnpm (this project uses `pnpm-lock.yaml`). From this directory:

```bash
pnpm install
pnpm dev
```

Visit `http://localhost:3000/search`. To check a production build, run `pnpm build`. The build and dev scripts also generate optional DCAT feeds from the catalogue; `datasets.json` remains the source of truth.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the local Next.js server |
| `pnpm build` | Generate the feeds and build the site |
| `pnpm exec tsc --noEmit` | Type-check |
| `TSX_TSCONFIG_PATH=scripts/tsconfig.test.json node --import tsx --test scripts/catalog.test.ts scripts/harvest-roundtrip.test.ts` | Run catalogue and metadata tests |
| `pnpm lint` / `pnpm check` | Run Biome lint / lint + format checks |

## Catalogue workflow

Edit [`datasets.json`](datasets.json) to add or update records; **do not create a page per dataset**. The search page at `/search` filters record names, publisher namespaces, descriptions, categories, and keywords (not the contents of source files). [`pages/[owner]/[slug].tsx`](pages/%5Bowner%5D/%5Bslug%5D.tsx) generates each showcase at `/@<namespace>/<slug>` at build time. This portal uses `NAMESPACE_TYPE = 'owner'`: `namespace` means publisher/owner, not subject. `(namespace, slug)` must be unique.

For an access-controlled GitHub repository, follow the existing CSSH entries. A metadata-only record needs no `file`, `format`, or `resources`:

```json
{
  "slug": "example-project",
  "namespace": "culturalheritagenus",
  "name": "Example Project",
  "description": "A one-line description of the dataset.",
  "keywords": ["topic", "method"],
  "access": "restricted",
  "sources": [
    {
      "title": "GitHub repository (sign in for access)",
      "path": "https://github.com/culturalheritagenus/example-project",
      "access": "restricted"
    }
  ]
}
```

The link is a **landing page**, not a public data URL; GitHub may show 404 to signed-out visitors. Use a credential-free HTTPS URL with no query string or fragment for restricted sources. Never put private file URLs, tokens, database credentials, or restricted data in `datasets.json` or `public/data/`. A restricted record cannot have `file` or `resources`; the build rejects that combination. This public static site displays an access label but provides **no authentication or authorization** for source data. The source system remains responsible for access.

For public sources, prefer linking to an existing public landing page with `sources`. If an accessible CSV/TSV/JSON/GeoJSON resource needs a preview, an absolute URL can be used in `file` (with `format`), subject to the remote host's CORS support. Avoid copying source data into the portal by default. Small CSVs under `public/data/` are inherited **template samples**, not CSSH research data; other demo records also reference external R2-hosted Parquet/geo files. Keep these samples until deliberately retired, but do not treat their namespaces or data as CSSH publishers.

The restricted CSSH entries in `datasets.json` are examples of the current onboarding pattern. New records should use informative titles, descriptions, and subject keywords so they are discoverable without exposing private content. After editing, build the site and check both `/search` and the generated showcase URL. No per-dataset page is needed.

## Implementation status

- [`lib/providers/static-provider.ts`](lib/providers/static-provider.ts) loads the manifest at build time; [`lib/datasets.ts`](lib/datasets.ts) supplies search, routing, and restricted-access validation. [`lib/providers/types.ts`](lib/providers/types.ts) defines the record shape.
- The current UI and bundled samples still contain PortalJS template preview, map, and DuckDB features. `DATA_QUERY` is **still `'duckdb'`** in `lib/datasets.ts`; [ARCHITECTURE.md](ARCHITECTURE.md) calls for a later switch to `'flat'` for the catalogue's preview-only use case. Do not assume that switch has been made.
- Git LFS/R2 configuration and optional template commands are present, but the CSSH default is **external linked data**, not ingesting files into R2. XML and PostgreSQL data can be listed by metadata and landing-page link without adding a preview or a database connection to the site.
- Cloudflare Pages built from GitHub is the intended hosting model; this repository does not itself provide access control for restricted datasets.
