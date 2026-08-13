# Unleash feature-flag cleanup fixture

This is a deliberately small application for testing an automated feature-flag
hygiene agent. It has no third-party dependencies and uses a local flag adapter,
so its tests do not need access to Unleash.

## Unleash setup

Create a project in your Unleash test instance and add these release flags.
Use `production` as the environment and run the hygiene agent with a
`minimumAgeDays` value of `10`.

| Flag | Production state | Required age | Expected agent result |
| --- | --- | --- | --- |
| `fixture-checkout-v2` | enabled | at least 10 days | Open a PR that keeps `modernCheckout` |
| `profile-page-v2` | enabled | at least 10 days | Open one PR covering both references |
| `semantic-search` | enabled | less than 10 days | Skip because it is too young |
| `invoice-pdf-v2` | disabled | at least 10 days | Skip because production is disabled |
| `docs-only-cleanup` | enabled | at least 10 days | Skip because it appears only in docs |

If your test Unleash instance cannot backdate an enabled timestamp, lower
`minimumAgeDays` to `0` for the two removable flags. To keep the young-flag
scenario meaningful, create `semantic-search` after the others and use whatever
positive threshold distinguishes their ages.

## GitHub setup

This fixture can be tested in place from the parent repository. If you publish
this directory as its own repository, update `.github/CODEOWNERS` to a GitHub
user or team that has access to that repository.

```bash
git init
git add .
git commit -m "Add Unleash cleanup test fixture"
git branch -M main
git remote add origin git@github.com:YOUR_USER/unleash-feature-flags-fixture.git
git push -u origin main
```

The repository can be private as long as the `GITHUB_PAT` configured for the
agent can read it and create branches and pull requests.

## Verify the fixture

```bash
npm test
npm run typecheck
```

The initial tests assert the production behavior for the removable flags. After
the cleanup PRs remove their evaluations and fallback branches, the same tests
should continue to pass.
