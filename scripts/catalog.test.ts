import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Chart, ChartPlot } from "../components/Chart";
import { parseCsv } from "../components/ui/parseCsv";
import type { Dataset } from "../lib/datasets";
import {
  datasetHref,
  getDatasetStage,
  isDraft,
  isRestricted,
  matchesCatalogQuery,
  publishedDatasets,
  stageLabel,
  subjectKeywords,
  suggestedQueries,
  validateCatalogAccess,
} from "../lib/datasets";
import { toDCAT } from "../lib/metadata/dcat";
import { StaticProvider } from "../lib/providers/static-provider";
import DatasetPage from "../pages/[owner]/[slug]";
import { DatasetRow } from "../pages/search";
import stageLabels from "../stage.config.json";

const tagged: Dataset = {
  slug: "oral-history",
  namespace: "humanities",
  name: "Interviews",
  description: "Recorded conversations",
  keywords: ["Oral History", "fieldwork"],
};

test("catalog search finds Frictionless keywords without searching source data", () => {
  assert.equal(matchesCatalogQuery(tagged, "oral history"), true);
  assert.equal(matchesCatalogQuery(tagged, "FIELDWORK"), true);
  assert.equal(matchesCatalogQuery(tagged, "interviews"), true);
  assert.equal(matchesCatalogQuery(tagged, "humanities"), true);
  assert.equal(matchesCatalogQuery(tagged, "recorded"), true);
  assert.equal(matchesCatalogQuery(tagged, "nothing"), false);
  assert.equal(
    matchesCatalogQuery({ ...tagged, keywords: [] }, "oral history"),
    false,
  );
});

test("controlled stage keywords describe data without inventing parentage", () => {
  for (const [stage, label] of Object.entries(stageLabels)) {
    const dataset: Dataset = { ...tagged, keywords: ["fieldwork", `stage:${stage}`] };
    assert.equal(getDatasetStage(dataset), stage);
    assert.equal(stageLabel(dataset), label);
    assert.deepEqual(subjectKeywords(dataset), ["fieldwork"]);
    assert.doesNotThrow(() => validateCatalogAccess([dataset]));
  }
  assert.equal(getDatasetStage(tagged), undefined);
  assert.equal(stageLabel(tagged), undefined);
  assert.equal(getDatasetStage({ ...tagged, derivedFrom: [] }), undefined);
  assert.deepEqual(suggestedQueries([{ ...tagged, keywords: ["stage:curated", "history"] }], 2), ["history", "interviews"]);
});

test("catalogue rejects unknown, duplicate, or malformed stages and obsolete roles", () => {
  for (const keywords of [
    ["stage:unknown"],
    ["stage:Master"],
    ["stage:master", "stage:annotated"],
    ["stage:master", "stage:master"],
    ["stage:master", 12],
  ]) {
    assert.throws(() => validateCatalogAccess([{ ...tagged, keywords } as Dataset]), /stage|keyword/i);
  }
  assert.throws(
    () => validateCatalogAccess([{ ...tagged, role: "derived" } as unknown as Dataset]),
    /role.*unsupported/i,
  );
});

test("lineage is optional and may reference multiple catalogue parents", async () => {
  const master: Dataset = { ...tagged, slug: "master", keywords: ["stage:master"] };
  const secondMaster: Dataset = {
    ...tagged,
    slug: "second-master",
    namespace: "archives",
    keywords: ["stage:master"],
  };
  const derived: Dataset = {
    ...tagged,
    slug: "derived",
    derivedFrom: [
      { namespace: master.namespace, slug: master.slug },
      { namespace: secondMaster.namespace, slug: secondMaster.slug },
    ],
  };
  const provider = new StaticProvider(
    [master, secondMaster, derived],
    "production",
  );
  assert.deepEqual(
    (await provider.getDataset("humanities", "derived"))?.derivedFrom,
    [
      { namespace: "humanities", slug: "master" },
      { namespace: "archives", slug: "second-master" },
    ],
  );
  assert.doesNotThrow(() =>
    validateCatalogAccess([
      { ...tagged, slug: "stage-without-parents", keywords: ["stage:curated"] },
      { ...tagged, slug: "empty-parents", derivedFrom: [] },
    ]),
  );
});

