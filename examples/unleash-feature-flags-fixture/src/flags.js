/**
 * Tiny local stand-in for an Unleash SDK client.
 *
 * Production applications would delegate this call to the real Unleash SDK.
 * Keeping the adapter dependency-free makes this fixture deterministic while
 * preserving the code shape that the cleanup agent needs to analyze.
 */
export function isEnabled(flagName) {
  const enabledFlags = new Set(
    (process.env.UNLEASH_FLAGS ?? "")
      .split(",")
      .map((flag) => flag.trim())
      .filter(Boolean),
  );

  return enabledFlags.has(flagName);
}
