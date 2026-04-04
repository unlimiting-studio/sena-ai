import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createWorker } from '../worker.js'
import { defineConfig } from '../config.js'
import { heartbeat } from '../schedules.js'
import type { Runtime, RuntimeEvent, Connector, HttpServer, TurnEngine, InboundEvent } from '../types.js'

const mockRuntime: Runtime = {
  name: 'mock',
  async *createStream(): AsyncGenerator<RuntimeEvent> {
    yield { type: 'session.init', sessionId: 'sess-1' }
    yield { type: 'result', text: 'hello from worker' }
  },
}

function createNoopConnector(name = 'noop-connector'): Connector {
  return {
    name,
    registerRoutes(server: HttpServer) {
      server.post(`/${name}/noop`, (_req: unknown, res: any) => {
        res.status(200).json({ ok: true })
      })
    },
    createOutput() {
      return {
        async showProgress() {},
        async sendResult() {},
        async sendError() {},
        async dispose() {},
      }
    },
  }
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// Helper to make HTTP requests to the worker
async function request(port: number, path: string, options: { method?: string; body?: unknown } = {}) {
  const { method = 'GET', body } = options
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: unknown = undefined
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, text, json }
}

describe('createWorker', () => {
  let stopFn: (() => Promise<void>) | null = null
  let originalProcessSend: typeof process.send

  beforeEach(() => {
    // Stub process.send to prevent vitest IPC conflicts
    originalProcessSend = process.send!
    process.send = (() => true) as any
  })

  afterEach(async () => {
    if (stopFn) {
      await stopFn()
      stopFn = null
    }
    process.send = originalProcessSend
    delete process.env.SENA_CONFIG_PATH
  })

  it('creates a worker with engine', () => {
    const config = defineConfig({ name: 'test-worker', runtime: mockRuntime })
    const worker = createWorker({ config, port: 0 })
    expect(worker).toBeDefined()
    expect(worker.engine).toBeDefined()
  })

  it('serves /health endpoint', async () => {
    const config = defineConfig({
      name: 'test-worker',
      runtime: mockRuntime,
      connectors: [createNoopConnector('health-noop')],
    })
    const port = 19876 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()

    // Wait for server to be ready
    await new Promise(r => setTimeout(r, 100))

    const res = await request(port, '/health')
    expect(res.status).toBe(200)
    expect(res.text).toBe('ok')
  })

  it('returns 404 for unknown routes', async () => {
    const config = defineConfig({
      name: 'test-worker',
      runtime: mockRuntime,
      connectors: [createNoopConnector('missing-route-noop')],
    })
    const port = 19876 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()

    await new Promise(r => setTimeout(r, 100))

    const res = await request(port, '/nonexistent')
    expect(res.status).toBe(404)
  })

  it('registers connector routes and handles POST', async () => {
    const receivedEvents: InboundEvent[] = []

    const testConnector: Connector = {
      name: 'test-connector',
      registerRoutes(server: HttpServer, engine: TurnEngine) {
        server.post('/test/events', (req: any, res: any) => {
          const body = req.body
          // Simulate processing
          engine.submitTurn({
            connector: 'test-connector',
            conversationId: body.conversationId ?? 'conv-1',
            userId: body.userId ?? 'user-1',
            userName: body.userName ?? 'testuser',
            text: body.text ?? 'hello',
            raw: body,
          }).then(() => {
            res.status(200).json({ ok: true })
          }).catch((err: Error) => {
            res.status(500).json({ error: err.message })
          })
        })
      },
      createOutput() {
        return {
          async showProgress() {},
          async sendResult() {},
          async sendError() {},
          async dispose() {},
        }
      },
    }

    const config = defineConfig({
      name: 'test-worker',
      runtime: mockRuntime,
      connectors: [testConnector],
    })
    const port = 19876 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()

    await new Promise(r => setTimeout(r, 100))

    const res = await request(port, '/test/events', {
      method: 'POST',
      body: { text: 'test message', conversationId: 'c1', userId: 'u1', userName: 'tester' },
    })

    expect(res.status).toBe(200)
    expect(res.json).toEqual({ ok: true })
  })

  it('parses POST body as JSON', async () => {
    let receivedBody: unknown = null

    const bodyCapture: Connector = {
      name: 'body-capture',
      registerRoutes(server: HttpServer) {
        server.post('/capture', (req: any, res: any) => {
          receivedBody = req.body
          res.status(200).json({ captured: true })
        })
      },
      createOutput() {
        return {
          async showProgress() {},
          async sendResult() {},
          async sendError() {},
          async dispose() {},
        }
      },
    }

    const config = defineConfig({
      name: 'test-worker',
      runtime: mockRuntime,
      connectors: [bodyCapture],
    })
    const port = 19876 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()

    await new Promise(r => setTimeout(r, 100))

    await request(port, '/capture', {
      method: 'POST',
      body: { key: 'value', nested: { a: 1 } },
    })

    expect(receivedBody).toEqual({ key: 'value', nested: { a: 1 } })
  })

  it('passes config directory as prompt base dir when cwd is omitted', () => {
    process.env.SENA_CONFIG_PATH = '/tmp/project/sena.config.ts'
    let receivedContext: Parameters<Connector['registerRoutes']>[2] | undefined

    const contextCapture: Connector = {
      name: 'context-capture',
      registerRoutes(_server, _engine, context) {
        receivedContext = context
      },
      createOutput() {
        return {
          async showProgress() {},
          async sendResult() {},
          async sendError() {},
          async dispose() {},
        }
      },
    }

    const config = defineConfig({
      name: 'context-worker',
      runtime: mockRuntime,
      connectors: [contextCapture],
    })

    createWorker({ config, port: 0 })

    expect(receivedContext).toEqual({
      cwd: process.cwd(),
      configDir: '/tmp/project',
      promptBaseDir: '/tmp/project',
    })
  })

  it('passes explicit cwd as prompt base dir when cwd is configured', () => {
    process.env.SENA_CONFIG_PATH = '/tmp/project/sena.config.ts'
    let receivedContext: Parameters<Connector['registerRoutes']>[2] | undefined

    const contextCapture: Connector = {
      name: 'context-capture',
      registerRoutes(_server, _engine, context) {
        receivedContext = context
      },
      createOutput() {
        return {
          async showProgress() {},
          async sendResult() {},
          async sendError() {},
          async dispose() {},
        }
      },
    }

    const config = defineConfig({
      name: 'context-worker',
      cwd: '/custom/base',
      runtime: mockRuntime,
      connectors: [contextCapture],
    })

    createWorker({ config, port: 0 })

    expect(receivedContext).toEqual({
      cwd: '/custom/base',
      configDir: '/tmp/project',
      promptBaseDir: '/custom/base',
    })
  })

  it('starts and stops scheduler when schedules are configured', async () => {
    const runtimeCalls: string[] = []
    const schedulerRuntime: Runtime = {
      name: 'scheduler-mock',
      async *createStream(): AsyncGenerator<RuntimeEvent> {
        runtimeCalls.push('turn')
        yield { type: 'session.init', sessionId: 'sched-sess' }
        yield { type: 'result', text: 'heartbeat done' }
      },
    }

    const config = defineConfig({
      name: 'test-scheduler-worker',
      runtime: schedulerRuntime,
      schedules: [
        heartbeat('1s', { name: 'test-hb', prompt: 'test heartbeat' }),
      ],
    })
    const port = 19876 + Math.floor(Math.random() * 1000)
    const worker = createWorker({ config, port })
    await worker.start()
    stopFn = () => worker.stop()

    // Wait enough for at least 1 heartbeat to fire (1s interval)
    await new Promise(r => setTimeout(r, 1200))

    expect(runtimeCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('does not create scheduler when no schedules configured', () => {
    const config = defineConfig({ name: 'no-sched', runtime: mockRuntime })
    // Should not throw — scheduler is null
    const worker = createWorker({ config, port: 0 })
    expect(worker).toBeDefined()
  })

  it('passes inbound raw metadata to connector outputs', async () => {
    const outputContexts: unknown[] = []
    let turnEngine: TurnEngine | undefined

    const metadataConnector: Connector = {
      name: 'metadata-capture',
      registerRoutes(_server, engine) {
        turnEngine = engine
      },
      createOutput(context) {
        outputContexts.push(context)
        return {
          async showProgress() {},
          async sendResult() {},
          async sendError() {},
          async dispose() {},
        }
      },
    }

    const runtime: Runtime = {
      name: 'metadata-runtime',
      async *createStream(): AsyncGenerator<RuntimeEvent> {
        yield { type: 'result', text: 'ok' }
      },
    }

    const worker = createWorker({
      config: defineConfig({
        name: 'metadata-worker',
        runtime,
        connectors: [metadataConnector],
      }),
      port: 0,
    })
    expect(worker).toBeDefined()
    expect(turnEngine).toBeDefined()
    const connectorEngine = turnEngine!

    const raw = { triggerKind: 'message', thinkingMessage: '분석 중...' }
    await connectorEngine.submitTurn({
      connector: 'metadata-capture',
      conversationId: 'C1:100.1',
      userId: 'U1',
      userName: 'tester',
      text: 'hello',
      raw,
    })

    expect(outputContexts).toEqual([
      {
        connector: 'metadata-capture',
        conversationId: 'C1:100.1',
        metadata: raw,
      },
    ])

    await worker.stop()
  })

  it('restores drained pending events in FIFO order while preserving each raw payload', async () => {
    const outputContexts: unknown[] = []
    const seenInputs: string[] = []
    const started = createDeferred()
    const allowDrain = createDeferred()
    let turnEngine: TurnEngine | undefined
    let turnCount = 0

    const runtime: Runtime = {
      name: 'steer-runtime',
      async *createStream(options): AsyncGenerator<RuntimeEvent> {
        turnCount += 1

        let input = ''
        for await (const message of options.prompt) {
          input += message.text
        }
        seenInputs.push(input)

        if (turnCount === 1) {
          started.resolve()
          await allowDrain.promise
          const drained = options.pendingMessages?.drain() ?? []
          expect(drained).toEqual(['second', 'third'])
          options.pendingMessages?.restore(['second restored', 'third restored'])
        }

        yield { type: 'result', text: input }
      },
    }

    const steerConnector: Connector = {
      name: 'steer-capture',
      registerRoutes(_server, engine) {
        turnEngine = engine
      },
      createOutput(context) {
        outputContexts.push(context)
        return {
          async showProgress() {},
          async sendResult() {},
          async sendError() {},
          async dispose() {},
        }
      },
    }

    const worker = createWorker({
      config: defineConfig({
        name: 'steer-worker',
        runtime,
        connectors: [steerConnector],
      }),
      port: 0,
    })
    expect(worker).toBeDefined()
    expect(turnEngine).toBeDefined()
    const connectorEngine = turnEngine!

    const firstTurn = connectorEngine.submitTurn({
      connector: 'steer-capture',
      conversationId: 'C1:200.1',
      userId: 'U1',
      userName: 'tester',
      text: 'first',
      raw: { id: 'raw-first' },
    })

    await started.promise

    const secondTurn = connectorEngine.submitTurn({
      connector: 'steer-capture',
      conversationId: 'C1:200.1',
      userId: 'U2',
      userName: 'tester-2',
      text: 'second',
      raw: { id: 'raw-second' },
    })

    const thirdTurn = connectorEngine.submitTurn({
      connector: 'steer-capture',
      conversationId: 'C1:200.1',
      userId: 'U3',
      userName: 'tester-3',
      text: 'third',
      raw: { id: 'raw-third' },
    })

    allowDrain.resolve()

    await Promise.all([firstTurn, secondTurn, thirdTurn])

    expect(seenInputs).toEqual(['first', 'second restored', 'third restored'])
    expect(outputContexts).toEqual([
      {
        connector: 'steer-capture',
        conversationId: 'C1:200.1',
        metadata: { id: 'raw-first' },
      },
      {
        connector: 'steer-capture',
        conversationId: 'C1:200.1',
        metadata: { id: 'raw-second' },
      },
      {
        connector: 'steer-capture',
        conversationId: 'C1:200.1',
        metadata: { id: 'raw-third' },
      },
    ])

    await worker.stop()
  })
})
