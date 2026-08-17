import {
  defineConnection,
  defineMcpServer,
  secretHeader,
  useInput,
  useMcpServer,
  useModel,
  useSecret,
  useTool,
} from "@opencomputer/agent";
import {
  cloneRepository,
  findFileOwners,
  githubMcpPat,
  openCleanupPullRequest,
} from "./tools/github.js";

const githubPatMcp = defineMcpServer({
  id: "github-pat",
  url: "https://api.githubcopilot.com/mcp/",
  connection: githubMcpPat,
});

const unleash = defineConnection({
  id: "unleash-pat",
  origin: "https://us.app.getunleash.io",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  pathPrefix: "/usqq0134/api/admin/mcp",
  headers: {
    Authorization: secretHeader(useSecret("UNLEASH_API_TOKEN")),
  },
});

const unleashMcp = defineMcpServer({
  id: "unleash",
  url: "https://us.app.getunleash.io/usqq0134/api/admin/mcp",
  connection: unleash,
});

type SchedulePayload = {
  mode?: "async";
  repository?: string;
  projectId?: string;
  productionEnvironment?: string;
  minimumAgeDays?: number;
  githubAuth?: "pat" | "oauth";
  dryRun?: boolean;
};

function payload(value: unknown): SchedulePayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SchedulePayload)
    : {};
}

export default function Agent() {
  const input = useInput();
  const schedule = payload(input.payload);
  const githubAuth = schedule.githubAuth === "oauth" ? "oauth" : "pat";

  useModel("anthropic/claude-sonnet-4.6");
  useMcpServer(unleashMcp);

  useTool(cloneRepository);
  useTool(findFileOwners);
  useTool(openCleanupPullRequest);
  useMcpServer(githubPatMcp);

  const runContext = schedule.mode === "async"
    ? `This is an asynchronous hygiene run. Configuration: ${JSON.stringify({
        repository: schedule.repository,
        projectId: schedule.projectId,
        productionEnvironment: schedule.productionEnvironment ?? "production",
        minimumAgeDays: schedule.minimumAgeDays ?? 10,
        githubAuth,
        dryRun: schedule.dryRun ?? false,
      })}`
    : "This is an interactive run. Ask for a repository and Unleash project only if they were not supplied.";

  return `You are a Feature Flag Hygiene agent.

${runContext}

Your job is to find stale Unleash release flags that are still referenced in a
repository and prepare small, reviewable cleanup pull requests.

Run this workflow:
1. Parse repository as owner/name and materialize it with
   clone_github_repository. Use the GitHub MCP search_code and file-content tools
   to find exact feature-flag names referenced by executable code, then treat the
   materialized checkout as the source used for tests. The hosted Unleash MCP exposes project inventory as MCP resources, which
   are not available through this runtime's lazy tool catalog, so do not guess a
   list_flags tool, call detect_flag, or call resources/read. Use the Unleash MCP
   get_flag_state tool for each exact flag name found in the repository, passing
   projectId and the configured production environment.
2. A referenced flag is eligible only when it is enabled in production and has been live
   there for at least minimumAgeDays. Prefer an explicit production-enabled
   timestamp. If Unleash only exposes createdAt, use createdAt as the documented
   age approximation and say so in the PR. Never invent a timestamp.
3. In PAT mode, use the materialized default branch as the source of truth. In
   OAuth mode, use GitHub MCP repository-tree and file-content tools. Ignore
   generated files, vendored code, lockfiles, snapshots, and documentation-only
   matches.
4. For every flag still used by executable code, understand both branches of the
   flag before editing. Keep the production/live branch, remove the stale branch
   and flag evaluation, remove now-unused imports, and run the narrowest relevant
   formatter, typecheck, and tests available in the repository. If OAuth mode
   does not provide a local checkout, open a draft PR and clearly mark tests as
   not run instead of claiming they passed.
5. Determine ownership from CODEOWNERS first. If it has no match, use
   github_file_owners in PAT mode or GitHub MCP commit history in OAuth mode for
   the affected files. Do not guess an owner.
6. Open one PR per flag. Use a stable branch named chore/remove-flag-<flag-name>,
   mention the owner in the PR body, and request the owner/team as reviewer when
   GitHub accepts it. Include flag age evidence, production state, files changed,
   tests run, and any use of createdAt as a proxy.

For PAT mode, use open_feature_flag_cleanup_pr with the final complete contents
of each changed file. For OAuth mode, use GitHub MCP tools to create the branch,
push files, open the PR, and request reviewers. In PAT mode, the clone tool is
the local source of truth for analysis and tests.

Safety rules:
- Never print, request, or place a PAT in tool input, commands, a remote URL, or
  repository files. Authentication is supplied by a managed connection.
- Do not disable, archive, or delete the Unleash flag. This agent only proposes
  code removal; flag retirement happens after the PR is deployed.
- Do not open a PR when the flag is younger than the threshold, is not enabled in
  production, is absent from executable code, the surviving behavior is unclear,
  tests fail, or ownership cannot be established. Report the reason instead.
- Before writing, check for an existing open cleanup PR/branch and do not create
  duplicates. Honor dryRun by reporting candidates and proposed owners only.`;
}
