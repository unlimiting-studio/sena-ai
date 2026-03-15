import type { TurnStartHook, TurnContext, ContextFragment } from '@sena-ai/core'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'

export type FileContextOptions = {
  path: string
  as: 'system' | 'context'
  glob?: string
  when?: (ctx: TurnContext) => boolean
  maxLength?: number
}

export function fileContext(options: FileContextOptions): TurnStartHook {
  const { path, as: role, glob, when, maxLength } = options

  return {
    name: `fileContext:${path}`,
    async execute(ctx: TurnContext): Promise<ContextFragment[]> {
      if (when && !when(ctx)) return []

      const info = await stat(path)

      if (info.isFile()) {
        const content = await readFile(path, 'utf-8')
        return [makeFragment(path, role, content, maxLength)]
      }

      if (info.isDirectory()) {
        const entries = await readdir(path)
        const filtered = glob
          ? entries.filter(e => matchGlob(e, glob))
          : entries

        const fragments: ContextFragment[] = []
        for (const entry of filtered.sort()) {
          const filePath = join(path, entry)
          const fileStat = await stat(filePath)
          if (!fileStat.isFile()) continue
          const content = await readFile(filePath, 'utf-8')
          fragments.push(makeFragment(filePath, role, content, maxLength))
        }
        return fragments
      }

      return []
    },
  }
}

function makeFragment(
  filePath: string,
  role: 'system' | 'context',
  content: string,
  maxLength?: number,
): ContextFragment {
  const trimmed = maxLength ? content.slice(0, maxLength) : content
  return {
    source: `file:${basename(filePath)}`,
    role,
    content: trimmed,
  }
}

function matchGlob(filename: string, pattern: string): boolean {
  if (pattern.startsWith('*')) {
    return filename.endsWith(pattern.slice(1))
  }
  return filename === pattern
}
