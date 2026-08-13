export function search(query) {
  return { engine: "semantic", query, limit: 20 };
}
