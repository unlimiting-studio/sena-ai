# onTurnEnd Fork & Detached Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fork/detached/followUp options to onTurnEnd hooks, enabling session forking with context inheritance and connector response control, while removing all legacy hook types.

**Architecture:** Extend `TurnEndResult` from `void` to a union that supports `{ fork, followUp, detached }`. Engine collects these into `TurnFollowUp[]` in `TurnTrace`. Worker dispatches blocking followUps via existing pending queue and fork followUps via new `spawnForkedTurn()` (fire-and-forget). Legacy hook types and `adaptLegacyHooks` are removed entirely.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Remove Legacy Hook Types and Adapter

**Files:**
- Modify: `packages/core/src/types.ts:9-28`
- Modify: `packages/core/src/runtime-hooks.ts:115-174`
- Modify: `packages/core/src/index.ts:2`
- Delete content: `packages/core/src/__tests__/runtime-hooks.test.ts` (entire file)
- Modify: `packages/core/src/__tests__/helpers.ts:1,13-20,22-31,44-53`

- [ ] **Step 1: Remove legacy hook types from types.ts**

Remove lines 9-28 (the three legacy hook type definitions):

```typescript
// DELETE everything between "// === Hook interfaces (Part 3) ===" and "// === TurnContext (Part 3) ==="
// i.e. remove TurnStartHook, TurnEndHook, ErrorHook types
```

The file should go from `ContextFragment` directly to the `// === TurnContext (Part 3) ===` comment.

- [ ] **Step 2: Remove adaptLegacyHooks from runtime-hooks.ts**

Remove `fragmentsToContext()` helper (lines 117-119) and the entire `adaptLegacyHooks()` function (lines 121-174). Also remove the import of legacy types at line 1:

```typescript
// Line 1 — change FROM:
import type { ContextFragment, TurnContext, TurnResult, TurnStartHook, TurnEndHook, ErrorHook } from './types.js'
// TO:
import type { TurnContext, TurnResult } from './types.js'
```

Note: `ContextFragment` is no longer used after removing `fragmentsToContext`. `TurnContext` and `TurnResult` are still used in the hook input types.

- [ ] **Step 3: Remove adaptLegacyHooks export from index.ts**

```typescript
// DELETE this line:
export { adaptLegacyHooks } from './runtime-hooks.js'
```

- [ ] **Step 4: Remove legacy helpers from helpers.ts**

Remove `createMockHook`, `createSpyEndHook`, `createSpyErrorHook` and their legacy type imports. The file becomes:

```typescript
import type { Runtime, RuntimeEvent, RuntimeStreamOptions } from '../types.js'

export function createMockRuntime(response: string = 'mock response'): Runtime {
  return {
    name: 'mock',
    async *createStream(): AsyncGenerator<RuntimeEvent> {
      yield { type: 'session.init', sessionId: 'sess-1' }
      yield { type: 'result', text: response }
    },
  }
}

export function createStreamingMockRuntime(events: RuntimeEvent[]): Runtime {
  return {
    name: 'mock-streaming',
    async *createStream(): AsyncGenerator<RuntimeEvent> {
      for (const event of events) {
        yield event
      }
    },
  }
}

/**
 * Creates a mock runtime that captures the RuntimeStreamOptions passed to createStream.
 * Useful for verifying that runtimeHooks and other options are forwarded correctly.
 */
export function createHookCapturingRuntime(
  onOptions: (opts: RuntimeStreamOptions) => void,
  response: string = 'mock response',
): Runtime {
  return {
    name: 'hook-capturing',
    async *createStream(options: RuntimeStreamOptions): AsyncGenerator<RuntimeEvent> {
      onOptions(options)
      yield { type: 'session.init', sessionId: 'sess-capture' }
      yield { type: 'result', text: response }
    },
  }
}
```

- [ ] **Step 5: Delete runtime-hooks.test.ts**

Delete the entire file `packages/core/src/__tests__/runtime-hooks.test.ts`. All tests in it are for `adaptLegacyHooks` which no longer exists.

- [ ] **Step 6: Run tests to verify nothing breaks**

Run: `cd packages/core && npx vitest run`
Expected: All remaining tests pass. No references to deleted types.

- [ ] **Step 7: Run type check**

Run: `cd packages/core && npx tsc --noEmit`
Expected: No type errors. If other packages import legacy types, fix those imports too.

