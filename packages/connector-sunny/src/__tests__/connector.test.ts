import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorker, defineConfig } from '@sena-ai/core'
import type { Runtime, RuntimeEvent } from '@sena-ai/core'
import { sunnyConnector } from '../connector.js'
import type { SunnyTaskResponse } from '../connector.js'

// ── Mock runtime that returns a structured report ──

function createMockRuntime(responseText?: string): Runtime {
  return {
    name: 'mock',
    async *createStream(): AsyncGenerator<RuntimeEvent> {
      yield { type: 'session.init', sessionId: 'sess-mock-1' }
      yield {
        type: 'result',
        text: responseText ?? '# 내일 오전 일정\n\n내일 오전에 2개의 일정이 있어요.\n\n10시 팀 미팅, 11시 반 1:1 면담.\n\n오후는 비어 있어요.',
      }
    },
  }
}

function createFailRuntime(): Runtime {
  return {
    name: 'mock-fail',
    async *createStream(): AsyncGenerator<RuntimeEvent> {
      yield { type: 'error', message: '에이전트 실행 오류' }
      throw new Error('에이전트 실행 오류')
    },
  }
}

async function request(
  port: number,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const { method = 'GET', body, headers = {} } = options
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: unknown = undefined
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, text, json }
}

describe('connector-sunny', () => {
  let stopFn: (() => Promise<void>) | null = null
  let originalProcessSend: typeof process.send

  beforeEach(() => {
    originalProcessSend = process.send!
    process.send = (() => true) as any
  })

  afterEach(async () => {
    if (stopFn) {
      await stopFn()
      stopFn = null
    }
    process.send = originalProcessSend
  })

  it('registers /api/sunny/tasks route', async () => {
    const config = defineConfig({
      name: 'test-sunny',
      runtime: createMockRuntime(),
      connectors: [sunnyConnector()],
    })
    const port = 29000 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()
    await new Promise((r) => setTimeout(r, 100))

    // Should return 400 for missing fields (not 404)
    const res = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: {},
    })
    expect(res.status).toBe(400)
    expect((res.json as { error: string }).error).toBe('taskId and goal are required')
  })

  it('processes a task and returns structured report', async () => {
    const config = defineConfig({
      name: 'test-sunny',
      runtime: createMockRuntime(),
      connectors: [sunnyConnector()],
    })
    const port = 29000 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()
    await new Promise((r) => setTimeout(r, 100))

    const res = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: {
        taskId: 'task_test_1',
        goal: '내일 오전 일정 확인해줘',
        context: { mode: 'voice', userLocale: 'ko-KR' },
      },
    })

    expect(res.status).toBe(200)
    const body = res.json as SunnyTaskResponse
    expect(body.taskId).toBe('task_test_1')
    expect(body.status).toBe('completed')
    expect(body.report).toBeTruthy()
    expect(body.report!.title).toBe('내일 오전 일정')
    expect(body.report!.content).toContain('팀 미팅')
    expect(body.report!.content).toContain('1:1 면담')
    expect(body.report!.summary.length).toBeGreaterThan(0)
    expect(body.sessionId).toBeTruthy()
    expect(body.error).toBeNull()
  })

  it('handles auth token validation', async () => {
    const config = defineConfig({
      name: 'test-sunny',
      runtime: createMockRuntime(),
      connectors: [sunnyConnector({ authToken: 'secret-123' })],
    })
    const port = 29000 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()
    await new Promise((r) => setTimeout(r, 100))

    // Without auth token → 401
    const noAuth = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: { taskId: 't1', goal: 'test' },
    })
    expect(noAuth.status).toBe(401)

    // With wrong token → 401
    const wrongAuth = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: { taskId: 't1', goal: 'test' },
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(wrongAuth.status).toBe(401)

    // With correct token → 200
    const goodAuth = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: { taskId: 't2', goal: 'test task' },
      headers: { Authorization: 'Bearer secret-123' },
    })
    expect(goodAuth.status).toBe(200)
    expect((goodAuth.json as SunnyTaskResponse).status).toBe('completed')
  })

  it('returns session ID for follow-up support', async () => {
    const config = defineConfig({
      name: 'test-sunny',
      runtime: createMockRuntime(),
      connectors: [sunnyConnector()],
    })
    const port = 29000 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()
    await new Promise((r) => setTimeout(r, 100))

    // First task
    const res1 = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: { taskId: 'task_first', goal: '일정 확인' },
    })
    expect(res1.status).toBe(200)
    const body1 = res1.json as SunnyTaskResponse
    expect(body1.sessionId).toBeTruthy()

    // Follow-up task using sessionId from first
    const res2 = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: {
        taskId: 'task_followup',
        goal: '그 팀 미팅 30분 뒤로 옮겨줘',
        context: { sessionId: body1.sessionId },
      },
    })
    expect(res2.status).toBe(200)
    const body2 = res2.json as SunnyTaskResponse
    expect(body2.status).toBe('completed')
    // Should use same sessionId (conversationId) for session continuity
    expect(body2.sessionId).toBe(body1.sessionId)
  })

  it('handles runtime errors gracefully', async () => {
    const config = defineConfig({
      name: 'test-sunny',
      runtime: createFailRuntime(),
      connectors: [sunnyConnector()],
    })
    const port = 29000 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()
    await new Promise((r) => setTimeout(r, 100))

    const res = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: { taskId: 'task_fail', goal: '실패할 작업' },
    })

    expect(res.status).toBe(200) // HTTP succeeds, but status is 'failed'
    const body = res.json as SunnyTaskResponse
    expect(body.status).toBe('failed')
    expect(body.report).toBeNull()
    expect(body.error).toBeTruthy()
  })

  it('respects timeout setting', async () => {
    // Create a runtime that takes too long
    const slowRuntime: Runtime = {
      name: 'mock-slow',
      async *createStream(): AsyncGenerator<RuntimeEvent> {
        yield { type: 'session.init', sessionId: 'sess-slow' }
        await new Promise((r) => setTimeout(r, 5000)) // 5 second delay
        yield { type: 'result', text: 'too slow' }
      },
    }

    const config = defineConfig({
      name: 'test-sunny',
      runtime: slowRuntime,
      connectors: [sunnyConnector({ defaultTimeoutMs: 500 })], // 500ms timeout
    })
    const port = 29000 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()
    await new Promise((r) => setTimeout(r, 100))

    const res = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: { taskId: 'task_timeout', goal: '느린 작업' },
    })

    expect(res.status).toBe(200)
    const body = res.json as SunnyTaskResponse
    expect(body.status).toBe('failed')
    expect(body.error).toContain('시간이 초과')
  }, 10_000) // vitest timeout

  it('parses report title from markdown heading', async () => {
    const runtime = createMockRuntime('## 매출 보고서\n\n이번 분기 매출은 150% 증가했습니다.\n\n세부 내용은 아래와 같습니다.')
    const config = defineConfig({
      name: 'test-sunny',
      runtime,
      connectors: [sunnyConnector()],
    })
    const port = 29000 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()
    await new Promise((r) => setTimeout(r, 100))

    const res = await request(port, '/api/sunny/tasks', {
      method: 'POST',
      body: { taskId: 'task_md', goal: '매출 보고서 작성' },
    })

    const body = res.json as SunnyTaskResponse
    expect(body.report!.title).toBe('매출 보고서') // heading prefix stripped
    expect(body.report!.content).toContain('## 매출 보고서') // full content preserved
    expect(body.report!.summary).toContain('매출은 150% 증가')
  })
})
