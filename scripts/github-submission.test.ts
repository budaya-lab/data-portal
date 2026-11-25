import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { readSubmissionSource } from "./github-repositories";

const source = "a".repeat(40);
const branchHead = "b".repeat(40);
const release = "c".repeat(40);
const tree = "d".repeat(40);
const repository = {
  id: 42,
  name: "ds-example",
  full_name: "example/ds-example",
  owner: { login: "example" },
  html_url: "https://github.com/example/ds-example",
  description: null,
  private: true,
  default_branch: "main",
};
const descriptor = (title = "Pinned metadata") => ({
  name: "ds-example",
  title,
  description: "Submitted collection metadata.",
  keywords: ["task:catalogue", "project:example", "stage:curated"],
  resources: [
    {
      name: "input",
      title: "Manifest",
      path: "input.csv",
      format: "csv",
      count: 0,
    },
  ],
});
type Fixture = {
  private?: boolean;
  status?: number;
  missingDescriptor?: boolean;
  releases?: boolean;
  unreachable?: boolean;
  annotated?: boolean;
  invalid?: boolean;
  wrongRepository?: boolean;
  notOnMain?: boolean;
  newerRelease?: boolean;
  longHistory?: boolean;
  wrongRef?: boolean;
  descriptorSymlink?: boolean;
};
function api(context: TestContext, fixture: Fixture = {}) {
  const urls: URL[] = [];
  let walked = 0;
  context.mock.method(
    globalThis,
    "fetch",
    async (input: URL, init: RequestInit) => {
      const url = new URL(input);
      urls.push(url);
      assert.equal(url.origin, "https://api.github.com");
      assert.equal(
        (init.headers as Record<string, string>).authorization,
        "Bearer fixture-token",
      );
      assert.equal(init.redirect, "error");
      if (fixture.status) return new Response("", { status: fixture.status });
      const path = url.pathname;
      if (path === "/repos/example/ds-example")
        return Response.json({
          ...repository,
          private: fixture.private ?? true,
          ...(fixture.wrongRepository ? { name: "ds-other" } : {}),
        });
      if (path.includes("/git/ref/heads/"))
        return Response.json({
          ref: fixture.wrongRef
            ? "refs/heads/different"
            : `refs/heads/${decodeURIComponent(path.split("/heads/")[1])}`,
          object: {
            type: "commit",
            sha:
              fixture.notOnMain && path.endsWith("/heads/main")
                ? "e".repeat(40)
                : branchHead,
          },
        });
      if (fixture.longHistory && path.includes("/git/commits/"))
        return Response.json({
          sha: path.split("/").pop(),
          tree: { sha: tree },
          parents: [{ sha: (++walked).toString(16).padStart(40, "0") }],
        });
      if (path.endsWith(`/git/commits/${"e".repeat(40)}`))
        return Response.json({
          sha: "e".repeat(40),
          tree: { sha: tree },
          parents: [],
        });
      if (path.endsWith(`/git/commits/${branchHead}`))
        return Response.json({
          sha: branchHead,
          tree: { sha: tree },
          parents: fixture.unreachable ? [] : [{ sha: source }],
        });
      if (path.endsWith(`/git/commits/${source}`))
        return Response.json({
          sha: source,
          tree: { sha: tree },
          parents: [{ sha: release }],
        });
      if (path.endsWith(`/git/commits/${release}`))
        return Response.json({
          sha: release,
          tree: { sha: tree },
          parents: [],
        });
      if (path.endsWith("/contents/datapackage.json")) {
        assert.equal(
          url.searchParams.get("ref"),
          source,
          "Never read descriptor at a branch, tag or other commit",
        );
        if (fixture.missingDescriptor) return new Response("", { status: 404 });
        return Response.json({
          encoding: "base64",
          content: Buffer.from(
            JSON.stringify(
              descriptor(
                fixture.invalid
                  ? "https://private.example/secret.csv"
                  : undefined,
              ),
            ),
          ).toString("base64"),
        });
      }
      if (path.endsWith("/releases"))
        return Response.json(
          fixture.releases === false
            ? []
            : [
                ...(fixture.newerRelease
                  ? [{ tag_name: "v2.0.0", draft: false, prerelease: false }]
                  : []),
                { tag_name: "v1.0.0", draft: false, prerelease: false },
              ],
        );
      if (path.endsWith("/git/ref/tags/v2.0.0"))
        return Response.json({
          ref: "refs/tags/v2.0.0",
          object: { type: "commit", sha: "e".repeat(40) },
        });
      if (path.endsWith("/git/ref/tags/v1.0.0"))
        return Response.json({
          ref: "refs/tags/v1.0.0",
          object: { type: fixture.annotated ? "tag" : "commit", sha: release },
        });
      if (path.endsWith(`/git/tags/${release}`))
        return Response.json({ object: { type: "commit", sha: release } });
      if (path.includes("/git/trees/") && !url.searchParams.has("recursive"))
        return Response.json({
          truncated: false,
          tree: [
            {
              path: "datapackage.json",
              type: "blob",
              mode: fixture.descriptorSymlink ? "120000" : "100644",
            },
          ],
        });
      if (path.includes("/git/trees/"))
        return Response.json({
          truncated: false,
          tree: [
            { path: "buckets.csv", type: "blob", mode: "100644" },
            { path: "input.csv", type: "blob", mode: "100644" },
          ],
        });
      if (path.endsWith("/contents/buckets.csv")) {
        assert.equal(url.searchParams.get("ref"), release);
        return Response.json({
          encoding: "base64",
          content: Buffer.from("kind,count\nA,2\n").toString("base64"),
        });
      }
      throw new Error(`Unexpected API request: ${path}`);
    },
  );
  return urls;
}

