import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import JSON5 from "json5";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const DEFAULT_AGENT_NAME = "세나";
const DEFAULT_BASE_PROMPT = [
  "당신은 {{name}}입니다. Slack 멘션으로 호출되어 요청된 작업을 수행하는 사내 다기능 코딩 에이전트입니다.",
  "특히 코딩/리포지토리 분석/문서 조사에 강하며, Slack 동료에게 따뜻하고 친절한 동료처럼 응답합니다.",
].join("\n");

const BasePromptSchema = z.union([z.string(), z.array(z.string())]);

const McpHttpServerSchema = z.object({
  type: z.enum(["http", "sse"]),
  url: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
});

const McpStdioServerSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const McpServerEntrySchema = z.union([McpHttpServerSchema, McpStdioServerSchema]);
const RuntimeModeSchema = z.enum(["claude", "codex"]);
const RuntimeConfigSchema = z.object({
  mode: RuntimeModeSchema.optional(),
  model: z.string().min(1).optional(),
});
const CronjobSchema = z.object({
  expr: z.string().min(1),
  name: z.string().min(1).optional(),
  prompt: z.string().min(1),
});
const HeartbeatSchema = z.object({
  intervalMinute: z.number().int().positive(),
  prompt: z.string().min(1),
});

const AgentConfigSchema = z.object({
  name: z.string().min(1).optional(),
  basePrompt: BasePromptSchema.optional(),
  mcpServers: z.record(z.string(), McpServerEntrySchema).optional(),
  runtime: RuntimeConfigSchema.optional(),
  cronjobs: z.array(CronjobSchema).optional(),
  heartbeat: HeartbeatSchema.optional(),
});

export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;
export type AgentRuntimeMode = z.infer<typeof RuntimeModeSchema>;

type AgentRuntimeConfig = {
  mode: AgentRuntimeMode | null;
  model: string | null;
};

type AgentCronjob = {
  expr: string;
  name: string;
  prompt: string;
};

type AgentHeartbeat = {
  intervalMinute: number;
  prompt: string;
};

type AgentConfig = {
  name: string;
  basePrompt: string;
  mcpServers: Record<string, McpServerEntry>;
  runtime: AgentRuntimeConfig;
  cronjobs: AgentCronjob[];
  heartbeat: AgentHeartbeat | null;
};

type ConfigFormat = "yaml" | "jsonc";

type ConfigCandidate = {
  path: string;
  format: ConfigFormat;
};

const CONFIG_FILES: Array<{ filename: string; format: ConfigFormat }> = [
  { filename: "sena.yaml", format: "yaml" },
  { filename: "sena.yml", format: "yaml" },
  { filename: "sena.jsonc", format: "jsonc" },
];

const toOptionalNonEmptyString = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const expandHomePath = (candidatePath: string): string => {
  if (candidatePath === "~") {
    return os.homedir();
  }
  if (candidatePath.startsWith("~/")) {
    return path.join(os.homedir(), candidatePath.slice(2));
  }
  return candidatePath;
};

const resolvePathFromCwd = (candidatePath: string): string => {
  const expanded = expandHomePath(candidatePath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);
};

const detectConfigFormat = (candidatePath: string): ConfigFormat =>
  path.extname(candidatePath).toLowerCase() === ".jsonc" ? "jsonc" : "yaml";

