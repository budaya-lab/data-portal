import { randomUUID } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseBuckets, validateBucketResource } from "../lib/buckets";
import type { Resource } from "../lib/providers/types";

type BucketWrite = { resource: Resource; bytes: Uint8Array };

async function checkDestination(root: string, path: string): Promise<void> {
  let target = root;
  const parts = ["public", "data", ...path.split("/")];
  for (let index = 0; index < parts.length; index++) {
    target = join(target, parts[index]);
    let stat: Stats;
    try {
      stat = await fs.lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error("Refusing a symlinked bucket destination.");
    if (index === parts.length - 1)
      throw new Error(
        "Bucket destination already exists; review the collision.",
      );
    if (!stat.isDirectory())
      throw new Error("Bucket destination parent must be a directory.");
  }
}

export async function writeGitHubImport(
  root: string,
  current: string,
  updated: string,
  buckets: BucketWrite[],
): Promise<void> {
  root = await fs.realpath(resolve(root));
  const manifest = join(root, "datasets.json");
  const manifestStat = await fs.lstat(manifest);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink())
    throw new Error("Catalogue must be a regular non-symlink file.");
  if ((await fs.readFile(manifest, "utf8")) !== current)
    throw new Error("Catalogue changed; rerun the import.");
  const destinations = new Set<string>();
  for (const { resource, bytes } of buckets) {
    validateBucketResource(resource);
    parseBuckets(bytes);
    if (destinations.has(resource.path))
      throw new Error("Duplicate bucket destination.");
    destinations.add(resource.path);
    await checkDestination(root, resource.path);
  }
  const created: { path: string; ino: number; dev: number }[] = [];
  const create = async (path: string, content: string | Uint8Array) => {
    const handle = await fs.open(path, "wx");
    try {
      const { ino, dev } = await handle.stat();
      created.push({ path, ino, dev });
      await handle.writeFile(content);
    } finally {
      await handle.close();
    }
  };
  try {
    for (const { resource, bytes } of buckets) {
      const path = join(root, "public/data", resource.path);
      await fs.mkdir(dirname(path), { recursive: true });
      await checkDestination(root, resource.path);
      await create(path, bytes);
    }
    const temporary = `${manifest}.${randomUUID()}.tmp`;
    await create(temporary, updated);
    if ((await fs.readFile(manifest, "utf8")) !== current)
      throw new Error("Catalogue changed; rerun the import.");
    await fs.rename(temporary, manifest);
  } catch (error) {
    const failures = [error];
    for (const file of created.reverse()) {
      try {
        const stat = await fs.lstat(file.path);
        if (
          stat.isSymbolicLink() ||
          stat.ino !== file.ino ||
          stat.dev !== file.dev
        )
          throw new Error(
            "Refusing to remove a file no longer owned by this import.",
          );
        await fs.unlink(file.path);
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        "Import failed and cleanup needs review.",
      );
    throw error;
  }
}
