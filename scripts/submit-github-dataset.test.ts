import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import {
  parseSubmissionArguments,
  submitGitHubDataset,
} from "./submit-github-dataset";

const commit = "a".repeat(40);
const release = "b".repeat(40);
const tree = "c".repeat(40);
const options = {
  account: "example",
  name: "ds-example",
  commit,
  apply: false,
};
const repo = {
  id: 42,
  name: "ds-example",
  full_name: "example/ds-example",
  owner: { login: "example" },
  private: true,
  default_branch: "main",
};
function api(context: TestContext, status = 200, invalid = false, id = 42) {
  const paths: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: URL) => {
    const url = new URL(input);
    paths.push(url.pathname);
    if (status !== 200) return new Response("", { status });
    if (url.pathname === "/repos/example/ds-example")
      return Response.json({ ...repo, id });
    if (url.pathname.endsWith("/git/ref/heads/main"))
      return Response.json({
        ref: "refs/heads/main",
        object: { type: "commit", sha: commit },
      });
    if (url.pathname.endsWith(`/git/commits/${commit}`))
      return Response.json({
        sha: commit,
        tree: { sha: tree },
        parents: [{ sha: release }],
      });
    if (url.pathname.endsWith(`/git/commits/${release}`))
      return Response.json({ sha: release, tree: { sha: tree }, parents: [] });
    if (url.pathname.endsWith("/contents/datapackage.json")) {
      assert.equal(url.searchParams.get("ref"), commit);
      return Response.json({
        encoding: "base64",
        content: Buffer.from(
          JSON.stringify({
            name: "ds-example",
            title: "Updated name",
            description: invalid
              ? "https://private.example/secret.csv"
              : "Source description.",
            keywords: ["project:example", "task:catalogue", "stage:annotated"],
            resources: [
              {
                name: "records",
                title: "Manifest",
                path: "input.csv",
                format: "csv",
                count: 0,
              },
            ],
          }),
        ).toString("base64"),
      });
    }
    if (url.pathname.endsWith("/releases"))
      return Response.json([
        { tag_name: "v1.0.0", draft: false, prerelease: false },
      ]);
    if (url.pathname.endsWith("/git/ref/tags/v1.0.0"))
      return Response.json({
        ref: "refs/tags/v1.0.0",
        object: { type: "commit", sha: release },
      });
    if (
      url.pathname.includes("/git/trees/") &&
      !url.searchParams.has("recursive")
    )
      return Response.json({
        truncated: false,
        tree: [{ path: "datapackage.json", type: "blob", mode: "100644" }],
      });
    if (url.pathname.includes("/git/trees/"))
      return Response.json({
        truncated: false,
        tree: [{ path: "buckets.csv", type: "blob", mode: "100644" }],
      });
    if (url.pathname.endsWith("/contents/buckets.csv")) {
      assert.equal(url.searchParams.get("ref"), release);
      return Response.json({
        encoding: "base64",
        content: Buffer.from("kind,count\nA,2\n").toString("base64"),
      });
    }
    throw new Error(`Unexpected API request: ${url.pathname}`);
  });
  return paths;
}
async function fixture(check: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "catalogue-submission-"));
  try {
    await writeFile(join(root, "datasets.json"), "[]\n");
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("submission CLI requires one repository and full commit SHA; supports a pushed branch and explicit apply", () => {
  assert.deepEqual(
    parseSubmissionArguments(["example/ds-example", "--commit", commit]),
    options,
  );
  assert.deepEqual(
    parseSubmissionArguments([
      "example/ds-example",
      "--commit",
      commit,
      "--branch",
      "metadata/review",
      "--apply",
    ]),
    { ...options, branch: "metadata/review", apply: true },
  );
  for (const args of [
    [],
    ["example"],
    ["example/ds-example"],
    ["example/other", "--commit", commit],
    ["example/ds-example", "--commit", "main"],
    ["example/ds-example", "--commit", commit, "--all"],
    ["example/ds-example", "--commit", commit, "--apply", "--apply"],
    ["example/ds-example", "--commit", commit, "--commit", commit],
    ["example/ds-example", "--commit", commit, "--branch", "../main"],
  ])
    assert.throws(() => parseSubmissionArguments(args));
});

test("single-dataset submission previews, applies and repeats without scanning the organisation", async (context) => {
  const paths = api(context);
  await fixture(async (root) => {
    const preview = await submitGitHubDataset(options, "fixture-token", root);
    assert.equal(preview.changes.length, 1);
    assert.equal(preview.prBranch, "chore/catalogue-42");
    assert.deepEqual((await readdir(root)).sort(), [".tmp", "datasets.json"]);
    assert.equal(await readFile(join(root, "datasets.json"), "utf8"), "[]\n");
    const report = await readFile(
      join(root, ".tmp/catalogue-submission-report.md"),
      "utf8",
    );
    assert.ok(report.includes(commit));
    assert.ok(report.includes(release));
    assert.match(report, /explicit review/);
    const applied = await submitGitHubDataset(
      { ...options, apply: true },
      "fixture-token",
      root,
    );
    const record = JSON.parse(applied.manifest)[0];
    assert.equal(record.draft, true);
    assert.equal(record.resources[1].count, 0);
    assert.equal(record.resources[1].access, "restricted");
    assert.equal(
      await readFile(
        join(root, "public/data/buckets/example/ds-example.csv"),
        "utf8",
      ),
      "kind,count\nA,2\n",
    );
    assert.equal(
      (
        await submitGitHubDataset(
          { ...options, apply: true },
          "fixture-token",
          root,
        )
      ).changes.length,
      0,
    );
    assert.ok(
      paths.every((path) => path.startsWith("/repos/example/ds-example")),
    );
    assert.ok(
      paths.every(
        (path) =>
          !path.includes("/contents/") ||
          /\/contents\/(datapackage.json|buckets.csv)$/.test(path),
      ),
    );
  });
});

test("repository IDs give each dataset a stable, separate PR branch", async (context) => {
  await fixture(async (root) => {
    api(context, 200, false, 42);
    const first = await submitGitHubDataset(options, "fixture-token", root);
    api(context, 200, false, 84);
    const other = await submitGitHubDataset(options, "fixture-token", root);
    assert.notEqual(first.prBranch, other.prBranch);
  });
});

test("invalid single submissions fail safely instead of skipping and updating an existing PR", async (context) => {
  api(context, 200, true);
  await fixture(async (root) => {
    await assert.rejects(
      submitGitHubDataset({ ...options, apply: true }, "fixture-token", root),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(
          error.message,
          /private\.example|secret.csv|fixture-token/,
        );
        return true;
      },
    );
    assert.deepEqual(await readdir(root), ["datasets.json"]);
  });
});

test("GitHub authentication, rate-limit, server and network failures make no writes", async (context) => {
  for (const status of [401, 403, 429, 500]) {
    api(context, status);
    await fixture(async (root) => {
      await assert.rejects(
        submitGitHubDataset({ ...options, apply: true }, "fixture-token", root),
      );
      assert.deepEqual(await readdir(root), ["datasets.json"]);
    });
  }
  context.mock.method(globalThis, "fetch", async () => {
    throw new Error("Network failed");
  });
  await fixture(async (root) => {
    await assert.rejects(
      submitGitHubDataset({ ...options, apply: true }, "fixture-token", root),
      /Network failed/,
    );
    assert.deepEqual(await readdir(root), ["datasets.json"]);
  });
});
