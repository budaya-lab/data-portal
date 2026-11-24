import { validateMetadata } from "@penjaga/validator";
import policy from "@penjaga/validator/policy" with { type: "json" };
import type { License } from "../lib/metadata/types";
import type { Resource } from "../lib/providers/types";

export class RepositoryValidationError extends Error {}

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
  bucketFile?: { bytes: Uint8Array; ref: string };
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

type ValidatedPackage = {
  title: string;
  description: string;
  keywords: string[];
  resources: {
    name: string;
    title: string;
    path: string | string[];
    format?: unknown;
  }[];
  created?: string;
  licenses?: License[];
};

function isPublicationPath(path: string, isDirectory: boolean): boolean {
  const validDirectoryPath =
    isDirectory &&
    path.length > 1 &&
    path.endsWith("/") &&
    !path.endsWith("//");
  return (
    !/[?#%]/.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    (!path.endsWith("/") || validDirectoryPath)
  );
}

export function parseDataPackage(text: string | undefined): ExtractedMetadata {
  if (text === undefined)
    throw new RepositoryValidationError(
      "datapackage.json is required for onboarding.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new RepositoryValidationError(
      "Invalid datapackage.json: expected JSON.",
      { cause },
    );
  }
  if (validateMetadata(parsed, policy).length > 0)
    throw new RepositoryValidationError(
      "Invalid datapackage.json: does not meet Penjaga metadata policy. Validate it in the source repository for details.",
    );
  // The validator checks unknown input but does not return a narrowed type.
  const value = parsed as ValidatedPackage;
  const title = safeText(value.title, 160);
  if (!title)
    throw new RepositoryValidationError(
      "Invalid datapackage.json title: review public-safe text.",
    );
  const description = safeText(value.description, 500);
  if (!description)
    throw new RepositoryValidationError(
      "Invalid datapackage.json description: review public-safe text.",
    );
  if (
    value.keywords.length > 20 ||
    value.keywords.some((keyword) => !safeText(keyword, 80))
  )
    throw new RepositoryValidationError("Invalid datapackage.json keywords.");
  const keywords = value.keywords;
  const resources: DeclaredResource[] = value.resources.map((resource) => {
    const paths = Array.isArray(resource.path)
      ? resource.path
      : [resource.path];
    const isDirectory =
      resource.format === undefined || resource.format === "dir";
    if (paths.some((path) => !isPublicationPath(path, isDirectory)))
      throw new RepositoryValidationError(
        "Invalid datapackage.json resource path.",
      );
    if (
      resource.format !== undefined &&
      (typeof resource.format !== "string" ||
        !/^[a-z0-9]+$/.test(resource.format))
    )
      throw new RepositoryValidationError(
        "Invalid datapackage.json resource format.",
      );
    const resourceTitle = safeText(resource.title, 160);
    if (!resourceTitle)
      throw new RepositoryValidationError(
        "Invalid datapackage.json resource title.",
      );
    return {
      name: resource.name,
      path: resource.path,
      ...(resource.format === undefined ? {} : { format: resource.format }),
      title: resourceTitle,
    };
  });
  let created: string | undefined;
  if (value.created !== undefined) {
    if (value.created === "2000-01-01T00:00:00Z")
      throw new RepositoryValidationError(
        "Invalid datapackage.json created date; replace the template example.",
      );
    created = value.created;
  }
  let licenses: License[] | undefined;
  if (value.licenses !== undefined) {
    licenses = value.licenses.map((license) => {
      if (
        typeof license.name !== "string" ||
        license.name.length > 80 ||
        !/^[A-Za-z0-9]/.test(license.name)
      )
        throw new RepositoryValidationError(
          "Invalid datapackage.json license.",
        );
      const title =
        license.title === undefined ? undefined : safeText(license.title, 160);
      if (license.title !== undefined && !title)
        throw new RepositoryValidationError(
          "Invalid datapackage.json license title.",
        );
      let path: string | undefined;
      if (license.path !== undefined) {
        try {
          const url = new URL(license.path);
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
          throw new RepositoryValidationError(
            "Invalid datapackage.json license URL.",
          );
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
    description,
    keywords,
    ...(created ? { created } : {}),
    ...(licenses ? { licenses } : {}),
    resources,
  };
}