- [ ] **Step 8: Commit**

```bash
git add -A packages/core/src/types.ts packages/core/src/runtime-hooks.ts packages/core/src/index.ts packages/core/src/__tests__/helpers.ts packages/core/src/__tests__/runtime-hooks.test.ts
git commit -m "refactor: remove legacy hook types (TurnStartHook, TurnEndHook, ErrorHook) and adaptLegacyHooks"
```

---

### Task 2: Extend TurnEndResult and TurnTrace Types

**Files:**
- Modify: `packages/core/src/runtime-hooks.ts:77`
- Modify: `packages/core/src/types.ts:83-95`

- [ ] **Step 1: Write failing test for new TurnEndResult type**

Create test in `packages/core/src/__tests__/engine.test.ts`:

```typescript
it('collects followUp from onTurnEnd hook into trace.followUps', async () => {
  const hooks: RuntimeHooks = {
    onTurnEnd: [async () => ({ followUp: 'do more work' })],
  }

  const engine = createTurnEngine({
    name: 'test',
    cwd: '/tmp',
    runtime: createMockRuntime('initial response'),
    hooks,
    tools: [],
  })

  const trace = await engine.processTurn({ input: 'hi' })

  expect(trace.followUps).toEqual([
    { prompt: 'do more work', fork: false, detached: false },
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/__tests__/engine.test.ts`
Expected: FAIL — type error because `TurnEndResult` is still `void`.

- [ ] **Step 3: Update TurnEndResult in runtime-hooks.ts**

Change line 77:

```typescript
// FROM:
export type TurnEndResult = void

// TO:
export type TurnEndResult = void | {
  /** Execute a follow-up prompt after this turn */
  followUp?: string
  /** Fork into a new session (inherits current session context via resume). Requires followUp. */
  fork?: boolean
  /** Suppress connector output for the forked turn. Only effective when fork is true. */
  detached?: boolean
}
```

- [ ] **Step 4: Add TurnFollowUp type and update TurnTrace in types.ts**

Add `TurnFollowUp` type and change `followUps` in `TurnTrace`:

```typescript
// Add before TurnTrace:
export type TurnFollowUp = {
  prompt: string
  fork: boolean
  detached: boolean
}

// In TurnTrace, change:
// FROM:
//   followUps?: string[]
// TO:
  followUps?: TurnFollowUp[]
```

- [ ] **Step 5: Update Engine to collect TurnEndResult return values**

In `packages/core/src/engine.ts`, change the onTurnEnd loop (lines 150-165):

```typescript
    // === onTurnEnd hooks (RuntimeHooks) ===
    const followUps: import('./types.js').TurnFollowUp[] = []
    if (result) {
      const turnEndInput: TurnEndInput = {
        hookEventName: 'turnEnd',
        result,
        turnContext: context,
      }
      const isForkedTurn = context.metadata.forkedFrom != null
      for (const callback of hooks?.onTurnEnd ?? []) {
        try {
          const hookResult = await callback(turnEndInput)
          if (hookResult && typeof hookResult === 'object' && hookResult.followUp) {
            // Ignore fork from forked turns (1-level depth limit)
            const fork = isForkedTurn ? false : (hookResult.fork ?? false)
            followUps.push({
              prompt: hookResult.followUp,
              fork,
              detached: fork ? (hookResult.detached ?? false) : false,
            })
          }
        } catch (hookErr) {
          console.error(`[engine] hooks.onTurnEnd threw:`, hookErr)
        }
      }
    }
```

Also update the import at the top of engine.ts — add `TurnFollowUp`:

```typescript
import type {
  Runtime,
  ToolPort,
  TurnContext,
  TurnResult,
  TurnTrace,
  TurnFollowUp,
  HookTrace,
  ContextFragment,
  RuntimeEvent,
  PendingMessageSource,
} from './types.js'
```

- [ ] **Step 6: Export TurnFollowUp from index.ts**

Add to `packages/core/src/index.ts` in the re-exports from types:

