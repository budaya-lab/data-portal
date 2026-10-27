import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { HorizontalBarChart } from "./HorizontalBarChart";
import { parseCsv } from "./ui/parseCsv";

type Row = Record<string, string | number>;
type ChartType = "line" | "bar" | "area" | "pie" | "scatter";

const EMPTY_DATA: Row[] = [];
const PALETTE = ["#8a4b2b", "#2f6f68", "#b56d3d", "#526b7a", "#8b6b35"];

export interface ChartProps {
  /** CSV file URL under /public, e.g. "/data/file.csv" */
  url?: string;
  /** Pre-parsed rows, e.g. from an imported JSON array */
  data?: Row[];
  type?: ChartType;
  /** Bar direction; horizontal bars use X for values and Y for categories. */
  barOrientation?: "horizontal" | "vertical";
  /** X-axis / category column key */
  x: string;
  /** One or more numeric column keys to plot */
  y: string | string[];
  height?: number;
}

export function Chart({
  url = "",
  data: initialData = EMPTY_DATA,
  type = "line",
  barOrientation = "vertical",
  x,
  y,
  height = 320,
}: ChartProps) {
  const yKeys = useMemo(() => (Array.isArray(y) ? y : [y]), [y]);
  const chartLabel =
    type === "bar" && barOrientation === "horizontal"
      ? `horizontal bar chart of ${yKeys.join(", ")} by ${x}`
      : `${type} chart of ${yKeys.join(", ")} by ${x}`;
  const [raw, setRaw] = useState<Row[]>(initialData);
  const [isLoading, setIsLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setRaw(initialData);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} — ${response.statusText}`);
        }
        return response.text();
      })
      .then((text) => setRaw(parseCsv(text).rows))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [url, initialData]);

  const rows = useMemo(
    () =>
      raw.map((row) => {
        const output: Row = { [x]: row[x] };
        for (const key of yKeys) {
          const value = row[key];
          const number = value === "" ? Number.NaN : Number(value);
          output[key] = Number.isFinite(number) ? number : Number.NaN;
        }
        return output;
      }),
    [raw, x, yKeys],
  );

  if (isLoading) {
    return (
      <div
        role="status"
        aria-label={chartLabel}
        data-chart-type={type}
        data-bar-orientation={barOrientation}
        className="flex min-h-[200px] items-center justify-center font-sans text-sm text-ink/50"
      >
        Loading chart…
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="border border-ink/15 bg-cream-panel p-4 font-sans text-sm text-ink"
      >
        Failed to load chart data: {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="p-4 font-sans text-sm text-ink/50">No data to chart.</div>
    );
  }

  if (type === "bar" && barOrientation === "horizontal") {
    return (
      <HorizontalBarChart
        rows={rows}
        x={x}
        yKeys={yKeys}
        height={height}
        label={chartLabel}
      />
    );
  }

  return (
    <div
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={chartLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ChartPlot rows={rows} type={type} x={x} yKeys={yKeys} />
      </ResponsiveContainer>
    </div>
  );
}

export function ChartPlot({
  rows,
  type,
  x,
  yKeys,
  width,
  height,
}: {
  rows: Row[];
  type: ChartType;
  x: string;
  yKeys: string[];
  width?: number;
  height?: number;
}) {
  const size = { width, height };
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#d8d1c4" />;
  // Recharts 2's react-is cannot unwrap React 19 fragments. Keep axes direct.
  const axes = [
    <XAxis
      key="x"
      dataKey={x}
      interval={0}
      tick={{ fontSize: 12 }}
      stroke="#766c60"
    />,
    <YAxis key="y" tick={{ fontSize: 12 }} stroke="#766c60" />,
  ];

  return type === "bar" ? (
    <BarChart {...size} data={rows}>
      {grid}
      {axes}
      <Tooltip />
      <Legend />
      {yKeys.map((key, index) => (
        <Bar key={key} dataKey={key} fill={PALETTE[index % PALETTE.length]} />
      ))}
    </BarChart>
  ) : type === "area" ? (
    <AreaChart {...size} data={rows}>
      {grid}
      {axes}
      <Tooltip />
      <Legend />
      {yKeys.map((key, index) => (
        <Area
          key={key}
          type="monotone"
          dataKey={key}
          stroke={PALETTE[index % PALETTE.length]}
          fill={PALETTE[index % PALETTE.length]}
          fillOpacity={0.2}
        />
      ))}
    </AreaChart>
  ) : type === "pie" ? (
    <PieChart {...size}>
      <Tooltip />
      <Legend />
      <Pie
        data={rows}
        dataKey={yKeys[0]}
        nameKey={x}
        cx="50%"
        cy="50%"
        outerRadius={110}
        label
      >
        {rows.map((row, index) => (
          <Cell
            key={`${String(row[x])}-${String(row[yKeys[0]])}`}
            fill={PALETTE[index % PALETTE.length]}
          />
        ))}
      </Pie>
    </PieChart>
  ) : type === "scatter" ? (
    <ScatterChart {...size}>
      {grid}
      <XAxis
        dataKey={x}
        type="number"
        tick={{ fontSize: 12 }}
        stroke="#766c60"
      />
      <YAxis
        dataKey={yKeys[0]}
        type="number"
        tick={{ fontSize: 12 }}
        stroke="#766c60"
      />
      <ZAxis range={[60, 60]} />
      <Tooltip cursor={{ strokeDasharray: "3 3" }} />
      <Legend />
      <Scatter data={rows} fill={PALETTE[0]} />
    </ScatterChart>
  ) : (
    <LineChart {...size} data={rows}>
      {grid}
      {axes}
      <Tooltip />
      <Legend />
      {yKeys.map((key, index) => (
        <Line
          key={key}
          type="monotone"
          dataKey={key}
          stroke={PALETTE[index % PALETTE.length]}
          dot={false}
        />
      ))}
    </LineChart>
  );
}
