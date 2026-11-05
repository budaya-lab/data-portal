import type { Resource } from "./providers/types";

export const MAX_BUCKET_BYTES = 1_000_000;
export type BucketData = {
  labelColumn: string;
  rows: Record<string, string | number>[];
};

export function validateBucketResource(resource: Resource): void {
  if (
    resource.name !== "buckets" ||
    resource.format !== "csv" ||
    typeof resource.path !== "string" ||
    !resource.path.endsWith(".csv") ||
    /[\\?#%:]/.test(resource.path) ||
    Array.from(resource.path).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    ) ||
    resource.path
      .split("/")
      .some((part) => !part || part === "." || part === "..")
  )
    throw new Error(
      "Bucket resources need name buckets, format csv, and a safe local CSV path",
    );
}

export function parseBuckets(input: string | Uint8Array): BucketData {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > MAX_BUCKET_BYTES)
    throw new Error("buckets.csv exceeds the 1 MB limit");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new Error("buckets.csv must contain valid UTF-8", { cause });
  }
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let state = "plain";
  const finishRecord = () => {
    if (record.length || field || state === "closed")
      records.push([...record, field]);
    record = [];
    field = "";
    state = "plain";
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === "quoted") {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') state = "closed";
      else field += char;
    } else if (char === ",") {
      record.push(field);
      field = "";
      state = "plain";
    } else if (char === "\n" || char === "\r") {
      finishRecord();
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else if (char === '"' && field === "" && state === "plain") {
      state = "quoted";
    } else if (char === '"' || state === "closed") {
      throw new Error(
        `buckets.csv row ${records.length + 1}: malformed CSV quoting`,
      );
    } else field += char;
  }
  if (state === "quoted")
    throw new Error("buckets.csv: unterminated quoted field");
  finishRecord();
  const header = records.shift()?.map((value) => value.trim());
  if (
    header?.length !== 2 ||
    !header[0] ||
    header[0] === "count" ||
    header[1] !== "count"
  ) {
    throw new Error("buckets.csv needs a label header followed by count");
  }
  if (!records.length)
    throw new Error("buckets.csv must contain at least one data row");
  const labelColumn = header[0];
  const labels = new Set<string>();
  const rows = records.map((values, index) => {
    const label = values[0]?.trim();
    const count = values[1]?.trim();
    if (
      values.length !== 2 ||
      !label ||
      labels.has(label) ||
      !/^\d+$/.test(count ?? "") ||
      !Number.isSafeInteger(Number(count))
    ) {
      throw new Error(
        `buckets.csv row ${index + 2}: expected a unique label and non-negative safe-integer count`,
      );
    }
    labels.add(label);
    return { [labelColumn]: label, count: Number(count) };
  });
  return { labelColumn, rows };
}