The wildcard `export * from './types.js'` already covers it. No change needed.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/__tests__/engine.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/runtime-hooks.ts packages/core/src/types.ts packages/core/src/engine.ts packages/core/src/__tests__/engine.test.ts
git commit -m "feat: extend TurnEndResult to support followUp/fork/detached options"
```

---

### Task 3: Engine Tests for All TurnEndResult Combinations

**Files:**
- Modify: `packages/core/src/__tests__/engine.test.ts`

- [ ] **Step 1: Write test for void return (no followUp)**

```typescript
it('onTurnEnd returning void produces no followUps', async () => {
  const hooks: RuntimeHooks = {
    onTurnEnd: [async () => {}],
  }

  const engine = createTurnEngine({
    name: 'test',
    cwd: '/tmp',
    runtime: createMockRuntime('done'),
    hooks,
    tools: [],
  })

  const trace = await engine.processTurn({ input: 'hi' })

  expect(trace.followUps).toBeUndefined()
})
```

- [ ] **Step 2: Write test for fork + followUp**

```typescript
it('collects fork followUp from onTurnEnd hook', async () => {
  const hooks: RuntimeHooks = {
    onTurnEnd: [async () => ({ fork: true, followUp: 'summarize' })],
  }

  const engine = createTurnEngine({
    name: 'test',
    cwd: '/tmp',
    runtime: createMockRuntime('response'),
    hooks,
    tools: [],
  })

  const trace = await engine.processTurn({ input: 'hi' })

  expect(trace.followUps).toEqual([
    { prompt: 'summarize', fork: true, detached: false },
  ])
})
```

- [ ] **Step 3: Write test for fork + followUp + detached**

```typescript
it('collects fork+detached followUp from onTurnEnd hook', async () => {
  const hooks: RuntimeHooks = {
    onTurnEnd: [async () => ({ fork: true, detached: true, followUp: 'background task' })],
  }

  const engine = createTurnEngine({
    name: 'test',
    cwd: '/tmp',
    runtime: createMockRuntime('response'),
    hooks,
    tools: [],
  })

  const trace = await engine.processTurn({ input: 'hi' })

  expect(trace.followUps).toEqual([
    { prompt: 'background task', fork: true, detached: true },
  ])
})
```

- [ ] **Step 4: Write test for fork without followUp (ignored)**

```typescript
it('ignores fork without followUp', async () => {
  const hooks: RuntimeHooks = {
    onTurnEnd: [async () => ({ fork: true })],
  }

  const engine = createTurnEngine({
    name: 'test',
    cwd: '/tmp',
    runtime: createMockRuntime('response'),
    hooks,
    tools: [],
  })

  const trace = await engine.processTurn({ input: 'hi' })

  expect(trace.followUps).toBeUndefined()
})
```

- [ ] **Step 5: Write test for detached without fork (detached ignored)**

```typescript
it('ignores detached when fork is not set', async () => {
  const hooks: RuntimeHooks = {
    onTurnEnd: [async () => ({ followUp: 'do work', detached: true })],
  }

  const engine = createTurnEngine({
    name: 'test',
    cwd: '/tmp',
    runtime: createMockRuntime('response'),
    hooks,
    tools: [],
  })

  const trace = await engine.processTurn({ input: 'hi' })

  expect(trace.followUps).toEqual([
    { prompt: 'do work', fork: false, detached: false },
  ])
})
```

- [ ] **Step 6: Write test for fork suppression in forked turns**

```typescript
it('ignores fork from a forked turn (depth limit)', async () => {
  const hooks: RuntimeHooks = {
    onTurnEnd: [async () => ({ fork: true, followUp: 'nested fork' })],
  }

  const engine = createTurnEngine({
    name: 'test',
    cwd: '/tmp',
    runtime: createMockRuntime('response'),
    hooks,
    tools: [],
  })

  const trace = await engine.processTurn({
    input: 'hi',
    metadata: { forkedFrom: 'original-turn-id' },
  })

  // fork should be downgraded to non-fork followUp
  expect(trace.followUps).toEqual([
    { prompt: 'nested fork', fork: false, detached: false },
  ])
})
```

- [ ] **Step 7: Write test for multiple onTurnEnd hooks**

```typescript
it('collects followUps from multiple onTurnEnd hooks', async () => {
  const hooks: RuntimeHooks = {
    onTurnEnd: [
      async () => ({ followUp: 'first' }),
      async () => {},
      async () => ({ fork: true, followUp: 'second', detached: true }),
    ],
  }

  const engine = createTurnEngine({
    name: 'test',
    cwd: '/tmp',
    runtime: createMockRuntime('response'),
    hooks,
    tools: [],
  })

  const trace = await engine.processTurn({ input: 'hi' })

  expect(trace.followUps).toEqual([
    { prompt: 'first', fork: false, detached: false },
    { prompt: 'second', fork: true, detached: true },
  ])
})
```

- [ ] **Step 8: Run all engine tests**

Run: `cd packages/core && npx vitest run src/__tests__/engine.test.ts`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/__tests__/engine.test.ts
git commit -m "test: add comprehensive tests for TurnEndResult fork/followUp/detached combinations"
```

