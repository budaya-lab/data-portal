import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDataPackage } from "./data-package";

const descriptor = {
  name: "example-dataset",
  title: "Example dataset",
  description: "An example collection.",
  keywords: ["task:catalogue", "project:example", "stage:master"],
  resources: [
    {
      name: "records",
      title: "Records",
      path: "tables/records.csv",
      format: "csv",
    },
  ],
};

test("rejects unsafe and malformed Data Packages without exposing private resource names", () => {
  for (const change of [
    {
      resources: [
        { ...descriptor.resources[0], path: "internal/secret.csv?download=1" },
      ],
    },
    {
      resources: [
        { ...descriptor.resources[0], path: "internal/%2e%2e/secret.csv" },
      ],
    },
    { resources: [{ ...descriptor.resources[0], format: "CSV" }] },
    { keywords: [...descriptor.keywords, ...Array(20).fill("subject")] },
    { title: "github.com/budaya-lab/ds-example/blob/main/private.csv" },
    { created: "2000-01-01T00:00:00Z" },
    {
      licenses: [
        {
          name: "Private",
          path: "https://private.example/internal/secret.csv",
        },
      ],
    },
    {
      licenses: [
        {
          name: "CC0-1.0",
          path: "https://creativecommons.org/publicdomain/zero/1.0/?token=private",
        },
      ],
    },
    {
      licenses: [
        { path: "https://creativecommons.org/publicdomain/zero/1.0/" },
      ],
    },
  ]) {
    let error: unknown;
    try {
      parseDataPackage(JSON.stringify({ ...descriptor, ...change }));
    } catch (cause) {
      error = cause;
    }
    assert.ok(error instanceof Error);
    assert.doesNotMatch(
      error.message,
      /internal\/secret|secret\.csv|private\.example/,
    );
  }
});

test("accepts ground-truth packages and preserves subject keywords and resources", () => {
  const keywords = [
    "fieldwork",
    "task:catalogue",
    "project:example",
    "stage:ground-truth",
  ];
  const metadata = parseDataPackage(
    JSON.stringify({ ...descriptor, keywords }),
  );
  assert.deepEqual(metadata.keywords, keywords);
  assert.deepEqual(metadata.resources, descriptor.resources);
});

test("uses the released metadata policy rather than the former minimal onboarding contract", () => {
  assert.throws(
    () =>
      parseDataPackage(
        JSON.stringify({
          name: "example-dataset",
          title: "Example dataset",
          keywords: ["stage:master"],
          resources: [
            { name: "records", path: "tables/records.csv", format: "csv" },
          ],
        }),
      ),
    /Invalid datapackage\.json: does not meet Lazydata metadata policy/,
  );
});

test("shared validation failures never expose source resource names or paths", () => {
  assert.throws(
    () =>
      parseDataPackage(
        JSON.stringify({
          ...descriptor,
          resources: [
            {
              ...descriptor.resources[0],
              name: "internal-private-records",
              count: -1,
            },
          ],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(
        error.message,
        /Invalid datapackage\.json: does not meet Lazydata metadata policy/,
      );
      assert.doesNotMatch(
        error.message,
        /internal-private-records|tables\/records/,
      );
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test("accepts valid public-safe optional fields without inventing dates or sources", () => {
  const metadata = parseDataPackage(JSON.stringify(descriptor));
  assert.equal(metadata.created, undefined);
  assert.equal(metadata.licenses, undefined);
  assert.equal("contributors" in metadata, false);
});
