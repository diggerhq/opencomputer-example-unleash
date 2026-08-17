import { defineSchedule } from "@opencomputer/agent";

export default defineSchedule({
  id: "weekday-hygiene",
  cron: "0 9 * * 1-5",
  timezone: "America/Los_Angeles",
  enabled: ["production"],
  overlap: "skip",
  dispatch: {
    text: "Run the configured feature-flag hygiene review.",
    payload: {
      mode: "async",
      repository: "diggerhq/opencomputer-example-unleash",
      projectId: "feature-example-test",
      productionEnvironment: "production",
      minimumAgeDays: 10,
      githubAuth: "pat",
      dryRun: true,
    },
  },
});
