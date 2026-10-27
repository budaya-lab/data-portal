import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const driver = new URL(
  process.env.CHART_WEBDRIVER_URL ?? "http://127.0.0.1:4815",
);
const portal = new URL(process.env.CHART_PORTAL_URL ?? "http://localhost:3000");
for (const url of [driver, portal]) {
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    "Use isolated localhost services",
  );
}

async function request(path, method = "GET", body) {
  const response = await fetch(new URL(path, driver), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const { value } = await response.json();
  assert.ok(response.ok, value?.message ?? `WebDriver HTTP ${response.status}`);
  return value;
}

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  assert.fail("Chart did not reach the expected state within 10 seconds");
}

test("overview chart loads proportional bars, positions axes, and supports hover and keyboard tooltips", async () => {
  const { sessionId } = await request("/session", "POST", {
    capabilities: {
      alwaysMatch: { browserName: process.env.CHART_BROWSER_NAME ?? "safari" },
    },
  });
  const session = `/session/${sessionId}`;
  const execute = (script) =>
    request(`${session}/execute/sync`, "POST", { script, args: [] });
  const find = (selector) =>
    request(`${session}/elements`, "POST", {
      using: "css selector",
      value: selector,
    });
  const visible = (element) =>
    request(`${session}/element/${element[ELEMENT]}/displayed`);
  const keys = (element, text) =>
    request(`${session}/element/${element[ELEMENT]}/value`, "POST", { text });

  try {
    await request(`${session}/url`, "POST", {
      url: new URL("/@budaya-lab/ds-layout-um-v2", portal).href,
    });
    const buttons = await waitFor(async () => {
      const elements = await find("[data-plot-rows] button");
      return elements.length === 7 && elements;
    });
    const tooltips = await find('[role="tooltip"]');
    assert.equal(tooltips.length, 7);
    assert.equal(await visible(tooltips[0]), false);

    for (const width of [1440, 320]) {
      await request(`${session}/window/rect`, "POST", { width, height: 960 });
      const layout = await execute(`
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const plot = rect('[data-plot-rows]');
        const y = rect('[data-axis-label="y"]');
        const x = rect('[data-axis-label="x"]');
        const ticks = rect('[data-axis-ticks="x"]');
        const figure = rect('figure[data-chart-type="bar"]');
        return {
          years: [...document.querySelectorAll('[data-chart-row]')].map(row => row.dataset.chartRow),
          bars: [...document.querySelectorAll('[data-chart-bar]')].map(bar => bar.getBoundingClientRect().width),
          yOffset: Math.abs((y.top + y.bottom) / 2 - (plot.top + plot.bottom) / 2),
          xBelowTicks: x.top >= ticks.bottom,
          fits: figure.left >= 0 && figure.right <= innerWidth + 1,
          headingStyle: getComputedStyle(document.querySelector('#overview-chart-title')).fontStyle
        };
      `);
      assert.deepEqual(layout.years, [
        "1962",
        "1963",
        "1964",
        "1966",
        "1967",
        "1968",
        "1969",
      ]);
      assert.ok(layout.bars.every((size) => size > 0));
      assert.ok(Math.abs(layout.bars[5] / layout.bars[0] - 5) < 0.1);
      assert.ok(
        layout.yOffset < 2,
        "Year title is centered on the plot, not the figure",
      );
      assert.ok(layout.xBelowTicks, "Count title is below the scale");
      assert.ok(layout.fits, "Chart stays inside the viewport");
      assert.equal(layout.headingStyle, "normal");
    }

    await request(`${session}/actions`, "POST", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            {
              type: "pointerMove",
              duration: 0,
              origin: buttons[0],
              x: 0,
              y: 0,
            },
          ],
        },
      ],
    });
    await waitFor(() => visible(tooltips[0]));
    await request(`${session}/actions`, "POST", {
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            {
              type: "pointerMove",
              duration: 0,
              origin: tooltips[0],
              x: 0,
              y: 0,
            },
          ],
        },
      ],
    });
    assert.equal(
      await visible(tooltips[0]),
      true,
      "Tooltip remains open under the pointer",
    );
    await request(`${session}/actions`, "POST", {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: "\uE00C" },
            { type: "keyUp", value: "\uE00C" },
          ],
        },
      ],
    });
    assert.equal(
      await visible(tooltips[0]),
      false,
      "Escape dismisses a hover tooltip without focus",
    );
    await request(
      `${session}/element/${buttons[0][ELEMENT]}/click`,
      "POST",
      {},
    );
    await waitFor(() => visible(tooltips[0]));
    await keys(buttons[0], "\uE00C");
    assert.equal(
      await visible(tooltips[0]),
      false,
      "Escape dismisses the tooltip",
    );
    await keys(buttons[0], "\uE004");
    await waitFor(() => visible(tooltips[1]));
    assert.equal(
      await visible(tooltips[0]),
      false,
      "Blur dismisses the previous tooltip",
    );
    const description = await request(
      `${session}/element/${buttons[1][ELEMENT]}/attribute/aria-describedby`,
    );
    const tooltipId = await request(
      `${session}/element/${tooltips[1][ELEMENT]}/attribute/id`,
    );
    assert.equal(description, tooltipId);
    await keys(buttons[1], "\uE00C");
    assert.equal(await visible(tooltips[1]), false);
  } finally {
    await request(session, "DELETE");
  }
});
