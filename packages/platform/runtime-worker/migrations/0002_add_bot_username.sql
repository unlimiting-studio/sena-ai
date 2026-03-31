CREATE TABLE bots_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  bot_username TEXT NOT NULL DEFAULT '',
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

INSERT INTO bots_new (
  id,
  name,
  bot_username,
  profile_image_url,
  connect_key,
  slack_app_id,
  slack_team_id,
  bot_token_enc,
  signing_secret_enc,
  client_id,
  client_secret_enc,
  manifest_json,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  name,
  '',
  profile_image_url,
  connect_key,
  slack_app_id,
  slack_team_id,
  bot_token_enc,
  signing_secret_enc,
  client_id,
  client_secret_enc,
  manifest_json,
  status,
  created_at,
  updated_at
FROM bots;

DROP TABLE bots;
ALTER TABLE bots_new RENAME TO bots;
