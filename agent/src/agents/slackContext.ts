export type SlackContext = {
  teamId: string | null;
  channelId: string;
  threadTs: string | null;
  messageTs: string;
  slackUserId: string;
  slackUserName: string | null;
};

export const buildThreadKey = (channelId: string, threadTs: string): string => `${channelId}:${threadTs}`;

export const resolveThreadTs = (threadTs: string | null, messageTs: string): string => {
  const normalizedThreadTs = threadTs?.trim() ?? "";
  if (normalizedThreadTs.length > 0) {
    return normalizedThreadTs;
  }
  return messageTs;
};