test("submission reads private and public descriptors only at the verified pushed SHA, without file diffs", async (context) => {
  for (const restricted of [true, false]) {
    const urls = api(context, { private: restricted });
    const result = await readSubmissionSource(
      "example",
      "ds-example",
      source,
      "fixture-token",
    );
    assert.equal(result.repo.id, 42);
    assert.equal(result.commit, source);
    assert.equal(result.metadata.title, "Pinned metadata");
    assert.equal(result.metadata.resources[0].count, 0);
    assert.match(result.metadata.bucketFile?.ref ?? "", new RegExp(release));
    assert.ok(
      urls.every(
        (url) =>
          !url.pathname.includes("/compare/") &&
          !/\/repos\/[^/]+\/[^/]+\/commits\//.test(url.pathname),
      ),
    );
    assert.ok(
      urls.every(
        (url) =>
          !url.pathname.includes("/contents/") ||
          /\/contents\/(datapackage.json|buckets.csv)$/.test(url.pathname),
      ),
    );
  }
});

test("submission supports an explicit pushed branch and annotated releases", async (context) => {
  const urls = api(context, { annotated: true });
  await readSubmissionSource(
    "example",
    "ds-example",
    source,
    "fixture-token",
    "metadata/review",
  );
  assert.ok(
    urls.some((url) =>
      decodeURIComponent(url.pathname).endsWith(
        "/git/ref/heads/metadata/review",
      ),
    ),
  );
  assert.ok(
    urls.some((url) => url.pathname.endsWith("/git/ref/heads/main")),
    "Release must still be reachable from main",
  );
});

test("unknown or unreachable commits and invalid repository identities fail before descriptor reads", async (context) => {
  for (const fixture of [
    { unreachable: true },
    { wrongRepository: true },
    { status: 404 },
  ]) {
    const urls = api(context, fixture);
    await assert.rejects(
      readSubmissionSource("example", "ds-example", source, "fixture-token"),
    );
    assert.ok(!urls.some((url) => url.pathname.includes("/contents/")));
  }
});

test("a symlinked descriptor is rejected before Contents API can follow it into a data file", async (context) => {
  const urls = api(context, { descriptorSymlink: true });
  await assert.rejects(
    readSubmissionSource("example", "ds-example", source, "fixture-token"),
    /regular Git file/,
  );
  assert.ok(!urls.some((url) => url.pathname.includes("/contents/")));
});

test("missing, invalid or unreleased submitted metadata never falls back to moving refs", async (context) => {
  for (const fixture of [{ missingDescriptor: true }, { invalid: true }]) {
    const urls = api(context, fixture);
    await assert.rejects(
      readSubmissionSource("example", "ds-example", source, "fixture-token"),
    );
    assert.equal(
      urls.filter((url) => url.pathname.endsWith("/contents/datapackage.json"))
        .length,
      1,
    );
  }
  api(context, { releases: false });
  const result = await readSubmissionSource(
    "example",
    "ds-example",
    source,
    "fixture-token",
  );
  assert.equal(result.metadata.title, "Pinned metadata");
  assert.equal(result.metadata.bucketFile, undefined);
});

test("release summaries must be reachable from both submitted metadata and main", async (context) => {
  api(context, { notOnMain: true });
  const isolated = await readSubmissionSource(
    "example",
    "ds-example",
    source,
    "fixture-token",
    "metadata/review",
  );
  assert.equal(isolated.metadata.bucketFile, undefined);
  api(context, { newerRelease: true });
  const older = await readSubmissionSource(
    "example",
    "ds-example",
    source,
    "fixture-token",
  );
  assert.match(older.metadata.bucketFile?.ref ?? "", /v1.0.0/);
});

test("ancestry traversal is bounded and exact branch references are required", async (context) => {
  const urls = api(context, { longHistory: true });
  await assert.rejects(
    readSubmissionSource("example", "ds-example", source, "fixture-token"),
    /256-commit safety limit/,
  );
  assert.ok(
    urls.filter((url) => url.pathname.includes("/git/commits/")).length <= 256,
  );
  assert.ok(!urls.some((url) => url.pathname.includes("/contents/")));
  api(context, { wrongRef: true });
  await assert.rejects(
    readSubmissionSource("example", "ds-example", source, "fixture-token"),
    /exact pushed branch/,
  );
});

test("malformed repository, SHA and branch inputs fail without network access", async (context) => {
  const urls = api(context);
  for (const [account, name, commit, branch] of [
    ["../outside", "ds-example", source, undefined],
    ["example", "other", source, undefined],
    ["example", "ds-example", "main", undefined],
    ["example", "ds-example", source.slice(0, 7), undefined],
    ["example", "ds-example", source, "../main"],
    ["example", "ds-example", source, "x\nmain"],
  ])
    await assert.rejects(
      readSubmissionSource(
        account as string,
        name as string,
        commit as string,
        "fixture-token",
        branch,
      ),
    );
  assert.equal(urls.length, 0);
});
