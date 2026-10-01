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
| `TSX_TSCONFIG_PATH=scripts/tsconfig.test.json node --import tsx --test scripts/catalog.test.ts scripts/github-repositories.test.ts scripts/harvest-roundtrip.test.ts` | Run catalogue, GitHub onboarding, and metadata tests |
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

### Master collections and derived datasets

A master collection is an authoritative body of data; a derived dataset can be a subset or transformation of other data, whether or not its parents are recorded in this catalogue. For example, a PostgreSQL database hosted on Supabase or a Droplet might hold a master collection, while a GitHub repository holds a derived subset. Hosting does **not** determine the role. Keep each as its own catalogue record with its own access label and source landing page; a public subset does not inherit its parent's access label automatically. Never publish a database connection string, credentials, or private URLs.

Records may optionally declare `role: "master" | "derived"` and independently provide `derivedFrom`, an array of `{ "namespace": "...", "slug": "..." }` references to known parent records. Both fields are optional; a derived record may have no recorded parents, and multiple parents are supported. Parent references must resolve to catalogue records, cannot be duplicated or self-referential, and cycles are rejected. For example, a derived record can use `"role": "derived"` without a `derivedFrom` field when its provenance is unknown.

Showcase pages label declared roles and link to known parent records; search results show the role. A published record may reference a draft parent, but production output omits that parent's reference and link; the relationship remains visible in development. Access labels are independent per record. The portal does not connect to source databases. Lineage is not currently exported in generated DCAT feeds. The current catalogue explicitly links `ds-article-20260902`, `ds-filteredum1956`, and `ds-articlereconstruction-20260821` to the illustrative Supabase example; `rumi-data` is intentionally unlinked. The example is not a provisioned database, and no additional relationships should be inferred. See [ARCHITECTURE.md](ARCHITECTURE.md) for design details.

### GitHub repository onboarding

`scripts/github-repositories.ts` can propose metadata-only draft records from repositories in a GitHub organisation or user account. It matches repository **names** locally (default `^ds[-_].*`), reads only GitHub repository metadata plus allowlisted `datapackage.json`, `metadata.yaml`, and README files, and never downloads dataset files. From `metadata.yaml`, it recognizes top-level `title`/`name`, `description`, and `keywords` fields (including a keyword list). Metadata extracted from repository text is untrusted and may be incomplete; review every proposed description and keyword before applying it.

```bash
# Uses your active `gh` login; set GITHUB_TOKEN only if you want to override it.
pnpm catalogue:github culturalheritagenus                         # dry-run (default)
pnpm catalogue:github culturalheritagenus --namespace cssh        # publisher override
pnpm catalogue:github culturalheritagenus --pattern '^ds[-_].*' --apply
```

The required first argument is the GitHub organisation or username. By default, the catalogue namespace is that account's lowercase login; `--namespace` overrides it without changing source links. `--pattern` overrides the default regular expression. The tool uses GitHub's [REST API](https://docs.github.com/en/rest) for [account lookup](https://docs.github.com/en/rest/users/users#get-a-user), [repository listing](https://docs.github.com/en/rest/repos/repos#list-organization-repositories), and [allowlisted contents](https://docs.github.com/en/rest/repos/contents#get-repository-content); provide a token with only the read permissions needed for those repositories. Already-catalogued repositories are skipped before metadata files are read. A TTY shows a progress bar while new candidates are processed; instead of printing candidate JSON, the script saves a review report to `.tmp/github-repository-review-<namespace>-<account>.json` and prints its path and a count summary. `.tmp/` is gitignored. `--apply` saves the same report and then requires typing `apply` in a terminal before appending new records; it is not suitable for unattended use. Missing descriptions/keywords and slug conflicts are flagged in the report. Existing records are never overwritten.

New records are `draft: true`. They are visible locally in development, but omitted from production catalogue routes/search/home and all generated DCAT feeds. Remove `draft` only after reviewing the metadata and access classification. Drafts are a production visibility gate, not confidentiality: the repository is private, but draft metadata is visible to its collaborators and remains in Git history. The scraper never writes resource/file URLs or `file`/`resources` fields. Non-public or unknown repository visibility is treated as restricted and linked only to the credential-free GitHub repository landing page.

## Implementation status

- [`lib/providers/static-provider.ts`](lib/providers/static-provider.ts) loads the manifest at build time; [`lib/datasets.ts`](lib/datasets.ts) supplies search, routing, and restricted-access validation. [`lib/providers/types.ts`](lib/providers/types.ts) defines the record shape.
- The current UI and bundled samples still contain PortalJS template preview, map, and DuckDB features. `DATA_QUERY` is **still `'duckdb'`** in `lib/datasets.ts`; [ARCHITECTURE.md](ARCHITECTURE.md) calls for a later switch to `'flat'` for the catalogue's preview-only use case. Do not assume that switch has been made.
- Git LFS/R2 configuration and optional template commands are present, but the CSSH default is **external linked data**, not ingesting files into R2. XML and PostgreSQL data can be listed by metadata and landing-page link without adding a preview or a database connection to the site.
- Cloudflare Pages built from GitHub is the intended hosting model; this repository does not itself provide access control for restricted datasets.
