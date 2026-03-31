CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile_image_url TEXT,
  connect_key TEXT NOT NULL UNIQUE,
  slack_app_id TEXT,
  slack_team_id TEXT,
  bot_token_enc TEXT,
  signing_secret_enc TEXT,
  client_id TEXT,
  client_secret_enc TEXT,
  manifest_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS config_tokens (
  workspace_id TEXT PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_admin_config (
  workspace_id TEXT PRIMARY KEY,
  slack_client_id TEXT,
  slack_client_secret_enc TEXT,
  d_cookie_enc TEXT,
  xoxc_token_enc TEXT,
  workspace_domain TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_by_user_id TEXT
);
