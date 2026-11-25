import assert from "node:assert/strict";
import { test } from "node:test";
import manifest from "../datasets.json";
import {
  type Dataset,
  getDownloadableResources,
  validateCatalogAccess,
} from "../lib/datasets";

const datasets = manifest as Dataset[];
const reviewedSlugs = [
  "ds-articlereconstruction",
  "ds-articlereconstruction-atd",
  "ds-articlereconstruction-frial-atd",
  "ds-articlereconstruction-syafiq-atd",
  "ds-bangsawan",
  "ds-bangsawan-yc-atd",
  "ds-layout-um",
  "ds-layout-um-gt",
  "ds-layout-um-v2",
  "ds-layout-um-v2-hirwan-atd",
];

function record(slug: string): Dataset {
  const found = datasets.filter(
    (dataset) => dataset.namespace === "budaya-lab" && dataset.slug === slug,
  );
  assert.equal(found.length, 1, slug);
  return found[0];
}

test("retains the ten reviewed identities and keeps all restricted listings metadata-only", () => {
  assert.doesNotThrow(() => validateCatalogAccess(datasets));
  for (const slug of reviewedSlugs) {
    const dataset = record(slug);
    const listed =
      dataset.resources?.filter(
        (resource) => resource.access === "restricted",
      ) ?? [];
    assert.ok(listed.every((resource) => resource.title?.trim()));
    assert.ok(
      getDownloadableResources(dataset).every(
        (resource) => resource.access !== "restricted",
      ),
    );
  }
});

test("publishes reviewed entries and preserves only explicit or previously confirmed parents", () => {
  for (const slug of reviewedSlugs) {
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

// Descriptions, keywords, resource lists and supplied counts are source-managed.
// Their replacement/preservation contract is tested with synthetic sources in
// catalogue-sync.test.ts rather than freezing today's research metadata here.
test("keeps existing bucket resources and does not infer dataset totals", () => {
  for (const slug of reviewedSlugs)
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
