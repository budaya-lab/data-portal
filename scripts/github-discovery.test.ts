import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyCandidates,
  discoverCandidates,
  type Repository,
} from "./github-repositories";

type Fixture = {
  descriptor?: string | Buffer;
  bucket?: string;
  status?: number;
  networkError?: Error;
};
const descriptor = (name: string) =>
  JSON.stringify({
    name,
    title: name,
    keywords: ["stage:curated"],
    resources: [{ name: "data", path: "internal/private.csv", format: "csv" }],
  });

async function withRepositories(
  fixtures: Record<string, Fixture>,
  check: (repositories: Repository[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const repositories = Object.keys(fixtures).map((name) => ({
    name,
    full_name: `example/${name}`,
    owner: { login: "example" },
    html_url: `https://github.com/example/${name}`,
    description: null,
    private: true,
    default_branch: "main",
  }));
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const name = url.pathname.split("/")[3];
    const fixture = fixtures[name];
    assert.ok(fixture, "Unexpected repository request");
    if (fixture.networkError) throw fixture.networkError;
    if (fixture.status) return new Response("", { status: fixture.status });
    if (url.pathname.endsWith("/contents/datapackage.json")) {
      if (fixture.descriptor === "missing")
        return new Response("", { status: 404 });
      return Response.json({
        encoding: "base64",
        content: Buffer.from(fixture.descriptor ?? descriptor(name)).toString(
          "base64",
        ),
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
        tree: [{ path: "buckets.csv", type: "blob", mode: "100644" }],
      });
    if (url.pathname.endsWith("/contents/buckets.csv"))
      return Response.json({
        encoding: "base64",
        content: Buffer.from(
          fixture.bucket ?? `kind,count\n${name},1\n`,
        ).toString("base64"),
      });
    throw new Error("Unexpected API request");
  };
  try {
    await check(repositories);
  } finally {
    globalThis.fetch = original;
  }
}

test("discovery reports invalid repositories and retains aligned valid candidates for confirmed apply", async () => {
  const root = mkdtempSync(join(tmpdir(), "portal-discovery-"));
  writeFileSync(join(root, "datasets.json"), "[]\n");
  try {
    await withRepositories(
      {
        "ds-first": {},
        "ds-description": {
          descriptor: JSON.stringify({
            ...JSON.parse(descriptor("ds-description")),
            description: "https://private.example/internal/secret.csv",
          }),
        },
        "ds-json": { descriptor: "{invalid" },
        "ds-missing": { descriptor: "missing" },
        "ds-buckets": { bucket: "kind,count\nprivate-label,-1\n" },
        "ds-last": {},
      },
      async (repositories) => {
        const progress: number[] = [];
        const { candidates, extracted, failures } = await discoverCandidates(
          "example",
          "example",
          repositories,
          "test-token",
          (done) => progress.push(done),
        );
        assert.deepEqual(
          candidates.map((item) => item.slug),
          ["ds-first", "ds-last"],
        );
        assert.deepEqual(
          extracted.map((item) => item.title),
          ["ds-first", "ds-last"],
        );
        assert.deepEqual(
          failures.map((item) => item.repository),
          [
            "example/ds-description",
            "example/ds-json",
            "example/ds-missing",
            "example/ds-buckets",
          ],
        );
        assert.match(failures[0].reason, /description/);
        assert.match(failures[3].reason, /buckets\.csv/);
        assert.doesNotMatch(
          JSON.stringify(failures),
          /private\.example|internal\/secret|private-label|test-token|private\.csv/,
        );
        assert.deepEqual(progress, [0, 1, 2, 3, 4, 5, 6]);
        assert.deepEqual(readdirSync(root), ["datasets.json"]);
        assert.equal(
          await applyCandidates(candidates, extracted, { root, apply: false }),
          0,
        );
        assert.equal(readFileSync(join(root, "datasets.json"), "utf8"), "[]\n");
        assert.equal(
          await applyCandidates(candidates, extracted, {
            root,
            apply: true,
            confirm: async () => true,
          }),
          2,
        );
        const records = JSON.parse(
          readFileSync(join(root, "datasets.json"), "utf8"),
        );
        assert.deepEqual(
          records.map((item: { slug: string }) => item.slug),
          ["ds-first", "ds-last"],
        );
        for (const slug of ["ds-first", "ds-last"]) {
          assert.equal(
            readFileSync(
              join(root, `public/data/buckets/example/${slug}.csv`),
              "utf8",
            ),
            `kind,count\n${slug},1\n`,
          );
        }
        assert.ok(
          records.every(
            (item: { draft: boolean; access: string }) =>
              item.draft && item.access === "restricted",
          ),
        );
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("discovery returns failures and no importable candidates when every repository is invalid", async () => {
  await withRepositories(
    { "ds-invalid": { descriptor: "{invalid" } },
    async (repositories) => {
      const result = await discoverCandidates(
        "example",
        "example",
        repositories,
        "test-token",
      );
      assert.equal(result.candidates.length, 0);
      assert.equal(result.extracted.length, 0);
      assert.equal(result.failures.length, 1);
      let prompts = 0;
      assert.equal(
        await applyCandidates(result.candidates, result.extracted, {
          apply: true,
          confirm: async () => {
            prompts++;
            return true;
          },
        }),
        0,
      );
      assert.equal(prompts, 0);
    },
  );
});

test("discovery isolates invalid public release metadata too", async () => {
  await withRepositories(
    { "ds-invalid": { descriptor: "{invalid" }, "ds-valid": {} },
    async (repositories) => {
      for (const repository of repositories) repository.private = false;
      const result = await discoverCandidates(
        "example",
        "example",
        repositories,
        "test-token",
      );
      assert.deepEqual(
        result.candidates.map((item) => item.slug),
        ["ds-valid"],
      );
      assert.equal(result.candidates[0].access, "public");
      assert.equal(result.failures[0].repository, "example/ds-invalid");
    },
  );
});

test("discovery reports invalid descriptor UTF-8 without dropping the next repository", async () => {
  await withRepositories(
    { "ds-invalid": { descriptor: Buffer.from([0xc3, 0x28]) }, "ds-valid": {} },
    async (repositories) => {
      const result = await discoverCandidates(
        "example",
        "example",
        repositories,
        "test-token",
      );
      assert.deepEqual(
        result.candidates.map((item) => item.slug),
        ["ds-valid"],
      );
      assert.match(result.failures[0].reason, /valid UTF-8/);
    },
  );
});

for (const status of [401, 403, 429, 500]) {
  test(`discovery does not downgrade GitHub HTTP ${status} errors to validation failures`, async () => {
    await withRepositories(
      { "ds-unavailable": { status }, "ds-next": {} },
      async (repositories) => {
        await assert.rejects(
          discoverCandidates("example", "example", repositories, "test-token"),
          new RegExp(String(status)),
        );
      },
    );
  });
}

test("discovery propagates network failures", async () => {
  const error = new Error("Network unavailable");
  await withRepositories(
    { "ds-unavailable": { networkError: error } },
    async (repositories) => {
      await assert.rejects(
        discoverCandidates("example", "example", repositories, "test-token"),
        error,
      );
    },
  );
});
