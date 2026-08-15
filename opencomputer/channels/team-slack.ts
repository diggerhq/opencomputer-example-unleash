import { defineChannel } from "@opencomputer/agent";

export default defineChannel({
  id: "team-slack",
  type: "slack",
  displayName: "Feature Flag Hygiene",
  scopes: {
    bot: ["app_mentions:read", "channels:read", "chat:write"],
  },
  events: ["app_mention"],
  destinations: {
    "pull-request-reviews": {
      type: "conversation",
      visibility: "public",
    },
  },
  routing: { whenAmbiguous: "ask" },
});
