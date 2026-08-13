import { isEnabled } from "./flags.js";

export function profilePage(user) {
  const page = isEnabled("profile-page-v2")
    ? { layout: "cards", displayName: user.displayName }
    : { layout: "classic", displayName: user.displayName };

  return {
    ...page,
    canEdit: user.permissions.includes("profile:write"),
  };
}

export function profileNavigation() {
  return isEnabled("profile-page-v2")
    ? ["Overview", "Activity", "Settings"]
    : ["Profile", "Settings"];
}
