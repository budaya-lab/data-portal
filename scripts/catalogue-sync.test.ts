import assert from "node:assert/strict";
import { test } from "node:test";
import type { Dataset } from "../lib/datasets";
import { planCatalogueSync } from "./catalogue-sync";
import { parseDataPackage } from "./data-package";
import type { Repository } from "./github-repositories";

const repo: Repository = {
  name: "ds-example",
  full_name: "example/ds-example",
  owner: { login: "example" },
  html_url: "https://github.com/example/ds-example",
  description: null,
  private: true,
  default_branch: "main",
};
const metadata = () =>
  parseDataPackage(
    JSON.stringify({
      name: "ds-example",
      title: "Updated",
      description: "Source description.",
      keywords: ["project:source", "task:catalogue", "stage:annotated"],
      resources: [
        {
          name: "input",
          title: "Manifest",
          path: "input.csv",
          format: "csv",
          count: 0,
        },
        { name: "xml", title: "Annotations", path: "xml/", count: 12 },
      ],
    }),
  );
const existing = (): Dataset => ({
  namespace: "publisher",
  slug: "stable-id",
  name: "Reviewed title",
  description: "Reviewed description.",
  keywords: ["stage:curated"],
  access: "restricted",
  sources: [
    {
      title: "Repository",
      path: "https://github.com/Example/DS-EXAMPLE",
      access: "restricted",
    },
  ],
  derivedFrom: [{ namespace: "publisher", slug: "parent" }],
  category: "Research",
  version: "2.0.0",
  created: "2026-01-01T00:00:00Z",
  licenses: [{ name: "CC0-1.0" }],
  resources: [
    {
      name: "input",
      title: "Old",
      path: "old.csv",
      format: "csv",
      access: "restricted",
      count: 5,
    },
  ],
});
const parent: Dataset = {
  namespace: "publisher",
  slug: "parent",
  name: "Parent",
};
const plan = (records: Dataset[], source = metadata(), repository = repo) =>
  planCatalogueSync(
    `${JSON.stringify(records, null, 2)}\n`,
    [{ repo: repository, metadata: source }],
    "example",
  );

test("sync replaces source metadata and supplied counts, preserving identity, publication and lineage", () => {
  assert.equal(metadata().resources[0].count, 0);
  const result = plan([parent, existing()]);
  const record = JSON.parse(result.manifest)[1];
  assert.equal(record.namespace, "publisher");
  assert.equal(record.slug, "stable-id");
  assert.equal(record.name, "Updated");
  assert.equal(record.description, "Source description.");
  assert.deepEqual(record.keywords, metadata().keywords);
  assert.equal(record.draft, undefined);
  assert.deepEqual(record.derivedFrom, existing().derivedFrom);
  assert.equal(record.category, "Research");
  assert.equal(record.version, "2.0.0");
  assert.equal(record.created, "2026-01-01T00:00:00Z");
  assert.equal(record.licenses, undefined);
  assert.deepEqual(record.resources, [
    {
      name: "input",
      title: "Manifest",
      path: "input.csv",
      format: "csv",
      count: 0,
      access: "restricted",
    },
    {
      name: "xml",
      title: "Annotations",
      path: "xml/",
      format: "directory",
      count: 12,
      access: "restricted",
    },
  ]);
  assert.match(result.changes[0].warnings.join(" "), /restricted.*review/i);
  assert.equal(result.failures.length, 0);
  assert.equal(
    planCatalogueSync(
      result.manifest,
      [{ repo, metadata: metadata() }],
      "example",
    ).changes.length,
    0,
  );
});

