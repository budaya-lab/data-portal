# Budaya Lab Data Portal

Public dataset catalogue at [data.budaya-lab.org](https://data.budaya-lab.org/). Search metadata and follow links to the data at its source. The portal does not control access to source data.

[`datasets.json`](datasets.json) is the catalogue's source of truth. It includes placeholder records for testing.

## Run locally

Requires Node.js 24+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open <http://localhost:3000/>. Draft records are visible locally but excluded from production pages and feeds.

## Add a dataset

### From a GitHub repository

1. Create the dataset repository from [`tpl-dataset`](https://github.com/nus-dh/tpl-dataset#readme). Follow its instructions to replace the example metadata and data, fill in `datapackage.json`, and validate it. The template requires one primary-stage keyword: `stage:master`, `stage:curated`, `stage:annotated`, or `stage:ground-truth`.
2. For public datasets, create a reviewed GitHub Release using the template's release workflow. The portal links verified ordinary resources from the highest non-prerelease SemVer release reachable from `main`; it does not copy those files. The exception is optional public `buckets.csv` summaries, which are copied on confirmed apply for public and restricted repositories alike. Without a suitable release, no summary is imported. Automated imports from private repositories otherwise contribute safe metadata and a landing-page link; reviewed resource listings can be added manually as described below.
3. From this directory, discover candidates and review the report:

   ```bash
   # Uses your gh login, or GITHUB_TOKEN if set.
   pnpm catalogue:github OWNER
   pnpm catalogue:github OWNER --apply
   ```

   `OWNER` is the GitHub organisation or username. The default repository-name pattern is `^ds[-_].*`; override it with `--pattern`. The publisher namespace defaults to the account's lowercase login; override it with `--namespace`.

   The first command validates summaries in memory and writes a report under `.tmp/` without changing the catalogue or `public/data/`. `--apply` requires typing `apply` in a terminal, copies validated public summaries, and appends drafts to `datasets.json`. Existing records are skipped, not updated. A valid root `datapackage.json` is required; README text and repository descriptions are not metadata fallbacks. Onboarding uses the published [Penjaga v2.0.0](https://github.com/budaya-lab/penjaga/releases/tag/v2.0.0) `@penjaga/validator` archive and its bundled metadata policy: a nonblank description, a title for every resource, and exactly one nonempty `task:`, `project:` and controlled `stage:` keyword are required. Supplied counts, contributors, licences and sources must also pass shared validation, even when not copied to the catalogue. These requirements apply to source descriptors, not `datasets.json`.

   Each repository is validated independently. Invalid metadata or bucket summaries skip that repository, not the entire scan. The terminal and report's `failures` list identify the repository and a public-safe reason. Only valid candidates are eligible for confirmed `--apply`; skipped repositories remain unchanged. Authentication, network, rate-limit, and other GitHub API errors still stop the run.
4. Review metadata, access, licences, resource links, and report warnings. Remove `draft` only when approved for publication. Run the checks below and submit a PR. A dataset release does not automatically publish a catalogue record.

### Submit one pushed dataset

**Submit dataset to portal** is manual-only. It accepts one `ds-*` repository name in the portal's GitHub account and a full lowercase 40-character metadata commit SHA. There is no schedule or organisation scan. Choose the workflow on portal `main`, enter the source repository and SHA, and optionally specify a pushed source branch. A future Steward action can call this workflow; no Steward UI or local-versus-pushed comparison is implemented here.

The submitted SHA must be reachable from the named source branch, or the source's default branch when omitted. The descriptor is read only at that SHA. Missing or invalid metadata never falls back to a branch, release descriptor or local draft. Source repository visibility is verified by GitHub. No source Git commit, push or release is created.

Submission uses bounded Git reference/commit metadata to prove ancestry, not REST commit/compare responses containing file patches. At most 256 Git commit lookups are allowed; tag resolution is also bounded. Exceeding a limit stops the submission. Ordinary public download links and bucket summaries retain the suitable-release rule: select the highest non-prerelease SemVer release reachable from both source `main` and the submitted metadata commit. The public report records the metadata SHA and any separate summary release/SHA.

Configure these repository secrets before running it (never put their values in Git):

| Secret | Fine-grained token permissions and repository selection |
| --- | --- |
| `DATASET_READ_TOKEN` | Selected source dataset repositories: **Contents: read** and **Metadata: read**. Include private repositories that may be submitted. |
| `CATALOGUE_PR_TOKEN` | Only `data-portal`: **Contents: read/write**, **Pull requests: read/write**, **Metadata: read**. The account must have portal write access. |

Use dedicated credentials with expiry and organisation approval where required. Keep read and PR credentials separate; source repositories need no write permission. The built-in `GITHUB_TOKEN` cannot read other private repositories, and [PRs it creates do not trigger normal PR validation](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow#triggering-a-workflow-from-a-workflow). No workflow-file-write or administration permission is needed for these runner secrets. The person or tool dispatching the workflow separately needs portal workflow-run permission ([fine-grained token: Actions write](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)); neither runner secret signs in the caller.

The workflow never checks out or executes dataset code. It reads only root `datapackage.json` and validated public `buckets.csv` contents, validates the resulting catalogue, and commits only `datasets.json` and public CSV summaries. **PRs, their branches and run summaries are public**, including metadata for private datasets and bucket labels/counts. Review disclosure before dispatching. Ordinary restricted resource bytes, previews and file history/diffs are never copied or fetched by submission.

Submission rules:

- Each repository has a stable PR branch, `chore/catalogue-<GitHub repository ID>`. Repeated submissions update its proposal; other datasets' PRs remain separate. There is no automatic merge. No diff means no new PR; a redundant existing proposal may close.
- New records remain drafts. Preserve existing catalogue identifiers, publication status, dates, confirmed lineage and portal-only fields. Source names, descriptions, keywords, licences, resource listings and supplied counts replace the corresponding portal values in the proposed PR. This can undo portal-only wording; make lasting corrections upstream. Do not infer totals or relationships.
- Flag access and restricted-resource changes for explicit review. Restricted listings carry their own access labels and never become download URLs. Unsafe or unsupported mappings fail the single submission rather than silently skip it.
- Valid public summaries may be added or updated without changing existing summary URLs. If no verified replacement exists, preserve an existing summary. The two-column label/count CSV contract remains unchanged; newer incompatible formats need separate work.
- Authentication, network, validation, identity or destination-safety failures stop before PR creation/update. A late write failure can leave changes only in the disposable checkout. Failed validation leaves the previous PR unchanged, so check the latest run before merging.
- Each proposal is regenerated from portal `main` for its dataset only. Do not edit submission branches manually. Concurrent proposals can conflict in `datasets.json`; after merging one, resubmit another from its same SHA to regenerate against current portal main.

To preview locally with your `gh` login or `GITHUB_TOKEN`, set `SOURCE_SHA` to the full pushed metadata SHA:

```bash
pnpm catalogue:submit budaya-lab/ds-example --commit "$SOURCE_SHA"
# Explicitly apply only in a disposable portal checkout:
pnpm catalogue:submit budaya-lab/ds-example --commit "$SOURCE_SHA" --apply
# Use a non-default pushed source branch when needed:
pnpm catalogue:submit budaya-lab/ds-example --commit "$SOURCE_SHA" --branch metadata/review
```

Preview writes `.tmp/catalogue-submission-report.md` only. Local apply prepares files but does not push a branch or open a PR. The older `catalogue:github --apply` remains interactive and append-only.

### Manually

Edit `datasets.json`; no new page file is needed. Use a unique `(namespace, slug)`, where `namespace` identifies the publisher. Add a title (`name`), description, subject keywords, and source landing-page link. Pages appear at `/@<namespace>/<slug>/`.

- For restricted sources, set `access: "restricted"`, use a credential-free HTTPS landing URL without a query or fragment, and omit `file`. Reviewed ordinary resources may be listed with their own `access: "restricted"`, repository-relative `path`, title, format and optional supplied `count`. These are metadata only: no previews, downloads, content/history reads or downloadable feed distributions. Use catalogue format `directory` for directory listings. Only validated public bucket summaries may expose bytes. Never add host/filesystem paths, private URLs, credentials or restricted data. Draft metadata remains public in Git.
- Set a stage only when known, using one keyword from [`stage.config.json`](stage.config.json). Keep its values aligned with the dataset template.
- Use `derivedFrom` only for confirmed catalogue parents. When manually adding these datasets, an explicit package source that matches another catalogue repository establishes that parent; preserve existing confirmed links. Do not infer lineage from similar names or stages. Automated GitHub onboarding does not add these links.

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

The path is relative to the portal's `public/data/`. New imports use publisher-scoped paths to prevent collisions. The existing `ds-layout-um-v2` example retains its original public CSV path. Existing records and files are skipped or flagged for review, never overwritten automatically. Advertised summaries that are malformed, unavailable, symlinked, or oversized fail that repository's import rather than disappear silently. Validation failures appear in the review report; GitHub API and response-safety errors still stop the run.

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
