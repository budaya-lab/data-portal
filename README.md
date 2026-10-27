# Budaya Lab Data Portal

A public, metadata-first data catalogue. The records currently in `datasets.json` include testing placeholders and entries that are not yet reviewed for publication. Some are non-draft and therefore appear in production builds and feeds; do not treat that output as a reviewed catalogue. The intended workflow is to discover records by publisher and keywords, then follow links to the systems that hold the data; access to restricted sources is enforced there, not by this public site. This repository is not yet a reusable template; the test records must be replaced with reviewed, safe examples before it becomes `tpl-data-portal`. See [ARCHITECTURE.md](ARCHITECTURE.md) for the decisions and planned work.

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

### Chart browser check

The overview chart has an opt-in, dependency-free WebDriver test for proportional bars, axis placement, responsive layout, and hover/keyboard tooltips. Tooltip focus, hover, and Escape behavior follows the [WAI-ARIA tooltip pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/). It needs a local portal and an isolated browser automation session. For Safari, remote automation must already be enabled by the user; this check does not change browser settings.

```bash
# In separate terminals, with Safari automation already enabled:
pnpm dev
safaridriver --port 4815
# Then run:
node --test scripts/chart.browser.test.mjs
```

`CHART_WEBDRIVER_URL`, `CHART_PORTAL_URL`, and `CHART_BROWSER_NAME` can select another local WebDriver/browser. This test is separate from the regular Node suite and fails rather than skips when automation is unavailable. For manual verification, check all seven bars and labels, hover a bar, Tab between bars, dismiss a tooltip with Escape, and check the layout at narrow and wide widths.

## Releases

`Validate portal` runs the catalogue tests, typecheck, and build on PRs to `main` and pushes to `main`. Repository-wide `pnpm lint` / `pnpm check` currently have pre-existing diagnostics, so they are not CI gates yet. After a successful **push** validation on the current `main` commit, `Release portal` runs Release Please. It uses Conventional Commits to propose a release PR that updates the version in `package.json`, the manifest, and `CHANGELOG.md`; merging that PR creates a tag and GitHub Release. The first release starts at `0.1.0`. Future portal tags and GitHub Release names use `vX.Y.Z`, like the dataset template; the existing legacy `v0.1.0` and `v0.2.0` tags remain unchanged. Both `v0.2.1` and `v0.3.0` have been published, so Release Please can now find the prior release using unprefixed tags. Do not create or rewrite tags to bypass review. Releases do not publish catalogue records or deploy the portal; review dataset metadata and access separately.

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

Use exactly one controlled `stage:` keyword from `stage.config.json` **when the stage is known**. The current values are `stage:master` (source-of-record data), `stage:curated` (cleaned/transformed data), and `stage:annotated` (labelled/enriched data). This file also supplies the stage labels shown in the portal; coordinate changes with the separate dataset-template configuration. This is a local convention within the standard Data Package `keywords` field, not a globally defined Data Package type. Other keywords describe subjects. The portal validates stage keywords, displays the stage separately on search and showcase pages, and hides the raw `stage:` keyword from subject tags and suggested searches. Records without a known stage remain unlabelled; do not infer one from hosting, description, or known parents. Stage labels on the placeholder records, including the illustrative (non-provisioned) Supabase record, are for testing only; do not treat them as verified classifications.

Confirmed catalogue parent relationships may independently use `derivedFrom`, an **internal portal reference** containing `{ "namespace": "...", "slug": "..." }`. It is not a Data Package field; package `sources[]` means upstream origins, and portal `sources[]` currently lists landing pages. Parent references must exist, be unique, and have no cycles. A published record may reference a draft parent, but production output omits that parent's reference and link; the relationship remains visible in development. Access is independent per record: a public subset does not inherit its parent's access label. The portal does not connect to source databases, and lineage is not yet exported as PROV-O `prov:wasDerivedFrom` in DCAT feeds. That would require a separately reviewed canonical dataset-URI policy. Never infer lineage or publish private URLs or credentials. See [ARCHITECTURE.md](ARCHITECTURE.md) for design details.

### GitHub repository onboarding

