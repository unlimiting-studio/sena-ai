import type { TurnContext, TurnStartCallback, TurnStartInput, TurnStartDecision, ContextFragment } from '@sena-ai/core'
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
    const fragments: ContextFragment[] = []

    if (info.isFile()) {
      fragments.push(makeFragment(path, role, await readFile(path, 'utf-8'), maxLength))
    } else if (info.isDirectory()) {
      const entries = await readdir(path)
      const filtered = glob
        ? entries.filter(e => matchGlob(e, glob))
        : entries

      for (const entry of filtered.sort()) {
        const filePath = join(path, entry)
        const fileStat = await stat(filePath)
        if (!fileStat.isFile()) continue
        fragments.push(makeFragment(filePath, role, await readFile(filePath, 'utf-8'), maxLength))
      }
    }

    if (fragments.length === 0) return { decision: 'allow' }
    return { decision: 'allow', fragments }
  }
}

function makeFragment(
  filePath: string,
  role: 'system' | 'prepend' | 'append',
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
