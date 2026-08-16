import { defineOutbox } from "@opencomputer/agent";
import teamSlack from "../channels/team-slack.js";

export default defineOutbox({
  id: "review-requests",
  delivery: {
    channel: teamSlack,
    destination: "pull-request-reviews",
  },
});
