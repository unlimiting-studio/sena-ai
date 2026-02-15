import * as fs from "node:fs/promises";
import * as path from "node:path";

import { getAgentOpsConfig, type AgentOpsConfig } from "../agentConfig.ts";

const FILE_MISSING_MARKER_PREFIX = "[파일 누락]";
const FILE_TRUNCATED_MARKER_PREFIX = "[내용 잘림]";
const INVISIBLE_WHITESPACE_PATTERN = /[\u200B-\u200D\u2060\uFEFF]/gu;
const HEARTBEAT_MARKUP_ONLY_LINE_PATTERN = /^[-_*#`>|~\s]+$/u;
const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type WorkspaceContextLoadOptions = {
  baseDir?: string;
  workspaceDir?: string;
  now?: Date;
  agentOps?: AgentOpsConfig;
};

type HeartbeatAckJudgeOptions = Partial<Pick<AgentOpsConfig["heartbeat"], "okToken" | "ackMaxChars">>;

export type WorkspaceContextFile = {
  relativePath: string;
  absolutePath: string;
  content: string;
  rawContent: string | null;
  missing: boolean;
  truncated: boolean;
};

export type WorkspaceContextSnapshot = {
  contextDir: string;
  contextDirAbsolutePath: string;
  files: WorkspaceContextFile[];
  contextFiles: WorkspaceContextFile[];
  memoryLongTermFile: WorkspaceContextFile | null;
  memoryDailyFiles: WorkspaceContextFile[];
  heartbeatInstructionFile: WorkspaceContextFile;
  heartbeatInstructionEmpty: boolean;
};

const toDisplayPath = (value: string): string => value.split(path.sep).join("/");

const normalizeTextForRead = (value: string): string => value.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");

const isNotFoundError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  const withCode = error as Error & { code?: string };
  return withCode.code === "ENOENT";
};

const makeMissingFileMarker = (relativePath: string): string =>
  `${FILE_MISSING_MARKER_PREFIX} ${toDisplayPath(relativePath)} 파일이 없습니다.`;

const makeTruncatedMarker = (relativePath: string, maxChars: number): string =>
  `\n\n${FILE_TRUNCATED_MARKER_PREFIX} ${toDisplayPath(relativePath)} 파일이 ${maxChars}자를 초과하여 나머지를 생략했습니다.`;

const truncateWithMarker = (
  text: string,
  maxChars: number,
  relativePath: string,
): { text: string; truncated: boolean } => {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const marker = makeTruncatedMarker(relativePath, maxChars);
  const keepChars = Math.max(0, maxChars - marker.length);
  if (keepChars === 0) {
    return { text: marker.slice(0, maxChars), truncated: true };
  }
  return {
    text: `${text.slice(0, keepChars)}${marker}`,
    truncated: true,
  };
};

const normalizePathKey = (value: string): string => path.normalize(value).split(path.sep).join("/");

const uniquePaths = (paths: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const candidate of paths) {
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = normalizePathKey(trimmed);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(trimmed);
  }

  return unique;
};

const resolveContextDirAbsolutePath = (baseDir: string, contextDir: string): string => {
  if (path.isAbsolute(contextDir)) {
    return contextDir;
  }
  return path.resolve(baseDir, contextDir);
};

const resolveContextFileAbsolutePath = (contextDirAbsolutePath: string, relativePath: string): string => {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return path.resolve(contextDirAbsolutePath, relativePath);
};

const readWorkspaceFile = async (
  contextDirAbsolutePath: string,
  relativePath: string,
  maxChars: number,
): Promise<WorkspaceContextFile> => {
  const absolutePath = resolveContextFileAbsolutePath(contextDirAbsolutePath, relativePath);

  let raw: string;
  try {
    raw = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        relativePath,
        absolutePath,
        content: makeMissingFileMarker(relativePath),
        rawContent: null,
        missing: true,
        truncated: false,
      };
    }
    throw error;
  }

  const normalized = normalizeTextForRead(raw);
  const truncated = truncateWithMarker(normalized, maxChars, relativePath);
  return {
    relativePath,
    absolutePath,
    content: truncated.text,
    rawContent: normalized,
    missing: false,
    truncated: truncated.truncated,
  };
};

const formatDateKey = (date: Date): string => SEOUL_DATE_FORMATTER.format(date);

