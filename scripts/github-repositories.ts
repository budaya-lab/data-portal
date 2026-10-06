import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Dataset, validateCatalogAccess } from "../lib/datasets";
import { type ExtractedMetadata, parseDataPackage } from "./data-package";
import {
  type ReleaseSummary,
  resourcesAtRelease,
  selectLatestMainRelease,
  type TreeEntry,
} from "./release-resources";

export type { ExtractedMetadata } from "./data-package";

const API = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_PATTERN = "^ds[-_].*";

type RepositoryOwner = { login: string };
export type Repository = {
  name: string;
  full_name: string;
  owner: RepositoryOwner;
  html_url: string;
  description: string | null;
  topics?: string[];
  private?: boolean;
  default_branch: string;
};

type Candidate = {
  slug: string;
  namespace: string;
  name: string;
  description?: string;
  keywords?: string[];
  created?: string;
  licenses?: ExtractedMetadata["licenses"];
  resources?: ExtractedMetadata["verifiedResources"];
  draft: true;
  access: "public" | "restricted";
  sources: [{ title: string; path: string; access: "public" | "restricted" }];
};

export type Options = {
  account: string;
  namespace: string;
  pattern: string;
  apply: boolean;
};

export function resolveGitHubToken(
  environmentToken: string | undefined,
  readGhToken: () => string,
): string {
  const token = environmentToken?.trim();
  if (token) return token;
  try {
    const ghToken = readGhToken().trim();
    if (ghToken) return ghToken;
  } catch (cause) {
    throw new Error(
      "No usable GitHub token found. Set GITHUB_TOKEN or authenticate with `gh auth login`.",
      { cause },
    );
  }
  throw new Error(
    "No usable GitHub token found. Set GITHUB_TOKEN or authenticate with `gh auth login`.",
  );
}

export function parseArguments(args: string[]): Options {
  const positional: string[] = [];
  const options = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    if (arg === "--apply") {
      if (apply) throw new Error("Duplicate --apply flag.");
      apply = true;
      continue;
    }
    if (!["--namespace", "--pattern"].includes(arg))
      throw new Error(`Unknown option: ${arg}`);
    if (options.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`${arg} requires a value.`);
    options.set(arg, value);
  }
  if (positional.length !== 1)
    throw new Error("Provide exactly one GitHub organisation or username.");
  const account = positional[0];
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(account)) {
    throw new Error("Invalid GitHub organisation or username.");
  }
  const namespace = options.get("--namespace") ?? account.toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(namespace)) {
    throw new Error(
      "Invalid namespace: use a lowercase URL-safe publisher slug.",
    );
  }
  const pattern = options.get("--pattern") ?? DEFAULT_PATTERN;
  try {
    new RegExp(pattern);
  } catch {
    throw new Error("Invalid repository name pattern.");
  }
  return { account, namespace, pattern, apply };
}

export function matchesRepositoryName(name: string, pattern: string): boolean {
  let matcher: RegExp;
  try {
    matcher = new RegExp(pattern);
  } catch {
    throw new Error("Invalid repository name pattern.");
  }
  matcher.lastIndex = 0;
  return matcher.test(name);
}

export function extractMetadata(
  _repo: Repository,
  files: Record<string, string>,
): ExtractedMetadata {
  return parseDataPackage(files["datapackage.json"]);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  if (!slug) throw new Error(`Cannot derive a catalogue slug from "${value}".`);
  return slug;
}

export function buildCandidate(
  repo: Repository,
  namespace: string,
  metadata: Partial<ExtractedMetadata>,
): Candidate {
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(repo.owner.login) ||
    !/^[A-Za-z0-9._-]+$/.test(repo.name)
  ) {
    throw new Error(`Invalid GitHub repository identity: ${repo.full_name}`);
  }
  const access = repo.private === false ? "public" : "restricted";
  const path = `https://github.com/${repo.owner.login.toLowerCase()}/${repo.name}`;
  const candidate: Candidate = {
    slug: slugify(repo.name),
    namespace,
    name: metadata.title ?? repo.name,
    draft: true,
    access,
    sources: [
      {
        title:
          access === "restricted"
            ? "GitHub repository (sign in for access)"
            : "GitHub repository",
        path,
        access,
      },
    ],
  };
  if (metadata.description) candidate.description = metadata.description;
  if (metadata.keywords?.length) candidate.keywords = metadata.keywords;
  if (metadata.created) candidate.created = metadata.created;
  if (metadata.licenses?.length) candidate.licenses = metadata.licenses;
  if (access === "public" && metadata.verifiedResources?.length)
    candidate.resources = metadata.verifiedResources;
  return candidate;
}