test("catalogue validates lineage references and rejects cycles", () => {
  const parent: Dataset = { ...tagged, slug: "parent", keywords: ["stage:master"] };
  const derived: Dataset = {
    ...tagged,
    slug: "derived",
    derivedFrom: [{ namespace: parent.namespace, slug: parent.slug }],
  };
  const restrictedParent: Dataset = {
    ...parent,
    access: "restricted",
    sources: [
      { title: "Parent login", path: "https://archive.example.org/login" },
    ],
  };
  assert.doesNotThrow(() => validateCatalogAccess([restrictedParent, derived]));
  assert.throws(
    () =>
      validateCatalogAccess([
        { ...tagged, derivedFrom: [{ namespace: "", slug: "parent" }] },
      ]),
    /invalid parent reference/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...tagged,
          derivedFrom: [
            {
              namespace: "humanities",
              slug: "parent",
              privateUrl: "https://private.invalid",
            },
          ],
        } as unknown as Dataset,
        parent,
      ]),
    /invalid parent reference/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        { ...derived, derivedFrom: [{ namespace: "missing", slug: "parent" }] },
      ]),
    /unknown parent/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...derived,
          derivedFrom: [
            { namespace: parent.namespace, slug: parent.slug },
            { namespace: parent.namespace, slug: parent.slug },
          ],
        },
        parent,
      ]),
    /duplicate parent/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...derived,
          derivedFrom: [{ namespace: derived.namespace, slug: derived.slug }],
        },
      ]),
    /cycle/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...parent,
          derivedFrom: [{ namespace: "humanities", slug: "derived" }],
        },
        derived,
      ]),
    /cycle/i,
  );
});

test("production provider omits draft parents without mutating manifest records", async () => {
  const draftParent: Dataset = { ...tagged, slug: "draft-parent", draft: true };
  const publishedChild: Dataset = {
    ...tagged,
    slug: "published-child",
    derivedFrom: [{ namespace: tagged.namespace, slug: draftParent.slug }],
  };
  const records = [draftParent, publishedChild];
  const production = new StaticProvider(records, "production");
  const development = new StaticProvider(records, "development");

  assert.deepEqual(
    (await production.getDataset(tagged.namespace, publishedChild.slug))
      ?.derivedFrom,
    [],
  );
  const productionList = await production.listDatasets();
  assert.equal(JSON.stringify(productionList).includes("draft-parent"), false);
  const productionResults = await production.search({});
  assert.deepEqual(
    productionResults.find((d) => d.slug === publishedChild.slug)?.derivedFrom,
    [],
  );
  assert.equal(
    JSON.stringify(productionResults).includes("draft-parent"),
    false,
  );
  assert.deepEqual(
    (await development.getDataset(tagged.namespace, publishedChild.slug))
      ?.derivedFrom,
    [{ namespace: tagged.namespace, slug: draftParent.slug }],
  );
  assert.deepEqual(publishedChild.derivedFrom, [
    { namespace: tagged.namespace, slug: draftParent.slug },
  ]);
});

test("isDraft identifies only explicitly marked draft datasets", () => {
  assert.equal(isDraft({ ...tagged, draft: true }), true);
  assert.equal(isDraft(tagged), false);
  assert.equal(isDraft({ ...tagged, draft: false }), false);
});

test("draft datasets are hidden from static provider outside development", async () => {
  const records: Dataset[] = [
    { ...tagged, slug: "published" },
    { ...tagged, slug: "draft-record", draft: true },
  ];
  const provider = new StaticProvider(records, "production");
  assert.deepEqual(
    (await provider.listDatasets()).map((d) => d.slug),
    ["published"],
  );
  assert.equal(
    await provider.getDataset(tagged.namespace, "draft-record"),
    null,
  );
  assert.deepEqual(
    (await provider.search({ q: "interviews" })).map((d) => d.slug),
    ["published"],
  );
});

test("draft datasets are available to the development provider", async () => {
  const provider = new StaticProvider(
    [{ ...tagged, draft: true }],
    "development",
  );
  assert.equal((await provider.listDatasets()).length, 1);
  assert.ok(await provider.getDataset(tagged.namespace, tagged.slug));
});

