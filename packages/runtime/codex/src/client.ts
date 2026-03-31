import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { EventEmitter } from 'node:events'

export type JsonRpcMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

type PendingRequest = {
  resolve: (result: unknown) => void
  reject: (error: unknown) => void
}

export class CodexAppServerClient extends EventEmitter {
  private child: ChildProcess | null = null
  private rl: Interface | null = null
  private nextId = 0
  private pending = new Map<number, PendingRequest>()
  private codexBin: string

  constructor(codexBin = 'codex') {
    super()
    this.codexBin = codexBin
  }

  spawn(configOverrides?: string[]): void {
    const args = ['app-server']
    if (configOverrides?.length) {
      for (const c of configOverrides) {
        args.push('-c', c)
      }
    }
    this.child = spawn(this.codexBin, args, {
      stdio: ['pipe', 'pipe', 'inherit'],
    })

    this.rl = createInterface({ input: this.child.stdout! })
    this.rl.on('line', (line) => this.onLine(line))

    this.child.on('error', (err) => this.emit('spawn-error', err))
    this.child.on('exit', (code) => this.emit('exit', code))
  }

  private onLine(line: string): void {
    if (!line.trim()) return
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }

    // Response to a client request
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) {
        reject(new Error(msg.error.message))
      } else {
        resolve(msg.result)
      }
      return
    }

    // Server request (has id but no pending — requires client response)
    if (msg.id !== undefined && msg.method) {
      this.emit('server-request', msg)
      return
    }

    // Server notification (no id)
    if (msg.method) {
      // Avoid emitting raw method names that start with 'error' — Node.js
      // treats unhandled 'error' events as fatal. Use 'notification' only.
      this.emit('notification', msg)
    }
  }

  private send(msg: object): void {
    if (!this.child?.stdin?.writable) throw new Error('Client not connected')
    this.child.stdin.write(JSON.stringify(msg) + '\n')
  }

  request(method: string, params: object): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send({ id, method, params })
    })
  }

  notify(method: string, params: object = {}): void {
    this.send({ method, params })
  }

  respond(id: number, result: unknown): void {
    this.send({ id, result })
  }

  async initialize(clientName = 'sena-runtime', version = '0.1.0'): Promise<unknown> {
    const result = await this.request('initialize', {
      clientInfo: { name: clientName, version },
      capabilities: { experimentalApi: true },
    })
    this.notify('initialized')
    return result
  }

  async threadStart(params: {
    model?: string
    cwd?: string
    approvalPolicy?: string
    sandbox?: Record<string, unknown>
    baseInstructions?: string
  }): Promise<{ threadId: string }> {
    const result = await this.request('thread/start', {
      ...params,
      persistExtendedHistory: true,
    }) as { thread: { id: string } }
    return { threadId: result.thread.id }
  }

  async threadResume(threadId: string, params: object = {}): Promise<unknown> {
    return this.request('thread/resume', {
      threadId,
      ...params,
      experimentalRawEvents: false,
      persistExtendedHistory: true,
    })
  }

  async turnStart(threadId: string, text: string, params: object = {}): Promise<{ turnId: string }> {
    const result = await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text }],
      persistExtendedHistory: true,
      ...params,
    }) as { turn: { id: string } }
    return { turnId: result.turn.id }
  }

  async turnSteer(threadId: string, text: string, expectedTurnId: string): Promise<{ turnId: string }> {
    const result = await this.request('turn/steer', {
      threadId,
      input: [{ type: 'text', text }],
      expectedTurnId,
    }) as { turnId: string }
    return { turnId: result.turnId }
  }

  close(): void {
    this.rl?.close()
    this.child?.kill()
    this.child = null
    this.rl = null
    for (const [, { reject }] of this.pending) {
      reject(new Error('Client closed'))
    }
    this.pending.clear()
  }
}
