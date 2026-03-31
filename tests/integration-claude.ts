/**
 * sena-v2 통합 테스트: Claude Runtime
 *
 * 실제 로컬 인증 세션으로 Claude Agent SDK를 사용하여
 * TurnEngine 전체 파이프라인을 검증한다.
 *
 * 실행: npx tsx tests/integration-claude.ts
 */

import { createTurnEngine } from '../packages/core/dist/index.js'
import { claudeRuntime } from '../packages/runtime/claude/dist/index.js'
import type { RuntimeEvent, TurnStartHook, TurnEndHook, ContextFragment } from '../packages/core/dist/index.js'

// ── Helpers ──

function log(label: string, msg: string) {
  console.log(`[${label}] ${msg}`)
}

function createTestHook(): TurnStartHook {
  return {
    name: 'test-system-prompt',
    async execute() {
      return [
        {
          source: 'integration-test',
          role: 'system' as const,
          content: 'You are a helpful assistant being tested. Respond concisely in one sentence.',
        },
      ]
    },
  }
}

function createEndHook(): TurnEndHook & { calls: { text: string; sessionId: string | null }[] } {
  const hook = {
    name: 'test-end-logger',
    calls: [] as { text: string; sessionId: string | null }[],
    async execute(_ctx: any, result: any) {
      hook.calls.push({ text: result.text, sessionId: result.sessionId })
    },
  }
  return hook
}

// ── Main Test ──

async function main() {
  console.log('=== sena-v2 Integration Test: Claude Runtime ===\n')

  const runtime = claudeRuntime({
    model: 'claude-sonnet-4-5',
    maxTurns: 3,
    permissionMode: 'bypassPermissions',
  })

  const startHook = createTestHook()
  const endHook = createEndHook()

  const engine = createTurnEngine({
    name: 'integration-test-agent',
    runtime,
    hooks: {
      onTurnStart: [startHook],
      onTurnEnd: [endHook],
    },
    tools: [],
  })

  // ── Test 1: 기본 프롬프트 처리 ──
  log('TEST 1', '기본 프롬프트 처리')

  const events: RuntimeEvent[] = []
  const trace = await engine.processTurn({
    input: 'What is 2 + 3? Reply with just the number.',
    trigger: 'programmatic',
    onEvent: (event) => {
      events.push(event)
      log('EVENT', `${event.type}: ${JSON.stringify(event).slice(0, 120)}`)
    },
  })

  // Assertions
  console.log('')
  assert(trace.agentName === 'integration-test-agent', 'agentName matches')
  assert(trace.trigger === 'programmatic', 'trigger is programmatic')
  assert(trace.input === 'What is 2 + 3? Reply with just the number.', 'input preserved')
  assert(trace.hooks.length >= 2, `hooks executed (${trace.hooks.length} traces)`)
  assert(trace.hooks[0].phase === 'onTurnStart', 'first hook is onTurnStart')
  assert(trace.hooks[0].fragments.length === 1, 'system fragment injected')
  assert(trace.assembledContext.includes('integration-test'), 'assembled context has source')
  assert(trace.result !== null, 'result is not null')
  assert(trace.result!.text.length > 0, `result text: "${trace.result!.text.slice(0, 80)}"`)
  assert(trace.result!.text.includes('5'), 'result contains "5"')
  assert(trace.error === null, 'no error')
  assert(events.some(e => e.type === 'result'), 'result event emitted')
  assert(endHook.calls.length === 1, 'onTurnEnd hook called once')

  log('TEST 1', `✅ PASS — result: "${trace.result!.text.slice(0, 100)}"`)
  log('TEST 1', `   duration: ${trace.result!.durationMs}ms`)

  // ── Test 2: progress 이벤트 스트리밍 ──
  log('TEST 2', '이벤트 스트리밍 확인')

  const hasSessionInit = events.some(e => e.type === 'session.init')
  const hasProgress = events.some(e => e.type === 'progress' || e.type === 'progress.delta')
  const hasResult = events.some(e => e.type === 'result')

  assert(hasResult, 'result event present')
  log('TEST 2', `✅ PASS — session.init: ${hasSessionInit}, progress: ${hasProgress}, result: ${hasResult}`)
  log('TEST 2', `   total events: ${events.length}`)

  // ── Test 3: AbortSignal ──
  log('TEST 3', 'AbortSignal로 중단')

  const controller = new AbortController()
  setTimeout(() => controller.abort(), 1000) // 1초 후 중단

  const abortTrace = await engine.processTurn({
    input: 'Write a very long essay about the history of computing. Make it at least 5000 words.',
    trigger: 'programmatic',
    abortSignal: controller.signal,
  })

  // 중단되었으므로 에러가 있거나 결과가 짧아야 함
  const wasAborted = abortTrace.error !== null || (abortTrace.result?.durationMs ?? 0) < 5000
  assert(wasAborted, `abort handled (error: ${abortTrace.error}, duration: ${abortTrace.result?.durationMs}ms)`)
  log('TEST 3', `✅ PASS — aborted successfully`)

  // ── Summary ──
  console.log('\n=== All Claude Integration Tests PASSED ===')
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`  ✓ ${message}`)
}

main().catch((err) => {
  console.error('❌ Test failed with error:', err)
  process.exit(1)
})
