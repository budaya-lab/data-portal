import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resourcesAtRelease,
  selectLatestMainRelease,
} from "./release-resources";

const releases = [
  { tag_name: "v1.2.0", draft: false, prerelease: false },
  { tag_name: "v1.10.0", draft: false, prerelease: false },
  { tag_name: "v2.0.0-rc.1", draft: false, prerelease: true },
  { tag_name: "v3.0.0", draft: true, prerelease: false },
];

test("selects the highest published SemVer release reachable from main", async () => {
  const checked: string[] = [];
  const selected = await selectLatestMainRelease(releases, async (tag) => {
    checked.push(tag);
    return tag !== "v1.10.0";
  });
  assert.equal(selected, "v1.2.0");
  assert.deepEqual(checked, ["v1.10.0", "v1.2.0"]);
  assert.equal(await selectLatestMainRelease([], async () => true), undefined);
});

test("maps every verified single-file resource to the selected tag, never a moving branch or SHA", () => {
  const input = [
    { name: "records", path: "tables/records.csv", format: "csv" },
    { name: "labels", path: "annotations/labels.json", format: "json" },
  ];
  const tree = [
    { path: "tables/records.csv", type: "blob", mode: "100644" },
    { path: "annotations/labels.json", type: "blob", mode: "100644" },
  ];
  assert.deepEqual(
    resourcesAtRelease(input, tree, "v1.2.0", "budaya-lab", "ds-example"),
    {
      resources: [
        {
          name: "records",
          path: "https://raw.githubusercontent.com/budaya-lab/ds-example/v1.2.0/tables/records.csv",
          format: "csv",
        },
        {
          name: "labels",
          path: "https://raw.githubusercontent.com/budaya-lab/ds-example/v1.2.0/annotations/labels.json",
          format: "json",
        },
      ],
    },
  );
});

test("holds all public resources as metadata-only on unsupported format, path arrays, missing files, or symlinks", () => {
  const tree = [{ path: "tables/data.csv", type: "blob", mode: "100644" }];
  for (const resources of [
    [{ name: "pdf", path: "tables/data.pdf", format: "pdf" }],
    [{ name: "parts", path: ["tables/data.csv"], format: "csv" }],
    [{ name: "missing", path: "missing.csv", format: "csv" }],
    [{ name: "link", path: "link.csv", format: "csv" }],
    [
      { name: "safe", path: "tables/data.csv", format: "csv" },
      { name: "missing", path: "missing.csv", format: "csv" },
    ],
  ]) {
    const result = resourcesAtRelease(
      resources,
      [...tree, { path: "link.csv", type: "blob", mode: "120000" }],
      "v1.2.0",
      "budaya-lab",
      "ds-example",
    );
    assert.equal(result.resources, undefined);
    assert.deepEqual(result.review, [
      "resources need review before publication",
    ]);
  }
});
