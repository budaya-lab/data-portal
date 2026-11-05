# Budaya Lab Data Portal

Public dataset catalogue at [data.budaya-lab.org](https://data.budaya-lab.org/). Search metadata and follow links to the data at its source. The portal does not control access to source data.

[`datasets.json`](datasets.json) is the catalogue's source of truth. It includes placeholder records for testing.

## Run locally

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000/>. Draft records are visible locally but excluded from production pages and feeds.

## Add a dataset

### From a GitHub repository

1. Create the dataset repository from [`tpl-dataset`](https://github.com/nus-dh/tpl-dataset#readme). Follow its instructions to replace the example metadata and data, fill in `datapackage.json`, and validate it. The template requires one primary-stage keyword: `stage:master`, `stage:curated`, `stage:annotated`, or `stage:ground-truth`.
2. For public datasets, create a reviewed GitHub Release using the template's release workflow. The portal links verified ordinary resources from the highest non-prerelease SemVer release reachable from `main`; it does not copy those files. The exception is optional public `buckets.csv` summaries, which are copied on confirmed apply for public and restricted repositories alike. Without a suitable release, no summary is imported. Private repositories otherwise contribute safe metadata and a landing-page link only.
3. From this directory, discover candidates and review the report:

   ```bash
   # Uses your gh login, or GITHUB_TOKEN if set.
   pnpm catalogue:github OWNER
   pnpm catalogue:github OWNER --apply
   ```

   `OWNER` is the GitHub organisation or username. The default repository-name pattern is `^ds[-_].*`; override it with `--pattern`. The publisher namespace defaults to the account's lowercase login; override it with `--namespace`.

   The first command validates summaries in memory and writes a report under `.tmp/` without changing the catalogue or `public/data/`. `--apply` requires typing `apply` in a terminal, copies validated public summaries, and appends drafts to `datasets.json`. Existing records are skipped, not updated. A valid root `datapackage.json` is required; README text and repository descriptions are not metadata fallbacks.
4. Review metadata, access, licences, resource links, and report warnings. Remove `draft` only when approved for publication. Run the checks below and submit a PR. A dataset release does not automatically publish a catalogue record.

### Manually

Edit `datasets.json`; no new page file is needed. Use a unique `(namespace, slug)`, where `namespace` identifies the publisher. Add a title (`name`), description, subject keywords, and source landing-page link. Pages appear at `/@<namespace>/<slug>/`.

- For restricted sources, set `access: "restricted"`, use a credential-free HTTPS landing URL without a query or fragment, and omit `file` and all ordinary resources. The only resource exception is a validated public bucket summary, described below. Never add private paths, credentials, or restricted data to the portal. Drafts are not a confidentiality boundary: their metadata and copied public summaries remain in Git.
- Set a stage only when known, using one keyword from [`stage.config.json`](stage.config.json). Keep its values aligned with the dataset template.
- Use `derivedFrom` only for confirmed catalogue parents. It is separate from Data Package `sources[]`; onboarding does not infer lineage.

### Public bucket summaries

A dataset repository may contain optional root `buckets.csv`: exactly two columns with headers, any nonempty label-column name other than `count`, followed by `count`. Labels must be unique and nonempty after trimming. Counts must be non-negative integers up to `9007199254740991`; zero counts are valid. Require at least one row and at most 1,000,000 bytes. Quoted labels, UTF-8 BOM, and LF/CRLF line endings are supported. Labels such as `001` remain text.

**Labels and counts are public, even when the dataset is restricted.** Review them for disclosure before applying an import. This exception never permits copying underlying restricted data or changing its access label.

Use the existing standard `resources[]` fields, not a custom catalogue field. Source descriptors should declare `name: "buckets"`, `path: "buckets.csv"`, and `format: "csv"`. Root-file discovery also works without that declaration. Onboarding reads the summary from the selected release commit, validates it, and on confirmed apply creates this catalogue resource:

```json
{
  "name": "buckets",
  "path": "buckets/<namespace>/<slug>.csv",
  "format": "csv",
  "title": "Public bucket summary"
}
```

The path is relative to the portal's `public/data/`. New imports use publisher-scoped paths to prevent collisions. The existing `ds-layout-um-v2` example retains its original public CSV path. Existing records and files are skipped or flagged for review, never overwritten automatically. Advertised summaries that are malformed, unavailable, symlinked, or oversized fail import rather than disappear silently.

The showcase derives the category header from the local CSV and renders horizontal bars in Views. The summary is also a normal public resource download/distribution, not a second table/SQL preview. Builds validate local summary paths and contents. Dataset access stays restricted where applicable. Copied CSVs are public in Git and the static export even for draft records; production still omits draft pages and feeds.

## Checks

```bash
pnpm validate  # tests, typecheck, build, and static-export checks
pnpm lint
pnpm check
```

Lint and format checks currently report existing diagnostics. `pnpm build` writes the static site to `out/` and generates the configured metadata feeds.

## GitHub Pages deployment

PRs run **Validate portal**. Successful validation of the current `main` commit triggers **Deploy portal** to publish the static site. Keep `public/CNAME` for the custom domain. To retry, run **Validate portal** on `main`; to roll back, revert through a reviewed PR.

Portal releases are separate from deployment. Use Conventional Commit PR titles. Release Please proposes version/changelog PRs after validated pushes to `main`; manually run **Validate portal** on each release PR branch before merging because its `GITHUB_TOKEN`-created PR does not trigger CI automatically.

See [ARCHITECTURE.md](ARCHITECTURE.md) for design decisions and remaining work.
