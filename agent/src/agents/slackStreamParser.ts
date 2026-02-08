import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type ToolUse = { id: string; name: string };

export type ToolProgress = { toolUseId: string; toolName: string };

export type ToolResult = { toolUseId: string; isError: boolean };

export const extractSessionId = (message: SDKMessage): string | null => {
  if (message.type !== "system" || message.subtype !== "init") {
    return null;
  }

  const sessionId = message.session_id.trim();
  return sessionId.length > 0 ? sessionId : null;
};

export const extractResultText = (message: SDKMessage): string | null => {
  if (message.type !== "result") {
    return null;
  }

  if (message.subtype !== "success") {
    return null;
  }

  const trimmed = message.result.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const extractAssistantText = (message: SDKMessage): string | null => {
  if (message.type !== "assistant") {
    return null;
  }

  const parts: string[] = [];
  for (const block of message.message.content) {
    if (block.type !== "text") {
      continue;
    }

    const text = block.text.trim();
    if (text.length > 0) {
      parts.push(text);
    }
  }

  const joined = parts.join("\n").trim();
  return joined.length > 0 ? joined : null;
};

export const extractStreamDeltaText = (message: SDKMessage): string | null => {
  if (message.type !== "stream_event") {
    return null;
  }

  if (message.event.type !== "content_block_delta") {
    return null;
  }

  if (message.event.delta.type !== "text_delta") {
    return null;
  }

  const text = message.event.delta.text;
  return text.length > 0 ? text : null;
};

export const isAssistantStreamMessageStart = (message: SDKMessage): boolean => {
  if (message.type !== "stream_event") {
    return false;
  }

  return message.event.type === "message_start";
};

export const extractToolUses = (message: SDKMessage): ToolUse[] => {
  if (message.type !== "assistant") {
    return [];
  }

  const toolUses: ToolUse[] = [];
  for (const block of message.message.content) {
    if (block.type === "tool_use") {
      const id = block.id.trim();
      const name = block.name.trim();
      if (id.length > 0 && name.length > 0) {
        toolUses.push({ id, name });
      }
      continue;
    }

    if (block.type === "mcp_tool_use") {
      const id = block.id.trim();
      const serverName = block.server_name.trim();
      const toolName = block.name.trim();
      if (id.length > 0 && serverName.length > 0 && toolName.length > 0) {
        toolUses.push({ id, name: `mcp__${serverName}__${toolName}` });
      }
    }
  }

  return toolUses;
};

export const extractToolProgress = (message: SDKMessage): ToolProgress | null => {
  if (message.type !== "tool_progress") {
    return null;
  }

  const toolUseId = message.tool_use_id.trim();
  const toolName = message.tool_name.trim();
  if (toolUseId.length === 0 || toolName.length === 0) {
    return null;
  }

  return { toolUseId, toolName };
};

export const extractToolResults = (message: SDKMessage): ToolResult[] => {
  const results: ToolResult[] = [];

  if (message.type === "user") {
    const content = message.message.content;
    if (typeof content !== "string") {
      for (const block of content) {
        if (block.type !== "tool_result") {
          continue;
        }

        const toolUseId = block.tool_use_id.trim();
        if (toolUseId.length === 0) {
          continue;
        }

        results.push({ toolUseId, isError: block.is_error === true });
      }
    }
    return results;
  }

  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type !== "mcp_tool_result") {
        continue;
      }

      const toolUseId = block.tool_use_id.trim();
      if (toolUseId.length === 0) {
        continue;
      }

      results.push({ toolUseId, isError: block.is_error });
    }
  }

  return results;
};
