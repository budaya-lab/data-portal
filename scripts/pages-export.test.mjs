import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
