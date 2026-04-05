import type { TurnContext, TurnStartCallback, TurnStartInput, TurnStartDecision } from '@sena-ai/core'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'

export type FileContextOptions = {
  path: string
  as: 'system' | 'prepend' | 'append'
  glob?: string
  when?: (ctx: TurnContext) => boolean
  maxLength?: number
}

export function fileContextHook(options: FileContextOptions): TurnStartCallback {
  const { path, as: role, glob, when, maxLength } = options

  return async (input: TurnStartInput): Promise<TurnStartDecision> => {
    if (when && !when(input.turnContext)) return { decision: 'allow' }

    const info = await stat(path)
    const fragments: { source: string; content: string }[] = []

    if (info.isFile()) {
      const content = await readFile(path, 'utf-8')
      fragments.push(makeFragment(path, role, content, maxLength))
    } else if (info.isDirectory()) {
      const entries = await readdir(path)
      const filtered = glob
        ? entries.filter(e => matchGlob(e, glob))
        : entries

      for (const entry of filtered.sort()) {
        const filePath = join(path, entry)
        const fileStat = await stat(filePath)
        if (!fileStat.isFile()) continue
        const content = await readFile(filePath, 'utf-8')
        fragments.push(makeFragment(filePath, role, content, maxLength))
      }
    }

    if (fragments.length === 0) return { decision: 'allow' }
    const context = fragments.map(f => `[${f.source}]\n${f.content}`).join('\n\n')
    return { decision: 'allow', additionalContext: context }
  }
}

function makeFragment(
  filePath: string,
  _role: string,
  content: string,
  maxLength?: number,
): { source: string; content: string } {
  const trimmed = maxLength ? content.slice(0, maxLength) : content
  return {
    source: `file:${basename(filePath)}`,
    content: trimmed,
  }
}

function matchGlob(filename: string, pattern: string): boolean {
  if (pattern.startsWith('*')) {
    return filename.endsWith(pattern.slice(1))
  }
  return filename === pattern
}
