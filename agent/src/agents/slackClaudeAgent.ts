import * as path from "node:path";

import { CONFIG } from "../config.ts";
import { SlackSDK } from "../sdks/slack.ts";
import { buildThreadKey, resolveThreadTs, type SlackContext } from "./slackContext.ts";
import { SlackThreadRunner } from "./slackThreadRunner.ts";
import { SlackThreadSessionStore } from "./threadSessionStore.ts";

export type { SlackContext } from "./slackContext.ts";

export class SlackClaudeAgent {
  private static _instance: SlackClaudeAgent | null = null;

  private threadSessions = new Map<string, string>();
  private threadRunners = new Map<string, SlackThreadRunner>();
  private threadSessionStore = new SlackThreadSessionStore({
    filePath: path.join(CONFIG.WORKSPACE_DIR, "slack-thread-sessions.json"),
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
    threadTs: string | null;
    messageTs: string | null;
  }): Promise<void> {
    const { teamId, channelId, userId, text, threadTs, messageTs } = _params;
    const normalizedText = text.replace(/^<@[A-Z0-9]+>\s*/u, "").trim();
    if (normalizedText.length === 0) {
      return;
    }

    const slackUserId = userId?.trim() || null;
    if (!slackUserId) {
      await SlackSDK.instance.postMessage({
        channel: channelId,
        thread_ts: threadTs ?? messageTs ?? undefined,
        text: "⚠️ Slack 사용자 ID를 확인할 수 없습니다.",
      });
      return;
    }

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
      },
      resumeSessionId,
    });

    const accepted = runner.enqueueUserInput(normalizedText);
    if (!accepted) {
      this.getOrCreateRunner({
        threadKey,
        slack: {
          teamId,
          channelId,
          threadTs: resolvedThreadTs,
          messageTs: resolvedMessageTs,
          slackUserId,
        },
        resumeSessionId,
        forceNew: true,
      }).enqueueUserInput(normalizedText);
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
