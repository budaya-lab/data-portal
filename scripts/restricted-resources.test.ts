import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type Dataset,
  getDownloadableResources,
  type Resource,
  resourceUrl,
  validateCatalogAccess,
} from "../lib/datasets";
import { withHistory } from "../lib/history";
import { toDCAT, toDCATCatalog } from "../lib/metadata/dcat";
import { getDcatProfile } from "../lib/metadata/dcat-profiles";
import DatasetPage from "../pages/[owner]/[slug]";

const metadata: Resource = {
  name: "input",
  title: "Supplied input manifest",
  path: "input.csv",
  format: "csv",
  count: 12,
  access: "restricted",
};
const dataset: Dataset = {
  namespace: "example",
  slug: "restricted",
  name: "Restricted example",
  access: "restricted",
  sources: [
    {
      title: "Source repository",
      path: "https://github.com/example/ds-example",
      access: "restricted",
    },
  ],
  resources: [
    metadata,
    {
      name: "annotations",
      title: "Supplied annotations",
      path: "annotations/",
      format: "directory",
      count: 0,
      access: "restricted",
    },
  ],
};

test("accepts explicit metadata-only restricted resources without treating them as downloads", () => {
  assert.doesNotThrow(() => validateCatalogAccess([dataset]));
  assert.deepEqual(getDownloadableResources(dataset), []);
  assert.throws(() => resourceUrl(metadata), /restricted.*download/i);
  const history = withHistory(dataset);
  assert.deepEqual(history.resources, []);
  assert.deepEqual(history.activity, []);
});

test("rejects unsafe metadata resource paths, invalid access labels and invalid supplied counts", () => {
  for (const path of [
    "/private/input.csv",
    "../input.csv",
    "https://example.org/private.csv",
    "input.csv?token=value",
    "input\\file.csv",
    ".env",
    "a/../input.csv",
  ]) {
    assert.throws(
      () =>
        validateCatalogAccess([
          { ...dataset, resources: [{ ...metadata, path }] },
        ]),
      /restricted resource/i,
    );
  }
  for (const count of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        validateCatalogAccess([
          { ...dataset, resources: [{ ...metadata, count }] },
        ]),
      /resource count/i,
    );
  }
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...dataset,
          resources: [{ ...metadata, access: "private" }],
        } as unknown as Dataset,
      ]),
    /resource access/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        { ...dataset, resources: [{ ...metadata, access: undefined }] },
      ]),
    /restricted.*resource/i,
  );
});

test("rejects preview/history payloads and structured content in metadata-only listings", () => {
  for (const fields of [
    { query: "SELECT * FROM data" },
    { history: [] },
    { schema: { fields: [] } },
    { description: { rows: ["private marker"] } },
  ]) {
    const resource = { ...metadata, ...fields } as unknown as Resource;
    assert.throws(
      () => validateCatalogAccess([{ ...dataset, resources: [resource] }]),
      /restricted resource/i,
    );
  }
});

test("shows resource metadata and zero counts without previews, paths or download actions", () => {
  const markup = renderToStaticMarkup(
    createElement(DatasetPage, { dataset, resources: [], activity: [] }),
  );
  assert.match(markup, /Supplied input manifest/);
  assert.match(markup, /Supplied annotations/);
  assert.match(markup, /Directory/);
  assert.match(markup, />12</);
  assert.match(markup, />0</);
  assert.doesNotMatch(
    markup,
    /input\.csv|annotations\/|Download &amp; API|Copy URL|SQL editor/,
  );
});

test("keeps public bucket resources downloadable beside private metadata listings", () => {
  const bucket: Resource = {
    name: "buckets",
    path: "public-summary.csv",
    format: "csv",
    title: "Public bucket summary",
  };
  const mixed = { ...dataset, resources: [metadata, bucket] };
  assert.doesNotThrow(() => validateCatalogAccess([mixed]));
  assert.deepEqual(getDownloadableResources(mixed), [bucket]);
  assert.equal(resourceUrl(bucket), "/data/public-summary.csv");
});

test("also protects restricted resource metadata inside an otherwise public dataset", () => {
  const publicFile: Resource = {
    name: "public",
    title: "Public records",
    path: "https://example.org/public.csv",
    format: "csv",
  };
  const mixed: Dataset = {
    ...dataset,
    access: "public",
    sources: [
      {
        title: "Public source",
        path: "https://example.org/catalogue",
        access: "public",
      },
    ],
    resources: [metadata, publicFile],
  };
  assert.doesNotThrow(() => validateCatalogAccess([mixed]));
  assert.deepEqual(getDownloadableResources(mixed), [publicFile]);
  const distributions = toDCAT(mixed)["dcat:distribution"];
  assert.equal(distributions?.length, 1);
  assert.equal(distributions?.[0]["dcat:downloadURL"], publicFile.path);
  assert.doesNotMatch(JSON.stringify(distributions), /input.csv/);
});

test("does not turn metadata-only entries into DCAT or Croissant download distributions", () => {
  const dcat = toDCAT(dataset);
  assert.equal(dcat["dcat:distribution"], undefined);
  assert.equal(dcat["dct:accessLevel"], "restricted public");
  const base = toDCATCatalog([dataset]);
  const profile = getDcatProfile("croissant");
  assert.ok(profile.applyFromEntries);
  const croissant = JSON.stringify(
    profile.applyFromEntries([dataset], base, {}),
  );
  assert.doesNotMatch(
    croissant,
    /input\.csv|annotations\/|FileObject|contentUrl/,
  );
});