test("published feed selection excludes drafts regardless of environment", () => {
  const records: Dataset[] = [
    { ...tagged, slug: "published" },
    { ...tagged, slug: "draft-record", draft: true },
  ];
  assert.deepEqual(
    publishedDatasets(records).map((d) => d.slug),
    ["published"],
  );
});

test("catalogue rejects invalid draft values", () => {
  assert.throws(
    () =>
      validateCatalogAccess([
        { ...tagged, draft: "true" } as unknown as Dataset,
      ]),
    /invalid draft/i,
  );
});

test("static provider searches manifest keywords as well as catalog metadata", async () => {
  const provider = new StaticProvider();
  const matches = await provider.search({ q: "geospatial" });
  assert.ok(matches.some((d) => d.slug === "world-boundaries"));
  assert.ok(matches.every((d) => matchesCatalogQuery(d, "geospatial")));
});

test("catalogue no longer includes culturalheritagenus records", async () => {
  const provider = new StaticProvider(undefined, "development");
  const datasets = await provider.listDatasets();
  assert.equal(
    datasets.some((dataset) => dataset.namespace === "culturalheritagenus"),
    false,
  );
});

test("budaya-lab repository is listed as metadata-only with its curated stage", async () => {
  const provider = new StaticProvider();
  const dataset = await provider.getDataset("budaya-lab", "ds-layout-um-v2");
  assert.ok(dataset);
  assert.equal(datasetHref(dataset), "/@budaya-lab/ds-layout-um-v2");
  assert.equal(isRestricted(dataset), true);
  assert.equal(dataset.file, undefined);
  assert.equal(dataset.resources, undefined);
  assert.equal(getDatasetStage(dataset), "curated");
  assert.deepEqual(dataset.sources, [
    {
      title: "GitHub repository (sign in for access)",
      path: "https://github.com/budaya-lab/ds-layout-um-v2",
      access: "restricted",
    },
  ]);
});

test("published Budaya Lab annotated dataset is visible in the production catalog", async () => {
  const provider = new StaticProvider();
  const dataset = await provider.getDataset(
    "budaya-lab",
    "ds-layout-um-v2-hirwan-atd",
  );
  assert.ok(dataset);
  assert.equal(dataset.draft, undefined);
  assert.equal(getDatasetStage(dataset), "annotated");
});

test("horizontal bar chart renders every category and value label", () => {
  const rows = parseCsv(
    readFileSync("public/data/ds-layout-um-v2-buckets.csv", "utf8"),
  ).rows;
  assert.equal(rows.length, 7);
  const markup = renderToStaticMarkup(
    createElement(Chart, {
      data: rows,
      type: "bar",
      barOrientation: "horizontal",
      x: "year",
      y: "count",
    }),
  );

  assert.equal((markup.match(/data-chart-row=/g) ?? []).length, rows.length);
  assert.match(markup, /data-axis-label="y"/);
  assert.match(markup, /data-axis-label="x"/);
  assert.equal((markup.match(/<button /g) ?? []).length, 7);
  assert.equal((markup.match(/role="tooltip" hidden=""/g) ?? []).length, 7);
  const tooltipIds = Array.from(
    markup.matchAll(/id="([^"]+)" role="tooltip"/g),
    (match) => match[1],
  );
  assert.equal(new Set(tooltipIds).size, 7);
  for (const id of tooltipIds) {
    assert.ok(markup.includes(`aria-describedby="${id}"`));
  }
  const widths = Array.from(
    markup.matchAll(/data-chart-bar="[^"]*"[^>]*style="width:([\d.]+)%/g),
    (match) => Number(match[1]),
  );
  assert.deepEqual(widths, [20, 20, 20, 20, 24, 100, 100]);
  assert.match(markup, /1962: count 10/);
  for (const { year, count } of rows) {
    assert.match(markup, new RegExp(`>${year}<`));
    assert.match(markup, new RegExp(`>${count}<`));
  }
});

