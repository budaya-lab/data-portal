import { constants, type Stats } from "node:fs";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MAX_BUCKET_BYTES,
  parseBuckets,
  validateBucketResource,
} from "../lib/buckets";
import { validateCatalogAccess } from "../lib/datasets";
import type { SyncPlan } from "./catalogue-sync";

async function inspect(root: string, relative: string): Promise<boolean> {
  let path = root;
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]);
    let stat: Stats;
    try {
      stat = await fs.lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error("Refusing a symlinked sync destination.");
    if (index === parts.length - 1) {
      if (!stat.isFile())
        throw new Error("Sync destination must be a regular file.");
      if (relative !== "datasets.json" && stat.size > MAX_BUCKET_BYTES)
        throw new Error("Existing bucket exceeds size limit.");
    } else if (!stat.isDirectory())
      throw new Error("Sync destination parent must be a directory.");
  }
  return true;
}

// The automated workflow uses a disposable checkout. Preflight the whole batch;
// any later write failure stops the workflow before branch/PR creation.
export async function writeCatalogueSync(
  root: string,
  current: string,
  plan: SyncPlan,
  apply: boolean,
): Promise<SyncPlan> {
  root = await fs.realpath(root);
  if (!(await inspect(root, "datasets.json")))
    throw new Error("Missing catalogue.");
  if ((await fs.readFile(join(root, "datasets.json"), "utf8")) !== current)
    throw new Error("Catalogue changed; rerun sync.");
  validateCatalogAccess(JSON.parse(plan.manifest));
  const result = {
    ...plan,
    changes: plan.changes.map((change) => ({
      ...change,
      fields: [...change.fields],
    })),
  };
  const writes: { path: string; bytes: Uint8Array; exists: boolean }[] = [];
  const destinations = new Set<string>();
  for (const bucket of plan.buckets) {
    validateBucketResource(bucket.resource);
    parseBuckets(bucket.bytes);
    const path = `public/data/${bucket.resource.path}`;
    if (destinations.has(path))
      throw new Error("Duplicate bucket destination.");
    destinations.add(path);
    const exists = await inspect(root, path);
    if (exists && !bucket.replace)
      throw new Error("Bucket destination collision needs review.");
    if (!exists && bucket.replace)
      throw new Error(
        "Existing catalogue bucket is missing; repair before syncing.",
      );
    if (
      exists &&
      Buffer.from(bucket.bytes).equals(await fs.readFile(join(root, path)))
    )
      continue;
    writes.push({ path, bytes: bucket.bytes, exists });
    let change = result.changes.find(
      (item) => item.repository === bucket.repository,
    );
    if (!change) {
      change = {
        repository: bucket.repository,
        kind: "updated",
        fields: [],
        warnings: bucket.warnings,
      };
      result.changes.push(change);
    }
    change.fields.push("public bucket summary");
  }
  if (!apply) return result;
  for (const write of writes) {
    const path = join(root, write.path);
    await fs.mkdir(dirname(path), { recursive: true });
    await inspect(root, write.path);
    const handle = await fs.open(
      path,
      write.exists ? constants.O_WRONLY | constants.O_NOFOLLOW : "wx",
    );
    try {
      if (write.exists) await handle.truncate(0);
      await handle.writeFile(write.bytes);
    } finally {
      await handle.close();
    }
  }
  if (plan.manifest !== current) {
    if ((await fs.readFile(join(root, "datasets.json"), "utf8")) !== current)
      throw new Error("Catalogue changed; rerun sync.");
    const handle = await fs.open(
      join(root, "datasets.json"),
      constants.O_WRONLY | constants.O_NOFOLLOW,
    );
    try {
      await handle.truncate(0);
      await handle.writeFile(plan.manifest);
    } finally {
      await handle.close();
    }
  }
  return result;
}
