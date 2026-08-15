import {
  bearer,
  defineConnection,
  defineTool,
  publishOutbox,
  useSecret,
} from "@opencomputer/agent";
import type { OutboxPublishResult } from "@opencomputer/agent";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = "/workspace/repositories";

export const githubPat = defineConnection({
  id: "github-pat",
  origin: "https://api.github.com",
  methods: ["GET", "POST", "PUT", "DELETE"],
  pathPrefix: "/repos/",
  redirectOrigins: [{ origin: "https://codeload.github.com" }],
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: bearer(useSecret("GITHUB_PAT")),
    "User-Agent": "opencomputer-example-unleash",
    "X-GitHub-Api-Version": "2022-11-28",
  },
});

// GitHub's remote MCP server accepts the same PAT as an Authorization bearer.
// This connection is separately origin-scoped so the credential cannot be sent
// anywhere except the official MCP endpoint.
export const githubMcpPat = defineConnection({
  id: "github-mcp-pat",
  origin: "https://api.githubcopilot.com",
  methods: ["GET", "POST", "DELETE"],
  pathPrefix: "/mcp/",
  headers: {
    Authorization: bearer(useSecret("GITHUB_PAT")),
  },
});

function segment(value: string, label: string): string {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return normalized;
}

function repositoryPath(owner: string, repo: string): string {
  return resolve(REPOSITORY_ROOT, `${segment(owner, "owner")}--${segment(repo, "repo")}`);
}

async function githubResponse(
  path: string,
  init?: RequestInit,
  allowNotFound = false,
): Promise<Response | undefined> {
  const response = await githubPat.fetch(path, init);
  if (allowNotFound && response.status === 404) return undefined;
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub API ${response.status}: ${message.slice(0, 2_000)}`);
  }
  return response;
}

async function githubJson<T>(
  path: string,
  init?: RequestInit,
  allowNotFound = false,
): Promise<T | undefined> {
  const response = await githubResponse(path, init, allowNotFound);
  return response ? (await response.json()) as T : undefined;
}

export const cloneRepository = defineTool({
  name: "clone_github_repository",
  description:
    "Securely materialize a GitHub repository ref in /workspace/repositories using the managed GITHUB_PAT connection. The token is never returned to the model.",
  input: {
    type: "object",
    properties: {
      owner: { type: "string", minLength: 1 },
      repo: { type: "string", minLength: 1 },
      ref: { type: "string", minLength: 1, default: "HEAD" },
    },
    required: ["owner", "repo"],
    additionalProperties: false,
  },
  async run({ input, signal, reportProgress }) {
    const owner = segment(String(input.owner), "owner");
    const repo = segment(String(input.repo), "repo");
    const ref = encodeURIComponent(String(input.ref ?? "HEAD"));
    const destination = repositoryPath(owner, repo);
    const temporary = await mkdtemp(join(tmpdir(), "github-repository-"));
    const archive = join(temporary, "repository.tar.gz");

    await reportProgress({ status: "downloading", repository: `${owner}/${repo}` });
    try {
      const response = await githubResponse(
        `/repos/${owner}/${repo}/tarball/${ref}`,
        { signal },
      );
      const bytes = new Uint8Array(await response!.arrayBuffer());
      await writeFile(archive, bytes);
      await mkdir(REPOSITORY_ROOT, { recursive: true });
      await rm(destination, { recursive: true, force: true });
      await mkdir(destination, { recursive: true });
      await execFileAsync("tar", ["-xzf", archive, "--strip-components=1", "-C", destination], {
        signal,
      });
      await reportProgress({ status: "ready", path: destination });
      return {
        repository: `${owner}/${repo}`,
        ref: decodeURIComponent(ref),
        path: destination,
        note: "This is an authenticated source snapshot; branch and PR writes use the GitHub API.",
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
});

type FileChange = {
  path: string;
  content?: string;
  delete?: boolean;
};

type GitHubRepository = { default_branch: string };
type GitHubRef = { object: { sha: string } };
type GitHubContent = { sha: string; type: string };
type GitHubPull = { number: number; html_url: string };
type GitHubCommit = {
  sha: string;
  html_url: string;
  author: { login: string } | null;
  commit: { author: { name: string; email: string; date: string } | null };
};

async function notifyPullRequestReview(input: {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  reviewers: string[];
  teamReviewers: string[];
}): Promise<{
  notification?: OutboxPublishResult;
  notificationWarning?: string;
}> {
  const requestedReviewers = [...input.reviewers, ...input.teamReviewers];
  try {
    const notification = await publishOutbox("review-requests", {
      type: "pull-request.ready",
      idempotencyKey: `${input.owner}/${input.repo}#${input.number}:review-request`,
      content: {
        title: `Review requested: ${input.title}`,
        body: requestedReviewers.length
          ? `Requested reviewers: ${requestedReviewers.join(", ")}`
          : "A cleanup pull request is ready for review.",
        url: input.url,
      },
    });
    return { notification };
  } catch (error) {
    return {
      notificationWarning: error instanceof Error ? error.message : String(error),
    };
  }
}

function filePath(value: string): string {
  const normalized = String(value ?? "").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\\")) {
    throw new Error(`Invalid repository file path: ${JSON.stringify(value)}`);
  }
  return normalized;
}

