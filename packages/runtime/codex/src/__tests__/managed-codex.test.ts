import { describe, expect, it } from 'vitest'
import { getCodexInvocation, resolveManagedCodexBin } from '../managed-codex.js'

describe('resolveManagedCodexBin', () => {
  it('resolves bin.codex from @openai/codex package.json', () => {
    const resolved = resolveManagedCodexBin({
      requireResolve: (id) => {
        expect(id).toBe('@openai/codex/package.json')
        return '/virtual/node_modules/@openai/codex/package.json'
      },
      readTextFile: () => JSON.stringify({
        bin: {
          codex: 'bin/codex.js',
        },
      }),
    })

    expect(resolved).toBe('/virtual/node_modules/@openai/codex/bin/codex.js')
  })

  it('throws when codex bin entry is missing', () => {
    expect(() =>
      resolveManagedCodexBin({
        requireResolve: () => '/virtual/node_modules/@openai/codex/package.json',
        readTextFile: () => JSON.stringify({ bin: {} }),
      }),
    ).toThrow(/bin\.codex/)
  })
})

describe('getCodexInvocation', () => {
  it('wraps JS entrypoints with the current node executable', () => {
    const invocation = getCodexInvocation(undefined, {
      requireResolve: () => '/virtual/node_modules/@openai/codex/package.json',
      readTextFile: () => JSON.stringify({
        bin: {
          codex: 'bin/codex.js',
        },
      }),
    })

    expect(invocation).toEqual({
      command: process.execPath,
      args: ['/virtual/node_modules/@openai/codex/bin/codex.js'],
    })
  })

  it('uses explicit override as-is for non-JS binaries', () => {
    const invocation = getCodexInvocation('/custom/bin/codex')

    expect(invocation).toEqual({
      command: '/custom/bin/codex',
      args: [],
    })
  })

  it('wraps explicit JS override with the current node executable', () => {
    const invocation = getCodexInvocation('/custom/bin/codex.js')

    expect(invocation).toEqual({
      command: process.execPath,
      args: ['/custom/bin/codex.js'],
    })
  })
})
