// Portal config + presentation helpers for datasets.
//
// The DATA itself is read through the provider seam in lib/providers (so a
// backend can replace the static source without touching any page). This module
// holds only the provider-independent bits: the Dataset shape, the namespace
// mode, and the canonical URL helper.

import stageLabels from "../stage.config.json";
import { validateBucketResource } from "./buckets";
import type { Dataset, Resource } from "./providers";

export type {
  ActivityEntry,
  Dataset,
  DiffLine,
  Resource,
  ResourceVersion,
} from "./providers";

// A portal uses exactly ONE namespace mode. Set to 'theme' for a single-publisher
// portal (datasets grouped by subject) or 'owner' for a multi-publisher portal
// (datasets grouped by who published them). This only changes the showcase
// metadata label ("Theme" vs "Owner") — the URL is always /@<namespace>/<slug>.
export const NAMESPACE_TYPE: "theme" | "owner" = "owner";

// The compute engine for a dataset's data on its showcase page:
//   'duckdb' — load the file into in-browser DuckDB-Wasm and expose a SQL query
//              view (filter/aggregate/join over CSV/Parquet, no server). The
//              default: every portal ships the AI-native SQL editor out of the box.
//   'flat'   — fetch the file and preview it (papaparse). Lightest; downgrade to
//              this for trivial reference-only portals that never need querying.
// This is the "compute" slot on the storage+compute spectrum (see ROADMAP.md).
// The duckdb-wasm chunk loads on-demand in the browser only when a query view
// renders, so first-load cost is deferred. `/portaljs-architect` may downgrade to
// 'flat' for preview-only portals but otherwise leaves this default in place.
export const DATA_QUERY: "flat" | "duckdb" = "duckdb";

// Client-side catalog search and the static provider share the same metadata fields.
export function matchesCatalogQuery(d: Dataset, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    d.name,
    d.namespace,
    d.description,
    d.category,
    ...(d.keywords ?? []),
  ].some((value) => value?.toLowerCase().includes(q));
}

export function publishedDatasets<T extends { draft?: boolean }>(
  datasets: T[],
): T[] {
  return datasets.filter((dataset) => dataset.draft !== true);
}

export function isDraft(d: Dataset): boolean {
  return d.draft === true;
}

export type DatasetStage = keyof typeof stageLabels;

const configuredStages = Object.entries(stageLabels);
if (configuredStages.length === 0 || configuredStages.some(([name, label]) =>
  !/^[a-z][a-z0-9-]*$/.test(name) || typeof label !== "string" || !label.trim()
)) {
  throw new Error("Invalid stage.config.json: expected nonempty stage names and labels");
}

export function getDatasetStage(d: Dataset): DatasetStage | undefined {
  if (d.keywords === undefined) return undefined;
  if (!Array.isArray(d.keywords) || d.keywords.some((keyword) => typeof keyword !== "string")) {
    throw new Error(`Invalid keywords for dataset ${d.namespace}/${d.slug}`);
  }
  const stages = d.keywords.filter((keyword) => keyword.startsWith("stage:"));
  if (stages.length > 1) {
    throw new Error(`Invalid stage keywords for dataset ${d.namespace}/${d.slug}`);
  }
  const keyword = stages[0];
  if (keyword === undefined) return undefined;
  const stage = keyword.slice("stage:".length);
  if (!Object.hasOwn(stageLabels, stage)) {
    throw new Error(`Invalid stage keyword for dataset ${d.namespace}/${d.slug}`);
  }
  return stage as DatasetStage;
}

export function stageLabel(d: Dataset): string | undefined {
  const stage = getDatasetStage(d);
  return stage === undefined ? undefined : stageLabels[stage];
}

export function subjectKeywords(d: Dataset): string[] {
  return (d.keywords ?? []).filter((keyword) => !keyword.startsWith("stage:"));
}

export type KeywordFacet = "task" | "stage" | "project" | "keywords";

export function keywordFacetValues(d: Dataset, facet: KeywordFacet): string[] {
  const keywords = d.keywords ?? [];
  if (facet === "keywords") {
    return keywords.filter(
      (keyword) =>
        !keyword.startsWith("task:") &&
        !keyword.startsWith("stage:") &&
        !keyword.startsWith("project:"),
    );
  }
  return keywords.filter((keyword) => keyword.startsWith(`${facet}:`));
}

export function isRestricted(d: Dataset): boolean {
  return (
    d.access === "restricted" ||
    d.sources?.some((s) => s.access === "restricted") === true
  );
}

