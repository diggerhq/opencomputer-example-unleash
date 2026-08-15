import { registerOutbox } from "@opencomputer/agent";
import reviewRequests from "../../../outboxes/review-requests.js";

export default registerOutbox(reviewRequests);
