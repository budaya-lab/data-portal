# Data Portal — agent notes

Read `ARCHITECTURE.md` and `README.md` before changing catalogue behavior. This is a public, metadata-first research-data catalogue currently containing CSSH records, built on an existing PortalJS template; it is not a data warehouse, an access-control service, or yet a reusable portal template.

## Boundaries

- `datasets.json` is the catalogue's source of truth. Keep existing sample records and other uncommitted work intact. Add records there, not in new page files; `pages/[owner]/[slug].tsx` renders `/@<namespace>/<slug>` automatically.
- `NAMESPACE_TYPE = 'owner'` in `lib/datasets.ts`: namespaces identify publishers. Use the appropriate publisher (existing CSSH records use `culturalheritagenus`) and keep `(namespace, slug)` unique. Add useful subject keywords for search.
- Default to links to existing source landing pages; do not copy research data into this repo or route it to LFS/R2 unless explicitly requested. The inline `public/data/` files and R2-backed entries are inherited demos, not a model for restricted CSSH data.
- For restricted sources, use `access: 'restricted'` and a credential-free HTTPS landing-page link in `sources` (no query or fragment). Omit `file` and `resources`: the public build rejects restricted resources. Never put private URLs, tokens, credentials, or restricted bytes into public files. Access is enforced by the source, not by this static site.
- A GitHub repository URL is a landing page, not a CSV/JSON file URL. If a repo is inaccessible without login, request enough metadata from the user instead of guessing its contents.
- Catalogue records may optionally declare one controlled `stage:` keyword from `stage.config.json` (currently `master`, `curated`, or `annotated`); omit the stage when unknown, and do not use the removed `role` field. Coordinate config changes with the separate dataset template. Confirmed parent links use internal `derivedFrom` references by `(namespace, slug)`, independent of stage and package `sources[]`. Validate references/cycles; in production omit draft-parent references from provider-visible output. Do not infer relationships from hosting/URLs or assume access inherits. PROV-O lineage export remains separate pending a canonical-URI decision.
- The intended query setting is `flat` per `ARCHITECTURE.md`, but code still sets `DATA_QUERY = 'duckdb'`; don't claim the migration is complete or change it incidentally. Cloudflare Pages is intended hosting, not a runtime RBAC backend.

## Verification

- Package manager: pnpm (`pnpm-lock.yaml`); Node.js 22+. Do not install dependencies unless asked.
- Build: `pnpm build` (also generates optional DCAT feeds). Typecheck: `pnpm exec tsc --noEmit`.
- Tests: `TSX_TSCONFIG_PATH=scripts/tsconfig.test.json node --import tsx --test scripts/catalog.test.ts scripts/data-package.test.ts scripts/github-repositories.test.ts scripts/release-resources.test.ts scripts/harvest-roundtrip.test.ts`.
- Lint: `pnpm lint`; format/check: `pnpm check`. These currently have existing diagnostics; do not make unrelated cleanup changes.
- Review the diff and `git status` before reporting. Do not commit unless asked.
