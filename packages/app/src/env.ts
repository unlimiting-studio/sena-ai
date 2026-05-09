export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`[@sena-ai/app] Missing required env: ${name}`);
  }
  return value;
}
