import type { DataFormat, Resource } from "../lib/providers/types";
import type { DeclaredResource } from "./data-package";

const supportedFormats = new Set<DataFormat>([
  "csv",
  "tsv",
  "json",
  "geojson",
  "parquet",
  "pmtiles",
  "geoparquet",
]);
const review = ["resources need review before publication"];

export type ReleaseSummary = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
};
export type TreeEntry = { path: string; type: string; mode: string };

export async function selectLatestMainRelease(
  releases: ReleaseSummary[],
  isReachableFromMain: (tag: string) => Promise<boolean>,
): Promise<string | undefined> {
  const eligible = releases
    .filter(
      (release) =>
        !release.draft &&
        !release.prerelease &&
        /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name),
    )
    .sort((a, b) => {
      const av = a.tag_name.replace(/^v/, "").split(".").map(Number);
      const bv = b.tag_name.replace(/^v/, "").split(".").map(Number);
      for (let i = 0; i < 3; i++) if (bv[i] !== av[i]) return bv[i] - av[i];
      return 0;
    });
  for (const release of eligible) {
    if (await isReachableFromMain(release.tag_name)) return release.tag_name;
  }
  return undefined;
}

export function resourcesAtRelease(
  declared: DeclaredResource[],
  tree: TreeEntry[],
  tag: string,
  owner: string,
  repo: string,
): { resources?: Resource[]; review?: string[] } {
  if (
    !/^v?\d+\.\d+\.\d+$/.test(tag) ||
    !/^[A-Za-z0-9-]+$/.test(owner) ||
    !/^[A-Za-z0-9._-]+$/.test(repo)
  )
    throw new Error("Invalid GitHub release identity.");
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));
  const resources: Resource[] = [];
  for (const item of declared) {
    if (typeof item.path !== "string") return { review };
    const format = item.format ?? item.path.split(".").pop()?.toLowerCase();
    if (!supportedFormats.has(format as DataFormat)) return { review };
    const entry = byPath.get(item.path);
    if (entry?.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      return { review };
    const urlPath = item.path.split("/").map(encodeURIComponent).join("/");
    resources.push({
      name: item.name,
      path: `https://raw.githubusercontent.com/${owner.toLowerCase()}/${repo}/${tag}/${urlPath}`,
      format: format as DataFormat,
      ...(item.title ? { title: item.title } : {}),
    });
  }
  return { resources };
}