---

### Task 4: Worker — Blocking FollowUp Support

**Files:**
- Modify: `packages/core/src/worker.ts:250-275`
- Modify: `packages/core/src/__tests__/worker.test.ts` (create if not exists)

- [ ] **Step 1: Check if worker test file exists**

Run: `ls packages/core/src/__tests__/worker.test.ts 2>/dev/null || echo "not found"`

If it doesn't exist, create it. If it does, read it and add to it.

- [ ] **Step 2: Update executeTurn return type**

In `packages/core/src/worker.ts`, change `executeTurn` return type and the `executeTurnWithSteer` logic.

Change `executeTurn` signature (line 287):

```typescript
// FROM:
async function executeTurn(event: InboundEvent, pendingMessages?: import('./types.js').PendingMessageSource, abortSignal?: AbortSignal): Promise<string[]> {
// TO:
async function executeTurn(event: InboundEvent, pendingMessages?: import('./types.js').PendingMessageSource, abortSignal?: AbortSignal): Promise<import('./types.js').TurnFollowUp[]> {
```

Change `return trace.followUps ?? []` (line 363):

```typescript
// This line already returns trace.followUps which is now TurnFollowUp[], so no change needed
return trace.followUps ?? []
```

Change `return []` in catch block (line 376) — already correct, empty array is compatible.

- [ ] **Step 3: Update executeTurnWithSteer to handle TurnFollowUp[]**

In `packages/core/src/worker.ts`, update the `executeTurnWithSteer` function (around lines 250-275):

```typescript
    let lastError: unknown = null
    while (true) {
      let followUps: import('./types.js').TurnFollowUp[] = []
      try {
        followUps = await executeTurn(event, pendingMessages, abortSignal)
      } catch (err) {
        console.error(`[worker] turn error in ${event.conversationId}, will process remaining pending messages (${pendingEvents.length} left):`, err)
        lastError = err
      }

      // Process followUps from onTurnEnd hooks
      for (const followUp of followUps) {
        if (!followUp.fork) {
          // Blocking followUp: enqueue as pending event (same session)
          pendingEvents.push({ ...event, text: followUp.prompt })
          console.log(`[worker] enqueued blocking follow-up from onTurnEnd hook`)
        } else {
          // Fork followUp: spawn in background (fire-and-forget)
          spawnForkedTurn(event, followUp)
        }
      }

      if (pendingEvents.length === 0) break

      event = pendingEvents.shift()!
      console.log(`[worker] processing next pending message as new turn (${pendingEvents.length} remaining)`)
    }
```

- [ ] **Step 4: Run type check**

Run: `cd packages/core && npx tsc --noEmit`
Expected: Type error for `spawnForkedTurn` not being defined yet. That's expected — we'll add it in Task 5.

- [ ] **Step 5: Commit (WIP — spawnForkedTurn not yet implemented)**

```bash
git add packages/core/src/worker.ts
git commit -m "refactor: update worker to handle TurnFollowUp[] with fork/blocking dispatch"
```

---

### Task 5: Worker — spawnForkedTurn Implementation

**Files:**
- Modify: `packages/core/src/worker.ts`

- [ ] **Step 1: Add spawnForkedTurn function**

Add this function inside `createWorker()`, after the `executeTurn` function (after line 380):