test("Cartesian chart modes render category and value axes with React 19", () => {
  const data = parseCsv(
    readFileSync("public/data/ds-layout-um-v2-buckets.csv", "utf8"),
  ).rows.map((row) => ({ year: row.year, count: Number(row.count) }));
  for (const type of ["bar", "area", "line"] as const) {
    const markup = renderToStaticMarkup(
      createElement(ChartPlot, {
        rows: data,
        type,
        x: "year",
        yKeys: ["count"],
        width: 640,
        height: 320,
      }),
    );
    assert.match(markup, /recharts-xAxis/, `${type} has an X axis`);
    assert.match(markup, /recharts-yAxis/, `${type} has a Y axis`);
    for (const row of data) {
      assert.match(markup, new RegExp(`>${row.year}</tspan>`));
    }
    if (type === "bar") {
      const bars =
        markup.match(/<path[^>]*class="recharts-rectangle"[^>]*>/g) ?? [];
      assert.equal(bars.length, 7);
      const heights = bars.map((bar) =>
        Number(bar.match(/ height="([\d.]+)"/)?.[1]),
      );
      assert.ok(heights.every((height) => height > 0));
      assert.ok(Math.abs(heights[5] / heights[0] - 5) < 0.001);
    }
  }
});

test("overview chart appears only on the selected Budaya Lab showcase", async () => {
  const provider = new StaticProvider();
  const dataset = await provider.getDataset("budaya-lab", "ds-layout-um-v2");
  assert.ok(dataset);
  const render = (item: Dataset) =>
    renderToStaticMarkup(
      createElement(DatasetPage, {
        dataset: item,
        parents: [],
        resources: [],
        activity: [],
      }),
    );

  const targetMarkup = render(dataset);
  assert.match(targetMarkup, /horizontal bar chart of count by year/);
  assert.match(targetMarkup, /data-chart-type="bar"/);
  assert.match(targetMarkup, /data-bar-orientation="horizontal"/);
  assert.match(
    targetMarkup,
    /<h2 id="overview-chart-title" class="[^"]*font-sans/,
  );
  assert.doesNotMatch(targetMarkup, /<h3[^>]*>Record counts by year/);
  assert.doesNotMatch(render(tagged), /horizontal bar chart of count by year/);
});

test("a restricted source marks its dataset as restricted", () => {
  assert.equal(
    isRestricted({
      ...tagged,
      sources: [{ title: "Archive", access: "restricted" }],
    }),
    true,
  );
  assert.equal(isRestricted({ ...tagged, access: "restricted" }), true);
  assert.equal(isRestricted(tagged), false);
});

test("catalogue rejects unknown access labels rather than treating them as public", () => {
  assert.throws(
    () =>
      validateCatalogAccess([
        { ...tagged, access: "private" } as unknown as Dataset,
      ]),
    /invalid access/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...tagged,
          sources: [{ title: "Archive", access: "private" }],
        } as unknown as Dataset,
      ]),
    /invalid access/i,
  );
});

test("restricted catalogue records cannot contain downloadable resources", () => {
  const restricted: Dataset = {
    ...tagged,
    access: "restricted",
    file: "secret.csv",
    format: "csv",
    sources: [{ title: "Archive", path: "https://archive.example.org/login" }],
  };
  assert.throws(
    () => validateCatalogAccess([restricted]),
    /restricted.*resource/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...tagged,
          sources: [{ title: "Archive", access: "restricted" }],
          resources: [
            {
              name: "data",
              path: "https://example.org/secret.csv",
              format: "csv",
            },
          ],
        },
      ]),
    /restricted.*resource/i,
  );
  assert.doesNotThrow(() =>
    validateCatalogAccess([{ ...restricted, file: undefined }]),
  );
});

test("restricted sources require a safe public landing link, not a credential URL", () => {
  const restricted: Dataset = {
    ...tagged,
    access: "restricted",
    sources: [{ title: "Archive", path: "https://archive.example.org/login" }],
  };
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...restricted,
          sources: [
            {
              title: "Archive",
              path: "https://user:pass@archive.example.org/login",
            },
          ],
        },
      ]),
    /source link/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...restricted,
          sources: [{ title: "Archive", path: "javascript:alert(1)" }],
        },
      ]),
    /source link/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...restricted,
          sources: [
            {
              title: "Archive",
              path: "https://archive.example.org/login?token=secret",
            },
          ],
        },
      ]),
    /source link/i,
  );
  assert.throws(
    () => validateCatalogAccess([{ ...restricted, sources: [] }]),
    /source link/i,
  );
  assert.throws(
    () =>
      validateCatalogAccess([
        {
          ...tagged,
          sources: [{ title: "Bad link", path: "javascript:alert(1)" }],
        },
      ]),
    /source link/i,
  );
  assert.doesNotThrow(() => validateCatalogAccess([restricted]));
});

