export function profilePage(user) {
  return {
    layout: "cards",
    displayName: user.displayName,
    canEdit: user.permissions.includes("profile:write"),
  };
}

export function profileNavigation() {
  return ["Overview", "Activity", "Settings"];
}
