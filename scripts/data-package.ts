import type { License } from "../lib/metadata/types";
import type { Resource } from "../lib/providers/types";
import stageLabels from "../stage.config.json";

export type DeclaredResource = {
  name: string;
  path: string | string[];
  format?: string;
  title?: string;
};

export type ExtractedMetadata = {
  title: string;
  description?: string;
  keywords?: string[];
  created?: string;
  licenses?: License[];
  resources: DeclaredResource[];
  verifiedResources?: Resource[];
  review?: string[];
};

function safeText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (
    !text ||
    text.length > maxLength ||
    /https?:\/\/|git@github\.com:|github\.com\/.+\/(?:blob|raw|tree)\/|\b(?:token|password|secret|api[_ -]?key)\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bAKIA[0-9A-Z]{16}\b/i.test(
      text,
    )
  )
    return undefined;
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDateTime(value: unknown): value is string {
  if (typeof value !== "string" || value === "2000-01-01T00:00:00Z")
    return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match || Number.isNaN(Date.parse(value))) return false;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    ,
    ,
    offsetHour,
    offsetMinute,
  ] = match;
  const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return (
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= days &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    (offsetHour === undefined ||
      (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59))
  );
}

function validPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/[?#%]/.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    path
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

export function parseDataPackage(text: string | undefined): ExtractedMetadata {
  if (text === undefined)
    throw new Error("datapackage.json is required for onboarding.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new Error("Invalid datapackage.json: expected JSON.", { cause });
  }
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value.name)
  )
    throw new Error("Invalid datapackage.json package name.");
  const title = safeText(value.title, 160);
  if (!title)
    throw new Error("Invalid datapackage.json title: review public-safe text.");
  const description =
    value.description === undefined
      ? undefined
      : safeText(value.description, 500);
  if (value.description !== undefined && !description)
    throw new Error(
      "Invalid datapackage.json description: review public-safe text.",
    );
  if (
    !Array.isArray(value.keywords) ||
    value.keywords.length > 20 ||
    value.keywords.some((keyword) => !safeText(keyword, 80))
  )
    throw new Error("Invalid datapackage.json keywords.");
  const keywords = value.keywords as string[];
  const declaredStages = keywords.filter((keyword) =>
    keyword.startsWith("stage:"),
  );
  if (
    declaredStages.length !== 1 ||
    !Object.hasOwn(stageLabels, declaredStages[0].slice("stage:".length))
  )
    throw new Error("Invalid datapackage.json stage keyword.");
  if (!Array.isArray(value.resources) || value.resources.length === 0)
    throw new Error("Invalid datapackage.json resources.");
  const names = new Set<string>();
  const resources: DeclaredResource[] = value.resources.map(
    (resource: unknown) => {
      if (
        !isRecord(resource) ||
        typeof resource.name !== "string" ||
        !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(resource.name) ||
        names.has(resource.name)
      )
        throw new Error("Invalid datapackage.json resource name.");
      names.add(resource.name);
      const paths = Array.isArray(resource.path)
        ? resource.path
        : [resource.path];
      if (
        paths.length === 0 ||
        paths.some((path) => !validPath(path)) ||
        resource.data !== undefined
      )
        throw new Error("Invalid datapackage.json resource path.");
      if (
        resource.format !== undefined &&
        (typeof resource.format !== "string" ||
          !/^[a-z0-9]+$/.test(resource.format))
      )
        throw new Error("Invalid datapackage.json resource format.");
      const resourceTitle =
        resource.title === undefined
          ? undefined
          : safeText(resource.title, 160);
      if (resource.title !== undefined && !resourceTitle)
        throw new Error("Invalid datapackage.json resource title.");
      return {
        name: resource.name,
        path: resource.path as string | string[],
        ...(resource.format === undefined
          ? {}
          : { format: resource.format as string }),
        ...(resourceTitle === undefined ? {} : { title: resourceTitle }),
      };
    },
  );
  let created: string | undefined;
  if (value.created !== undefined) {
    if (!validDateTime(value.created))
      throw new Error(
        "Invalid datapackage.json created date; replace the template example.",
      );
    created = value.created;
  }
  let licenses: License[] | undefined;
  if (value.licenses !== undefined) {
    if (!Array.isArray(value.licenses))
      throw new Error("Invalid datapackage.json licenses.");
    licenses = value.licenses.map((license: unknown) => {
      if (
        !isRecord(license) ||
        typeof license.name !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(license.name)
      )
        throw new Error("Invalid datapackage.json license.");
      const title =
        license.title === undefined ? undefined : safeText(license.title, 160);
      if (license.title !== undefined && !title)
        throw new Error("Invalid datapackage.json license title.");
      let path: string | undefined;
      if (license.path !== undefined) {
        try {
          const url = new URL(license.path as string);
          if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            ![
              "creativecommons.org",
              "spdx.org",
              "opendatacommons.org",
            ].includes(url.hostname)
          )
            throw new Error("unsafe URL");
          path = url.href;
        } catch {
          throw new Error("Invalid datapackage.json license URL.");
        }
      }
      return {
        name: license.name,
        ...(title ? { title } : {}),
        ...(path ? { path } : {}),
      };
    });
  }
  return {
    title,
    ...(description ? { description } : {}),
    keywords,
    ...(created ? { created } : {}),
    ...(licenses ? { licenses } : {}),
    resources,
  };
}
