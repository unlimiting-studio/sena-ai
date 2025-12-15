import {
  type ChatPostEphemeralArguments,
  type ChatPostMessageArguments,
  type ChatUpdateArguments,
  type ConversationsHistoryArguments,
  type ConversationsRepliesArguments,
  type SearchMessagesArguments,
  type UsersInfoArguments,
  WebClient,
} from "@slack/web-api";

import { CONFIG } from "../config.ts";

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

  async postMessage(args: ChatPostMessageArguments) {
    return this.client.chat.postMessage(args);
  }

  async postEphemeral(args: ChatPostEphemeralArguments) {
    return this.client.chat.postEphemeral(args);
  }

  async updateMessage(args: ChatUpdateArguments) {
    return this.client.chat.update(args);
  }

  async usersInfo(args: UsersInfoArguments) {
    return this.client.users.info(args);
  }

  async getThreadReplies(
    args: Pick<ConversationsRepliesArguments, "channel" | "ts" | "latest" | "oldest" | "limit" | "inclusive">,
  ) {
    return this.client.conversations.replies(args);
  }

  async getChannelHistory(
    args: Pick<ConversationsHistoryArguments, "channel" | "latest" | "oldest" | "limit" | "inclusive">,
  ) {
    return this.client.conversations.history(args);
  }

  async searchMessages(args: SearchMessagesArguments) {
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
}