type RepositoryPlan = {
  repositories: Repository[];
  alreadyCatalogued: string[];
  conflicts: { repository: string; reason: string }[];
};

function canonicalLandingUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      segments.length !== 2
    )
      return undefined;
    return `https://github.com/${segments[0].toLowerCase()}/${segments[1].toLowerCase()}`;
  } catch {
    return undefined;
  }
}

export function planRepositories(
  repositories: Repository[],
  namespace: string,
  manifestText: string,
): RepositoryPlan {
  const records: unknown = JSON.parse(manifestText);
  if (!Array.isArray(records))
    throw new Error("datasets.json must contain a JSON array.");
  const catalog = records as Array<Record<string, unknown>>;
  const plan: RepositoryPlan = {
    repositories: [],
    alreadyCatalogued: [],
    conflicts: [],
  };
  const plannedSources = new Set<string>();
  const plannedIds = new Set<string>();
  for (const repo of repositories) {
    const candidate = buildCandidate(repo, namespace, {});
    const source = canonicalLandingUrl(candidate.sources[0].path);
    if (!source)
      throw new Error(`Invalid GitHub landing URL for ${repo.full_name}.`);
    const existingSource = catalog.some(
      (record) =>
        Array.isArray(record.sources) &&
        record.sources.some(
          (item) =>
            item &&
            typeof item === "object" &&
            canonicalLandingUrl((item as { path?: unknown }).path) === source,
        ),
    );
    if (existingSource || plannedSources.has(source)) {
      plan.alreadyCatalogued.push(`${namespace}/${candidate.slug}`);
      continue;
    }
    const id = `${namespace}/${candidate.slug}`;
    const existingId = catalog.some(
      (record) =>
        record.namespace === namespace && record.slug === candidate.slug,
    );
    if (existingId || plannedIds.has(id)) {
      plan.conflicts.push({
        repository: repo.full_name,
        reason: `catalogue slug ${id} belongs to a different source`,
      });
      continue;
    }
    plan.repositories.push(repo);
    plannedSources.add(source);
    plannedIds.add(id);
  }
  return plan;
}

export function mergeCandidates(
  manifestText: string,
  candidates: Candidate[],
): string {
  const records: unknown = JSON.parse(manifestText);
  if (!Array.isArray(records))
    throw new Error("datasets.json must contain a JSON array.");
  const existing = records as Array<Record<string, unknown>>;
  const additions: Candidate[] = [];
  for (const candidate of candidates) {
    const source = candidate.sources[0].path;
    const bySource =
      existing.find(
        (record) =>
          Array.isArray(record.sources) &&
          record.sources.some(
            (item) =>
              item &&
              typeof item === "object" &&
              (item as { path?: unknown }).path === source,
          ),
      ) ?? additions.find((record) => record.sources[0].path === source);
    if (bySource) {
      if (
        bySource.namespace === candidate.namespace &&
        bySource.slug === candidate.slug
      )
        continue;
      throw new Error(
        `Source URL already exists with a different catalogue identity: ${source}`,
      );
    }
    const collision = [...existing, ...additions].find(
      (record) =>
        record.namespace === candidate.namespace &&
        record.slug === candidate.slug,
    );
    if (collision)
      throw new Error(
        `Catalogue slug collision for ${candidate.namespace}/${candidate.slug}.`,
      );
    additions.push(candidate);
  }
  const merged = [...existing, ...additions];
  validateCatalogAccess(merged as unknown as Dataset[]);
  return `${JSON.stringify(merged, null, 2)}\n`;
}

