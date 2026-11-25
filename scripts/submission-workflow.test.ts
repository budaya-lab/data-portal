import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = () =>
  readFileSync(".github/workflows/submit-dataset.yml", "utf8");

test("PR pathspec includes legacy root CSVs as well as publisher-scoped summaries", () => {
  const yaml = workflow();
  const pattern = yaml.match(
    /^\s+(:\(glob\)public\/data\/\*\*\/\*.csv)$/m,
  )?.[1];
  assert.ok(pattern);
  const files = (pathspec: string) =>
    execFileSync("git", ["ls-files", "--", pathspec], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((file) => file.endsWith(".csv"));
  const expected = files("public/data");
  assert.ok(expected.length > 0);
  assert.deepEqual(files(pattern), expected);
});

test("dataset submission is manual-only on portal main with explicit source inputs", () => {
  const yaml = workflow();
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /repository:\n\s+description:/);
  assert.match(yaml, /commit:\n\s+description:/);
  assert.match(yaml, /branch:\n\s+description:/);
  assert.doesNotMatch(
    yaml,
    /schedule:|cron:|pull_request_target:|pull_request:|workflow_run:/,
  );
  assert.match(yaml, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(yaml, /permissions:\n {2}contents: read/);
  assert.match(
    yaml,
    /concurrency:\n {2}group: catalogue-submission-\$\{\{ inputs.repository \}\}\n {2}cancel-in-progress: false/,
  );
  assert.match(yaml, /timeout-minutes: 30/);
  assert.match(yaml, /ref: main\n\s+persist-credentials: false/);
});

test("catalogue workflow separates read and PR credentials, validates, and commits only catalogue data", () => {
  const yaml = workflow();
  assert.match(yaml, /GITHUB_TOKEN: \$\{\{ secrets.DATASET_READ_TOKEN \}\}/);
  assert.match(yaml, /token: \$\{\{ secrets.CATALOGUE_PR_TOKEN \}\}/);
  assert.doesNotMatch(
    yaml,
    /token: \$\{\{ (?:github.token|secrets.GITHUB_TOKEN) \}\}/,
  );
  assert.match(yaml, /node-version: "24"/);
  assert.match(yaml, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.match(yaml, /SOURCE_REPOSITORY: \$\{\{ inputs.repository \}\}/);
  assert.match(yaml, /SOURCE_COMMIT: \$\{\{ inputs.commit \}\}/);
  assert.match(yaml, /SOURCE_BRANCH: \$\{\{ inputs.branch \}\}/);
  assert.match(yaml, /DATASET_ACCOUNT: \$\{\{ github.repository_owner \}\}/);
  assert.match(
    yaml,
    /args=\("\$DATASET_ACCOUNT\/\$SOURCE_REPOSITORY" --commit "\$SOURCE_COMMIT" --apply\)/,
  );
  assert.match(yaml, /pnpm catalogue:submit "\$\{args\[@\]\}"/);
  assert.doesNotMatch(yaml, /run:.*\$\{\{ inputs\./);
  assert.match(yaml, /run: pnpm validate/);
  assert.ok(
    yaml.indexOf("run: pnpm validate") <
      yaml.indexOf("uses: peter-evans/create-pull-request@"),
  );
  assert.match(yaml, /peter-evans\/create-pull-request@[a-f0-9]{40}/);
  assert.match(yaml, /branch: \$\{\{ steps.prepare.outputs.pr_branch \}\}/);
  assert.match(yaml, /base: main/);
  assert.match(
    yaml,
    /add-paths: \|\n\s+datasets.json\n\s+:\(glob\)public\/data\/\*\*\/\*.csv/,
  );
  assert.match(yaml, /body-path: .tmp\/catalogue-submission-report.md/);
  assert.doesNotMatch(yaml, /gh pr merge|auto-merge|git push|git add \./);
});
