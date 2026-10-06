# CSSH Data Portal

A public catalogue of research datasets for CSSH. Use it to discover records by publisher and keywords, then follow links to the systems that hold the data. The catalogue is **metadata-first**: most data stays in GitHub repositories or other source systems, and access to restricted sources is enforced there, not by this public site. See [ARCHITECTURE.md](ARCHITECTURE.md) for the decisions and planned work.

## Run locally

Requires Node.js 22+ and pnpm (this project uses `pnpm-lock.yaml`). From this directory:

```bash
pnpm install
pnpm dev
```

Visit `http://localhost:3000/`. To check a production build, run `pnpm build`. The build and dev scripts also generate optional DCAT feeds from the catalogue; `datasets.json` remains the source of truth.

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the local Next.js server |
| `pnpm build` | Generate the feeds and build the site |
| `pnpm exec tsc --noEmit` | Type-check |
| `TSX_TSCONFIG_PATH=scripts/tsconfig.test.json node --import tsx --test scripts/catalog.test.ts scripts/github-repositories.test.ts scripts/harvest-roundtrip.test.ts` | Run catalogue, GitHub onboarding, and metadata tests |
| `pnpm lint` / `pnpm check` | Run Biome lint / lint + format checks |

## Releases

`Validate portal` runs the catalogue tests, typecheck, and build on PRs to `main` and pushes to `main`. Repository-wide `pnpm lint` / `pnpm check` currently have pre-existing diagnostics, so they are not CI gates yet. After a successful **push** validation on the current `main` commit, `Release portal` runs Release Please. It uses Conventional Commits to propose a release PR that updates the version in `package.json`, the manifest, and `CHANGELOG.md`; merging that PR creates a tag and GitHub Release. The first release starts at `0.1.0`. Releases do not publish catalogue records or deploy the portal; review dataset metadata and access separately.

Use reviewed PRs and Conventional Commit titles for squash merges (e.g. `feat(catalog): add search filters` or `fix(catalog): correct dataset links`). Enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** if repository policy requires it. The release workflow uses the built-in `GITHUB_TOKEN`, not a personal access token. GitHub does not trigger PR CI for PRs created with that token: manually run **Validate portal** with `workflow_dispatch` on the release PR branch, inspect the diff and passing result, then merge. Re-run validation if the release branch changes. Confirm your branch protection accepts this manual validation before relying on it as a required check.

## Catalogue workflow

Edit [`datasets.json`](datasets.json) to add or update records; **do not create a page per dataset**. The search page at `/search` filters record names, publisher namespaces, descriptions, categories, and keywords (not the contents of source files). [`pages/[owner]/[slug].tsx`](pages/%5Bowner%5D/%5Bslug%5D.tsx) generates each showcase at `/@<namespace>/<slug>` at build time. This portal uses `NAMESPACE_TYPE = 'owner'`: `namespace` means publisher/owner, not subject. `(namespace, slug)` must be unique.

For an access-controlled GitHub repository, a metadata-only record needs no `file`, `format`, or `resources`:

```json
{
  "slug": "example-repository",
  "namespace": "publisher",
  "name": "Example Project",
  "description": "A one-line description of the dataset.",
  "keywords": ["topic", "method"],
  "access": "restricted",
  "sources": [
    {
      "title": "GitHub repository (sign in for access)",
      "path": "https://github.com/OWNER/REPOSITORY",
      "access": "restricted"
    }
  ]
}
```

The link is a **landing page**, not a public data URL; GitHub may show 404 to signed-out visitors. Use a credential-free HTTPS URL with no query string or fragment for restricted sources. Never put private file URLs, tokens, database credentials, or restricted data in `datasets.json` or `public/data/`. A restricted record cannot have `file` or `resources`; the build rejects that combination. This public static site displays an access label but provides **no authentication or authorization** for source data. The source system remains responsible for access.

For public sources, prefer linking to an existing public landing page with `sources`. If an accessible CSV/TSV/JSON/GeoJSON resource needs a preview, an absolute URL can be used in `file` (with `format`), subject to the remote host's CORS support. Avoid copying source data into the portal by default. New records should use informative titles, descriptions, and subject keywords so they are discoverable without exposing private content. After editing, build the site and check both `/search` and the generated showcase URL. No per-dataset page is needed.

### Dataset stages and catalogue parents

Use exactly one controlled `stage:` keyword from `stage.config.json` **when the stage is known**. The current values are `stage:master` (source-of-record data), `stage:curated` (cleaned/transformed data), and `stage:annotated` (labelled/enriched data). This file also supplies the stage labels shown in the portal; coordinate changes with the separate dataset-template configuration. This is a local convention within the standard Data Package `keywords` field, not a globally defined Data Package type. Other keywords describe subjects. The portal validates stage keywords, displays the stage separately on search and showcase pages, and hides the raw `stage:` keyword from subject tags and suggested searches. Records without a known stage remain unlabelled; do not infer one from hosting, description, or known parents. The four stage labels currently assigned to exploratory CSSH records are provisional, including the illustrative (non-provisioned) Supabase record; dataset owners must confirm them before treating them as verified classifications.