```typescript
  /** Active fork promises — tracked for graceful shutdown */
  const activeForks = new Set<Promise<void>>()

  /**
   * Spawns a forked turn in the background (fire-and-forget).
   * The forked turn inherits the original session via sessionId resume.
   */
  function spawnForkedTurn(originalEvent: InboundEvent, followUp: import('./types.js').TurnFollowUp): void {
    const forkId = randomUUID().slice(0, 8)
    const forkConversationId = `fork-${originalEvent.conversationId}-${forkId}`

    console.log(`[worker] spawning forked turn ${forkId} (detached:${followUp.detached}) for ${originalEvent.conversationId}`)

    const forkPromise = (async () => {
      try {
        // Look up original session to resume from
        const originalSessionId = await sessionStore.get(originalEvent.conversationId)

        // Create output: NullOutput for detached, or real connector output
        const connector = connectorMap.get(originalEvent.connector)
        const output = followUp.detached || !connector
          ? { showProgress: async () => {}, sendResult: async () => {}, sendError: async () => {}, dispose: async () => {} }
          : connector.createOutput({
              conversationId: originalEvent.conversationId,
              connector: originalEvent.connector,
              metadata: originalEvent.raw,
            })

        try {
          const trace = await engine.processTurn({
            input: followUp.prompt,
            trigger: 'connector',
            sessionId: originalSessionId,
            connector: {
              name: originalEvent.connector,
              conversationId: forkConversationId,
              userId: originalEvent.userId,
              userName: originalEvent.userName,
              raw: originalEvent.raw,
            },
            metadata: { forkedFrom: forkConversationId.replace(`fork-`, '').replace(`-${forkId}`, '') },
          })

          // Save forked session under its own conversationId (don't pollute original)
          if (trace.result?.sessionId) {
            await sessionStore.set(forkConversationId, trace.result.sessionId)
          }

          // Send result if not detached
          if (trace.result) {
            await output.sendResult(trace.result.text)
          } else if (trace.error && !followUp.detached) {
            await output.sendError(trace.error)
          }
        } finally {
          await output.dispose()
        }
      } catch (err) {
        console.error(`[worker] forked turn ${forkId} error:`, err)
      }
    })()

    activeForks.add(forkPromise)
    forkPromise.finally(() => activeForks.delete(forkPromise))
  }
```

- [ ] **Step 2: Add randomUUID import**

Add at the top of `packages/core/src/worker.ts`:

```typescript
import { randomUUID } from 'node:crypto'
```

- [ ] **Step 3: Update drain() to wait for active forks**

In the `drain()` function, add fork waiting after active conversations:

```typescript
  async function drain(): Promise<void> {
    if (draining) return
    draining = true

    // 1. Stop accepting new events (close server, connectors, scheduler)
    await stop()

    // 2. Wait for all in-flight turns to complete naturally
    if (activeConversations.size > 0) {
      console.log(`[worker] draining: waiting for ${activeConversations.size} active turn(s) to finish`)
      await Promise.allSettled(
        [...activeConversations.values()].map(s => s.activeTurnPromise),
      )
      console.log('[worker] all active turns finished')
    }

    // 3. Wait for any forked turns still running
    if (activeForks.size > 0) {
      console.log(`[worker] draining: waiting for ${activeForks.size} forked turn(s) to finish`)
      await Promise.allSettled([...activeForks])
      console.log('[worker] all forked turns finished')
    }

    console.log('[worker] exiting')
    process.exit(0)
  }
```

- [ ] **Step 4: Run type check**

Run: `cd packages/core && npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 5: Run all tests**

Run: `cd packages/core && npx vitest run`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/worker.ts
git commit -m "feat: implement spawnForkedTurn for fire-and-forget session forking"
```

---

### Task 6: Integration Tests for Fork/Detached in Worker

**Files:**
- Create or modify: `packages/core/src/__tests__/worker-fork.test.ts`

- [ ] **Step 1: Create worker fork test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTurnEngine } from '../engine.js'
import type { RuntimeHooks, TurnEndInput } from '../runtime-hooks.js'
import type { RuntimeEvent, ConnectorOutput, TurnFollowUp } from '../types.js'

// Minimal mock runtime that returns a configurable response and emits session.init
function createMockRuntime(response: string = 'mock response') {
  return {
    name: 'mock',
    async *createStream(): AsyncGenerator<RuntimeEvent> {
      yield { type: 'session.init' as const, sessionId: `sess-${Math.random().toString(36).slice(2, 8)}` }
      yield { type: 'result' as const, text: response }
    },
  }
}

