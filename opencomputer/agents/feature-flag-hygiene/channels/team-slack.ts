import { registerChannel } from "@opencomputer/agent";
import teamSlack from "../../../channels/team-slack.js";

export default registerChannel(teamSlack, { on: ["mention"] });
