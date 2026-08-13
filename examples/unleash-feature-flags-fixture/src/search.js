import { isEnabled } from "./flags.js";

export function search(query) {
  // This flag is deliberately too young to remove in the recommended setup.
  if (isEnabled("semantic-search")) {
    return { engine: "semantic", query, limit: 20 };
  }

  return { engine: "keyword", query, limit: 50 };
}
