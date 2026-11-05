import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  type BucketData,
  MAX_BUCKET_BYTES,
  parseBuckets,
  validateBucketResource,
} from "./buckets";
import type { Resource } from "./providers/types";

export function validateBucketFiles(
  datasets: { resources?: Resource[] }[],
): void {
  for (const dataset of datasets) {
    for (const resource of dataset.resources ?? []) {
      if (resource.name === "buckets") readBucketFile(resource);
    }
  }
}

export function readBucketFile(
  resource: Resource,
  root = resolve("public/data"),
): BucketData {
  validateBucketResource(resource);
  let path = realpathSync(root);
  const parts = resource.path.split("/");
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink())
      throw new Error("Bucket path cannot contain symlinks");
    if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error("Bucket path must resolve to a regular file");
    }
  }
  const fd = openSync(path, "r");
  let bytes: Buffer;
  try {
    const buffer = Buffer.alloc(MAX_BUCKET_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    bytes = buffer.subarray(0, size);
  } finally {
    closeSync(fd);
  }
  const data = parseBuckets(bytes);
  if (
    resource.schema !== undefined &&
    (!Array.isArray(resource.schema.fields) ||
      resource.schema.fields.length !== 2 ||
      resource.schema.fields[0]?.name !== data.labelColumn ||
      resource.schema.fields[1]?.name !== "count")
  )
    throw new Error("Bucket schema fields must match the CSV headers");
  return data;
}
