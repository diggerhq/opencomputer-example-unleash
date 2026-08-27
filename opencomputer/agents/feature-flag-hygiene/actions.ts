import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  allow,
  defineAction,
  deny,
  requireApproval,
  useAction,
  useGate,
  useSecret,
} from "@opencomputer/agent";

const execFileAsync = promisify(execFile);
const repository = "diggerhq/opencomputer-example-unleash";

function oid(value: unknown, label: string): string {
  const normalized = String(value ?? "");
  if (!/^[0-9a-f]{40,64}$/.test(normalized)) {
    throw new Error(`${label} must be an exact Git object ID`);
  }
  return normalized;
}

function branch(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(normalized) || normalized.includes("..")) {
    throw new Error("externalBranch is invalid");
  }
  return normalized;
}

export const createPullRequest = defineAction({
  id: "create-pull-request",
  server: "github",
  tool: "create_pull_request",
  description: "Publish an exact feature-flag cleanup commit and create its pull request",
  effect: "write",
  duration: "inline",
  input: {
    type: "object",
    properties: {
      repositoryId: { type: "string" },
      headOid: { type: "string" },
      baseBranch: { type: "string" },
      baseOid: { type: "string" },
      externalBranch: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      draft: { type: "boolean" },
    },
    required: [
      "repositoryId",
      "headOid",
      "baseBranch",
      "baseOid",
      "externalBranch",
      "title",
      "body",
    ],
  },
  secrets: {
    githubToken: useSecret("GITHUB_TOKEN"),
  },
  async run({ input, secrets, repositories }) {
    if (input.repositoryId !== "application") {
      throw new Error("Repository is not allowed");
    }
    const mirror = repositories.application;
    if (!mirror) throw new Error("Managed repository application is unavailable");
    const headOid = oid(input.headOid, "headOid");
    const baseOid = oid(input.baseOid, "baseOid");
    const externalBranch = branch(input.externalBranch);
    const temporary = await mkdtemp(join(tmpdir(), "feature-hygiene-action-"));
    const askPass = join(temporary, "git-askpass.sh");
    try {
      await writeFile(
        askPass,
        "#!/bin/sh\ncase \"$1\" in *Username*) printf '%s\\n' x-access-token ;; *) printf '%s\\n' \"$OPENCOMPUTER_ACTION_GITHUB_TOKEN\" ;; esac\n",
        { mode: 0o700 },
      );
      await execFileAsync("git", ["init", "--bare", temporary]);
      await execFileAsync("git", ["fetch", mirror.remote, headOid], {
        cwd: temporary,
      });

      const currentBase = await fetch(
        `https://api.github.com/repos/${repository}/git/ref/heads/${encodeURIComponent(String(input.baseBranch))}`,
        {
          headers: {
            authorization: `Bearer ${secrets.githubToken}`,
            accept: "application/vnd.github+json",
            "user-agent": "opencomputer-feature-hygiene-action",
          },
        },
      );
      if (!currentBase.ok) throw new Error(`GitHub base lookup returned ${currentBase.status}`);
      const currentBaseJson = await currentBase.json() as { object?: { sha?: string } };
      if (currentBaseJson.object?.sha !== baseOid) {
        throw new Error("base_moved: fetch, rebase, test, and submit a new action");
      }

      await execFileAsync(
        "git",
        [
          "push",
          `https://github.com/${repository}.git`,
          `${headOid}:refs/heads/${externalBranch}`,
        ],
        {
          cwd: temporary,
          env: {
            ...process.env,
            GIT_ASKPASS: askPass,
            GIT_TERMINAL_PROMPT: "0",
            OPENCOMPUTER_ACTION_GITHUB_TOKEN: secrets.githubToken,
          },
        },
      );

      const response = await fetch(`https://api.github.com/repos/${repository}/pulls`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secrets.githubToken}`,
          accept: "application/vnd.github+json",
          "content-type": "application/json",
          "user-agent": "opencomputer-feature-hygiene-action",
        },
        body: JSON.stringify({
          title: input.title,
          body: input.body,
          head: externalBranch,
          base: input.baseBranch,
          draft: input.draft !== false,
        }),
      });
      if (!response.ok) throw new Error(`GitHub create PR returned ${response.status}`);
      const pull = await response.json() as {
        number: number;
        html_url: string;
      };
      return {
        status: "created",
        number: pull.number,
        url: pull.html_url,
        repository,
        externalBranch,
        headOid,
        baseOid,
      };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
});

export default function Actions() {
  const action = useAction();
  useGate(() => {
    if (
      action.definitionId !== createPullRequest.id ||
      action.input.repositoryId !== "application"
    ) {
      return deny("Feature hygiene may only publish its configured repository");
    }
    if (action.input.draft === false) {
      return requireApproval({
        role: "project-admin",
        reason: "Publishing a non-draft feature cleanup requires approval",
      });
    }
    return allow();
  });
}
