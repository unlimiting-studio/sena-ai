import * as path from "node:path";

import { CONFIG } from "../config.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { resolveSlackUserName } from "../utils/slackUser.ts";
import { buildThreadKey, resolveThreadTs, type SlackContext } from "./slackContext.ts";
import { SlackThreadRunner } from "./slackThreadRunner.ts";
import { SlackThreadSessionStore } from "./threadSessionStore.ts";

export type { SlackContext } from "./slackContext.ts";

type SlackMentionFile = {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  permalink?: string;
  url_private?: string;
  url_private_download?: string;
};

type PreparedImageMetadata = {
  summaryLines: string[];
};

const MAX_IMAGE_METADATA_PER_MESSAGE = 10;

const toNonEmptyTrimmed = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

const isImageSlackFile = (file: SlackMentionFile): boolean => {
  const mimetype = toNonEmptyTrimmed(file.mimetype)?.toLowerCase();
  if (mimetype?.startsWith("image/")) {
    return true;
  }

  const filetype = toNonEmptyTrimmed(file.filetype)?.toLowerCase();
  return filetype === "jpg" || filetype === "jpeg" || filetype === "png" || filetype === "gif" || filetype === "webp";
};

const formatImageMetadataLine = (file: SlackMentionFile, index: number): string => {
  const fileId = toNonEmptyTrimmed(file.id) ?? "(missing)";
  const fileName = toNonEmptyTrimmed(file.name) ?? "(no-name)";
  const mimeType = toNonEmptyTrimmed(file.mimetype) ?? "unknown";
  const fileType = toNonEmptyTrimmed(file.filetype) ?? "unknown";
  const sizePart =
    typeof file.size === "number" && file.size > 0 ? `${Math.max(1, Math.round(file.size / 1024))}KB` : "unknown";
  const permalink = toNonEmptyTrimmed(file.permalink);
  const permalinkPart = permalink ? `, permalink=${permalink}` : "";

  return `- 이미지 ${index + 1}: fileId=${fileId}, name=${fileName}, mimetype=${mimeType}, filetype=${fileType}, size=${sizePart}${permalinkPart}`;
};

export class SlackClaudeAgent {
  private static _instance: SlackClaudeAgent | null = null;

  private threadSessions = new Map<string, string>();
  private threadRunners = new Map<string, SlackThreadRunner>();
  private sessionStoreDir = process.cwd();
  private threadSessionStore = new SlackThreadSessionStore({
    filePath: path.join(this.sessionStoreDir, `slack-thread-sessions-${CONFIG.AGENT_RUNTIME_MODE}.json`),
  });

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  static get instance(): SlackClaudeAgent {
    if (!SlackClaudeAgent._instance) {
      SlackClaudeAgent._instance = new SlackClaudeAgent();
    }
    return SlackClaudeAgent._instance;
  }

  async handleMention(_params: {
    teamId: string | null;
    channelId: string;
    userId: string | null;
    text: string;
    files: SlackMentionFile[];
    threadTs: string | null;
    messageTs: string | null;
  }): Promise<void> {
    const { teamId, channelId, userId, text, files, threadTs, messageTs } = _params;
    const normalizedText = text.replace(/^<@[A-Z0-9]+>\s*/u, "").trim();
    const preparedMetadata = this.prepareImageMetadata(files);

    if (normalizedText.length === 0 && preparedMetadata.summaryLines.length === 0) {
      return;
    }

    const userInputText = this.buildUserInputText(normalizedText, preparedMetadata.summaryLines);

    const slackUserId = userId?.trim() || null;
    if (!slackUserId) {
      await SlackSDK.instance.postMessage({
        channel: channelId,
        thread_ts: threadTs ?? messageTs ?? undefined,
        text: "⚠️ Slack 사용자 ID를 확인할 수 없습니다.",
      });
      return;
    }
    const slackUserName = await resolveSlackUserName(slackUserId);

    const resolvedMessageTs = messageTs?.trim() || threadTs?.trim() || null;
    if (!resolvedMessageTs) {
      await SlackSDK.instance.postMessage({
        channel: channelId,
        thread_ts: threadTs ?? undefined,
        text: "⚠️ 메시지 타임스탬프를 확인할 수 없습니다.",
      });
      return;
    }

    const resolvedThreadTs = resolveThreadTs(threadTs, resolvedMessageTs);
    const threadKey = buildThreadKey(channelId, resolvedThreadTs);
    let resumeSessionId = this.threadSessions.get(threadKey) ?? null;
    if (!resumeSessionId) {
      resumeSessionId = (await this.threadSessionStore.get(threadKey).catch(() => null)) ?? null;
      if (resumeSessionId) {
        this.threadSessions.set(threadKey, resumeSessionId);
      }
    }

    const runner = this.getOrCreateRunner({
      threadKey,
      slack: {
        teamId,
        channelId,
        threadTs: resolvedThreadTs,
        messageTs: resolvedMessageTs,
        slackUserId,
        slackUserName,
      },
      resumeSessionId,
    });

    const accepted = runner.enqueueUserInput(userInputText);
    if (!accepted) {
      this.getOrCreateRunner({
        threadKey,
        slack: {
          teamId,
          channelId,
          threadTs: resolvedThreadTs,
          messageTs: resolvedMessageTs,
          slackUserId,
          slackUserName,
        },
        resumeSessionId,
        forceNew: true,
      }).enqueueUserInput(userInputText);
    }
  }