const buildConfigCandidates = (): ConfigCandidate[] => {
  const candidates: ConfigCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidate: ConfigCandidate): void => {
    const resolvedPath = resolvePathFromCwd(candidate.path);
    if (seen.has(resolvedPath)) {
      return;
    }
    seen.add(resolvedPath);
    candidates.push({ path: resolvedPath, format: candidate.format });
  };

  const pushConfigDir = (rawDir: string | null | undefined): void => {
    const dir = toOptionalNonEmptyString(rawDir);
    if (!dir) {
      return;
    }
    for (const file of CONFIG_FILES) {
      pushCandidate({ path: path.join(dir, file.filename), format: file.format });
    }
  };

  const explicitConfigPath = toOptionalNonEmptyString(process.env.SENA_CONFIG_PATH);
  if (explicitConfigPath) {
    pushCandidate({ path: explicitConfigPath, format: detectConfigFormat(explicitConfigPath) });
  }

  const entrypoint = toOptionalNonEmptyString(process.argv[1]);
  const entrypointDir = entrypoint ? path.dirname(resolvePathFromCwd(entrypoint)) : null;
  const entrypointParentDir = entrypointDir ? path.dirname(entrypointDir) : null;

  pushConfigDir(process.cwd());
  pushConfigDir(entrypointDir);
  pushConfigDir(entrypointParentDir);
  pushConfigDir(process.env.WORKSPACE_DIR);
  pushConfigDir(path.join(os.homedir(), "agents", "sena"));
  pushConfigDir(os.homedir());

  return candidates;
};

const applyNameTemplate = (value: string, name: string): string => value.replaceAll("{{name}}", name);

const normalizeName = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : DEFAULT_AGENT_NAME;
};

const normalizeBasePrompt = (value: string | string[] | undefined, name: string): string => {
  const raw = Array.isArray(value) ? value.join("\n") : (value ?? "");
  const trimmed = raw.trim();
  const prompt = trimmed.length > 0 ? trimmed : DEFAULT_BASE_PROMPT;
  return applyNameTemplate(prompt, name);
};

const normalizeRuntimeConfig = (raw: z.infer<typeof RuntimeConfigSchema> | undefined): AgentRuntimeConfig => {
  const mode = raw?.mode ?? null;
  const trimmedModel = raw?.model?.trim() ?? "";
  return {
    mode,
    model: trimmedModel.length > 0 ? trimmedModel : null,
  };
};

const normalizeCronjobs = (raw: z.infer<typeof CronjobSchema>[] | undefined): AgentCronjob[] => {
  if (!raw || raw.length === 0) {
    return [];
  }

  return raw
    .map((job, index) => {
      const expr = substituteEnvVars(job.expr).trim();
      const prompt = substituteEnvVars(job.prompt).trim();
      if (expr.length === 0 || prompt.length === 0) {
        return null;
      }
      const rawName = substituteEnvVars(job.name ?? "").trim();
      const name = rawName.length > 0 ? rawName : `cronjob-${index + 1}`;
      return { expr, name, prompt };
    })
    .filter((job): job is AgentCronjob => job !== null);
};

const normalizeHeartbeat = (raw: z.infer<typeof HeartbeatSchema> | undefined): AgentHeartbeat | null => {
  if (!raw) {
    return null;
  }
  const prompt = substituteEnvVars(raw.prompt).trim();
  if (prompt.length === 0) {
    return null;
  }
  return {
    intervalMinute: raw.intervalMinute,
    prompt,
  };
};

const substituteEnvVars = (value: string): string =>
  value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => process.env[key] ?? "");

const substituteEnvVarsInRecord = (record: Record<string, string>): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = substituteEnvVars(v);
  }
  return result;
};

const normalizeMcpServers = (raw: Record<string, McpServerEntry> | undefined): Record<string, McpServerEntry> => {
  if (!raw) {
    return {};
  }
  const result: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if ("command" in entry) {
      result[name] = {
        ...entry,
        ...(entry.env ? { env: substituteEnvVarsInRecord(entry.env) } : {}),
      };
    } else {
      result[name] = {
        ...entry,
        url: substituteEnvVars(entry.url),
        ...(entry.headers ? { headers: substituteEnvVarsInRecord(entry.headers) } : {}),
      };
    }
  }
  return result;
};

const buildDefaultConfig = (): AgentConfig => ({
  name: DEFAULT_AGENT_NAME,
  basePrompt: applyNameTemplate(DEFAULT_BASE_PROMPT, DEFAULT_AGENT_NAME),
  mcpServers: {},
  runtime: { mode: null, model: null },
  cronjobs: [],
  heartbeat: null,
});