describe('Engine + Worker fork integration', () => {
  it('blocking followUp (no fork) produces a TurnFollowUp with fork=false', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ followUp: 'continue in same session' })],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('first'),
      hooks,
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'start' })

    expect(trace.followUps).toBeDefined()
    expect(trace.followUps).toHaveLength(1)
    expect(trace.followUps![0]).toEqual({
      prompt: 'continue in same session',
      fork: false,
      detached: false,
    })
  })

  it('fork followUp produces a TurnFollowUp with fork=true', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ fork: true, followUp: 'fork task' })],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('original'),
      hooks,
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'go' })

    expect(trace.followUps).toHaveLength(1)
    expect(trace.followUps![0]).toEqual({
      prompt: 'fork task',
      fork: true,
      detached: false,
    })
  })

  it('fork+detached followUp produces correct TurnFollowUp', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ fork: true, detached: true, followUp: 'silent task' })],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('original'),
      hooks,
      tools: [],
    })

    const trace = await engine.processTurn({ input: 'go' })

    expect(trace.followUps).toHaveLength(1)
    expect(trace.followUps![0]).toEqual({
      prompt: 'silent task',
      fork: true,
      detached: true,
    })
  })

  it('forked turn (metadata.forkedFrom set) downgrades fork to blocking', async () => {
    const hooks: RuntimeHooks = {
      onTurnEnd: [async () => ({ fork: true, followUp: 'try nested fork' })],
    }

    const engine = createTurnEngine({
      name: 'test',
      cwd: '/tmp',
      runtime: createMockRuntime('forked response'),
      hooks,
      tools: [],
    })

    const trace = await engine.processTurn({
      input: 'from fork',
      metadata: { forkedFrom: 'parent-turn-123' },
    })

    expect(trace.followUps).toHaveLength(1)
    expect(trace.followUps![0].fork).toBe(false)
    expect(trace.followUps![0].detached).toBe(false)
  })
})
```

- [ ] **Step 2: Run the integration tests**

Run: `cd packages/core && npx vitest run src/__tests__/worker-fork.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/worker-fork.test.ts
git commit -m "test: add integration tests for fork/detached followUp in engine"
```

---

### Task 7: Full Suite Verification and Type Check

**Files:**
- No changes — verification only

- [ ] **Step 1: Run full type check across the monorepo**

Run: `npx tsc --noEmit` (or the monorepo's type check command, e.g., `bun run typecheck` or `turbo run typecheck`)

Expected: No type errors. If other packages import legacy types (`TurnStartHook`, `TurnEndHook`, `ErrorHook`, `adaptLegacyHooks`), fix those imports.

- [ ] **Step 2: Run full test suite**

Run: `cd packages/core && npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Check for any remaining references to removed types**

Run: `grep -r "TurnStartHook\|TurnEndHook\|ErrorHook\|adaptLegacyHooks" packages/ --include="*.ts" --exclude-dir=node_modules`

Expected: No results (all references removed). If any found, fix them.

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix: remove remaining references to legacy hook types"
```

---

### Task 8: Update Specs

**Files:**
- Modify: `packages/core/specs/types.md`
- Modify: `packages/core/specs/turn-engine.md`
- Modify: `packages/core/specs/worker.md`
- Modify: `packages/hooks/specs/index.md`

- [ ] **Step 1: Read current specs**

Read each spec file to understand what needs updating.

- [ ] **Step 2: Update types.md**

- Remove `TurnStartHook`, `TurnEndHook`, `ErrorHook` references
- Add `TurnFollowUp` type documentation
- Update `TurnTrace.followUps` type from `string[]` to `TurnFollowUp[]`

- [ ] **Step 3: Update turn-engine.md**

- Document that `onTurnEnd` hooks can return `{ followUp, fork, detached }` 
- Document engine's role: collect return values into `TurnTrace.followUps`
- Document fork depth limit (forked turns can't re-fork)

- [ ] **Step 4: Update worker.md**

- Document blocking vs fork followUp dispatch
- Document `spawnForkedTurn` behavior (fire-and-forget, session resume, NullOutput for detached)
- Document graceful shutdown waiting for active forks

- [ ] **Step 5: Update hooks specs**

- Remove legacy hook type references from `packages/hooks/specs/index.md`
- Update any references to `adaptLegacyHooks`

- [ ] **Step 6: Commit**

```bash
git add packages/core/specs/ packages/hooks/specs/
git commit -m "docs: update specs for fork/detached onTurnEnd and legacy removal"
```
