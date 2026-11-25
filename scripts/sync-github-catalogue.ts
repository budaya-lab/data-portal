import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planCatalogueSync, type SyncPlan } from "./catalogue-sync";
import {
  buildCandidate,
  canonicalLandingUrl,
  discoverCandidates,
  listRepositories,
  matchesRepositoryName,
  type Options,
  parseArguments,
  resolveGitHubToken,
} from "./github-repositories";
import { writeCatalogueSync } from "./write-catalogue-sync";

export function syncReport(plan: SyncPlan): string {
  const lines = [
    "## Dataset catalogue sync",
    "",
    "Source metadata and public bucket summaries only. No ordinary restricted data files were read or copied.",
    "New records remain drafts; existing publication status, catalogue identities and confirmed lineage are preserved.",
    "Review source-authoritative descriptions, keywords, licences and resource counts before merging. Access and restricted-resource changes require explicit review.",
    "",
  ];
  for (const change of plan.changes) {
    lines.push(
      `### ${change.repository} (${change.kind})`,
      "",
      `Fields: ${change.fields.join(", ")}`,
      "",
    );
    for (const warning of change.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }
  if (!plan.changes.length)
    lines.push("No catalogue or public summary changes.", "");
  if (plan.failures.length) {
    lines.push("### Skipped repositories", "");
    for (const failure of plan.failures)
      lines.push(`- ${failure.repository}: ${failure.reason}`);
    lines.push("");
  }
  lines.push(
    "This PR is regenerated from main on each run. Make lasting corrections in the source repositories; do not edit the automation branch.",
    "",
  );
  return lines.join("\n");
}

export async function syncGitHubCatalogue(
  options: Options,
  token: string,
  root = process.cwd(),
): Promise<SyncPlan> {
  const current = await readFile(resolve(root, "datasets.json"), "utf8");
  const repositories = (await listRepositories(options.account, token))
    .filter((repo) => matchesRepositoryName(repo.name, options.pattern))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const bySource = new Map(
    repositories.map((repo) => [
      canonicalLandingUrl(
        buildCandidate(repo, options.namespace, {}).sources[0].path,
      ),
      repo,
    ]),
  );
  const { candidates, extracted, failures } = await discoverCandidates(
    options.account,
    options.namespace,
    repositories,
    token,
  );
  const inputs = candidates.map((candidate, index) => {
    const repo = bySource.get(canonicalLandingUrl(candidate.sources[0].path));
    if (!repo) throw new Error("Discovery returned an unknown source.");
    return { repo, metadata: extracted[index] };
  });
  const plan = planCatalogueSync(current, inputs, options.namespace);
  plan.failures.unshift(...failures);
  const result = await writeCatalogueSync(root, current, plan, options.apply);
  const directory = resolve(root, ".tmp");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "catalogue-sync-report.md"),
    syncReport(result),
    "utf8",
  );
  console.log(
    `${options.apply ? "Applied" : "Dry run"}: ${result.changes.length} changed dataset(s), ${result.failures.length} skipped repository/repositories. See .tmp/catalogue-sync-report.md.`,
  );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const run = async () => {
    const options = parseArguments(process.argv.slice(2));
    const token = resolveGitHubToken(process.env.GITHUB_TOKEN, () =>
      execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    await syncGitHubCatalogue(options, token);
  };
  run().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Catalogue sync failed.",
    );
    process.exitCode = 1;
  });
}
