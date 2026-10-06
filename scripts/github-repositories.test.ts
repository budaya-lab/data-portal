import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCandidate,
  extractMetadata,
  listRepositories,
  matchesRepositoryName,
  mergeCandidates,
  parseArguments,
  planRepositories,
  type Repository,
  readRepositoryMetadata,
  resolveGitHubToken,
} from "./github-repositories";

const repo: Repository = {
  name: "ds-example",
  full_name: "cssh/ds-example",
  owner: { login: "CSSH" },
  html_url: "https://github.com/cssh/ds-example",
  description: "A study of printed newspapers.",
  topics: ["newspapers", "history"],
  private: true,
  default_branch: "main",
};

test("GitHub CLI authentication is used unless an explicit token is provided", () => {
  assert.equal(
    resolveGitHubToken(" environment-token ", () => "cli-token"),
    "environment-token",
  );
  assert.equal(
    resolveGitHubToken(undefined, () => " cli-token\n"),
    "cli-token",
  );
  assert.throws(
    () => resolveGitHubToken(undefined, () => ""),
    /gh auth login|GITHUB_TOKEN/i,
  );
  let thrown: unknown;
  try {
    resolveGitHubToken(undefined, () => {
      throw new Error("gh unavailable");
    });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error);
  assert.match(thrown.message, /gh auth login|GITHUB_TOKEN/i);
  assert.ok(thrown.cause instanceof Error);
  assert.match(thrown.cause.message, /gh unavailable/);
});

test("CLI requires an account and derives a lowercase namespace unless overridden", () => {
  assert.throws(() => parseArguments([]), /organisation or username/i);
  assert.deepEqual(parseArguments(["cssh"]), {
    account: "cssh",
    namespace: "cssh",
    pattern: "^ds[-_].*",
    apply: false,
  });
  assert.equal(
    parseArguments(["cssh", "--namespace", "culturalheritagenus"]).namespace,
    "culturalheritagenus",
  );
  assert.throws(
    () => parseArguments(["cssh", "--namespace", "../bad"]),
    /namespace/i,
  );
});

test("repository planning skips existing entries and reports slug conflicts", () => {
  const existing = buildCandidate(repo, "cssh", {});
  const other = { ...repo, name: "ds-new", full_name: "cssh/ds-new" };
  const conflict = {
    ...repo,
    name: "ds-example",
    owner: { login: "other" },
    full_name: "other/ds-example",
  };
  const plan = planRepositories(
    [repo, other, conflict],
    "cssh",
    JSON.stringify([existing]),
  );
  assert.deepEqual(plan.alreadyCatalogued, ["cssh/ds-example"]);
  assert.deepEqual(
    plan.repositories.map((item) => item.full_name),
    ["cssh/ds-new"],
  );
  assert.deepEqual(plan.conflicts, [
    {
      repository: "other/ds-example",
      reason: "catalogue slug cssh/ds-example belongs to a different source",
    },
  ]);
});

test("repository name pattern is validated and matched locally", () => {
  assert.equal(matchesRepositoryName("ds-example", "^ds[-_].*"), true);
  assert.equal(matchesRepositoryName("ds_example", "^ds[-_].*"), true);
  assert.equal(matchesRepositoryName("other-ds-example", "^ds[-_].*"), false);
  assert.throws(() => matchesRepositoryName("anything", "["), /pattern/i);
});

test("private repository candidate contains only metadata and a safe landing link", () => {
  const candidate = buildCandidate(repo, "culturalheritagenus", {
    title: "Newspaper corpus",
    description: "A study of printed newspapers.",
    keywords: ["newspapers", "history"],
  });
  assert.deepEqual(candidate, {
    slug: "ds-example",
    namespace: "culturalheritagenus",
    name: "Newspaper corpus",
    description: "A study of printed newspapers.",
    keywords: ["newspapers", "history"],
    draft: true,
    access: "restricted",
    sources: [
      {
        title: "GitHub repository (sign in for access)",
        path: "https://github.com/cssh/ds-example",
        access: "restricted",
      },
    ],
  });
  assert.equal("file" in candidate, false);
  assert.equal("resources" in candidate, false);
});

test("Data Package metadata supplies the title, stage, creation date and public-safe licenses", () => {
  const metadata = extractMetadata(
    { ...repo, private: false },
    {
      "datapackage.json": JSON.stringify({
        name: "example-dataset",
        title: "Example corpus",
        description: "A catalogue-safe description.",
        keywords: ["history", "stage:curated"],
        created: "2026-10-01T00:00:00Z",
        licenses: [
          {
            name: "CC-BY-4.0",
            path: "https://creativecommons.org/licenses/by/4.0/",
          },
        ],
        contributors: [{ title: "Person not published" }],
        resources: [{ name: "data", path: "tables/data.csv", format: "csv" }],
      }),
    },
  );
  const candidate = buildCandidate(
    { ...repo, private: false },
    "cssh",
    metadata,
  );
  assert.equal(candidate.name, "Example corpus");
  assert.equal(candidate.created, "2026-10-01T00:00:00Z");
  assert.deepEqual(candidate.licenses, [
    { name: "CC-BY-4.0", path: "https://creativecommons.org/licenses/by/4.0/" },
  ]);
  assert.deepEqual(candidate.keywords, ["history", "stage:curated"]);
  assert.equal("contributors" in candidate, false);
});