Confirmed catalogue parent relationships may independently use `derivedFrom`, an **internal portal reference** containing `{ "namespace": "...", "slug": "..." }`. It is not a Data Package field; package `sources[]` means upstream origins, and portal `sources[]` currently lists landing pages. Parent references must exist, be unique, and have no cycles. A published record may reference a draft parent, but production output omits that parent's reference and link; the relationship remains visible in development. Access is independent per record: a public subset does not inherit its parent's access label. The portal does not connect to source databases, and lineage is not yet exported as PROV-O `prov:wasDerivedFrom` in DCAT feeds. That would require a separately reviewed canonical dataset-URI policy. Never infer lineage or publish private URLs or credentials. See [ARCHITECTURE.md](ARCHITECTURE.md) for design details.

### GitHub repository onboarding

`scripts/github-repositories.ts` can propose metadata-only draft records from repositories in a GitHub organisation or user account. It matches repository **names** locally (default `^ds[-_].*`), reads only GitHub repository metadata plus allowlisted `metadata.json`, `datapackage.json`, `metadata.yaml`, and README files, and never downloads dataset files. From `metadata.json`, it recognizes `name` (or `title`), `description`, `keywords`, and optional `derivedFrom`; the descriptive fields take precedence over the same fields in `datapackage.json`, while missing or invalid descriptive fields fall back to `datapackage.json`, `metadata.yaml`, repository metadata, or README as appropriate. The old `role` field is rejected; use a controlled `stage:` keyword instead. Declared parent links are copied into drafts for review, not inferred from URLs. Malformed parent fields stop the harvest; `--apply` rejects parent references absent from the catalogue or lineage cycles. From `metadata.yaml`, it recognizes top-level `title`/`name`, `description`, and `keywords` fields (including a keyword list). Metadata extracted from repository text is untrusted and may be incomplete; review every proposed description and keyword before applying it.

```bash
# Uses your active `gh` login; set GITHUB_TOKEN only if you want to override it.
pnpm catalogue:github OWNER                         # dry-run (default)
pnpm catalogue:github OWNER --namespace PUBLISHER    # publisher override
pnpm catalogue:github OWNER --pattern '^example-.*' --apply
```

The required first argument is the GitHub organisation or username. By default, the catalogue namespace is that account's lowercase login; `--namespace` overrides it without changing source links. `--pattern` overrides the default regular expression. The tool uses GitHub's [REST API](https://docs.github.com/en/rest) for [account lookup](https://docs.github.com/en/rest/users/users#get-a-user), [repository listing](https://docs.github.com/en/rest/repos/repos#list-organization-repositories), and [allowlisted contents](https://docs.github.com/en/rest/repos/contents#get-repository-content); provide a token with only the read permissions needed for those repositories. Already-catalogued repositories are skipped before metadata files are read. A TTY shows a progress bar while new candidates are processed; instead of printing candidate JSON, the script saves a review report to `.tmp/github-repository-review-<namespace>-<account>.json` and prints its path and a count summary. `.tmp/` is gitignored. `--apply` saves the same report and then requires typing `apply` in a terminal before appending new records; it is not suitable for unattended use. Missing descriptions/keywords and slug conflicts are flagged in the report. Existing records are never overwritten.

New records are `draft: true`. They are visible locally in development, but omitted from production catalogue routes/search/home and all generated DCAT feeds. Remove `draft` only after reviewing the metadata and access classification. Drafts are a production visibility gate, not confidentiality: the repository is private, but draft metadata is visible to its collaborators and remains in Git history. The scraper never writes resource/file URLs or `file`/`resources` fields. Non-public or unknown repository visibility is treated as restricted and linked only to the credential-free GitHub repository landing page.

## Implementation status

- [`lib/providers/static-provider.ts`](lib/providers/static-provider.ts) loads the manifest at build time; [`lib/datasets.ts`](lib/datasets.ts) supplies search, routing, and restricted-access validation. [`lib/providers/types.ts`](lib/providers/types.ts) defines the record shape.
- The current UI and bundled samples still contain PortalJS template preview, map, and DuckDB features. `DATA_QUERY` is **still `'duckdb'`** in `lib/datasets.ts`; [ARCHITECTURE.md](ARCHITECTURE.md) calls for a later switch to `'flat'` for the catalogue's preview-only use case. Do not assume that switch has been made.
- Git LFS/R2 configuration and optional template commands are present, but the catalogue defaults to **external linked data**, not ingesting files into R2. Sources can be listed by metadata and landing-page link without adding a preview or a database connection to the site.
