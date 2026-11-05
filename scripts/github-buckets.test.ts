import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCandidate,
  type Repository,
  readRepositoryMetadata,
} from "./github-repositories";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const repo: Repository = {
  name: "ds-example",
  full_name: "example/ds-example",
  owner: { login: "example" },
  html_url: "https://github.com/example/ds-example",
  description: null,
  private: true,
  default_branch: "main",
};

type Fixture = {
  private?: boolean;
  content?: string | Buffer;
  mode?: string;
  missing?: boolean;
  noRelease?: boolean;
  status?: number;
  conflicting?: boolean;
  alias?: boolean;
  encoding?: string;
  truncated?: boolean;
  moved?: boolean;
  base64?: string;
};
async function withGitHub(
  options: Fixture,
  check: (requests: string[], source: Repository) => Promise<void>,
) {
  const original = globalThis.fetch;
  const requests: string[] = [];
  const source = { ...repo, private: options.private ?? true };
  const descriptor = {
    name: "example",
    title: "Public-safe title",
    keywords: ["stage:curated"],
    resources: [
      {
        name: "records",
        path: source.private ? "internal/private.csv" : "tables/data.csv",
        format: "csv",
      },
      {
        name: options.alias ? "summary" : "buckets",
        path: options.conflicting ? "other.csv" : "buckets.csv",
        format: "csv",
      },
    ],
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-token",
    );
    assert.equal(init?.redirect, "error");
    if (url.includes("/releases?"))
      return Response.json(
        options.noRelease
          ? []
          : [{ tag_name: "v1.0.0", draft: false, prerelease: false }],
      );
    if (url.includes("/compare/v1.0.0...main"))
      return Response.json({ status: "ahead" });
    if (url.includes(`/compare/${commit}...main`))
      return Response.json({ status: options.moved ? "behind" : "ahead" });
    if (url.endsWith("/commits/v1.0.0"))
      return Response.json({ sha: commit, commit: { tree: { sha: tree } } });
    if (
      url.includes(
        `/contents/datapackage.json?ref=${source.private ? "main" : commit}`,
      )
    ) {
      return Response.json({
        content: Buffer.from(JSON.stringify(descriptor)).toString("base64"),
        encoding: "base64",
      });
    }
    if (url.includes(`/git/trees/${tree}?`))
      return Response.json({
        truncated: options.truncated ?? false,
        tree: [
          {
            path: source.private ? "internal/private.csv" : "tables/data.csv",
            type: "blob",
            mode: "100644",
          },
          ...(options.missing
            ? []
            : [
                {
                  path: "buckets.csv",
                  type: "blob",
                  mode: options.mode ?? "100644",
                },
              ]),
        ],
      });
    if (url.includes(`/contents/buckets.csv?ref=${commit}`)) {
      if (options.status) return new Response("", { status: options.status });
      return Response.json({
        content:
          options.base64 ??
          Buffer.from(options.content ?? "kind,count\n001,0\nA,2\n").toString(
            "base64",
          ),
        encoding: options.encoding ?? "base64",
      });
    }
    throw new Error(`Unexpected API request: ${url}`);
  };
  try {
    await check(requests, source);
  } finally {
    globalThis.fetch = original;
  }
}

test("release eligibility is checked against the resolved commit, not a moving tag", async () => {
  await withGitHub({ moved: true }, async (requests, source) => {
    const metadata = await readRepositoryMetadata(
      "example",
      source,
      "test-token",
    );
    assert.equal(metadata.bucketFile, undefined);
    assert.ok(
      requests.some((url) => url.includes(`/compare/${commit}...main`)),
    );
    assert.ok(requests.every((url) => !url.includes("/contents/buckets.csv")));
  });
});

test("large base64 summaries within the API limit decode without a regexp stack overflow", async () => {
  await withGitHub(
    { content: `kind,count\n${"a".repeat(700_000)},1` },
    async (_requests, source) => {
      assert.ok(
        (await readRepositoryMetadata("example", source, "test-token"))
          .bucketFile,
      );
    },
  );
});

for (const restricted of [true, false]) {
  test(`imports a public bucket resource from a ${restricted ? "restricted" : "public"} release`, async () => {
    await withGitHub({ private: restricted }, async (requests, source) => {
      const metadata = await readRepositoryMetadata(
        "example",
        source,
        "test-token",
      );
      assert.ok(metadata.bucketFile);
      assert.equal(
        Buffer.from(metadata.bucketFile.bytes).toString(),
        "kind,count\n001,0\nA,2\n",
      );
      const candidate = buildCandidate(source, "example", metadata);
      assert.equal(candidate.access, restricted ? "restricted" : "public");
      assert.equal(candidate.draft, true);
      assert.equal(
        candidate.resources?.filter((resource) => resource.name === "buckets")
          .length,
        1,
      );
      assert.deepEqual(
        candidate.resources?.find((resource) => resource.name === "buckets"),
        {
          name: "buckets",
          path: "buckets/example/ds-example.csv",
          format: "csv",
          title: "Public bucket summary",
        },
      );
      assert.equal(candidate.resources?.length, restricted ? 1 : 2);
      assert.doesNotMatch(
        JSON.stringify(candidate),
        /internal\/private|test-token|bucketFile|bytes/,
      );
      assert.ok(
        requests.some((url) =>
          url.includes(`/contents/buckets.csv?ref=${commit}`),
        ),
      );
      assert.ok(
        requests.every(
          (url) =>
            !url.includes("/contents/internal/") &&
            !url.includes("/contents/tables/"),
        ),
      );
      if (!restricted)
        assert.match(
          candidate.resources?.[0]?.path ?? "",
          /\/v1.0.0\/tables\/data.csv$/,
        );
    });
  });
}

test("root summary discovery replaces a differently named declared summary without duplication", async () => {
  await withGitHub(
    { private: false, alias: true },
    async (_requests, source) => {
      const candidate = buildCandidate(
        source,
        "example",
        await readRepositoryMetadata("example", source, "test-token"),
      );
      assert.equal(candidate.resources?.length, 2);
      assert.ok(
        candidate.resources?.every((resource) => resource.name !== "summary"),
      );
    },
  );
});

for (const options of [
  { missing: true },
  { noRelease: true },
  { truncated: true },
]) {
  test(`summary is omitted when unavailable for review: ${JSON.stringify(options)}`, async () => {
    await withGitHub(options, async (requests, source) => {
      const metadata = await readRepositoryMetadata(
        "example",
        source,
        "test-token",
      );
      assert.equal(metadata.bucketFile, undefined);
      assert.equal(
        buildCandidate(source, "example", metadata).resources,
        undefined,
      );
      assert.ok(
        requests.every((url) => !url.includes("/contents/buckets.csv")),
      );
      if (!options.missing) assert.ok(metadata.review?.length);
    });
  });
}

for (const options of [
  { content: "kind,count\nsecret-label,-1" },
  { content: Buffer.from([0xff]) },
  { content: `kind,count\n${"a".repeat(800_000)},1` },
  { mode: "120000" },
  { mode: "160000" },
  { status: 404 },
  { status: 403 },
  { encoding: "none" },
  { base64: "not!base64" },
  { conflicting: true },
  {
    content:
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12",
  },
]) {
  test(`advertised invalid bucket summary fails (${Object.keys(options).join()})`, async () => {
    await withGitHub(options, async (_requests, source) => {
      await assert.rejects(
        readRepositoryMetadata("example", source, "test-token"),
        (error: Error) => {
          assert.doesNotMatch(
            error.message,
            /secret-label|test-token|internal\/private/,
          );
          return true;
        },
      );
    });
  });
}
