import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SyncPlan } from "./catalogue-sync";
import { writeCatalogueSync } from "./write-catalogue-sync";

const current = "[]\n";
const bytes = Buffer.from("kind,count\nA,2\n");
const makePlan = (replace = false): SyncPlan => ({
  manifest: current,
  changes: [],
  failures: [],
  buckets: [
    {
      resource: {
        name: "buckets",
        path: "buckets/example/ds-example.csv",
        title: "Public bucket summary",
        format: "csv",
      },
      bytes,
      replace,
      repository: "example/ds-example",
      warnings: ["Review public labels and counts."],
    },
  ],
});
async function fixture(check: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "portal-sync-write-"));
  try {
    await writeFile(join(root, "datasets.json"), current);
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("sync dry run reports bucket differences without creating public files", async () => {
  await fixture(async (root) => {
    const result = await writeCatalogueSync(root, current, makePlan(), false);
    assert.equal(result.changes.length, 1);
    assert.ok(result.changes[0].fields.includes("public bucket summary"));
    assert.deepEqual(await readdir(root), ["datasets.json"]);
  });
});

test("sync writes verified summaries, updates owned files and is byte-idempotent", async () => {
  await fixture(async (root) => {
    await writeCatalogueSync(root, current, makePlan(), true);
    const path = join(root, "public/data/buckets/example/ds-example.csv");
    assert.deepEqual(await readFile(path), bytes);
    const repeated = await writeCatalogueSync(
      root,
      current,
      makePlan(true),
      true,
    );
    assert.equal(repeated.changes.length, 0);
    const plan = makePlan(true);
    plan.buckets[0].bytes = Buffer.from("kind,count\nA,9\n");
    assert.equal(
      (await writeCatalogueSync(root, current, plan, true)).changes.length,
      1,
    );
    assert.equal(await readFile(path, "utf8"), "kind,count\nA,9\n");
  });
});

test("sync refuses a new summary colliding with an unowned file", async () => {
  await fixture(async (root) => {
    await mkdir(join(root, "public/data/buckets/example"), { recursive: true });
    await writeFile(
      join(root, "public/data/buckets/example/ds-example.csv"),
      bytes,
    );
    await assert.rejects(
      writeCatalogueSync(root, current, makePlan(), true),
      /collision/i,
    );
  });
});

test("sync refuses symlinked catalogue files, parents and summary targets without touching external files", async () => {
  for (const target of [
    "datasets.json",
    "public",
    "public/data/buckets/example/ds-example.csv",
  ]) {
    await fixture(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), "portal-sync-outside-"));
      try {
        await writeFile(join(outside, "keep.csv"), "keep\n");
        if (target === "datasets.json") {
          await rm(join(root, target));
          await symlink(join(outside, "keep.csv"), join(root, target));
        } else if (target === "public")
          await symlink(outside, join(root, target));
        else {
          await mkdir(join(root, "public/data/buckets/example"), {
            recursive: true,
          });
          await symlink(join(outside, "keep.csv"), join(root, target));
        }
        await assert.rejects(
          writeCatalogueSync(root, current, makePlan(true), true),
          /symlink|regular/i,
        );
        assert.equal(
          await readFile(join(outside, "keep.csv"), "utf8"),
          "keep\n",
        );
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  }
});

test("preflight validates the entire batch and refuses concurrent catalogue edits", async () => {
  await fixture(async (root) => {
    const plan = makePlan();
    plan.buckets.push({
      ...plan.buckets[0],
      resource: { ...plan.buckets[0].resource, path: "second.csv" },
      bytes: Buffer.from("kind,count\nA,-1\n"),
    });
    await assert.rejects(
      writeCatalogueSync(root, current, plan, true),
      /buckets.csv/,
    );
    assert.deepEqual(await readdir(root), ["datasets.json"]);
    await writeFile(join(root, "datasets.json"), "[ ]\n");
    await assert.rejects(
      writeCatalogueSync(root, current, makePlan(), true),
      /changed/i,
    );
    assert.equal(await readFile(join(root, "datasets.json"), "utf8"), "[ ]\n");
  });
});
