import { useEffect, useId, useState } from "react";

type Row = Record<string, string | number>;

const PALETTE = ["#8a4b2b", "#2f6f68", "#b56d3d", "#526b7a", "#8b6b35"];
const ROW_GRID =
  "grid grid-cols-[2.5rem_minmax(0,1fr)_1.75rem] items-center gap-x-2";

function BarMark({
  category,
  series,
  value,
  axisMax,
  color,
}: {
  category: string;
  series: string;
  value: number;
  axisMax: number;
  color: string;
}) {
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  const detail = `${category}: ${series} ${Number.isFinite(value) ? value : "no value"}`;
  const width =
    Number.isFinite(value) && value > 0 ? (value / axisMax) * 100 : 0;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDismissed(true);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [open]);

  return (
    // biome-ignore lint/a11y/useSemanticElements: This groups a bar and tooltip, not form fields.
    <div
      role="group"
      aria-label={`${category}, ${series}`}
      className="relative h-6"
      onMouseEnter={() => {
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={`Show details for ${category}, ${series}`}
        aria-describedby={tooltipId}
        className="absolute inset-0 rounded-sm bg-ink/[0.04] text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onFocus={() => {
          setFocused(true);
          setDismissed(false);
        }}
        onBlur={() => setFocused(false)}
        onClick={() => setDismissed(false)}
      >
        <span
          aria-hidden="true"
          data-chart-bar={category}
          className="absolute inset-y-[2px] left-0 rounded-sm"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!open}
        className="absolute bottom-full left-0 z-20 whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-[11px] text-cream shadow-md"
      >
        {detail}
      </span>
    </div>
  );
}

export function HorizontalBarChart({
  rows,
  x,
  yKeys,
  height,
  label,
}: {
  rows: Row[];
  x: string;
  yKeys: string[];
  height: number;
  label: string;
}) {
  const values = rows.flatMap((row) => yKeys.map((key) => Number(row[key])));
  const maxValue = Math.max(0, ...values.filter(Number.isFinite));
  const axisMax = maxValue > 0 ? Math.ceil(maxValue / 5) * 5 : 5;
  const ticks = Array.from({ length: 6 }, (_, index) => (axisMax * index) / 5);
  const categoryTitle = x.charAt(0).toUpperCase() + x.slice(1);
  const valueTitle = yKeys
    .map((key) => key.charAt(0).toUpperCase() + key.slice(1))
    .join(", ");

  return (
    <figure
      className="grid w-full grid-cols-[1rem_minmax(0,1fr)] content-center items-center gap-x-2 gap-y-2 font-sans text-xs text-ink/75"
      style={{ minHeight: height }}
      aria-label={label}
      data-chart-type="bar"
      data-bar-orientation="horizontal"
    >
      <figcaption className="sr-only">{label}</figcaption>
      <span
        data-axis-label="y"
        className="col-start-1 row-start-1 justify-self-center -rotate-90 whitespace-nowrap font-medium"
      >
        {categoryTitle}
      </span>
      <div data-plot-rows="" className="col-start-2 row-start-1 grid gap-y-2">
        {rows.flatMap((row) =>
          yKeys.map((key, seriesIndex) => {
            const category = String(row[x] ?? "");
            const value = Number(row[key]);
            return (
              <div
                key={`${category}-${key}-${String(row[key])}`}
                data-chart-row={category}
                className={ROW_GRID}
              >
                <span className="text-right tabular-nums">{category}</span>
                <BarMark
                  category={category}
                  series={key}
                  value={value}
                  axisMax={axisMax}
                  color={PALETTE[seriesIndex % PALETTE.length]}
                />
                <span className="tabular-nums">
                  {Number.isFinite(value) ? value : "–"}
                </span>
              </div>
            );
          }),
        )}
      </div>
      <div
        data-axis-ticks="x"
        className={`col-start-2 row-start-2 ${ROW_GRID}`}
      >
        <span />
        <div className="relative h-5 border-t border-ink/30">
          {ticks.map((tick) => (
            <span
              key={tick}
              className={`absolute top-1 tabular-nums ${
                tick === 0
                  ? ""
                  : tick === axisMax
                    ? "-translate-x-full"
                    : "-translate-x-1/2"
              }`}
              style={{ left: `${(tick / axisMax) * 100}%` }}
            >
              {tick}
            </span>
          ))}
        </div>
        <span />
      </div>
      <div className={`col-start-2 row-start-3 ${ROW_GRID}`}>
        <span />
        <span data-axis-label="x" className="text-center font-medium">
          {valueTitle}
        </span>
        <span />
      </div>
    </figure>
  );
}
