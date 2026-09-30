import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API = "https://api.github.com";
const PAGE_SIZE = 100;
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_PATTERN = "^ds[-_].*";
const METADATA_FILES = [
  "datapackage.json",
  "metadata.json",
  "metadata.yaml",
  "README.md",
  "README.rst",
  "README.txt",
];

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
export type ExtractedMetadata = {
  title?: string;
  description?: string;
  keywords?: string[];
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

function readmeMetadata(text: string): ExtractedMetadata {
  const lines = text.split(/\r?\n/);
  const title = lines
    .find((line) => /^#\s+\S/.test(line))
    ?.replace(/^#\s+/, "");
  const paragraph = lines
    .find((line) => {
      const value = line.trim();
      return (
        value.length >= 30 &&
        !value.startsWith("#") &&
        !value.startsWith("![") &&
        !value.startsWith("[") &&
        !value.startsWith("```") &&
        !value.startsWith("<")
      );
    })
    ?.trim()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|`/g, "");
  return {
    title: safeText(title, 160),
    description: safeText(paragraph, 500),
  };
}

function yamlScalar(value: string): string | undefined {
  const scalar = value.trim();
  if (!scalar || scalar === "null" || scalar === "~") return undefined;
  if (scalar.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(scalar);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (scalar.startsWith("'") && scalar.endsWith("'")) {
    return scalar.slice(1, -1).replace(/''/g, "'");
  }
  return scalar.replace(/\s+#.*$/, "").trim();
}

function parseMetadataYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const raw = (match[2] ?? "").trim();
    if (["|", "|-", "|+", ">", ">-", ">+"].includes(raw)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^\s+/.test(lines[i + 1]))
        block.push(lines[++i].trim());
      result[key] = raw.startsWith(">") ? block.join(" ") : block.join("\n");
    } else if (key === "keywords" && raw.startsWith("[") && raw.endsWith("]")) {
      result[key] = raw
        .slice(1, -1)
        .split(",")
        .map(yamlScalar)
        .filter((v): v is string => Boolean(v));
    } else if (raw) {
      result[key] = yamlScalar(raw);
    } else if (key === "keywords") {
      const keywords: string[] = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) {
        const item = lines[++i].replace(/^\s+-\s+/, "");
        const value = yamlScalar(item);
        if (value) keywords.push(value);
      }
      result[key] = keywords;
    }
  }
  return result;
}

export function extractMetadata(
  repo: Repository,
  files: Record<string, string>,
): ExtractedMetadata {
  let packageMetadata: Record<string, unknown> = {};
  if (files["datapackage.json"]) {
    try {
      const parsed: unknown = JSON.parse(files["datapackage.json"]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        packageMetadata = parsed as Record<string, unknown>;
      }
    } catch {
      // Invalid optional metadata is ignored and surfaced by missing-field review.
    }
  }
  const yamlMetadata = files["metadata.yaml"]
    ? parseMetadataYaml(files["metadata.yaml"])
    : {};
  const readme = readmeMetadata(
    files["README.md"] ?? files["README.rst"] ?? files["README.txt"] ?? "",
  );
  const rawKeywords =
    Array.isArray(packageMetadata.keywords) && packageMetadata.keywords.length
      ? packageMetadata.keywords
      : Array.isArray(yamlMetadata.keywords) && yamlMetadata.keywords.length
        ? yamlMetadata.keywords
        : (repo.topics ?? []);
  const keywords = Array.from(
    new Set(
      rawKeywords
        .map((value) => safeText(value, 80))
        .filter((v): v is string => Boolean(v)),
    ),
  ).slice(0, 20);
  return {
    title:
      safeText(packageMetadata.title, 160) ??
      safeText(packageMetadata.name, 160) ??
      safeText(yamlMetadata.title, 160) ??
      safeText(yamlMetadata.name, 160) ??
      readme.title,
    description:
      safeText(packageMetadata.description, 500) ??
      safeText(yamlMetadata.description, 500) ??
      safeText(repo.description, 500) ??
      readme.description,
    keywords: keywords.length ? keywords : undefined,
  };
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
  metadata: ExtractedMetadata,
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
  return `${JSON.stringify([...existing, ...additions], null, 2)}\n`;
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
): Promise<string | undefined> {
  const path = filename.split("/").map(encodeURIComponent).join("/");
  const url = new URL(
    `repos/${encodeURIComponent(account)}/${encodeURIComponent(repo.name)}/contents/${path}?ref=${encodeURIComponent(repo.default_branch)}`,
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

export async function readRepositoryMetadata(
  account: string,
  repo: Repository,
  token: string,
): Promise<ExtractedMetadata> {
  const files: Record<string, string> = {};
  for (const filename of METADATA_FILES) {
    const content = await readContent(account, repo, filename, token);
    if (content !== undefined) files[filename] = content;
  }
  return extractMetadata(repo, files);
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
        !extracted[index].title && "title derived from repository name; review",
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
