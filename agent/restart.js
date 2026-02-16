#!/usr/bin/env node
"use strict";

const DEFAULT_PORT = 3101;

const parsePort = (value, fallback) => {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/u.test(normalized)) {
    return fallback;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return fallback;
  }
  return parsed;
};

const formatBodyForOutput = (rawBody) => {
  const text = rawBody.trim();
  if (text.length === 0) {
    return "";
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
};

const requestRestart = async () => {
  const port = parsePort(process.env.PORT, DEFAULT_PORT);
  const endpoint = `http://127.0.0.1:${port}/restart`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[restart] request_failed endpoint=${endpoint}`);
    console.error(`[restart] error=${message}`);
    process.exit(1);
  }

  const rawBody = await response.text();
  const formattedBody = formatBodyForOutput(rawBody);

  if (response.ok) {
    console.log(`[restart] request_accepted endpoint=${endpoint}`);
    console.log(`[restart] status=${response.status} ${response.statusText}`);
    if (formattedBody.length > 0) {
      console.log(formattedBody);
    }
    process.exit(0);
  }

  console.error(`[restart] request_rejected endpoint=${endpoint}`);
  console.error(`[restart] status=${response.status} ${response.statusText}`);
  if (formattedBody.length > 0) {
    console.error(formattedBody);
  }
  process.exit(1);
};

void requestRestart();
