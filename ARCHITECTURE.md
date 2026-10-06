# Architecture brief — research data catalogue

**Building:** A public research-data catalogue for a centre with multiple publishers/owners.
**Data:** Approximately 100 datasets and growing; mostly MB-sized CSV, JSON, and XML in GitHub repositories, plus PostgreSQL sources to link to. Existing datasets rarely change; new datasets arrive continuously. Catalogue records are public; some sources require access control.
**Purpose:** Discover and filter datasets by metadata, then follow links to their sources. The portal does not need to host downloads or search within source data.

| Slot | Decision | Reason |
| --- | --- | --- |
| Storage | Repo files for catalogue metadata; data remains at external GitHub/PostgreSQL sources | Avoid duplicating existing data or introducing R2/LFS infrastructure. |
| Catalog | `datasets.json` in GitHub | Git-managed, reviewable records suit the current catalogue size and publishing workflow. GitHub is the catalogue's source of truth, not a runtime database or access-control backend. |
| Compute | Flat preview where appropriate; no catalogue-wide data-query engine | Catalogue search is metadata search, not queries over file contents or database rows. |
| Access | Static, public catalogue; record whether each linked source is public or restricted | Source systems, not the portal, enforce access. Never publish private data, credentials, or privileged download URLs in the static site. |
| Hosting | Cloudflare Pages built from GitHub | Static hosting supports a public Git-managed catalogue without a runtime service. |
| Metadata | Frictionless Data Package keywords for subjects and a controlled dataset stage; optional catalogue-parent links | Reuse the portal's metadata model and keep publisher/access independent of stage. DCAT export exists, but confirmed parent links are not yet serialized with PROV-O. |

**Namespace mode:** `owner` — group datasets by publisher/owner.

**Default data tier for added datasets:** `external` — record existing public landing-page or resource URLs without copying bytes. Restricted sources should link to an appropriate authentication-protected landing page, not embed private resource URLs; use `LFS` only if a future dataset is intentionally ingested and versioned with the portal. The portal can mix tiers per dataset.

**Query mode:** `DATA_QUERY = 'flat'` — metadata-only discovery does not require the SQL editor. This is a portal-wide change from the existing `duckdb` setting in `lib/datasets.ts`; Parquet resources still render a query view regardless of the setting. Do not attempt to preview restricted sources.

**Deviations from template defaults:** No R2/LFS ingest, DuckLake, or DuckDB for general discovery; use existing GitHub source links, `datasets.json`, and flat preview. Frictionless metadata remains the default.

**Implemented for catalogue onboarding:** `keywords` now participate in search; records and sources can label access as public/restricted; restricted records link to HTTPS landing pages without exposing resource downloads or previews. The static build rejects restricted records with resources. Access to the source is still enforced by the source system; restricted bytes must never be placed in `public/data/`.

**Stage and catalogue lineage:** `stage.config.json` defines the portal's allowed stage values and display labels (currently `stage:master`, `stage:curated`, and `stage:annotated`); coordinate changes with the dataset template's separate config. These are controlled keywords, not Data Package-defined types; missing stages stay unknown. The portal validates at most one and displays its label without treating it as a subject keyword. Hosting never implies a stage. Optional `derivedFrom: { namespace: string; slug: string }[]` is an internal pointer to confirmed catalogue parents, distinct from upstream package `sources[]` and portal landing-page `sources[]`. A record with a stage need not identify parents, and a record with parents need not declare a stage. References must resolve uniquely and remain acyclic; multiple parents are supported. Showcase pages link to known, visible parents. In production, references to draft parents are omitted from served catalogue records and page props; they remain valid in the source manifest and visible in development. Each record's access is independent: a public subset is not automatically restricted because a parent is restricted. Do not infer lineage or expose connection strings. The static site does not connect to databases. DCAT/PROV-O feed mapping for lineage remains unimplemented pending a canonical-URI policy.

**Designed in, built later:** Add source type/details for GitHub and PostgreSQL and XML-specific previews only if needed (linked sources work without preview). Switch the existing portal-wide `DATA_QUERY` constant from `duckdb` to `flat` when the agreed preview-only mode is implemented. Runtime RBAC is only needed if catalogue records themselves become private. The portal is already scaffolded with `NAMESPACE_TYPE = 'owner'`; do not scaffold a second portal.