`scripts/github-repositories.ts` proposes drafts from repositories in a GitHub organisation or user account, matching repository **names** locally (default `^ds[-_].*`). A root `datapackage.json` is required for each new candidate; invalid or missing packages stop the harvest rather than falling back to `metadata.json`, YAML, README, or repository descriptions. Package `title`, `description`, `keywords`, optional `created` and public-safe `licenses` become catalogue metadata. License URLs must point to public Creative Commons, SPDX or Open Data Commons pages; otherwise correct the package before onboarding. Contributors and raw upstream `sources[]` stay in the package; no parent relationship is inferred. Replace the template example data and date before onboarding. Repository names and the publisher namespace determine catalogue identity, not package `name`.

For public repositories, the harvester chooses the highest published, non-prerelease SemVer GitHub Release whose tag points to a commit reachable from `main`. It reads the package and verifies every declared file against that release's Git tree **without downloading dataset bytes**. Supported single-file resources link to that release **tag**, not a moving branch or a commit SHA. If there is no suitable release, a tag or resource is missing, the tree is truncated, any format is unsupported, or any resource uses a path array, the public candidate is a metadata-only draft with a generic review warning: no partially linked resource list is published. Git tags can move or disappear; recheck the tag and links before removing `draft`. Private/unknown-visibility repositories read their package from `main` but produce safe metadata and a credential-free landing link only, never resource paths or previews.

```bash
# Uses your active `gh` login; set GITHUB_TOKEN only if you want to override it.
pnpm catalogue:github OWNER                         # dry-run (default)
pnpm catalogue:github OWNER --namespace PUBLISHER    # publisher override
pnpm catalogue:github OWNER --pattern '^example-.*' --apply
```

The required first argument is the GitHub organisation or username. By default, the catalogue namespace is that account's lowercase login; `--namespace` overrides it without changing source links. `--pattern` overrides the default regular expression. The tool uses GitHub's [REST API](https://docs.github.com/en/rest) for [repository listing](https://docs.github.com/en/rest/repos/repos#list-organization-repositories), [releases](https://docs.github.com/en/rest/releases/releases#list-releases), [commit comparison](https://docs.github.com/en/rest/commits/commits#compare-two-commits), [Git trees](https://docs.github.com/en/rest/git/trees#get-a-tree), and [package contents](https://docs.github.com/en/rest/repos/contents#get-repository-content); provide a token with only the read permissions needed for those repositories. Already-catalogued repositories are skipped before metadata files are read. A TTY shows a progress bar while new candidates are processed; instead of printing candidate JSON, the script saves a review report to `.tmp/github-repository-review-<namespace>-<account>.json` and prints its path and a count summary. `.tmp/` is gitignored. `--apply` saves the same report and then requires typing `apply` in a terminal before appending new records; it is not suitable for unattended use. Missing descriptions/keywords and slug conflicts are flagged in the report. Existing records are never overwritten.

New records are `draft: true`. They are visible locally in development, but omitted from production catalogue routes/search/home and all generated DCAT feeds. Remove `draft` only after reviewing the metadata and access classification. Drafts are a production visibility gate, not confidentiality: the repository is private, but draft metadata is visible to its collaborators and remains in Git history. Only complete, verified public packages get tag-pinned `resources[]` URLs in their drafts; restricted or unknown-visibility repositories never receive `file`/`resources` fields. Review package metadata for sensitive titles, descriptions, keywords and licences before publication. Private resource filenames and paths must never enter public records or review reports.

## Implementation status

- [`lib/providers/static-provider.ts`](lib/providers/static-provider.ts) loads the manifest at build time; [`lib/datasets.ts`](lib/datasets.ts) supplies search, routing, and restricted-access validation. [`lib/providers/types.ts`](lib/providers/types.ts) defines the record shape.
- The current UI and bundled samples still contain PortalJS template preview, map, and DuckDB features. `DATA_QUERY` is **still `'duckdb'`** in `lib/datasets.ts`; [ARCHITECTURE.md](ARCHITECTURE.md) calls for a later switch to `'flat'` for the catalogue's preview-only use case. Do not assume that switch has been made.
- Git LFS/R2 configuration and optional template commands are present, but the catalogue defaults to **external linked data**, not ingesting files into R2. Sources can be listed by metadata and landing-page link without adding a preview or a database connection to the site.
