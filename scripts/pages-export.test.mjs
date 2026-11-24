import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const config = require("../next.config.js");
const records = JSON.parse(readFileSync("datasets.json", "utf8"));

function html(path) {
  return readFileSync(join("out", path), "utf8");
}

test("Next.js exports directory routes for GitHub Pages", () => {
  assert.equal(config.output, "export");
  assert.equal(config.trailingSlash, true);
});

test("Pages artifact contains the portal, search, and a custom 404", () => {
  assert.match(
    html("index.html"),
    /<title\b[^>]*>Budaya Lab Data Portal<\/title>/,
  );
  assert.match(html("search/index.html"), /<title\b[^>]*>Search/);
  assert.match(html("404.html"), /404/);
});

test("Pages artifact contains published dataset routes, but no draft routes", () => {
  for (const record of records) {
    const route = join(`@${record.namespace}`, record.slug, "index.html");
    if (record.draft === true) {
      assert.equal(
        existsSync(join("out", route)),
        false,
        "Draft route must not be exported",
      );
    } else {
      assert.match(html(route), /<h1/);
    }
  }
});

test("every portal page includes one footer with the package version and navigation", () => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  const pages = [
    "index.html",
    "search/index.html",
    "404.html",
    ...records
      .filter((record) => record.draft !== true)
      .map((record) => join(`@${record.namespace}`, record.slug, "index.html")),
  ];

  for (const page of pages) {
    const document = html(page);
    const footers = [
      ...document.matchAll(/<footer\b[^>]*>([\s\S]*?)<\/footer>/g),
    ];
    assert.equal(footers.length, 1, `${page} must have one site footer`);
    const footer = footers[0][1];
    assert.ok(
      footer.replace(/<[^>]*>/g, "").includes(`v${version}`),
    );
    assert.match(footer, /aria-label="Footer"/);
    assert.match(footer, /href="\/search\/?"/);
    assert.match(footer, /href="https:\/\/budaya-lab\.org\/"/);
    assert.ok(document.indexOf("<footer") > document.lastIndexOf("</main>"));
  }
});

test("Pages artifact includes the custom domain, chart summary, and metadata feeds", () => {
  assert.equal(
    html("CNAME").trim(),
    readFileSync("public/CNAME", "utf8").trim(),
  );
  assert.equal(
    html("data/ds-layout-um-v2-buckets.csv"),
    readFileSync("public/data/ds-layout-um-v2-buckets.csv", "utf8"),
  );
  assert.ok(JSON.parse(html("catalog.jsonld")));
});

test("published bucket resources export their CSV, chart and download without changing dataset access", () => {
  for (const record of records.filter((item) => item.draft !== true)) {
    const bucket = record.resources?.find((resource) => resource.name === "buckets");
    if (!bucket) continue;
    assert.equal(html(`data/${bucket.path}`), readFileSync(join("public/data", bucket.path), "utf8"));
    const page = html(`@${record.namespace}/${record.slug}/index.html`);
    assert.match(page, /data-bar-orientation="horizontal"/);
    assert.ok(page.includes(`href="/data/${bucket.path}"`));
    if (record.access === "restricted") assert.match(page, /Restricted/);
    assert.ok(html("catalog.jsonld").includes(`/data/${bucket.path}`));
  }
});

test("published pages list private resource metadata without private download or preview URLs", () => {
  const feed = html("catalog.jsonld");
  for (const record of records.filter((item) => item.draft !== true)) {
    const resources = (record.resources ?? []).filter((resource) => resource.access === "restricted");
    if (!resources.length) continue;
    const page = html(`@${record.namespace}/${record.slug}/index.html`);
    const section = page.match(/<section\b[^>]*aria-label="Restricted resource metadata"[^>]*>[\s\S]*?<\/section>/)?.[0];
    assert.ok(section, record.slug);
    const text = section.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
    for (const resource of resources) {
      assert.ok(text.includes(resource.name), `${record.slug}/${resource.name}`);
      assert.equal(page.includes(`href="/data/${resource.path}"`), false);
      assert.equal(page.includes(`src="/data/${resource.path}"`), false);
      assert.equal(feed.includes(`/data/${resource.path}`), false);
    }
  }
});

