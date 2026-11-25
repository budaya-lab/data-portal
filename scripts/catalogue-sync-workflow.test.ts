import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = () =>
  readFileSync(".github/workflows/sync-catalogue.yml", "utf8");

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

test("catalogue automation runs only on schedule/manual main with minimal default permissions", () => {
  const yaml = workflow();
  assert.match(yaml, /schedule:\n\s+- cron: "23 3 \* \* \*"/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.doesNotMatch(yaml, /pull_request_target:|pull_request:|workflow_run:/);
  assert.match(yaml, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(yaml, /permissions:\n {2}contents: read/);
  assert.match(
    yaml,
    /concurrency:\n {2}group: catalogue-sync\n {2}cancel-in-progress: false/,
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
  assert.match(yaml, /pnpm catalogue:sync "\$DATASET_OWNER" --apply/);
  assert.match(yaml, /run: pnpm validate/);
  assert.ok(
    yaml.indexOf("run: pnpm validate") <
      yaml.indexOf("uses: peter-evans/create-pull-request@"),
  );
  assert.match(yaml, /peter-evans\/create-pull-request@[a-f0-9]{40}/);
  assert.match(yaml, /branch: chore\/catalogue-sync/);
  assert.match(yaml, /base: main/);
  assert.match(
    yaml,
    /add-paths: \|\n\s+datasets.json\n\s+:\(glob\)public\/data\/\*\*\/\*.csv/,
  );
  assert.match(yaml, /body-path: .tmp\/catalogue-sync-report.md/);
  assert.doesNotMatch(yaml, /gh pr merge|auto-merge|git push|git add \./);
});
