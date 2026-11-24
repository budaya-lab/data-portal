import assert from "node:assert/strict";
import { test } from "node:test";
import manifest from "../datasets.json";
import {
  type Dataset,
  getDownloadableResources,
  validateCatalogAccess,
} from "../lib/datasets";

const datasets = manifest as Dataset[];
const expected: Record<string, string[]> = {
  "ds-articlereconstruction": ["input", "alto", "xml"],
  "ds-articlereconstruction-atd": [
    "input",
    "alto",
    "annotations",
    "article_xml",
    "assemble_annotations",
    "backups",
    "xml",
    "reports",
  ],
  "ds-articlereconstruction-frial-atd": ["input", "alto", "article_xml", "xml"],
  "ds-articlereconstruction-syafiq-atd": [
    "input",
    "alto",
    "article_xml",
    "xml",
  ],
  "ds-bangsawan": ["input", "alto", "config", "results"],
  "ds-bangsawan-yc-atd": ["input", "alto", "config", "results"],
  "ds-layout-um": ["input", "metadata"],
  "ds-layout-um-gt": ["input", "metadata", "xml"],
  "ds-layout-um-v2": ["input"],
  "ds-layout-um-v2-hirwan-atd": ["input", "xml"],
};

function record(slug: string): Dataset {
  const found = datasets.filter(
    (dataset) => dataset.namespace === "budaya-lab" && dataset.slug === slug,
  );
  assert.equal(found.length, 1, slug);
  return found[0];
}

test("catalogues all ten reviewed datasets with every declared private resource listed", () => {
  assert.doesNotThrow(() => validateCatalogAccess(datasets));
  for (const [slug, names] of Object.entries(expected)) {
    const dataset = record(slug);
    assert.equal(dataset.access, "restricted");
    const listed =
      dataset.resources?.filter(
        (resource) => resource.access === "restricted",
      ) ?? [];
    assert.deepEqual(
      listed.map((resource) => resource.name),
      names,
      slug,
    );
    assert.ok(listed.every((resource) => resource.title?.trim()));
    assert.ok(
      getDownloadableResources(dataset).every(
        (resource) => resource.name === "buckets",
      ),
    );
  }
});

test("publishes reviewed entries and preserves only explicit or previously confirmed parents", () => {
  for (const slug of Object.keys(expected)) {
    assert.equal(record(slug).draft, undefined, slug);
  }
  const parents: Record<string, string> = {
    "ds-articlereconstruction-atd": "ds-articlereconstruction",
    "ds-articlereconstruction-frial-atd": "ds-articlereconstruction-atd",
    "ds-articlereconstruction-syafiq-atd": "ds-articlereconstruction-atd",
    "ds-bangsawan-yc-atd": "ds-bangsawan",
    "ds-layout-um-gt": "ds-layout-um",
    "ds-layout-um-v2-hirwan-atd": "ds-layout-um-v2",
  };
  for (const [slug, parent] of Object.entries(parents)) {
    assert.deepEqual(record(slug).derivedFrom, [
      { namespace: "budaya-lab", slug: parent },
    ]);
  }
});

test("preserves reviewed catalogue metadata when the local source disagrees", () => {
  const dataset = record("ds-layout-um");
  assert.equal(
    dataset.description,
    "557 images from 1956 to 1961, used for layout classification.",
  );
  assert.ok(dataset.keywords?.includes("stage:curated"));
  assert.equal(dataset.keywords?.includes("stage:annotated"), false);
});

test("retains supplied counts and existing public bucket resources without inventing totals", () => {
  const input = record("ds-articlereconstruction").resources?.find(
    (resource) => resource.name === "input",
  );
  assert.equal(input?.count, 178);
  assert.equal(
    record("ds-articlereconstruction-atd").resources?.find(
      (resource) => resource.name === "backups",
    )?.count,
    725,
  );
  assert.equal(
    record("ds-articlereconstruction-atd").resources?.find(
      (resource) => resource.name === "assemble_annotations",
    )?.count,
    undefined,
  );
  for (const slug of Object.keys(expected))
    assert.equal(record(slug).recordCount, undefined);
  for (const slug of [
    "ds-layout-um",
    "ds-layout-um-v2",
    "ds-articlereconstruction",
  ]) {
    assert.equal(
      record(slug).resources?.filter((resource) => resource.name === "buckets")
        .length,
      1,
    );
  }
});
