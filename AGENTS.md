# Data Portal — agent notes

Read `ARCHITECTURE.md` and `README.md` before changing catalogue behavior. This is a public, metadata-first data catalogue scaffold currently containing placeholder records for testing, built on an existing PortalJS template; it is not a data warehouse, an access-control service, or yet a reusable portal template.

## Boundaries

- `datasets.json` is the catalogue's source of truth. Keep existing sample records and other uncommitted work intact. Add records there, not in new page files; `pages/[owner]/[slug].tsx` renders `/@<namespace>/<slug>` automatically.
- `NAMESPACE_TYPE = 'owner'` in `lib/datasets.ts`: namespaces identify publishers. Use the appropriate publisher (placeholder records may use `culturalheritagenus`; this does not establish their publisher) and keep `(namespace, slug)` unique. Add useful subject keywords for search.
- Default to links to existing source landing pages; do not copy research data into this repo or route it to LFS/R2 unless explicitly requested. The inline `public/data/` files and R2-backed entries are inherited demos, not a model for restricted data.
- For restricted sources, use `access: 'restricted'` and a credential-free HTTPS landing-page link in `sources` (no query or fragment). Omit `file`. The owner approved ordinary resource metadata listings with explicit resource `access: 'restricted'`, reviewed repository-relative paths, titles, formats and optional supplied counts; directory listings use catalogue format `directory`. Never turn those paths into portal URLs, read their contents/history, preview/download them or export downloadable distributions. Only validated public bucket CSVs may expose bytes. Never publish host/filesystem paths, private URLs, tokens, credentials or restricted bytes. Access is enforced by the source, not by this static site.
- Scheduled/manual organisation refresh is implemented by `scripts/sync-github-catalogue.ts` and `.github/workflows/sync-catalogue.yml`. Owner approved source-authoritative names/descriptions/keywords/licences/resource listings/counts, public private-repository metadata and public bucket updates in review-only PRs. Preserve identity, publication, dates and confirmed lineage; new records are drafts. Flag access/restricted-resource changes; never read ordinary private bytes. Legacy `catalogue:github` stays interactive/append-only. Configure credentials separately; never auto-merge or change secrets/settings without approval.
- Root `buckets.csv` is explicitly public even for restricted datasets. Import only from a suitable release, validate its two-column label/count contract, and copy only on confirmed apply to `public/data/buckets/<namespace>/<slug>.csv`. Legacy onboarding dry runs write no public data and never overwrite existing files/records; the separate owner-approved sync may propose replacements in PRs. The resource drives the existing horizontal chart and remains a normal public download/distribution. No custom Dataset fields. Labels/counts and draft CSV bytes require disclosure review; the underlying dataset stays restricted.
- A GitHub repository URL is a landing page, not a CSV/JSON file URL. If a repo is inaccessible without login, request enough metadata from the user instead of guessing its contents.
- Catalogue records may optionally declare one controlled `stage:` keyword from `stage.config.json` (currently `master`, `curated`, `annotated`, or `ground-truth`); omit the stage when unknown, and do not use the removed `role` field. Coordinate config changes with the separate dataset template. Confirmed parent links use internal `derivedFrom` references by `(namespace, slug)`, independent of stage and package `sources[]`. Validate references/cycles; in production omit draft-parent references from provider-visible output. Do not infer relationships from hosting/URLs or assume access inherits. PROV-O lineage export remains separate pending a canonical-URI decision.
- The intended query setting is `flat` per `ARCHITECTURE.md`, but code still sets `DATA_QUERY = 'duckdb'`; don't claim the migration is complete or change it incidentally. GitHub Pages serves the static export at `data.budaya-lab.org`; it is not a runtime RBAC backend.

## Source descriptor validation

- Onboarding in `scripts/data-package.ts` uses the pinned compiled Penjaga v2.0.0 release (`@penjaga/validator`) and its bundled policy for source `datapackage.json`. Keep shared rule tests in Penjaga, with only adapter/integration tests here. Retain portal-specific disclosure, publication-path/URL, placeholder-date and mapping checks; never expose shared validation details containing private resource names.
- Keep the `@penjaga/validator` dependency, imports and lockfile aligned when upgrading its pinned published archive. Do not substitute a sibling checkout, moving branch, source archive or nonexistent release asset.
- Do not apply the full dataset policy to `datasets.json`. Catalogue validation, stage helpers/config and bucket parsing remain separate and unchanged by this adoption.

## Verification

- Package manager: pnpm (`pnpm-lock.yaml`); Node.js 24+. Do not install dependencies unless asked.
- Build: `pnpm build` (generates optional DCAT feeds and static `out/`). Then run `pnpm check:pages` for export hygiene and route/asset checks. Typecheck: `pnpm exec tsc --noEmit`.
- Preserve the `Validate portal` workflow/job names. Pages deployment is a separate, current-main-only workflow; do not couple release management to deployment or publish PR artifacts. `public/CNAME` preserves the custom domain.
- Tests: `pnpm test` (runs `scripts/*.test.ts`, including bucket validation/import/apply tests).
- Lint: `pnpm lint`; format/check: `pnpm check`. These currently have existing diagnostics; do not make unrelated cleanup changes.
- Review the diff and `git status` before reporting. Do not commit unless asked.
