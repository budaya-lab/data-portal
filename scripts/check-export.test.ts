import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("./check-export.mjs", import.meta.url));

function checkExport(records: unknown[]): string {
  const directory = mkdtempSync(join(tmpdir(), "portal-export-summary-"));
  try {
    mkdirSync(join(directory, "out"));
    writeFileSync(join(directory, "datasets.json"), JSON.stringify(records));
    return execFileSync(process.execPath, [checker, "out"], {
      cwd: directory,
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("export summary separates private metadata from local and remote downloads", () => {
  const output = checkExport([
    {
      access: "restricted",
      resources: [
        { name: "input", path: "input.csv", access: "restricted" },
        { name: "annotations", path: "annotations/", access: "restricted" },
        { name: "buckets", path: "public-summary.csv" },
      ],
    },
    {
      access: "public",
      resources: [
        { name: "private", path: "private.csv", access: "restricted" },
        { name: "remote", path: "https://example.org/records.csv" },
        { name: "local", path: "public.csv" },
      ],
    },
    { file: "legacy.csv" },
  ]);
  assert.match(
    output,
    /4 downloadable resources \(1 remote, 3 local\); 3 restricted metadata-only listings/,
  );
  assert.doesNotMatch(output, /served from R2|inline/);
});

test("an entirely metadata-only catalogue reports no hosted downloads", () => {
  const output = checkExport([
    {
      access: "restricted",
      resources: [{ name: "input", path: "input.csv", access: "restricted" }],
    },
  ]);
  assert.match(
    output,
    /0 downloadable resources \(0 remote, 0 local\); 1 restricted metadata-only listings/,
  );
  assert.doesNotMatch(output, /served from R2|inline/);
});

test("export summary honours restricted sources as well as dataset access", () => {
  const output = checkExport([
    {
      sources: [{ access: "restricted" }],
      resources: [
        { name: "input", path: "input.csv", access: "restricted" },
        { name: "buckets", path: "summary.csv" },
      ],
    },
  ]);
  assert.match(
    output,
    /1 downloadable resources \(0 remote, 1 local\); 1 restricted metadata-only listings/,
  );
});
