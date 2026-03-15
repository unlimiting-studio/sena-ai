import type { ToolPort, RuntimeInfo, McpConfig } from '@sena-ai/core'

export type McpHttpOptions = {
  name: string
  url: string
  headers?: Record<string, string>
}

export type McpStdioOptions = {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type McpServerOptions = McpHttpOptions | McpStdioOptions

function isHttpOptions(opts: McpServerOptions): opts is McpHttpOptions {
  return 'url' in opts
}

export function mcpServer(options: McpServerOptions): ToolPort {
  if (isHttpOptions(options)) {
    return {
      name: options.name,
      type: 'mcp-http',
      toMcpConfig(_runtime: RuntimeInfo): McpConfig {
        return {
          url: options.url,
          ...(options.headers ? { headers: options.headers } : {}),
        }
      },
    }
  }

  return {
    name: options.name,
    type: 'mcp-stdio',
    toMcpConfig(_runtime: RuntimeInfo): McpConfig {
      return {
        command: options.command,
        args: options.args ?? [],
        ...(options.env ? { env: options.env } : {}),
      }
    },
  }
}