test("new private records are drafts with metadata-only resources, not download URLs", () => {
  const result = plan([]);
  const [record] = JSON.parse(result.manifest);
  assert.equal(record.draft, true);
  assert.equal(record.access, "restricted");
  assert.equal(record.namespace, "example");
  assert.ok(
    record.resources.every(
      (resource: { access: string }) => resource.access === "restricted",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(record),
    /raw.githubusercontent|history|preview|bucketFile|bytes/,
  );
  assert.equal(result.changes[0].kind, "added");
});

test("access transitions are explicit, remove old download sugar and never promote private paths", () => {
  const record = {
    ...existing(),
    access: "public" as const,
    file: "old.csv",
    format: "csv" as const,
    sources: [
      { title: "Repository", path: repo.html_url, access: "public" as const },
    ],
  };
  const result = plan([parent, record]);
  const updated = JSON.parse(result.manifest)[1];
  assert.equal(updated.access, "restricted");
  assert.equal(updated.file, undefined);
  assert.equal(updated.format, undefined);
  assert.equal(updated.sources[0].access, "restricted");
  assert.match(result.changes[0].warnings.join(" "), /access.*review/i);
});

test("explicit access-label changes require review even if another source already restricts the record", () => {
  const record = { ...existing(), access: undefined };
  const result = plan([parent, record]);
  assert.match(result.changes[0].warnings.join(" "), /access.*review/i);
});

test("verified public resources retain supplied counts without copying data bytes", () => {
  const source = {
    ...metadata(),
    verifiedResources: [
      {
        name: "input",
        title: "Manifest",
        path: "https://raw.githubusercontent.com/example/ds-example/v1.0.0/input.csv",
        format: "csv" as const,
      },
    ],
  };
  const result = plan([], source, { ...repo, private: false });
  assert.equal(JSON.parse(result.manifest)[0].resources[0].count, 0);
  assert.equal(result.buckets.length, 0);
});

test("bucket updates preserve legacy paths; missing replacements keep existing summaries", () => {
  const bucket = {
    name: "buckets",
    path: "legacy-buckets.csv",
    format: "csv" as const,
    title: "Public bucket summary",
  };
  const record = {
    ...existing(),
    resources: [bucket, ...(existing().resources ?? [])],
  };
  const source = {
    ...metadata(),
    bucketFile: { bytes: Buffer.from("kind,count\nA,2\n"), ref: "v1.0.0" },
  };
  const result = plan([parent, record], source);
  assert.equal(result.buckets[0].resource.path, "legacy-buckets.csv");
  assert.deepEqual(result.buckets[0].bytes, source.bucketFile.bytes);
  assert.equal(
    JSON.parse(result.manifest)[1].resources[0].path,
    "legacy-buckets.csv",
  );
  const missing = plan([parent, record]);
  assert.equal(missing.buckets.length, 0);
  assert.equal(
    JSON.parse(missing.manifest)[1].resources[0].path,
    "legacy-buckets.csv",
  );
  assert.match(missing.changes[0].warnings.join(" "), /summary.*preserved/i);
});

test("ambiguous source matches, identity collisions and shared bucket destinations fail closed", () => {
  assert.throws(
    () => plan([parent, existing(), { ...existing(), slug: "duplicate" }]),
    /ambiguous/i,
  );
  assert.throws(
    () =>
      plan([
        { namespace: "example", slug: "ds-example", name: "Different source" },
      ]),
    /collision/i,
  );
  const bucket = {
    name: "buckets",
    path: "shared.csv",
    format: "csv" as const,
  };
  assert.throws(
    () =>
      plan([
        parent,
        { ...existing(), resources: [bucket] },
        {
          namespace: "other",
          slug: "other",
          name: "Other",
          resources: [bucket],
        },
      ]),
    /shared/i,
  );
});

test("two repositories cannot update the same record through different source links", () => {
  const other = { ...repo, name: "ds-other", full_name: "example/ds-other" };
  const record = {
    ...existing(),
    sources: [
      ...(existing().sources ?? []),
      {
        title: "Other",
        path: "https://github.com/example/ds-other",
        access: "restricted" as const,
      },
    ],
  };
  assert.throws(
    () =>
      planCatalogueSync(
        JSON.stringify([parent, record]),
        [
          { repo, metadata: metadata() },
          { repo: other, metadata: metadata() },
        ],
        "example",
      ),
    /ambiguous/i,
  );
});

test("sync preserves explicit draft states and does not delete undiscovered records", () => {
  for (const draft of [true, false]) {
    const result = plan([parent, { ...existing(), draft }]);
    assert.equal(JSON.parse(result.manifest)[1].draft, draft);
    assert.deepEqual(JSON.parse(result.manifest)[0], parent);
  }
});

test("unsafe or unrepresentable private resources skip only their repository with safe errors", () => {
  for (const resource of [
    {
      name: "private-name",
      title: "Private",
      path: ["secret.csv", "other.csv"],
      format: "csv",
    },
    {
      name: "private-name",
      title: "Private",
      path: "../secret.csv",
      format: "csv",
    },
    {
      name: "private-name",
      title: "Private",
      path: "secret.zip",
      format: "zip",
    },
  ]) {
    const current = `${JSON.stringify([parent, existing()], null, 2)}\n`;
    const result = planCatalogueSync(
      current,
      [{ repo, metadata: { ...metadata(), resources: [resource] } }],
      "example",
    );
    assert.equal(result.manifest, current);
    assert.equal(result.changes.length, 0);
    assert.equal(result.failures.length, 1);
    assert.doesNotMatch(
      JSON.stringify(result.failures),
      /private-name|secret\.csv|secret\.zip/,
    );
  }
});
