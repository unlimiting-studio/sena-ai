import {
  createPostgresState,
  type CreatePostgresStateOptions,
} from "@chat-adapter/state-pg";

export { createPostgresState, PostgresStateAdapter } from "@chat-adapter/state-pg";
export type {
  CreatePostgresStateOptions,
  PostgresStateAdapterOptions,
  PostgresStateClientOptions,
} from "@chat-adapter/state-pg";

export type PostgresStateOptions = CreatePostgresStateOptions & {
  /** Alias for `url`, matching common DATABASE_URL naming. */
  connectionString?: string;
};

export function postgresState(options: PostgresStateOptions = {}) {
  if ("client" in options && options.client) {
    return createPostgresState(options);
  }

  const { connectionString, ...rest } = options;
  const configuredUrl = "url" in rest ? rest.url : undefined;
  const url = configuredUrl ?? connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "[@sena-ai/app] postgresState requires `url`/`connectionString` or DATABASE_URL.",
    );
  }
  return createPostgresState({ ...rest, url });
}
