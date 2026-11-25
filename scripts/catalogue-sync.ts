import { isDeepStrictEqual } from "node:util";
import { parseBuckets, validateBucketResource } from "../lib/buckets";
import {
  type Dataset,
  isRestricted,
  validateCatalogAccess,
} from "../lib/datasets";
import type { Resource } from "../lib/providers/types";
import {
  type ExtractedMetadata,
  RepositoryValidationError,
} from "./data-package";
import {
  buildCandidate,
  canonicalLandingUrl,
  type Repository,
} from "./github-repositories";

export type SyncInput = { repo: Repository; metadata: ExtractedMetadata };
export type BucketWrite = {
  resource: Resource;
  bytes: Uint8Array;
  replace: boolean;
  repository: string;
  warnings: string[];
};
export type SyncChange = {
  repository: string;
  kind: "added" | "updated";
  fields: string[];
  warnings: string[];
};
export type SyncPlan = {
  manifest: string;
  buckets: BucketWrite[];
  changes: SyncChange[];
  failures: { repository: string; reason: string }[];
};

const formats = new Set<Resource["format"]>([
  "csv",
  "tsv",
  "json",
  "geojson",
  "parquet",
  "pmtiles",
  "geoparquet",
  "xml",
  "yaml",
  "ipynb",
  "directory",
]);

function restrictedResources(metadata: ExtractedMetadata): Resource[] {
  return metadata.resources
    .filter((item) => item.path !== "buckets.csv")
    .map((item) => {
      if (typeof item.path !== "string")
        throw new RepositoryValidationError(
          "Restricted resource metadata needs review.",
        );
      const format =
        item.path.endsWith("/") &&
        (item.format === undefined || item.format === "dir")
          ? "directory"
          : (item.format ?? item.path.split(".").pop());
      if (!formats.has(format as Resource["format"]))
        throw new RepositoryValidationError(
          "Restricted resource metadata needs review.",
        );
      return {
        name: item.name,
        title: item.title,
        path: item.path,
        format: format as Resource["format"],
        ...(item.count === undefined ? {} : { count: item.count }),
        access: "restricted",
      };
    });
}

