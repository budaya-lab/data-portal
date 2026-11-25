import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { planCatalogueSync, type SyncPlan } from "./catalogue-sync";
import {
  readSubmissionSource,
  resolveGitHubToken,
  validateSubmissionSource,
} from "./github-repositories";
import { writeCatalogueSync } from "./write-catalogue-sync";

export type SubmissionOptions = {
  account: string;
  name: string;
  commit: string;
  branch?: string;
  apply: boolean;
};
export type SubmissionResult = SyncPlan & { prBranch: string };

export function parseSubmissionArguments(args: string[]): SubmissionOptions {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") {
      if (apply) throw new Error("Duplicate --apply flag.");
      apply = true;
    } else if (arg.startsWith("--")) {
      if (!["--commit", "--branch"].includes(arg) || flags.has(arg))
        throw new Error("Unknown or duplicate submission option.");
      const value = args[++index];
      if (!value || value.startsWith("--"))
        throw new Error("Submission option requires a value.");
      flags.set(arg, value);
    } else positional.push(arg);
  }
  const parts = positional[0]?.split("/") ?? [];
  const commit = flags.get("--commit");
  if (positional.length !== 1 || parts.length !== 2 || !commit)
    throw new Error("Provide ACCOUNT/REPOSITORY and --commit FULL_SHA.");
  const [account, name] = parts;
  const branch = flags.get("--branch");
  validateSubmissionSource(account, name, commit, branch);
  return {
    account,
    name,
    commit,
    ...(branch === undefined ? {} : { branch }),
    apply,
  };
}

function submissionReport(
  plan: SyncPlan,
  source: Awaited<ReturnType<typeof readSubmissionSource>>,
): string {
  const lines = [
    "## Dataset catalogue submission",
    "",
    `Source repository: ${source.repo.full_name}`,
    `Metadata commit: \`${source.commit}\``,
    `Public summary source: ${source.metadata.bucketFile ? `\`${source.metadata.bucketFile.ref}\`` : "no verified replacement; preserve any existing summary"}`,
    "",
    "Source metadata and public summaries only. No ordinary restricted data files or file diffs were read or copied.",
    "New records remain drafts; existing publication status, identity, dates and confirmed lineage are preserved.",
    "Access and restricted-resource changes require explicit review. This PR is regenerated from portal main for this dataset only; do not edit the submission branch.",
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
  for (const warning of source.metadata.review ?? [])
    lines.push(`- ${warning}`);
  return `${lines.join("\n")}\n`;
}

export async function submitGitHubDataset(
  options: SubmissionOptions,
  token: string,
  root = process.cwd(),
): Promise<SubmissionResult> {
  const current = await readFile(resolve(root, "datasets.json"), "utf8");
  const source = await readSubmissionSource(
    options.account,
    options.name,
    options.commit,
    token,
    options.branch,
  );
  const plan = planCatalogueSync(
    current,
    [{ repo: source.repo, metadata: source.metadata }],
    options.account.toLowerCase(),
  );
  if (plan.failures.length) throw new Error(plan.failures[0].reason);
  const result = await writeCatalogueSync(root, current, plan, options.apply);
  await mkdir(resolve(root, ".tmp"), { recursive: true });
  await writeFile(
    resolve(root, ".tmp/catalogue-submission-report.md"),
    submissionReport(result, source),
    "utf8",
  );
  console.log(
    `${options.apply ? "Applied" : "Dry run"}: ${result.changes.length} dataset change(s) from ${source.commit}. See .tmp/catalogue-submission-report.md.`,
  );
  return { ...result, prBranch: `chore/catalogue-${source.repo.id}` };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const run = async () => {
    const options = parseSubmissionArguments(process.argv.slice(2));
    const token = resolveGitHubToken(process.env.GITHUB_TOKEN, () =>
      execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    const result = await submitGitHubDataset(options, token);
    if (process.env.GITHUB_OUTPUT)
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `pr_branch=${result.prBranch}\n`,
        "utf8",
      );
  };
  run().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Catalogue submission failed.",
    );
    process.exitCode = 1;
  });
}
