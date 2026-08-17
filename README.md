# OpenComputer × Unleash feature-flag hygiene agent

This project contains an OpenComputer agent that finds old Unleash release
flags still referenced by code and prepares one cleanup pull request per flag.
It also includes a dependency-free fixture application under
`examples/unleash-feature-flags-fixture`.

## Prerequisites

- Node.js 22 or newer
- Access to the linked OpenComputer project
- A GitHub personal access token configured as described in
  [GitHub PAT permissions](#github-pat-permissions)
- An Unleash personal access token for the configured US Cloud instance
- The remote MCP server enabled under **Admin settings → Remote MCP server**

## GitHub PAT permissions

Prefer a fine-grained personal access token. Set its resource owner to the user
or organization that owns every repository the agent will inspect, select only
those repositories, and grant these repository permissions:

- **Contents: Read and write** — clone/read the repository, create the cleanup
  branch, and commit updated or deleted files.
- **Pull requests: Read and write** — detect an existing cleanup PR, open a new
  PR, and request reviewers.

GitHub automatically includes **Metadata: Read-only**. No Issues,
Administration, Actions, or repository-secret permission is needed. If the
agent must change a file under `.github/workflows/`, also grant
**Workflows: Read and write**.

For an organization-owned repository, the token may require organization-owner
approval. If the organization uses SAML SSO, authorize the token for that
organization as well. The token's owner must already have permission to push a
branch and open a pull request in each selected repository; a PAT cannot grant
more access than its owner has.

If a classic PAT is unavoidable, grant the **repo** scope. Add **workflow** only
when cleanup PRs may modify `.github/workflows/` files. Fine-grained tokens are
preferred because they can be restricted to named repositories and the two
permissions above.

## Install

```bash
npm install
```

## Configure development secrets

The agent runs in OpenComputer's Development environment. A local `.env.local`
is useful for direct API scripts, but it is not sent to the managed agent
runtime. Store both credentials as managed development secrets:

```bash
npm run opencomputer -- secrets set GITHUB_PAT \
  --environment development \
  --agent current

npm run opencomputer -- secrets set UNLEASH_API_TOKEN \
  --environment development \
  --agent current
```

Each command prompts for a hidden value. Never commit or pass either token as
a command argument.

## Start the development inspector

```bash
npm run dev
```

Keep this process open. It compiles and syncs agent changes to the Development
deployment and displays the local Debug Inspector.

## Run a safe fixture test

The fixture flags are in the Unleash project `feature-example-test`. They were
created recently, so use a zero-day threshold for the first test. Start with a
dry run so the agent analyzes everything without opening pull requests:

```bash
npm run session -- "Analyze repository diggerhq/opencomputer-example-unleash using Unleash project feature-example-test and production environment. Use minimumAgeDays 0, GitHub PAT mode, and dryRun true."
```

Expected result:

- `fixture-checkout-v2`, `profile-page-v2`, and `semantic-search` are eligible
  because they are enabled and referenced by executable code.
- `invoice-pdf-v2` is skipped because production is disabled.
- `docs-only-cleanup` is skipped because it appears only in documentation.

When the dry-run output looks correct, rerun with `dryRun false`:

```bash
npm run session -- "Analyze repository diggerhq/opencomputer-example-unleash using Unleash project feature-example-test and production environment. Use minimumAgeDays 0, GitHub PAT mode, and dryRun false. Open the eligible cleanup pull requests."
```

The agent should open one PR per eligible flag and leave the flags themselves
unchanged in Unleash. Outside dry-run mode, every created or reused PR also
publishes one deduplicated review request to the configured Slack destination.

## Configure Slack review notifications

The project defines a `team-slack` channel in code and maps its
`pull-request-reviews` destination to the `review-requests` outbox. Deploy or
start development sync once so OpenComputer can discover those resources.

In the project's **Channels** tab:

1. Open `team-slack`, create the Slack app from the generated manifest, and
   install it in the workspace.
2. Invite the installed app to the public Slack channel that should receive
   review requests.
3. Bind `pull-request-reviews` to that Slack conversation's stable ID (the
   value beginning with `C`), not its mutable `#channel-name`.

Bindings are environment-specific: configure Development while testing and
configure Production separately before deploying there. If the channel's
declared Slack scopes later expand, reconnect the app so the workspace can
authorize the additional scopes.

The same app also listens for `@mention` events and routes them to the
feature-flag hygiene agent. A Slack delivery failure is returned as
`notificationWarning`; it does not turn an already-created GitHub pull request
into a failed tool call. Re-running the tool reuses the stable
`owner/repository#pull-number:review-request` idempotency key, so the outbox can
deduplicate the notification.

## Test the code-defined schedule

The `weekday-hygiene` definition under the agent's `schedules/` directory runs
at 9:00 AM Pacific on weekdays in Production. Development discovers and displays
the same definition but leaves it manual-only by default. Open the project's
**Schedules** tab in Development and choose **Run now** to test it safely.

The schedule sends `payload.mode: "async"`, which selects the unattended agent
behavior. `input.source: "schedule"` remains execution provenance and is not a
business-mode switch. The example payload uses `dryRun: true`; change that only
after validating the candidates and reviewer routing.

To test automatic recurrence in Development explicitly, add `"development"` to
the schedule's `enabled` array and redeploy. Development and Production keep
separate schedule rows, run histories, sessions, secrets, and channel bindings.

## Verify the fixture directly

```bash
cd examples/unleash-feature-flags-fixture
npm test
npm run typecheck
```