export function planCatalogueSync(
  current: string,
  inputs: SyncInput[],
  namespace: string,
): SyncPlan {
  const records: Dataset[] = JSON.parse(current);
  if (!Array.isArray(records))
    throw new Error("datasets.json must contain a JSON array.");
  validateCatalogAccess(records);
  const buckets = new Map<string, string>();
  for (const record of records) {
    for (const resource of record.resources ?? []) {
      if (resource.name !== "buckets") continue;
      if (buckets.has(resource.path))
        throw new Error("Shared bucket destination needs manual review.");
      buckets.set(resource.path, `${record.namespace}/${record.slug}`);
    }
  }
  const result: SyncPlan = {
    manifest: current,
    buckets: [],
    changes: [],
    failures: [],
  };
  const seen = new Set<string>();
  const targets = new Set<string>();
  for (const { repo, metadata } of inputs) {
    const candidate = buildCandidate(repo, namespace, metadata);
    const source = canonicalLandingUrl(candidate.sources[0].path);
    if (!source || seen.has(source))
      throw new Error("Ambiguous repository identity in sync input.");
    seen.add(source);
    const matches = records.filter((record) =>
      record.sources?.some((item) => canonicalLandingUrl(item.path) === source),
    );
    if (matches.length > 1)
      throw new Error(
        "Ambiguous catalogue source match; resolve before syncing.",
      );
    const existing = matches[0];
    if (
      !existing &&
      records.some(
        (record) =>
          record.namespace === namespace && record.slug === candidate.slug,
      )
    )
      throw new Error("Catalogue identity collision; resolve before syncing.");
    const id = existing ?? candidate;
    const target = `${id.namespace}/${id.slug}`;
    if (targets.has(target))
      throw new Error(
        "Ambiguous catalogue target; multiple repositories map to one record.",
      );
    targets.add(target);
    const bucket = existing?.resources?.find(
      (resource) => resource.name === "buckets",
    );
    const warnings = [...(metadata.review ?? [])];
    const updated: Dataset = existing ? { ...existing } : { ...candidate };
    updated.name = candidate.name;
    updated.description = candidate.description;
    updated.keywords = candidate.keywords;
    updated.licenses = candidate.licenses;
    // Source dates are provenance, not scan timestamps. Preserve reviewed dates.
    if (!existing && candidate.created) updated.created = candidate.created;
    updated.access = candidate.access;
    updated.sources = existing
      ? existing.sources?.map((item) =>
          canonicalLandingUrl(item.path) === source
            ? candidate.sources[0]
            : item,
        )
      : candidate.sources;
    delete updated.file;
    delete updated.format;
    try {
      const resources =
        candidate.access === "restricted"
          ? restrictedResources(metadata)
          : (metadata.verifiedResources ?? []).map((resource) => {
              const declared = metadata.resources.find(
                (item) => item.name === resource.name,
              );
              return {
                ...resource,
                ...(declared?.count === undefined
                  ? {}
                  : { count: declared.count }),
              };
            });
      const summary = metadata.bucketFile
        ? (bucket ?? {
            name: "buckets",
            title: "Public bucket summary",
            format: "csv" as const,
            path: `buckets/${id.namespace}/${id.slug}.csv`,
          })
        : bucket;
      if (summary) {
        validateBucketResource(summary);
        resources.unshift(summary);
        if (!metadata.bucketFile)
          warnings.push(
            "Existing public summary preserved; no verified replacement available.",
          );
      }
      if (metadata.bucketFile) parseBuckets(metadata.bucketFile.bytes);
      updated.resources = resources.length ? resources : undefined;
      const index = existing ? records.indexOf(existing) : records.length;
      const prospective = [...records];
      prospective[index] = updated;
      try {
        validateCatalogAccess(prospective);
      } catch (cause) {
        throw new RepositoryValidationError(
          "Mapped catalogue metadata needs review; repository unchanged.",
          { cause },
        );
      }
      if (summary && metadata.bucketFile) {
        const owner = buckets.get(summary.path);
        if (owner && owner !== `${id.namespace}/${id.slug}`)
          throw new Error("Shared bucket destination needs manual review.");
        buckets.set(summary.path, `${id.namespace}/${id.slug}`);
        result.buckets.push({
          resource: summary,
          bytes: metadata.bucketFile.bytes,
          replace: !!bucket,
          repository: repo.full_name,
          warnings,
        });
      }
      const fields = Object.keys(updated).filter(
        (field) =>
          !isDeepStrictEqual(
            existing?.[field as keyof Dataset],
            updated[field as keyof Dataset],
          ),
      );
      for (const field of Object.keys(existing ?? {}))
        if (!(field in updated)) fields.push(field);
      if (
        existing &&
        (existing.access !== updated.access ||
          isRestricted(existing) !== isRestricted(updated))
      )
        warnings.push(
          "Access classification changed; explicit review required.",
        );
      if (
        candidate.access === "restricted" &&
        (!existing ||
          !isDeepStrictEqual(
            existing.resources?.filter(
              (resource) => resource.name !== "buckets",
            ),
            resources.filter((resource) => resource.name !== "buckets"),
          ))
      )
        warnings.push(
          "Restricted resource metadata changed; explicit review required. No restricted bytes were read.",
        );
      if (fields.length || !existing)
        result.changes.push({
          repository: repo.full_name,
          kind: existing ? "updated" : "added",
          fields,
          warnings,
        });
      records[index] = updated;
    } catch (error) {
      if (!(error instanceof RepositoryValidationError)) throw error;
      result.failures.push({
        repository: repo.full_name,
        reason: error.message,
      });
    }
  }
  if (result.changes.length)
    result.manifest = `${JSON.stringify(records, null, 2)}\n`;
  return result;
}
