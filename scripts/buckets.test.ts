import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HorizontalBarChart } from "../components/HorizontalBarChart";
import { readBucketFile, validateBucketFiles } from "../lib/bucket-files";
import { parseBuckets, validateBucketResource } from "../lib/buckets";
import { validateCatalogAccess } from "../lib/datasets";
import { toDCATCatalog } from "../lib/metadata/dcat";
import type { Dataset, Resource } from "../lib/providers/types";

for (const [text, labelColumn, rows] of [
  [
    "year,count\n001,0\n1962,10\n",
    "year",
    [
      { year: "001", count: 0 },
      { year: "1962", count: 10 },
    ],
  ],
  [
    "\uFEFF category , count \r\n A , 0 \r\n\r\nB,0",
    "category",
    [
      { category: "A", count: 0 },
      { category: "B", count: 0 },
    ],
  ],
  [
    'kind,count\n"A,B",2\n"A""B",3\n"two\nlines",4\n',
    "kind",
    [
      { kind: "A,B", count: 2 },
      { kind: 'A"B', count: 3 },
      { kind: "two\nlines", count: 4 },
    ],
  ],
  [
    "__proto__,count\nconstructor,9007199254740991",
    "__proto__",
    [{ ["__proto__"]: "constructor", count: Number.MAX_SAFE_INTEGER }],
  ],
] as const) {
  test(`accepts bucket CSV with header ${labelColumn} and preserves labels`, () => {
    assert.deepEqual(parseBuckets(text), { labelColumn, rows });
  });
}

for (const text of [
  "",
  "year,count\n",
  "year,total\nA,1",
  "count,count\nA,1",
  ",count\nA,1",
  "year,count,extra\nA,1,x",
  "year,count\nA",
  "year,count\nA,1,x",
  "year,count\n ,1",
  "year,count\nA,1\n A ,2",
  "year,count\nA,",
  "year,count\nA,-1",
  "year,count\nA,+1",
  "year,count\nA,1.5",
  "year,count\nA,1e3",
  "year,count\nA,NaN",
  "year,count\nA,Infinity",
  "year,count\nA,9007199254740992",
  'year,count\n"A,1',
  'year,count\nA"B,1',
  'year,count\n"A"x,1',
  "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n",
]) {
  test(`rejects malformed bucket CSV ${JSON.stringify(text)}`, () => {
    assert.throws(() => parseBuckets(text), /buckets\.csv/);
  });
}

test("a summary within the byte limit does not overflow the horizontal chart maximum", () => {
  const text = `label,count\n${Array.from({ length: 130_000 }, (_, index) => `${index.toString(36)},0`).join("\n")}`;
  assert.ok(Buffer.byteLength(text) < 1_000_000);
  const data = parseBuckets(text);
  assert.doesNotThrow(() =>
    HorizontalBarChart({
      rows: data.rows,
      x: data.labelColumn,
      yKeys: ["count"],
      height: 320,
      label: "Bucket counts",
    }),
  );
});

test("rejects invalid UTF-8 and oversized bucket contents", () => {
  assert.throws(() => parseBuckets(Buffer.from([0xff])), /UTF-8/);
  assert.throws(
    () => parseBuckets(`label,count\n${"a".repeat(1_000_000)},1`),
    /limit/,
  );
});

test("bucket resources require safe local CSV paths and the reserved name", () => {
  for (const path of [
    "../outside.csv",
    "/data/example.csv",
    "https://example.test/data.csv",
    "a/../b.csv",
    "a//b.csv",
    "a\\b.csv",
    "a%2fb.csv",
    "a.csv?token=x",
    "a.csv#x",
    "a\n.csv",
    "a.json",
  ]) {
    assert.throws(
      () => validateBucketResource({ name: "buckets", format: "csv", path }),
      /bucket/i,
    );
  }
  assert.throws(
    () =>
      validateBucketResource({
        name: "other",
        format: "csv",
        path: "example.csv",
      }),
    /bucket/i,
  );
  assert.throws(
    () =>
      validateBucketResource({
        name: "buckets",
        format: "json",
        path: "example.csv",
      }),
    /bucket/i,
  );
});

test("restricted datasets permit only a single standard public bucket resource", () => {
  const bucket: Resource = {
    name: "buckets",
    format: "csv",
    path: "example.csv",
    title: "Public bucket summary",
  };
  const dataset: Dataset = {
    namespace: "example",
    slug: "restricted",
    name: "Restricted example",
    access: "restricted",
    sources: [
      {
        title: "Source",
        path: "https://github.com/example/ds-example",
        access: "restricted",
      },
    ],
    resources: [bucket],
  };
  assert.doesNotThrow(() => validateCatalogAccess([dataset]));
  for (const resources of [
    [{ ...bucket, name: "data" }],
    [bucket, bucket],
    [bucket, { name: "data", format: "csv" as const, path: "secret.csv" }],
    [{ ...bucket, path: "https://example.test/buckets.csv" }],
  ]) {
    assert.throws(
      () => validateCatalogAccess([{ ...dataset, resources }]),
      /bucket|restricted/i,
    );
  }
  assert.throws(
    () => validateCatalogAccess([{ ...dataset, file: "secret.csv" }]),
    /restricted/i,
  );
  const catalog = toDCATCatalog([dataset], {
    baseUrl: "https://portal.example",
  });
  const text = JSON.stringify(catalog);
  assert.match(text, /restricted public/);
  assert.match(text, /example.csv/);
  assert.doesNotMatch(text, /secret.csv/);
  assert.throws(
    () =>
      validateBucketFiles([
        { ...dataset, resources: [{ ...bucket, path: "missing.csv" }] },
      ]),
    /ENOENT|bucket/i,
  );
});

test("local reads reject missing, symlinked, outside-root, non-file and invalid summaries", () => {
  const root = mkdtempSync(join(tmpdir(), "portal-buckets-"));
  const resource: Resource = {
    name: "buckets",
    path: "nested/example.csv",
    format: "csv",
  };
  try {
    mkdirSync(join(root, "nested"));
    writeFileSync(join(root, resource.path), "year,count\n001,0\n");
    assert.deepEqual(readBucketFile(resource, root), {
      labelColumn: "year",
      rows: [{ year: "001", count: 0 }],
    });
    assert.throws(() =>
      readBucketFile({ ...resource, path: "missing.csv" }, root),
    );
    assert.throws(() =>
      readBucketFile({ ...resource, path: "../outside.csv" }, root),
    );
    symlinkSync(join(root, resource.path), join(root, "link.csv"));
    assert.throws(
      () => readBucketFile({ ...resource, path: "link.csv" }, root),
      /symlink/,
    );
    symlinkSync(join(root, "nested"), join(root, "linked"));
    assert.throws(
      () => readBucketFile({ ...resource, path: "linked/example.csv" }, root),
      /symlink/,
    );
    mkdirSync(join(root, "directory.csv"));
    assert.throws(
      () => readBucketFile({ ...resource, path: "directory.csv" }, root),
      /file/,
    );
    assert.throws(
      () =>
        readBucketFile(
          {
            ...resource,
            schema: { fields: [{ name: "wrong" }, { name: "count" }] },
          },
          root,
        ),
      /schema/i,
    );
    writeFileSync(join(root, resource.path), "year,count\nsecret-label,-1\n");
    assert.throws(
      () => readBucketFile(resource, root),
      (error: Error) => {
        assert.doesNotMatch(error.message, /secret-label/);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