export const findFileOwners = defineTool({
  name: "github_file_owners",
  description:
    "Return recent GitHub commit authors for repository files when CODEOWNERS has no matching rule. This is evidence for ownership, not permission to guess a reviewer.",
  input: {
    type: "object",
    properties: {
      owner: { type: "string", minLength: 1 },
      repo: { type: "string", minLength: 1 },
      paths: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { type: "string", minLength: 1 },
      },
      perFile: { type: "integer", minimum: 1, maximum: 10, default: 5 },
    },
    required: ["owner", "repo", "paths"],
    additionalProperties: false,
  },
  async run({ input, signal }) {
    const owner = segment(String(input.owner), "owner");
    const repo = segment(String(input.repo), "repo");
    const perFile = Math.min(10, Math.max(1, Number(input.perFile ?? 5)));
    const result: Record<string, unknown> = {};
    for (const rawPath of input.paths as string[]) {
      const path = filePath(rawPath);
      const commits = await githubJson<GitHubCommit[]>(
        `/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=${perFile}`,
        { signal },
      );
      result[path] = (commits ?? []).map((commit) => ({
        login: commit.author?.login,
        name: commit.commit.author?.name,
        date: commit.commit.author?.date,
        sha: commit.sha,
        url: commit.html_url,
      }));
    }
    return result;
  },
});

export const openCleanupPullRequest = defineTool({
  name: "open_feature_flag_cleanup_pr",
  description:
    "Create or reuse a cleanup branch, commit complete file replacements/deletions, open a GitHub PR, and request known owners. Uses the managed GITHUB_PAT connection.",
  input: {
    type: "object",
    properties: {
      owner: { type: "string", minLength: 1 },
      repo: { type: "string", minLength: 1 },
      base: { type: "string", minLength: 1 },
      branch: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 },
      body: { type: "string", minLength: 1 },
      commitMessage: { type: "string", minLength: 1 },
      changes: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            path: { type: "string", minLength: 1 },
            content: { type: "string" },
            delete: { type: "boolean", default: false },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
      reviewers: { type: "array", items: { type: "string" }, default: [] },
      teamReviewers: { type: "array", items: { type: "string" }, default: [] },
      draft: { type: "boolean", default: false },
      dryRun: { type: "boolean", default: false },
    },
    required: ["owner", "repo", "branch", "title", "body", "commitMessage", "changes"],
    additionalProperties: false,
  },
  async run({ input, signal, reportProgress }) {
    const owner = segment(String(input.owner), "owner");
    const repo = segment(String(input.repo), "repo");
    const branch = String(input.branch).trim();
    if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) {
      throw new Error("branch contains unsupported characters");
    }
    const changes = (input.changes as FileChange[]).map((change) => ({
      ...change,
      path: filePath(change.path),
    }));
    const reviewers = (input.reviewers as string[] | undefined) ?? [];
    const teamReviewers = (input.teamReviewers as string[] | undefined) ?? [];

    const repository = await githubJson<GitHubRepository>(`/repos/${owner}/${repo}`, { signal });
    const base = String(input.base ?? repository!.default_branch);
    const head = `${owner}:${branch}`;
    const existing = await githubJson<GitHubPull[]>(
      `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(head)}&base=${encodeURIComponent(base)}`,
      { signal },
    );
    if (existing?.length) {
      const pull = existing[0]!;
      const notification = await notifyPullRequestReview({
        owner,
        repo,
        number: pull.number,
        url: pull.html_url,
        title: String(input.title),
        reviewers,
        teamReviewers,
      });
      return { status: "existing", pullRequest: pull, ...notification };
    }

    if (input.dryRun) {
      return {
        status: "dry-run",
        repository: `${owner}/${repo}`,
        base,
        branch,
        files: changes.map((change) => ({ path: change.path, delete: Boolean(change.delete) })),
      };
    }

    await reportProgress({ status: "creating-branch", branch });
    const branchRef = await githubJson<GitHubRef>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      { signal },
      true,
    );
    if (!branchRef) {
      const baseRef = await githubJson<GitHubRef>(
        `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
        { signal },
      );
      await githubJson(`/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef!.object.sha }),
      });
    }

    for (const [index, change] of changes.entries()) {
      await reportProgress({ status: "committing", file: change.path, current: index + 1, total: changes.length });
      const encodedPath = change.path.split("/").map(encodeURIComponent).join("/");
      const current = await githubJson<GitHubContent>(
        `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
        { signal },
        true,
      );
      if (current && current.type !== "file") {
        throw new Error(`${change.path} is not a file`);
      }
      if (change.delete) {
        if (!current) continue;
        await githubJson(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
          method: "DELETE",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: input.commitMessage,
            branch,
            sha: current.sha,
          }),
        });
      } else {
        if (typeof change.content !== "string") {
          throw new Error(`Replacement content is required for ${change.path}`);
        }
        await githubJson(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
          method: "PUT",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: input.commitMessage,
            branch,
            content: Buffer.from(change.content, "utf8").toString("base64"),
            ...(current ? { sha: current.sha } : {}),
          }),
        });
      }
    }

    await reportProgress({ status: "opening-pull-request" });
    const pull = await githubJson<GitHubPull>(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: branch,
        base,
        draft: Boolean(input.draft),
      }),
    });

    let reviewerWarning: string | undefined;
    if (reviewers.length || teamReviewers.length) {
      try {
        await githubJson(`/repos/${owner}/${repo}/pulls/${pull!.number}/requested_reviewers`, {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reviewers, team_reviewers: teamReviewers }),
        });
      } catch (error) {
        reviewerWarning = error instanceof Error ? error.message : String(error);
      }
    }

    const notification = await notifyPullRequestReview({
      owner,
      repo,
      number: pull!.number,
      url: pull!.html_url,
      title: String(input.title),
      reviewers,
      teamReviewers,
    });
    return {
      status: "created",
      number: pull!.number,
      url: pull!.html_url,
      ...(reviewerWarning ? { reviewerWarning } : {}),
      ...notification,
    };
  },
});