const buildRecentDailyMemoryPaths = (dailyDir: string, recentDays: number, now: Date): string[] => {
  if (recentDays <= 0) {
    return [];
  }

  const result: string[] = [];
  for (let offset = 0; offset < recentDays; offset += 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    result.push(path.join(dailyDir, `${formatDateKey(day)}.md`));
  }
  return result;
};

const normalizeHeartbeatInstructionText = (value: string | null | undefined): string => {
  const source = (value ?? "")
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(INVISIBLE_WHITESPACE_PATTERN, "");

  const meaningfulLines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !HEARTBEAT_MARKUP_ONLY_LINE_PATTERN.test(line));

  return meaningfulLines.join("\n").trim();
};

const resolveHeartbeatJudgeConfig = (
  options: HeartbeatAckJudgeOptions | undefined,
): { okToken: string; ackMaxChars: number } => {
  const defaults = getAgentOpsConfig().heartbeat;
  return {
    okToken: options?.okToken ?? defaults.okToken,
    ackMaxChars: options?.ackMaxChars ?? defaults.ackMaxChars,
  };
};

const mergeWorkspaceFiles = (
  contextFiles: WorkspaceContextFile[],
  memoryLongTermFile: WorkspaceContextFile | null,
  memoryDailyFiles: WorkspaceContextFile[],
): WorkspaceContextFile[] => {
  const ordered = [...contextFiles, ...(memoryLongTermFile ? [memoryLongTermFile] : []), ...memoryDailyFiles];
  const seen = new Set<string>();
  const merged: WorkspaceContextFile[] = [];

  for (const file of ordered) {
    const key = normalizePathKey(file.relativePath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(file);
  }
  return merged;
};

type WorkspaceContextLogSource = "include" | "heartbeat" | "include+heartbeat";
type WorkspaceContextLogStatus = "ok" | "missing" | "truncated" | "not_loaded";

const logWorkspaceContextResolution = (options: {
  contextBaseDir: string;
  contextDirAbsolutePath: string;
  contextFilePaths: string[];
  contextFiles: WorkspaceContextFile[];
  agentOps: AgentOpsConfig;
  heartbeatInstructionEmpty: boolean;
}): void => {
  const includeKeys = new Set(options.agentOps.memory.includeFiles.map((value) => normalizePathKey(value)));
  const heartbeatKey = normalizePathKey(options.agentOps.heartbeat.instructionFile);
  const contextFileMap = new Map(options.contextFiles.map((file) => [normalizePathKey(file.relativePath), file]));

  const fileDetails = options.contextFilePaths.map((configuredPath) => {
    const key = normalizePathKey(configuredPath);
    const resolved = contextFileMap.get(key);
    const isHeartbeat = key === heartbeatKey;
    const isInclude = includeKeys.has(key);
    const source: WorkspaceContextLogSource =
      isHeartbeat && isInclude ? "include+heartbeat" : isHeartbeat ? "heartbeat" : "include";
    const status: WorkspaceContextLogStatus = !resolved
      ? "not_loaded"
      : resolved.missing
        ? "missing"
        : resolved.truncated
          ? "truncated"
          : "ok";
    return {
      path: toDisplayPath(configuredPath),
      absolutePath: resolved ? toDisplayPath(resolved.absolutePath) : null,
      source,
      status,
      charLength: resolved?.rawContent?.length ?? 0,
    };
  });

  const missingCount = fileDetails.filter((file) => file.status === "missing" || file.status === "not_loaded").length;
  const truncatedCount = fileDetails.filter((file) => file.status === "truncated").length;

  console.info(
    `[workspace-context] include-files ${JSON.stringify({
      baseDir: toDisplayPath(options.contextBaseDir),
      contextDir: toDisplayPath(options.contextDirAbsolutePath),
      includeFilesConfigured: options.agentOps.memory.includeFiles.map((value) => toDisplayPath(value)),
      heartbeatInstructionFile: toDisplayPath(options.agentOps.heartbeat.instructionFile),
      heartbeatInstructionEmpty: options.heartbeatInstructionEmpty,
      missingCount,
      truncatedCount,
      fileDetails,
    })}`,
  );
};

export const isHeartbeatInstructionEffectivelyEmpty = (value: string | null | undefined): boolean =>
  normalizeHeartbeatInstructionText(value).length === 0;

export const normalizeHeartbeatOkToken = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(INVISIBLE_WHITESPACE_PATTERN, "")
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");

export const normalizeHeartbeatAckText = (value: string | null | undefined): string =>
  (value ?? "").normalize("NFKC").replace(/\r\n?/gu, "\n").replace(INVISIBLE_WHITESPACE_PATTERN, "").trim();

export const shouldSuppressHeartbeatAck = (
  value: string | null | undefined,
  options?: HeartbeatAckJudgeOptions,
): boolean => {
  const normalizedAck = normalizeHeartbeatAckText(value);
  if (normalizedAck.length === 0) {
    return false;
  }

  const judgeConfig = resolveHeartbeatJudgeConfig(options);
  if (judgeConfig.ackMaxChars <= 0 || normalizedAck.length > judgeConfig.ackMaxChars) {
    return false;
  }

  // Suppress only *pure* acknowledgements (e.g. `HEARTBEAT_OK` alone).
  // If the heartbeat includes any additional content, it must be forwarded.
  const normalizedToken = normalizeHeartbeatOkToken(judgeConfig.okToken);
  const normalizedAckTokenStream = normalizeHeartbeatOkToken(normalizedAck);
  if (normalizedToken.length === 0 || normalizedAckTokenStream.length === 0) {
    return false;
  }

  return normalizedAckTokenStream === normalizedToken;
};

export const shouldSuppressHeartbeatAckText = shouldSuppressHeartbeatAck;

export const loadWorkspaceContext = async (
  options?: WorkspaceContextLoadOptions,
): Promise<WorkspaceContextSnapshot> => {
  const agentOps = options?.agentOps ?? getAgentOpsConfig();
  const contextBaseDir = options?.baseDir ?? options?.workspaceDir ?? process.cwd();
  const now = options?.now ?? new Date();

  const contextDirAbsolutePath = resolveContextDirAbsolutePath(contextBaseDir, agentOps.contextDir);

  const contextFilePaths = uniquePaths([...agentOps.memory.includeFiles, agentOps.heartbeat.instructionFile]);
  const contextFiles = await Promise.all(
    contextFilePaths.map((relativePath) =>
      readWorkspaceFile(contextDirAbsolutePath, relativePath, agentOps.memory.maxCharsPerFile),
    ),
  );

  const heartbeatInstructionKey = normalizePathKey(agentOps.heartbeat.instructionFile);
  let heartbeatInstructionFile = contextFiles.find(
    (file) => normalizePathKey(file.relativePath) === heartbeatInstructionKey,
  );
  if (!heartbeatInstructionFile) {
    heartbeatInstructionFile = await readWorkspaceFile(
      contextDirAbsolutePath,
      agentOps.heartbeat.instructionFile,
      agentOps.memory.maxCharsPerFile,
    );
  }

  let memoryLongTermFile: WorkspaceContextFile | null = null;
  let memoryDailyFiles: WorkspaceContextFile[] = [];
  if (agentOps.memory.enabled) {
    memoryLongTermFile = await readWorkspaceFile(
      contextDirAbsolutePath,
      agentOps.memory.longTermFile,
      agentOps.memory.maxCharsPerFile,
    );

    const dailyPaths = buildRecentDailyMemoryPaths(agentOps.memory.dailyDir, agentOps.memory.recentDays, now);
    memoryDailyFiles = await Promise.all(
      dailyPaths.map((relativePath) =>
        readWorkspaceFile(contextDirAbsolutePath, relativePath, agentOps.memory.maxCharsPerFile),
      ),
    );
  }

  const files = mergeWorkspaceFiles(contextFiles, memoryLongTermFile, memoryDailyFiles);
  const heartbeatInstructionEmpty = heartbeatInstructionFile.missing
    ? true
    : isHeartbeatInstructionEffectivelyEmpty(heartbeatInstructionFile.rawContent);

  logWorkspaceContextResolution({
    contextBaseDir,
    contextDirAbsolutePath,
    contextFilePaths,
    contextFiles,
    agentOps,
    heartbeatInstructionEmpty,
  });

  return {
    contextDir: agentOps.contextDir,
    contextDirAbsolutePath,
    files,
    contextFiles,
    memoryLongTermFile,
    memoryDailyFiles,
    heartbeatInstructionFile,
    heartbeatInstructionEmpty,
  };
};

export const loadWorkspaceContextFiles = loadWorkspaceContext;