test("Data Package onboarding rejects missing or malformed descriptors without legacy fallbacks", () => {
  for (const files of [
    {},
    { "metadata.json": JSON.stringify({ title: "Legacy" }) },
    {
      "datapackage.json": "{invalid",
      "metadata.json": JSON.stringify({ title: "Legacy" }),
    },
    {
      "datapackage.json": JSON.stringify({
        name: "example-dataset",
        title: "No resources",
        resources: [],
      }),
    },
  ] as Record<string, string>[]) {
    assert.throws(() => extractMetadata(repo, files), /datapackage|resource/i);
  }
});

test("public onboarding reads the latest release from main and pins verified resources to its tag", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  const descriptor = {
    name: "example",
    title: "Released data",
    keywords: ["stage:master"],
    resources: [{ name: "records", path: "tables/data.csv", format: "csv" }],
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/releases?"))
      return Response.json([
        { tag_name: "v0.3.0", draft: false, prerelease: false },
        { tag_name: "v0.2.0", draft: false, prerelease: false },
      ]);
    if (url.includes("/compare/v0.3.0...main"))
      return Response.json({ status: "ahead" });
    if (url.includes("/contents/datapackage.json?ref=v0.3.0"))
      return Response.json({
        content: Buffer.from(JSON.stringify(descriptor)).toString("base64"),
        encoding: "base64",
      });
    if (url.includes("/git/trees/v0.3.0"))
      return Response.json({
        truncated: false,
        tree: [{ path: "tables/data.csv", type: "blob", mode: "100644" }],
      });
    throw new Error(`Unexpected API request: ${url}`);
  };
  try {
    const metadata = await readRepositoryMetadata(
      "cssh",
      { ...repo, private: false },
      "test-token",
    );
    const candidate = buildCandidate(
      { ...repo, private: false },
      "cssh",
      metadata,
    );
    assert.deepEqual(
      candidate.resources?.map((resource) => resource.path),
      [
        "https://raw.githubusercontent.com/cssh/ds-example/v0.3.0/tables/data.csv",
      ],
    );
    assert.ok(requested.every((url) => !url.includes("metadata.json")));
    assert.ok(requested.some((url) => url.includes("/compare/v0.3.0...main")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("unsupported public resources keep the whole release metadata-only with a generic review warning", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/releases?"))
      return Response.json([
        { tag_name: "v1.0.0", draft: false, prerelease: false },
      ]);
    if (url.includes("/compare/v1.0.0...main"))
      return Response.json({ status: "identical" });
    if (url.includes("/contents/datapackage.json?ref=v1.0.0"))
      return Response.json({
        content: Buffer.from(
          JSON.stringify({
            name: "example",
            title: "Public title",
            keywords: ["stage:master"],
            resources: [
              { name: "data", path: "data.csv", format: "csv" },
              { name: "raw", path: "internal/secret.xml", format: "xml" },
            ],
          }),
        ).toString("base64"),
        encoding: "base64",
      });
    if (url.includes("/git/trees/v1.0.0"))
      return Response.json({
        truncated: false,
        tree: [
          { path: "data.csv", type: "blob", mode: "100644" },
          { path: "internal/secret.xml", type: "blob", mode: "100644" },
        ],
      });
    throw new Error(`Unexpected API request: ${url}`);
  };
  try {
    const metadata = await readRepositoryMetadata(
      "cssh",
      { ...repo, private: false },
      "test-token",
    );
    const candidate = buildCandidate(
      { ...repo, private: false },
      "cssh",
      metadata,
    );
    assert.equal("resources" in candidate, false);
    assert.deepEqual(metadata.review, [
      "resources need review before publication",
    ]);
    assert.doesNotMatch(
      JSON.stringify({ candidate, review: metadata.review }),
      /internal\/secret|secret\.xml/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a missing latest tag produces a public metadata-only draft with a generic warning", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/releases?"))
      return Response.json([
        { tag_name: "v1.0.0", draft: false, prerelease: false },
      ]);
    if (url.includes("/compare/v1.0.0...main"))
      return new Response("", { status: 404 });
    if (url.includes("/contents/datapackage.json?ref=main"))
      return Response.json({
        content: Buffer.from(
          JSON.stringify({
            name: "example",
            title: "Safe title",
            keywords: ["stage:master"],
            resources: [
              { name: "private-filename", path: "internal/file.csv" },
            ],
          }),
        ).toString("base64"),
        encoding: "base64",
      });
    throw new Error(`Unexpected API request: ${url}`);
  };
  try {
    const metadata = await readRepositoryMetadata(
      "cssh",
      { ...repo, private: false },
      "test-token",
    );
    const candidate = buildCandidate(
      { ...repo, private: false },
      "cssh",
      metadata,
    );
    assert.equal("resources" in candidate, false);
    assert.ok(
      metadata.review?.some((warning) => warning.includes("release tag")),
    );
    assert.doesNotMatch(
      JSON.stringify({ candidate, review: metadata.review }),
      /internal\/file|private-filename/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("missing descriptor at the selected release holds the public record as metadata-only", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/releases?"))
      return Response.json([
        { tag_name: "v1.0.0", draft: false, prerelease: false },
      ]);
    if (url.includes("/compare/v1.0.0...main"))
      return Response.json({ status: "identical" });
    if (url.includes("/contents/datapackage.json?ref=v1.0.0"))
      return new Response("", { status: 404 });
    if (url.includes("/contents/datapackage.json?ref=main"))
      return Response.json({
        content: Buffer.from(
          JSON.stringify({
            name: "example",
            title: "Safe title",
            keywords: ["stage:master"],
            resources: [{ name: "data", path: "data.csv" }],
          }),
        ).toString("base64"),
        encoding: "base64",
      });
    throw new Error(`Unexpected API request: ${url}`);
  };
  try {
    const metadata = await readRepositoryMetadata(
      "cssh",
      { ...repo, private: false },
      "test-token",
    );
    assert.equal(
      "resources" in
        buildCandidate({ ...repo, private: false }, "cssh", metadata),
      false,
    );
    assert.ok(
      metadata.review?.some((warning) => warning.includes("descriptor")),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("private onboarding reads main without requesting releases or exposing its resource paths", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/contents/datapackage.json?ref=main"))
      return Response.json({
        content: Buffer.from(
          JSON.stringify({
            name: "secret",
            title: "Safe title",
            keywords: ["stage:annotated"],
            resources: [{ name: "private-data", path: "internal/secret.csv" }],
          }),
        ).toString("base64"),
        encoding: "base64",
      });
    throw new Error(`Unexpected API request: ${url}`);
  };
  try {
    const metadata = await readRepositoryMetadata("cssh", repo, "test-token");
    const candidate = buildCandidate(repo, "cssh", metadata);
    assert.equal("resources" in candidate, false);
    assert.doesNotMatch(
      JSON.stringify(candidate),
      /internal\/secret|private-data/,
    );
    assert.ok(
      requested.every(
        (url) => !url.includes("/releases") && !url.includes("/git/trees"),
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("repository listing follows GitHub pagination and rejects incomplete full pages", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/users/cssh"))
      return new Response(JSON.stringify({ type: "Organization" }), {
        status: 200,
      });
    const page = new URL(url).searchParams.get("page");
    const data =
      page === "2"
        ? [{ ...repo, name: "ds-last" }]
        : Array.from({ length: 100 }, (_, index) => ({
            ...repo,
            name: `ds-${index}`,
          }));
    return new Response(JSON.stringify(data), {
      status: 200,
      headers:
        page === "2"
          ? {}
          : {
              link: '<https://api.github.com/orgs/cssh/repos?type=all&per_page=100&page=2>; rel="next"',
            },
    });
  };
  try {
    const repositories = await listRepositories("cssh", "test-token");
    assert.equal(repositories.length, 101);
    assert.equal(requests.length, 3);
    assert.ok(
      requests.every((url) => url.startsWith("https://api.github.com/")),
    );
    assert.ok(requests[1].includes("/orgs/cssh/repos"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public candidate defaults metadata to human-review placeholders", () => {
  const candidate = buildCandidate({ ...repo, private: false }, "cssh", {});
  assert.equal(candidate.name, "ds-example");
  assert.equal(candidate.description, undefined);
  assert.equal(candidate.keywords, undefined);
  assert.equal(candidate.access, "public");
  assert.equal(
    buildCandidate({ ...repo, private: undefined }, "cssh", {}).access,
    "restricted",
  );
});

test("merge is idempotent and refuses source or namespace-slug collisions", () => {
  const candidate = buildCandidate(repo, "cssh", {});
  const empty = `${JSON.stringify([], null, 2)}\n`;
  const once = mergeCandidates(empty, [candidate]);
  assert.equal(JSON.parse(mergeCandidates(once, [candidate])).length, 1);
  assert.throws(
    () => mergeCandidates(once, [{ ...candidate, slug: "different" }]),
    /already exists/i,
  );
  assert.throws(
    () =>
      mergeCandidates(
        JSON.stringify([{ slug: candidate.slug, namespace: "cssh" }]),
        [candidate],
      ),
    /collision/i,
  );
});