const restrictedPaths = new Set(
  records.flatMap((record) =>
    (record.resources ?? [])
      .filter((resource) => resource.access === "restricted")
      .map((resource) => resource.path),
  ),
);

function assertNoPrivateResourceUrls(value) {
  if (typeof value === "string") {
    if (!/^(https?:\/\/|\/)/.test(value)) return;
    const path = decodeURIComponent(
      new URL(value, "https://portal.example").pathname,
    );
    if (!path.startsWith("/data/")) return;
    const localPath = path.slice("/data/".length);
    for (const restrictedPath of restrictedPaths) {
      assert.equal(
        localPath === restrictedPath ||
          (restrictedPath.endsWith("/") && localPath.startsWith(restrictedPath)),
        false,
        "Restricted metadata must not become a portal resource URL",
      );
    }
  } else if (value && typeof value === "object") {
    for (const child of Object.values(value)) assertNoPrivateResourceUrls(child);
  }
}

function searchHydration() {
  const script = html("search/index.html").match(
    /<script\b[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  assert.ok(script, "Search must contain its hydration payload");
  return JSON.parse(script[1]);
}

test("search keeps approved private metadata without private resource links or previews", () => {
  assert.ok(restrictedPaths.size > 0);
  const page = html("search/index.html").replace(
    /<script\b[^>]*>[\s\S]*?<\/script>/g,
    "",
  );
  const urls = [...page.matchAll(/(?:href|src)="([^"]*)"/g)].map(
    (match) => match[1],
  );
  assert.ok(urls.length > 0);
  assertNoPrivateResourceUrls(urls);

  const hydration = searchHydration();
  const request = JSON.parse(html(`_next/data/${hydration.buildId}/search.json`));
  const published = records.filter((record) => record.draft !== true);
  for (const props of [hydration.props.pageProps, request.pageProps]) {
    assert.deepEqual(
      props.datasets.map((record) => [record.namespace, record.slug]),
      published.map((record) => [record.namespace, record.slug]),
    );
    for (const record of published) {
      const served = props.datasets.find(
        (item) => item.namespace === record.namespace && item.slug === record.slug,
      );
      assert.deepEqual(served.resources, record.resources, record.slug);
    }
  }
});

test("all Next.js page-data payloads exclude portal URLs for restricted resources", () => {
  const hydration = searchHydration();
  assertNoPrivateResourceUrls(hydration);
  const directory = `_next/data/${hydration.buildId}`;
  const payloads = readdirSync(join("out", directory), { recursive: true }).filter(
    (path) => path.endsWith(".json"),
  );
  assert.ok(payloads.length > 0);
  for (const path of payloads) {
    assertNoPrivateResourceUrls(JSON.parse(html(join(directory, path))));
  }
});

test("resource URL guard rejects raw, encoded and nested private URLs but permits metadata references", () => {
  assert.throws(
    () => assertNoPrivateResourceUrls({ preview: { src: "/data/input.csv" } }),
    /Restricted metadata must not become a portal resource URL/,
  );
  assert.throws(
    () => assertNoPrivateResourceUrls("https://portal.example/data/%69nput.csv"),
    /Restricted metadata must not become a portal resource URL/,
  );
  assert.doesNotThrow(() =>
    assertNoPrivateResourceUrls({ path: "input.csv", access: "restricted" }),
  );
  const bucket = records
    .flatMap((record) => record.resources ?? [])
    .find((resource) => resource.name === "buckets");
  assert.ok(bucket);
  assert.doesNotThrow(() => assertNoPrivateResourceUrls(`/data/${bucket.path}`));
});

test("Exported pages reference bundled assets that exist at the domain root", () => {
  const pages = [
    "index.html",
    "search/index.html",
    "@budaya-lab/ds-layout-um-v2/index.html",
  ];
  for (const page of pages) {
    const assets = Array.from(
      html(page).matchAll(/(?:src|href)="(\/_next\/[^"?]+)(?:\?[^"]*)?"/g),
    );
    assert.ok(assets.length > 0, "Page must reference its application assets");
    for (const [, asset] of assets) {
      assert.ok(
        existsSync(join("out", decodeURIComponent(asset))),
        "Referenced application asset must be exported",
      );
    }
  }
});
