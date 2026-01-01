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
const AgentConfigSchema = z.object({
  name: z.string().min(1).optional(),
  basePrompt: BasePromptSchema.optional(),
});

type AgentConfig = {
  name: string;
  basePrompt: string;
};

type ConfigFormat = "yaml" | "jsonc";

type ConfigCandidate = {
  path: string;
  format: ConfigFormat;
};

const CONFIG_CANDIDATES: ConfigCandidate[] = [
  { path: path.join(process.cwd(), "sena.yaml"), format: "yaml" },
  { path: path.join(process.cwd(), "sena.yml"), format: "yaml" },
  { path: path.join(process.cwd(), "sena.jsonc"), format: "jsonc" },
  { path: path.join(os.homedir(), "sena.yaml"), format: "yaml" },
  { path: path.join(os.homedir(), "sena.yml"), format: "yaml" },
  { path: path.join(os.homedir(), "sena.jsonc"), format: "jsonc" },
];

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

const buildDefaultConfig = (): AgentConfig => ({
  name: DEFAULT_AGENT_NAME,
  basePrompt: applyNameTemplate(DEFAULT_BASE_PROMPT, DEFAULT_AGENT_NAME),
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
  return { name, basePrompt };
};

const loadAgentConfig = (): AgentConfig => {
  const envConfig = loadAgentConfigFromEnv();
  if (envConfig) {
    return envConfig;
  }

  for (const candidate of CONFIG_CANDIDATES) {
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
    return { name, basePrompt };
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
export const getAgentSubject = (): string => withJosa(getAgentName(), "이", "가");
export const formatAgentNameWithSuffix = (suffix: string): string => `${getAgentName()}${suffix}`;
