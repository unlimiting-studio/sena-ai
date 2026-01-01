CREATE TABLE IF NOT EXISTS agent_configs (
  agent_id TEXT PRIMARY KEY,
  slack_app_id TEXT,
  slack_token TEXT,
  slack_bot_token TEXT,
  slack_signing_secret TEXT,
  github_token TEXT,
  sena_yaml TEXT
);
