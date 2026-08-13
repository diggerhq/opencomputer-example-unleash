# OpenComputer × Unleash feature-flag hygiene agent

This project contains an OpenComputer agent that finds old Unleash release
flags still referenced by code and prepares one cleanup pull request per flag.
It also includes a dependency-free fixture application under
`examples/unleash-feature-flags-fixture`.

## Prerequisites

- Node.js 22 or newer
- Access to the linked OpenComputer project
- `GITHUB_PAT` with permission to read this repository and create branches and
  pull requests
- An Unleash personal access token for the configured US Cloud instance
- The remote MCP server enabled under **Admin settings → Remote MCP server**

## Install

```bash
npm install
```

## Configure development secrets

The agent runs in OpenComputer's Development environment. A local `.env.local`
is useful for direct API scripts, but it is not sent to the managed agent
runtime. Store both credentials as managed development secrets:

```bash
npx opencomputer secrets set GITHUB_PAT \
  --environment development \
  --agent current

npx opencomputer secrets set UNLEASH_API_TOKEN \
  --environment development \
  --agent current
```

Each command prompts for a hidden value. Never commit either token.

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
unchanged in Unleash.

## Verify the fixture directly

```bash
cd examples/unleash-feature-flags-fixture
npm test
npm run typecheck
```
