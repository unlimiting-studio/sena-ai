import { WebClient } from "@slack/web-api";

import { CONFIG } from "../config.ts";

type ChatPostMessageArgs = Parameters<WebClient["chat"]["postMessage"]>[0];
type ChatPostEphemeralArgs = Parameters<WebClient["chat"]["postEphemeral"]>[0];
type ChatUpdateArgs = Parameters<WebClient["chat"]["update"]>[0];
type ReactionsAddArgs = Parameters<WebClient["reactions"]["add"]>[0];
type ReactionsRemoveArgs = Parameters<WebClient["reactions"]["remove"]>[0];
type UsersInfoArgs = Parameters<WebClient["users"]["info"]>[0];
type SearchMessagesArgs = Parameters<WebClient["search"]["messages"]>[0];
type ChatStartStreamArgs = Parameters<WebClient["chat"]["startStream"]>[0];
type ChatAppendStreamArgs = Parameters<WebClient["chat"]["appendStream"]>[0];
type ChatStopStreamArgs = Parameters<WebClient["chat"]["stopStream"]>[0];

type ThreadRepliesArgs = {
  channel: string;
  ts: string;
  latest?: string;
  oldest?: string;
  limit?: number;
  inclusive?: boolean;
};

type ChannelHistoryArgs = {
  channel: string;
  latest?: string;
  oldest?: string;
  limit?: number;
  inclusive?: boolean;
};

export class SlackSDK {
  private client: WebClient;

  private constructor() {
    this.client = new WebClient(CONFIG.SLACK_BOT_TOKEN);
  }

  private static _instance: SlackSDK | null = null;

  static get instance(): SlackSDK {
    if (!SlackSDK._instance) {
      SlackSDK._instance = new SlackSDK();
    }
    return SlackSDK._instance;
  }

  async postMessage(args: ChatPostMessageArgs) {
    return this.client.chat.postMessage(args);
  }

  async postEphemeral(args: ChatPostEphemeralArgs) {
    return this.client.chat.postEphemeral(args);
  }

  async updateMessage(args: ChatUpdateArgs) {
    return this.client.chat.update(args);
  }

  async addReaction(args: ReactionsAddArgs) {
    return this.client.reactions.add(args);
  }

  async removeReaction(args: ReactionsRemoveArgs) {
    return this.client.reactions.remove(args);
  }

  async usersInfo(args: UsersInfoArgs) {
    return this.client.users.info(args);
  }

  async getThreadReplies(args: ThreadRepliesArgs) {
    return this.client.conversations.replies(args);
  }

  async getChannelHistory(args: ChannelHistoryArgs) {
    return this.client.conversations.history(args);
  }

  async searchMessages(args: SearchMessagesArgs) {
    return this.client.search.messages(args);
  }

  async searchMessagesWithUserToken(
    userToken: string,
    query: string,
    options?: {
      sort?: "score" | "timestamp";
      sort_dir?: "asc" | "desc";
      count?: number;
      page?: number;
      highlight?: boolean;
    },
  ) {
    const userClient = new WebClient(userToken);
    return userClient.search.messages({
      query,
      sort: options?.sort ?? "score",
      sort_dir: options?.sort_dir ?? "desc",
      count: options?.count ?? 20,
      page: options?.page ?? 1,
      highlight: options?.highlight ?? true,
    });
  }

  async startStream(args: ChatStartStreamArgs) {
    return this.client.chat.startStream(args);
  }

  async appendStream(args: ChatAppendStreamArgs) {
    return this.client.chat.appendStream(args);
  }

  async stopStream(args: ChatStopStreamArgs) {
    return this.client.chat.stopStream(args);
  }
}