async function readBounded(response: Response): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_RESPONSE_BYTES)
    throw new Error("GitHub response exceeds the 1 MB safety limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("GitHub response exceeds the 1 MB safety limit.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function githubGet(
  url: URL,
  token: string,
): Promise<{ response: Response; text: string }> {
  if (url.protocol !== "https:" || url.hostname !== "api.github.com")
    throw new Error("Refusing non-GitHub API URL.");
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  return { response, text: await readBounded(response) };
}

function nextPage(link: string | null): URL | undefined {
  if (!link) return undefined;
  for (const part of link.split(",")) {
    const match = part.trim().match(/^<([^>]+)>;\s*rel="next"$/);
    if (!match) continue;
    const url = new URL(match[1]);
    if (url.protocol !== "https:" || url.hostname !== "api.github.com")
      throw new Error("Refusing pagination outside api.github.com.");
    return url;
  }
  return undefined;
}

export async function listRepositories(
  account: string,
  token: string,
): Promise<Repository[]> {
  const accountUrl = new URL(`users/${encodeURIComponent(account)}`, API);
  const accountResult = await githubGet(accountUrl, token);
  if (!accountResult.response.ok) {
    throw new Error(
      `GitHub account lookup failed (${accountResult.response.status}); no records were written.`,
    );
  }
  const accountProfile: unknown = JSON.parse(accountResult.text);
  if (
    !accountProfile ||
    typeof accountProfile !== "object" ||
    !["Organization", "User"].includes(
      String((accountProfile as { type?: unknown }).type),
    )
  ) {
    throw new Error("GitHub returned an invalid account profile.");
  }
  const isOrganization =
    (accountProfile as { type: string }).type === "Organization";
  const path = isOrganization
    ? `orgs/${encodeURIComponent(account)}/repos?type=all&per_page=100`
    : `user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100`;
  let pageUrl = new URL(path, API);
  let response = await githubGet(pageUrl, token);
  const repositories: Repository[] = [];
  while (true) {
    if (!response.response.ok)
      throw new Error(
        `GitHub repository listing failed (${response.response.status}); no records were written.`,
      );
    const data: unknown = JSON.parse(response.text);
    if (!Array.isArray(data))
      throw new Error("GitHub returned an invalid repository listing.");
    for (const value of data) {
      if (!value || typeof value !== "object")
        throw new Error("GitHub returned an invalid repository record.");
      const repo = value as Partial<Repository>;
      if (
        typeof repo.name !== "string" ||
        typeof repo.full_name !== "string" ||
        typeof repo.html_url !== "string" ||
        !repo.owner ||
        typeof repo.owner.login !== "string" ||
        typeof repo.default_branch !== "string"
      )
        throw new Error("GitHub returned an incomplete repository record.");
      if (
        !isOrganization &&
        repo.owner.login.toLowerCase() !== account.toLowerCase()
      )
        continue;
      repositories.push(repo as Repository);
    }
    if (data.length < PAGE_SIZE) return repositories;
    const next = nextPage(response.response.headers.get("link"));
    if (!next)
      throw new Error(
        "GitHub returned a full page without a next-page link; refusing an incomplete harvest.",
      );
    pageUrl = next;
    response = await githubGet(pageUrl, token);
  }
}

async function readContent(
  account: string,
  repo: Repository,
  filename: string,
  token: string,
  ref: string,
): Promise<string | undefined> {
  const path = filename.split("/").map(encodeURIComponent).join("/");
  const url = new URL(
    `repos/${encodeURIComponent(account)}/${encodeURIComponent(repo.name)}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    API,
  );
  const { response, text } = await githubGet(url, token);
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(
      `Could not read allowlisted metadata ${filename} from ${repo.full_name} (${response.status}).`,
    );
  const result: unknown = JSON.parse(text);
  if (!result || typeof result !== "object")
    throw new Error(`Invalid GitHub content response for ${filename}.`);
  const content = (result as { content?: unknown; encoding?: unknown }).content;
  if (
    typeof content !== "string" ||
    (result as { encoding?: unknown }).encoding !== "base64"
  ) {
    throw new Error(
      `GitHub returned unsupported content encoding for ${filename}.`,
    );
  }
  return Buffer.from(content, "base64").toString("utf8");
}

function repositoryApiPath(account: string, repo: Repository): string {
  return `repos/${encodeURIComponent(account)}/${encodeURIComponent(repo.name)}`;
}

async function listReleases(
  account: string,
  repo: Repository,
  token: string,
): Promise<ReleaseSummary[]> {
  const releases: ReleaseSummary[] = [];
  let url: URL | undefined = new URL(
    `${repositoryApiPath(account, repo)}/releases?per_page=100&page=1`,
    API,
  );
  while (url) {
    const { response, text } = await githubGet(url, token);
    if (!response.ok)
      throw new Error(
        `Could not list GitHub releases for ${repo.full_name} (${response.status}).`,
      );
    const page: unknown = JSON.parse(text);
    if (
      !Array.isArray(page) ||
      page.some(
        (item) =>
          !item ||
          typeof item.tag_name !== "string" ||
          typeof item.draft !== "boolean" ||
          typeof item.prerelease !== "boolean",
      )
    )
      throw new Error("Invalid GitHub releases response.");
    releases.push(...(page as ReleaseSummary[]));
    url =
      page.length === 100 ? nextPage(response.headers.get("link")) : undefined;
    if (page.length === 100 && !url)
      throw new Error("Incomplete GitHub releases response.");
  }
  return releases;
}

class MissingReleaseTagError extends Error {}

async function releaseIsOnMain(
  account: string,
  repo: Repository,
  token: string,
  tag: string,
): Promise<boolean> {
  const url = new URL(
    `${repositoryApiPath(account, repo)}/compare/${encodeURIComponent(tag)}...main`,
    API,
  );
  const { response, text } = await githubGet(url, token);
  if (response.status === 404)
    throw new MissingReleaseTagError(
      "Release tag is unavailable; review the repository releases.",
    );
  if (!response.ok)
    throw new Error(`Could not compare release to main (${response.status}).`);
  const result: unknown = JSON.parse(text);
  if (
    !result ||
    typeof result !== "object" ||
    typeof (result as { status?: unknown }).status !== "string"
  )
    throw new Error("Invalid GitHub compare response.");
  return ["ahead", "identical"].includes((result as { status: string }).status);
}

async function readReleaseTree(
  account: string,
  repo: Repository,
  token: string,
  tag: string,
): Promise<TreeEntry[] | undefined> {
  const url = new URL(
    `${repositoryApiPath(account, repo)}/git/trees/${encodeURIComponent(tag)}?recursive=1`,
    API,
  );
  const { response, text } = await githubGet(url, token);
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error(
      `Could not verify GitHub release files (${response.status}).`,
    );
  const result: unknown = JSON.parse(text);
  if (!result || typeof result !== "object")
    throw new Error("Invalid GitHub release tree.");
  const tree = result as { truncated?: unknown; tree?: unknown };
  if (tree.truncated === true) return undefined;
  if (
    tree.truncated !== false ||
    !Array.isArray(tree.tree) ||
    tree.tree.some(
      (entry) =>
        !entry ||
        typeof entry.path !== "string" ||
        typeof entry.type !== "string" ||
        typeof entry.mode !== "string",
    )
  )
    throw new Error("Invalid GitHub release tree.");
  return tree.tree as TreeEntry[];
}

export async function readRepositoryMetadata(
  account: string,
  repo: Repository,
  token: string,
): Promise<ExtractedMetadata> {
  if (repo.private !== false) {
    const descriptor = await readContent(
      account,
      repo,
      "datapackage.json",
      token,
      "main",
    );
    return parseDataPackage(descriptor);
  }
  const releases = await listReleases(account, repo, token);
  let tag: string | undefined;
  try {
    tag = await selectLatestMainRelease(releases, (releaseTag) =>
      releaseIsOnMain(account, repo, token, releaseTag),
    );
  } catch (error) {
    if (!(error instanceof MissingReleaseTagError)) throw error;
    const descriptor = await readContent(
      account,
      repo,
      "datapackage.json",
      token,
      "main",
    );
    return {
      ...parseDataPackage(descriptor),
      review: [
        "release tag unavailable; resources need review before publication",
      ],
    };
  }
  const descriptor = await readContent(
    account,
    repo,
    "datapackage.json",
    token,
    tag ?? "main",
  );
  if (tag && descriptor === undefined) {
    const current = await readContent(
      account,
      repo,
      "datapackage.json",
      token,
      "main",
    );
    return {
      ...parseDataPackage(current),
      review: [
        "descriptor unavailable at release; resources need review before publication",
      ],
    };
  }
  const metadata = parseDataPackage(descriptor);
  if (!tag)
    return {
      ...metadata,
      review: [
        "no suitable release from main; resources need review before publication",
      ],
    };
  const tree = await readReleaseTree(account, repo, token, tag);
  if (!tree)
    return {
      ...metadata,
      review: ["resources need review before publication"],
    };
  const result = resourcesAtRelease(
    metadata.resources,
    tree,
    tag,
    repo.owner.login,
    repo.name,
  );
  return {
    ...metadata,
    verifiedResources: result.resources,
    review: result.review,
  };
}

async function confirmApply(): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import("node:readline/promises");
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (
      (await terminal.question(
        'Type "apply" to append these drafts to datasets.json: ',
      )) === "apply"
    );
  } finally {
    terminal.close();
  }
}

function showProgress(done: number, total: number): void {
  if (!process.stderr.isTTY || total === 0) return;
  const width = 28;
  const filled = Math.round((done / total) * width);
  process.stderr.write(
    `${String.fromCharCode(13)}[${"#".repeat(filled)}${"-".repeat(width - filled)}] ${done}/${total} repositories`,
  );
  if (done === total) process.stderr.write(String.fromCharCode(10));
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const token = resolveGitHubToken(process.env.GITHUB_TOKEN, () =>
    execFileSync("gh", ["auth", "token", "--hostname", "github.com"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
  const repositories = await listRepositories(options.account, token);
  const matched = repositories.filter((repo) =>
    matchesRepositoryName(repo.name, options.pattern),
  );
  const manifestPath = "datasets.json";
  const initialManifest = await readFile(manifestPath, "utf8");
  const plan = planRepositories(matched, options.namespace, initialManifest);
  const candidates: Candidate[] = [];
  const extracted: ExtractedMetadata[] = [];
  showProgress(0, plan.repositories.length);
  for (let index = 0; index < plan.repositories.length; index++) {
    const repo = plan.repositories[index];
    const metadata = await readRepositoryMetadata(options.account, repo, token);
    extracted.push(metadata);
    candidates.push(buildCandidate(repo, options.namespace, metadata));
    showProgress(index + 1, plan.repositories.length);
  }
  const review = {
    account: options.account,
    namespace: options.namespace,
    pattern: options.pattern,
    summary: {
      repositoriesDiscovered: repositories.length,
      repositoriesMatched: matched.length,
      alreadyCatalogued: plan.alreadyCatalogued.length,
      candidates: candidates.length,
      conflicts: plan.conflicts.length,
    },
    alreadyCatalogued: plan.alreadyCatalogued,
    conflicts: plan.conflicts,
    candidates: candidates.map((candidate, index) => ({
      ...candidate,
      review: [
        !candidate.description && "description missing",
        !candidate.keywords && "subject keywords missing",
        ...(extracted[index].review ?? []),
        "verify metadata and access classification before publication",
      ].filter(Boolean),
    })),
  };
  const reviewPath = `.tmp/github-repository-review-${options.namespace}-${options.account.toLowerCase()}.json`;
  await mkdir(".tmp", { recursive: true });
  await writeFile(
    reviewPath,
    `${JSON.stringify(review, null, 2)}${String.fromCharCode(10)}`,
    "utf8",
  );
  console.log(
    `Repositories: ${repositories.length} discovered, ${matched.length} matched, ` +
      `${plan.alreadyCatalogued.length} already catalogued, ${candidates.length} new candidate(s), ` +
      `${plan.conflicts.length} conflict(s).`,
  );
  console.log(`Review file saved to ${reviewPath}`);
  if (!options.apply || candidates.length === 0) return;
  if (plan.conflicts.length)
    throw new Error(
      "Resolve review-file conflicts before applying candidates.",
    );
  if (!(await confirmApply()))
    throw new Error("Apply cancelled; datasets.json was not changed.");
  const current = await readFile(manifestPath, "utf8");
  const updated = mergeCandidates(current, candidates);
  await writeFile(manifestPath, updated, "utf8");
  const added = JSON.parse(updated).length - JSON.parse(current).length;
  console.log(`Added ${added} draft dataset record(s) to ${manifestPath}.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