function validateRestrictedResource(resource: Resource): void {
  const allowedKeys = new Set(["name", "title", "description", "path", "format", "count", "access"]);
  const path = resource.path;
  if (
    resource.name === "buckets" ||
    typeof resource.name !== "string" || !resource.name.trim() ||
    typeof resource.title !== "string" || !resource.title.trim() ||
    (resource.description !== undefined && (typeof resource.description !== "string" || !resource.description.trim())) ||
    typeof resource.format !== "string" || !/^[a-z][a-z0-9-]*$/.test(resource.format) ||
    typeof path !== "string" || /[\\:?#%]/.test(path) || path.startsWith("~") ||
    Array.from(path).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    path.replace(/\/$/, "").split("/").some((part) => !part || part.startsWith(".")) ||
    (resource.format === "directory") !== path.endsWith("/") ||
    Object.keys(resource).some((key) => !allowedKeys.has(key))
  ) throw new Error("Restricted resource listings need reviewed relative metadata paths, titles and formats, without download or preview fields");
}

// A public static export cannot enforce source access. Explicit restricted
// resource metadata is listable, but only public resources may expose bytes.
export function validateCatalogAccess(datasets: Dataset[]): void {
  const byId = new Map<string, Dataset>();
  for (const d of datasets) {
    const id = JSON.stringify([d.namespace, d.slug]);
    if (byId.has(id)) {
      throw new Error(`Duplicate dataset identity ${d.namespace}/${d.slug}`);
    }
    byId.set(id, d);
  }

  const parentsById = new Map<string, string[]>();
  for (const d of datasets) {
    if (d.draft !== undefined && typeof d.draft !== "boolean") {
      throw new Error(`Invalid draft for dataset ${d.namespace}/${d.slug}`);
    }
    getDatasetStage(d);
    if (Object.hasOwn(d, "role")) {
      throw new Error(`Catalogue role is unsupported for dataset ${d.namespace}/${d.slug}; use a stage: keyword`);
    }
    const id = JSON.stringify([d.namespace, d.slug]);
    if (d.derivedFrom !== undefined && !Array.isArray(d.derivedFrom)) {
      throw new Error(
        `Invalid parent references for dataset ${d.namespace}/${d.slug}`,
      );
    }
    const parentIds: string[] = [];
    const seenParents = new Set<string>();
    for (const parent of d.derivedFrom ?? []) {
      if (
        !parent ||
        Object.keys(parent).some(
          (key) => key !== "namespace" && key !== "slug",
        ) ||
        typeof parent.namespace !== "string" ||
        !parent.namespace.trim() ||
        typeof parent.slug !== "string" ||
        !parent.slug.trim()
      ) {
        throw new Error(
          `Invalid parent reference for dataset ${d.namespace}/${d.slug}`,
        );
      }
      const parentId = JSON.stringify([parent.namespace, parent.slug]);
      if (seenParents.has(parentId)) {
        throw new Error(
          `Duplicate parent reference for dataset ${d.namespace}/${d.slug}`,
        );
      }
      seenParents.add(parentId);
      if (!byId.has(parentId)) {
        throw new Error(
          `Unknown parent ${parent.namespace}/${parent.slug} for dataset ${d.namespace}/${d.slug}`,
        );
      }
      parentIds.push(parentId);
    }
    parentsById.set(id, parentIds);
    if (
      d.access !== undefined &&
      d.access !== "public" &&
      d.access !== "restricted"
    ) {
      throw new Error(`Invalid access for dataset ${d.namespace}/${d.slug}`);
    }
    if (
      d.sources?.some(
        (s) =>
          s.access !== undefined &&
          s.access !== "public" &&
          s.access !== "restricted",
      )
    ) {
      throw new Error(
        `Invalid access for source of dataset ${d.namespace}/${d.slug}`,
      );
    }
    if (d.resources !== undefined && !Array.isArray(d.resources)) {
      throw new Error(`Invalid resources for dataset ${d.namespace}/${d.slug}`);
    }
    for (const resource of d.resources ?? []) {
      if (!resource || typeof resource !== "object") throw new Error("Invalid resource metadata");
      if (resource.access !== undefined && resource.access !== "public" && resource.access !== "restricted") {
        throw new Error("Invalid resource access");
      }
      if (resource.count !== undefined && (!Number.isSafeInteger(resource.count) || resource.count < 0)) {
        throw new Error("Invalid resource count");
      }
      if (resource.access === "restricted") validateRestrictedResource(resource);
    }
    const buckets = (d.resources ?? []).filter((resource) => resource?.name === "buckets");
    if (buckets.length > 1) throw new Error("Only one bucket resource is allowed per dataset");
    for (const resource of buckets) validateBucketResource(resource);
    const restricted = isRestricted(d);
    if (restricted && (d.file || d.resources?.some((resource) => resource?.name !== "buckets" && resource.access !== "restricted"))) {
      throw new Error(
        `Restricted dataset ${d.namespace}/${d.slug} cannot have resources in a public catalog`,
      );
    }
    if (restricted && !d.sources?.some((s) => s.path)) {
      throw new Error(
        `Restricted dataset ${d.namespace}/${d.slug} needs a source link`,
      );
    }
    for (const source of d.sources ?? []) {
      if (!source.path) continue;
      let url: URL;
      try {
        url = new URL(source.path);
      } catch {
        throw new Error(
          `Invalid source link for dataset ${d.namespace}/${d.slug}`,
        );
      }
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        (restricted && (url.protocol !== "https:" || url.search || url.hash))
      ) {
        throw new Error(
          `Invalid source link for dataset ${d.namespace}/${d.slug}: use a credential-free HTTP(S) landing page (HTTPS without query or fragment for restricted sources)`,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id))
      throw new Error(`Catalogue lineage cycle involving ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parentId of parentsById.get(id) ?? []) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Array.from(parentsById.keys())) visit(id);
}

// Canonical URL for a dataset's showcase page. Datasets are namespaced under `@`
// so they never collide with regular content/static pages (which never start
// with `@`). See README for the routing rationale.
export function datasetHref(d: Dataset): string {
  return `/@${d.namespace}/${d.slug}`;
}

// Normalize a dataset to its resource list. A multi-resource dataset returns its
// `resources` as-is; a single-file dataset is presented as one synthesized
// resource (from `file`/`format`/`schema`) so every surface renders datasets
// uniformly — there's no single-vs-multi branching at the call site.
export function getResources(d: Dataset): Resource[] {
  if (d.resources && d.resources.length > 0) return d.resources;
  if (d.file) {
    const resource: Resource = {
      name: "data",
      path: d.file,
      format: d.format ?? "csv",
      title: d.name,
    };
    // Only attach schema when present — an `undefined` field can't be serialized
    // through getStaticProps once the resource is baked into static props.
    if (d.schema) resource.schema = d.schema;
    return [resource];
  }
  return [];
}

export function getDownloadableResources(d: Dataset): Resource[] {
  return getResources(d).filter((resource) =>
    resource.access !== "restricted" && (!isRestricted(d) || resource.name === "buckets"),
  );
}

// Public URL of a resource's raw file. A relative `path` is served statically from
// /public/data; an absolute path is returned as-is, so a resource can point at a remote
// file (e.g. a CKAN/DCAT download URL harvested by /portaljs-migrate) or a site-root path without
// copying bytes into the repo.
export function resourceUrl(r: Resource): string {
  if (r.access === "restricted") throw new Error("Restricted resources have no download URL");
  if (/^(https?:)?\/\//.test(r.path) || r.path.startsWith("/")) return r.path;
  return `/data/${r.path}`;
}

// Human-readable label for a resource in the file list. `path` can be an R2/LFS
// URL whose basename is a 64-hex content id (data.portaljs.com/lfs/<org>/<slug>/<oid>)
// — meaningless and very long, so never render it raw. Prefer the resource title,
// then a real-looking filename basename, then the resource name, and only fall
// back to a generic "Download <format>" label.
export function resourceLabel(r: Resource): string {
  if (r.title) return r.title;
  const base = (r.path.split(/[?#]/)[0].split("/").pop() ?? "").trim();
  const isOid = /^[0-9a-f]{64}$/i.test(base);
  if (base && !isOid && /\.[a-z0-9]{1,6}$/i.test(base)) return base;
  return r.name || `Download ${r.format}`;
}

export type StructuredKeywordKind = "task" | "stage" | "project";
export type KeywordPresentation = {
  label: string;
  kind?: StructuredKeywordKind;
};

export function keywordPresentation(keyword: string): KeywordPresentation {
  for (const kind of ["task", "stage", "project"] as const) {
    const prefix = `${kind}:`;
    if (keyword.startsWith(prefix)) {
      return { label: keyword.slice(prefix.length), kind };
    }
  }
  return { label: keyword };
}

// Derive keyword cards and record counts from all catalogue keywords.
export type KeywordCount = {
  keyword: string;
  count: number;
  kind?: StructuredKeywordKind;
};

export function keywordCounts(datasets: Dataset[]): KeywordCount[] {
  const counts = new Map<string, KeywordCount>();
  for (const dataset of datasets) {
    const seen = new Set<string>();
    for (const keyword of dataset.keywords ?? []) {
      const key = keyword.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        const { kind } = keywordPresentation(keyword);
        counts.set(key, { keyword, count: 1, ...(kind && { kind }) });
      }
    }
  }
  return Array.from(counts.values()).sort(
    (a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword),
  );
}