  async resumeSessionFromLinkToken(_params: {
    sessionId: string;
    slack: SlackContext;
    provider: "slack" | "github";
    continuationText: string;
  }): Promise<boolean> {
    const sessionId = _params.sessionId.trim();
    if (sessionId.length === 0) {
      return false;
    }

    const resolvedThreadTs = resolveThreadTs(_params.slack.threadTs, _params.slack.messageTs);
    const threadKey = buildThreadKey(_params.slack.channelId, resolvedThreadTs);

    this.threadSessions.set(threadKey, sessionId);
    void this.threadSessionStore.set(threadKey, sessionId).catch(() => undefined);

    const shouldRestart = _params.provider === "github";
    if (shouldRestart) {
      this.stopRunner(threadKey);
    }

    const runner = this.getOrCreateRunner({
      threadKey,
      slack: {
        ..._params.slack,
        threadTs: resolvedThreadTs,
      },
      resumeSessionId: sessionId,
      forceNew: shouldRestart,
    });

    const accepted = runner.enqueueUserInput(_params.continuationText, { isSynthetic: true });
    if (!accepted) {
      this.getOrCreateRunner({
        threadKey,
        slack: {
          ..._params.slack,
          threadTs: resolvedThreadTs,
        },
        resumeSessionId: sessionId,
        forceNew: true,
      }).enqueueUserInput(_params.continuationText, { isSynthetic: true });
    }
    return true;
  }

  private stopRunner(threadKey: string): void {
    const runner = this.threadRunners.get(threadKey);
    if (!runner) {
      return;
    }
    runner.stop({ reason: "restart", abort: true });
    this.threadRunners.delete(threadKey);
  }

  private isInCloudflareContainer(): boolean {
    return CONFIG.NODE_ENV === "production" && !!CONFIG.BACKEND_URL && !CONFIG.BACKEND_URL.includes("localhost");
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval !== null || !this.isInCloudflareContainer()) {
      return;
    }

    const containerId = process.env.CONTAINER_ID;
    if (!containerId) {
      return;
    }

    const heartbeatUrl = `${CONFIG.BACKEND_URL}/api/agents/${encodeURIComponent(containerId)}/health`;

    this.heartbeatInterval = setInterval(() => {
      fetch(heartbeatUrl).catch(() => {});
    }, this.HEARTBEAT_INTERVAL_MS);

    this.heartbeatInterval.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private buildUserInputText(text: string, imageSummaryLines: string[]): string {
    const normalizedText = text.trim();
    const baseText =
      normalizedText.length > 0
        ? normalizedText
        : "이미지를 첨부했어요. 아래 fileId 메타데이터를 참고해서 필요하면 `mcp__slack__download_file`로 파일을 내려받아 확인해 주세요.";

    if (imageSummaryLines.length === 0) {
      return baseText;
    }

    return [
      baseText,
      "",
      "[첨부 이미지 메타데이터]",
      "- 이미지 내용을 확인해야 하면 `mcp__slack__download_file`를 사용하세요.",
      ...imageSummaryLines,
    ].join("\n");
  }

  private prepareImageMetadata(files: SlackMentionFile[]): PreparedImageMetadata {
    const imageFiles = files.filter((file) => isImageSlackFile(file));
    if (imageFiles.length === 0) {
      return { summaryLines: [] };
    }

    const selectedFiles = imageFiles.slice(0, MAX_IMAGE_METADATA_PER_MESSAGE);
    const summaryLines = selectedFiles.map((file, index) => formatImageMetadataLine(file, index));

    if (imageFiles.length > selectedFiles.length) {
      summaryLines.push(`- 추가 이미지 ${imageFiles.length - selectedFiles.length}개는 이번 턴에서 생략됨`);
    }

    return { summaryLines };
  }

  private getOrCreateRunner(params: {
    threadKey: string;
    slack: SlackContext;
    resumeSessionId: string | null;
    forceNew?: boolean;
  }): SlackThreadRunner {
    const existing = params.forceNew ? null : this.threadRunners.get(params.threadKey);
    if (existing?.canAcceptInput()) {
      existing.updateSlackContext(params.slack);
      return existing;
    }

    const threadKey = params.threadKey;
    const runner = new SlackThreadRunner({
      initialSlack: params.slack,
      resumeSessionId: params.resumeSessionId,
      onSessionId: (sessionId) => {
        this.threadSessions.set(threadKey, sessionId);
        void this.threadSessionStore.set(threadKey, sessionId).catch(() => undefined);
      },
      onStop: () => {
        const current = this.threadRunners.get(threadKey);
        if (current === runner) {
          this.threadRunners.delete(threadKey);
        }

        // Stop heartbeat if no more runners
        if (this.threadRunners.size === 0) {
          this.stopHeartbeat();
        }
      },
    });

    this.threadRunners.set(threadKey, runner);

    // Start heartbeat if this is the first runner
    if (this.threadRunners.size === 1) {
      this.startHeartbeat();
    }

    return runner;
  }
}
