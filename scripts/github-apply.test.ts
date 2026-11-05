import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseDataPackage } from "./data-package";
import {
  applyCandidates,
  buildCandidate,
  type Repository,
} from "./github-repositories";

const source: Repository = {
  name: "ds-example",
  full_name: "example/ds-example",
  owner: { login: "example" },
  html_url: "https://github.com/example/ds-example",
  description: null,
  private: true,
  default_branch: "main",
};
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bucket-apply-"));
  mkdirSync(join(root, "public/data"), { recursive: true });
  writeFileSync(join(root, "datasets.json"), "[]\n");
  const metadata = {
    ...parseDataPackage(
      JSON.stringify({
        name: "example",
        title: "Example",
        keywords: ["stage:master"],
        resources: [{ name: "data", path: "private.csv" }],
      }),
    ),
    bucketFile: {
      bytes: Buffer.from("kind,count\n001,0\nA,2\n"),
      ref: "v1.0.0",
    },
  };
  return {
    root,
    metadata,
    candidate: buildCandidate(source, "example", metadata),
  };
}

test("dry run and cancelled apply do not write public files or catalogue records", async () => {
  const { root, metadata, candidate } = fixture();
  try {
    let prompts = 0;
    const confirm = async () => {
      prompts++;
      return false;
    };
    assert.equal(
      await applyCandidates([candidate], [metadata], {
        root,
        apply: false,
        confirm,
      }),
      0,
    );
    assert.equal(prompts, 0);
    await assert.rejects(
      applyCandidates([candidate], [metadata], { root, apply: true, confirm }),
      /cancelled/i,
    );
    assert.equal(prompts, 1);
    assert.equal(readFileSync(join(root, "datasets.json"), "utf8"), "[]\n");
    assert.deepEqual(readdirSync(join(root, "public/data")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("metadata-only imports still append drafts without copying files", async () => {
  const { root, metadata } = fixture();
  const metadataOnly = { ...metadata, bucketFile: undefined };
  const candidate = buildCandidate(source, "example", metadataOnly);
  try {
    assert.equal(
      await applyCandidates([candidate], [metadataOnly], {
        root,
        apply: true,
        confirm: async () => true,
      }),
      1,
    );
    const records = JSON.parse(
      readFileSync(join(root, "datasets.json"), "utf8"),
    );
    assert.equal(records[0].resources, undefined);
    assert.equal(records[0].access, "restricted");
    assert.deepEqual(readdirSync(join(root, "public/data")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("confirmed apply copies only new namespace-scoped summaries and remains idempotent", async () => {
  const { root, metadata, candidate } = fixture();
  const other = buildCandidate(
    { ...source, owner: { login: "other" }, full_name: "other/ds-example" },
    "other",
    metadata,
  );
  try {
    const options = { root, apply: true, confirm: async () => true };
    assert.equal(
      await applyCandidates([candidate, other], [metadata, metadata], options),
      2,
    );
    for (const namespace of ["example", "other"]) {
      assert.deepEqual(
        readFileSync(
          join(root, `public/data/buckets/${namespace}/ds-example.csv`),
        ),
        metadata.bucketFile.bytes,
      );
    }
    const records = JSON.parse(
      readFileSync(join(root, "datasets.json"), "utf8"),
    );
    assert.equal(records.length, 2);
    assert.ok(
      records.every(
        (record: { draft: boolean; access: string }) =>
          record.draft && record.access === "restricted",
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(records),
      /private.csv|bytes|bucketFile/,
    );
    const snapshot = readFileSync(join(root, "datasets.json"), "utf8");
    assert.equal(await applyCandidates([candidate], [metadata], options), 0);
    assert.equal(readFileSync(join(root, "datasets.json"), "utf8"), snapshot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("collisions or a symlinked destination refuse the entire batch before copying", async () => {
  for (const link of [false, true]) {
    const { root, metadata, candidate } = fixture();
    const other = buildCandidate(
      { ...source, owner: { login: "other" }, full_name: "other/ds-example" },
      "other",
      metadata,
    );
    try {
      mkdirSync(join(root, "public/data/buckets"));
      if (link) symlinkSync(root, join(root, "public/data/buckets/other"));
      else {
        mkdirSync(join(root, "public/data/buckets/other"));
        writeFileSync(
          join(root, "public/data/buckets/other/ds-example.csv"),
          "do not overwrite\n",
        );
      }
      await assert.rejects(
        applyCandidates([candidate, other], [metadata, metadata], {
          root,
          apply: true,
          confirm: async () => true,
        }),
        /exist|collision|symlink/i,
      );
      assert.equal(readFileSync(join(root, "datasets.json"), "utf8"), "[]\n");
      assert.deepEqual(readdirSync(join(root, "public/data/buckets")), [
        "other",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("invalid later summaries fail before any catalogue or public-data writes", async () => {
  const { root, metadata, candidate } = fixture();
  const other = buildCandidate(
    { ...source, owner: { login: "other" } },
    "other",
    metadata,
  );
  try {
    await assert.rejects(
      applyCandidates(
        [candidate, other],
        [
          metadata,
          {
            ...metadata,
            bucketFile: {
              ...metadata.bucketFile,
              bytes: Buffer.from("kind,count\nA,-1"),
            },
          },
        ],
        { root, apply: true, confirm: async () => true },
      ),
      /buckets.csv/,
    );
    assert.deepEqual(readdirSync(join(root, "public/data")), []);
    assert.equal(readFileSync(join(root, "datasets.json"), "utf8"), "[]\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed catalogue rename removes only newly created summaries", async (context) => {
  const { root, metadata, candidate } = fixture();
  try {
    writeFileSync(join(root, "public/data/keep.csv"), "keep\n");
    context.mock.method(fs, "rename", async () => {
      throw new Error("simulated rename failure");
    });
    await assert.rejects(
      applyCandidates([candidate], [metadata], {
        root,
        apply: true,
        confirm: async () => true,
      }),
      /simulated rename failure/,
    );
    assert.equal(readFileSync(join(root, "datasets.json"), "utf8"), "[]\n");
    assert.equal(
      readFileSync(join(root, "public/data/keep.csv"), "utf8"),
      "keep\n",
    );
    assert.deepEqual(
      readdirSync(join(root, "public/data/buckets/example")),
      [],
    );
    assert.deepEqual(readdirSync(root).sort(), ["datasets.json", "public"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
