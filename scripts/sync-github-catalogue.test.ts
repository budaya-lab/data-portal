import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { syncGitHubCatalogue } from "./sync-github-catalogue";

const repositories = ["ds-example", "ds-invalid"].map((name) => ({
  name,
  full_name: `example/${name}`,
  owner: { login: "example" },
  html_url: `https://github.com/example/${name}`,
  description: null,
  private: true,
  default_branch: "main",
}));
const options = {
  account: "example",
  namespace: "example",
  pattern: "^ds[-_].*",
  apply: false,
};
function api(context: TestContext, status = 200) {
  const paths: string[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: URL, init: RequestInit) => {
      assert.equal(
        (init.headers as Record<string, string>).authorization,
        "Bearer fixture-token",
      );
      assert.equal(init.redirect, "error");
      const url = new URL(input);
      paths.push(url.pathname);
      if (url.pathname === "/users/example")
        return Response.json({ type: "Organization" });
      if (url.pathname === "/orgs/example/repos")
        return Response.json(repositories);
      if (status !== 200) return new Response("", { status });
      if (url.pathname.endsWith("/contents/datapackage.json")) {
        const name = url.pathname.split("/")[3];
        return Response.json({
          encoding: "base64",
          content: Buffer.from(
            JSON.stringify({
              name,
              title: "Updated name",
              description:
                name === "ds-invalid"
                  ? "https://private.example/secret.csv"
                  : "Source description.",
              keywords: [
                "project:example",
                "task:catalogue",
                "stage:annotated",
              ],
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
      if (url.pathname.endsWith("/commits/v1.0.0"))
        return Response.json({
          sha: "a".repeat(40),
          commit: { tree: { sha: "b".repeat(40) } },
        });
      if (url.pathname.includes("/compare/"))
        return Response.json({ status: "ahead" });
      if (url.pathname.includes("/git/trees/"))
        return Response.json({
          truncated: false,
          tree: [
            { path: "buckets.csv", type: "blob", mode: "100644" },
            { path: "input.csv", type: "blob", mode: "100644" },
          ],
        });
      if (url.pathname.endsWith("/contents/buckets.csv")) {
        assert.equal(url.searchParams.get("ref"), "a".repeat(40));
        return Response.json({
          encoding: "base64",
          content: Buffer.from("kind,count\nA,2\n").toString("base64"),
        });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    },
  );
  return paths;
}

test("end-to-end sync previews without public writes, applies metadata and buckets, then makes no repeated changes", async (context) => {
  const paths = api(context);
  const root = await mkdtemp(join(tmpdir(), "catalogue-sync-cli-"));
  try {
    await writeFile(join(root, "datasets.json"), "[]\n");
    const preview = await syncGitHubCatalogue(options, "fixture-token", root);
    assert.equal(preview.changes.length, 1);
    assert.equal(preview.failures.length, 1);
    assert.deepEqual((await readdir(root)).sort(), [".tmp", "datasets.json"]);
    assert.equal(await readFile(join(root, "datasets.json"), "utf8"), "[]\n");
    const applied = await syncGitHubCatalogue(
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
        await syncGitHubCatalogue(
          { ...options, apply: true },
          "fixture-token",
          root,
        )
      ).changes.length,
      0,
    );
    const report = await readFile(
      join(root, ".tmp/catalogue-sync-report.md"),
      "utf8",
    );
    assert.match(report, /Skipped repositories/);
    assert.match(report, /Penjaga|public-safe/);
    assert.doesNotMatch(report, /private\.example|secret\.csv|fixture-token/);
    assert.ok(
      paths.every(
        (path) =>
          !path.includes("/contents/") ||
          /\/contents\/(datapackage.json|buckets.csv)$/.test(path),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GitHub auth, rate-limit and server failures stop before any report or public write", async (context) => {
  for (const status of [401, 403, 429, 500]) {
    api(context, status);
    const root = await mkdtemp(join(tmpdir(), "catalogue-sync-api-failure-"));
    try {
      await writeFile(join(root, "datasets.json"), "[]\n");
      await assert.rejects(
        syncGitHubCatalogue({ ...options, apply: true }, "fixture-token", root),
        /Could not read/,
      );
      assert.deepEqual(await readdir(root), ["datasets.json"]);
      assert.equal(await readFile(join(root, "datasets.json"), "utf8"), "[]\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