test("DCAT feed marks restricted source data as restricted public", () => {
  const dataset: Dataset = {
    ...tagged,
    sources: [
      {
        title: "Archive",
        path: "https://archive.example.org/login",
        access: "restricted",
      },
    ],
  };
  const node = toDCAT(dataset);
  assert.equal(node["dct:accessLevel"], "restricted public");
  assert.equal(node["dcat:distribution"], undefined);
});

test("restricted dataset page shows source access but no preview or download actions", () => {
  const dataset: Dataset = {
    ...tagged,
    access: "restricted",
    sources: [
      {
        title: "Protected archive",
        path: "https://archive.example.org/login",
        access: "restricted",
      },
    ],
  };
  const resource = {
    name: "secret",
    path: "https://archive.example.org/secret.csv",
    format: "csv" as const,
  };
  const html = renderToStaticMarkup(
    createElement(DatasetPage, {
      dataset,
      resources: [resource],
      activity: [],
    }),
  );
  assert.match(html, /Protected archive/);
  assert.match(html, /Restricted/);
  assert.match(html, /https:\/\/archive\.example\.org\/login/);
  assert.doesNotMatch(html, /https:\/\/archive\.example\.org\/secret\.csv/);
  assert.doesNotMatch(html, /Download &amp; API|Download csv|Copy URL|Preview/);
});

test("unmarked existing datasets retain their public resource display", () => {
  const dataset: Dataset = { ...tagged, file: "data.csv", format: "csv" };
  const resource = { name: "data", path: "data.csv", format: "csv" as const };
  const html = renderToStaticMarkup(
    createElement(DatasetPage, {
      dataset,
      resources: [resource],
      activity: [],
    }),
  );
  assert.match(html, /Download &amp; API/);
  assert.match(html, /\/data\/data\.csv/);
});

test("search result shows the controlled stage without exposing a raw keyword", () => {
  const html = renderToStaticMarkup(
    createElement(DatasetRow, {
      ds: { ...tagged, keywords: ["fieldwork", "stage:curated"] },
    }),
  );
  assert.match(html, /Curated dataset/);
  assert.doesNotMatch(html, /stage:curated/);
});

test("dataset showcase renders the stage and confirmed catalogue parent links", () => {
  const dataset: Dataset = {
    ...tagged,
    keywords: ["fieldwork", "stage:annotated"],
    derivedFrom: [{ namespace: "archives", slug: "master-record" }],
  };
  const parent: Dataset = {
    slug: "master-record",
    namespace: "archives",
    name: "Master collection",
  };
  const secondParent: Dataset = {
    slug: "second-master",
    namespace: "other-archives",
    name: "Second master collection",
  };
  const html = renderToStaticMarkup(
    createElement(DatasetPage, {
      dataset,
      parents: [parent, secondParent],
      resources: [],
      activity: [],
    }),
  );
  assert.match(html, /Annotated dataset/);
  assert.doesNotMatch(html, /stage:annotated/);
  assert.match(html, /Master collection/);
  assert.match(html, /href="\/@archives\/master-record"/);
  assert.match(html, /Second master collection/);
  assert.match(html, /href="\/@other-archives\/second-master"/);
});

test("dataset showcase displays a curated stage without inventing parent metadata", () => {
  const html = renderToStaticMarkup(
    createElement(DatasetPage, {
      dataset: { ...tagged, keywords: ["fieldwork", "stage:curated"], derivedFrom: [] },
      parents: [],
      resources: [],
      activity: [],
    }),
  );
  assert.match(html, /Curated dataset/);
  assert.doesNotMatch(html, /stage:curated|Derived from/);
});
