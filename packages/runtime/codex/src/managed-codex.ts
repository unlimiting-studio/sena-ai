import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const requireFromHere = createRequire(import.meta.url)

type CodexPackageJson = {
  bin?: string | Record<string, string>
}

export type ManagedCodexResolverDeps = {
  requireResolve?: (id: string) => string
  readTextFile?: (path: string) => string
}

export type CodexInvocation = {
  command: string
  args: string[]
}

export function resolveManagedCodexBin(deps: ManagedCodexResolverDeps = {}): string {
  const requireResolve = deps.requireResolve ?? requireFromHere.resolve.bind(requireFromHere)
  const readTextFile = deps.readTextFile ?? ((path: string) => readFileSync(path, 'utf-8'))

  const packageJsonPath = requireResolve('@openai/codex/package.json')
  const packageJson = JSON.parse(readTextFile(packageJsonPath)) as CodexPackageJson
  const bin = typeof packageJson.bin === 'string'
    ? packageJson.bin
    : packageJson.bin?.codex

  if (!bin) {
    throw new Error('Failed to resolve Codex executable: missing "bin.codex" in @openai/codex package.json')
  }

  return resolve(dirname(packageJsonPath), bin)
}

export function getCodexInvocation(
  codexBin?: string,
  deps: ManagedCodexResolverDeps = {},
): CodexInvocation {
  const executable = codexBin ?? resolveManagedCodexBin(deps)

  if (/\.(?:c|m)?js$/i.test(executable)) {
    return {
      command: process.execPath,
      args: [executable],
    }
  }

  return {
    command: executable,
    args: [],
  }
}