const parseConfig = (raw: string, format: ConfigFormat): unknown => {
  const normalized = raw.replace(/^\uFEFF/, "");
  if (format === "yaml") {
    return parseYaml(normalized);
  }
  return JSON5.parse(normalized);
};

const loadAgentConfigFromEnv = (): AgentConfig | null => {
  const raw = process.env.SENA_YAML;
  if (!raw || raw.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseConfig(raw, "yaml");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.warn(`Failed to parse SENA_YAML: ${message}`);
    return buildDefaultConfig();
  }

  const result = AgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    console.warn("Invalid SENA_YAML format; falling back to defaults.");
    return buildDefaultConfig();
  }

  const name = normalizeName(result.data.name);
  const basePrompt = normalizeBasePrompt(result.data.basePrompt, name);
  const mcpServers = normalizeMcpServers(result.data.mcpServers);
  const runtime = normalizeRuntimeConfig(result.data.runtime);
  const cronjobs = normalizeCronjobs(result.data.cronjobs);
  const heartbeat = normalizeHeartbeat(result.data.heartbeat);
  return { name, basePrompt, mcpServers, runtime, cronjobs, heartbeat };
};

const loadAgentConfig = (): AgentConfig => {
  const envConfig = loadAgentConfigFromEnv();
  if (envConfig) {
    return envConfig;
  }

  for (const candidate of buildConfigCandidates()) {
    if (!fs.existsSync(candidate.path)) {
      continue;
    }

    let parsed: unknown;
    try {
      const raw = fs.readFileSync(candidate.path, "utf8");
      parsed = parseConfig(raw, candidate.format);
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      console.warn(`에이전트 설정 파일을 읽는 중 오류가 발생했습니다: ${candidate.path} (${message})`);
      return buildDefaultConfig();
    }

    const result = AgentConfigSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(`에이전트 설정 파일 형식이 올바르지 않습니다: ${candidate.path}`);
      return buildDefaultConfig();
    }

    const name = normalizeName(result.data.name);
    const basePrompt = normalizeBasePrompt(result.data.basePrompt, name);
    const mcpServers = normalizeMcpServers(result.data.mcpServers);
    const runtime = normalizeRuntimeConfig(result.data.runtime);
    const cronjobs = normalizeCronjobs(result.data.cronjobs);
    const heartbeat = normalizeHeartbeat(result.data.heartbeat);
    return { name, basePrompt, mcpServers, runtime, cronjobs, heartbeat };
  }

  return buildDefaultConfig();
};

const AGENT_CONFIG = loadAgentConfig();

const hasFinalConsonant = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  const lastChar = trimmed.charCodeAt(trimmed.length - 1);
  if (lastChar < 0xac00 || lastChar > 0xd7a3) {
    return false;
  }
  return (lastChar - 0xac00) % 28 !== 0;
};

const withJosa = (value: string, consonant: string, vowel: string): string =>
  `${value}${hasFinalConsonant(value) ? consonant : vowel}`;

export const getAgentConfig = (): AgentConfig => AGENT_CONFIG;
export const getAgentName = (): string => AGENT_CONFIG.name;
export const getAgentBasePrompt = (): string => AGENT_CONFIG.basePrompt;
export const getAgentMcpServers = (): Record<string, McpServerEntry> => AGENT_CONFIG.mcpServers;
export const getAgentRuntimeConfig = (): AgentRuntimeConfig => AGENT_CONFIG.runtime;
export const getAgentCronjobs = (): AgentCronjob[] => AGENT_CONFIG.cronjobs;
export const getAgentHeartbeat = (): AgentHeartbeat | null => AGENT_CONFIG.heartbeat;
export const getAgentSubject = (): string => withJosa(getAgentName(), "이", "가");
export const formatAgentNameWithSuffix = (suffix: string): string => `${getAgentName()}${suffix}`;
