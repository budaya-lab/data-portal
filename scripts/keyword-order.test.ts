import assert from "node:assert/strict";
import { test } from "node:test";
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";
import type { NextRouter } from "next/router";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Dataset } from "../lib/datasets";
import { keywordCounts } from "../lib/datasets";
import Home from "../pages";
import Search from "../pages/search";

const router = {
  isReady: true,
  query: {},
  push: async () => true,
} as unknown as NextRouter;

const datasets: Dataset[] = [
  {
    namespace: "example",
    slug: "one",
    name: "One",
    keywords: ["stage:curated", "fieldwork", "task:layout", "project:Jawi"],
  },
  {
    namespace: "example",
    slug: "two",
    name: "Two",
    keywords: ["task:article", "project:archive", "oral history"],
  },
];

test("landing-page keyword cards group project, task, stage, then other keywords", () => {
  const keywords = keywordCounts(datasets);
  assert.deepEqual(
    keywords.map(({ keyword }) => keyword),
    [
      "project:archive",
      "project:Jawi",
      "task:article",
      "task:layout",
      "stage:curated",
      "fieldwork",
      "oral history",
    ],
  );

  const markup = renderToStaticMarkup(
    createElement(
      RouterContext.Provider,
      { value: router },
      createElement(Home, { keywords }),
    ),
  );
  const positions = keywords.map(({ keyword }) =>
    markup.indexOf(`/search?q=${encodeURIComponent(keyword)}`),
  );
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
});

test("search keyword facets appear in project, task, stage, other order", () => {
  const markup = renderToStaticMarkup(
    createElement(
      RouterContext.Provider,
      { value: router },
      createElement(Search, { datasets }),
    ),
  );
  const headings = ["Project", "Task", "Stage", "Other keywords"].map((title) =>
    markup.indexOf(`>${title}</h2>`),
  );
  assert.ok(headings.every((position) => position >= 0));
  assert.deepEqual(
    headings,
    [...headings].sort((a, b) => a - b),
  );
});
