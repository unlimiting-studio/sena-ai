export function sanitizeEnv(env: typeof process.env, keysToRemove: string[] = []): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => !keysToRemove.includes(entry[0]) && typeof entry[1] !== "undefined",
    ),
  );
}
