import { fork, type ChildProcess } from 'node:child_process'
import { createServer, request as httpRequest, type Server, type IncomingMessage, type ServerResponse } from 'node:http'

export type OrchestratorOptions = {
  port: number
  workerScript: string
  workerPort?: number
}

export type WorkerInfo = {
  generation: number
  process: ChildProcess
  port: number
  ready: boolean
  exited: boolean
  released: boolean
}

// Grace period before force-killing a draining worker (1 hour)
const DRAIN_TIMEOUT_MS = 60 * 60 * 1000

export function createOrchestrator(options: OrchestratorOptions) {
  const { port, workerScript, workerPort = 0 } = options

  let currentWorker: WorkerInfo | null = null
  let generation = 0
  let server: Server | null = null

  function spawnWorker(workerPortOverride?: number): WorkerInfo {
    const gen = ++generation
    const wp = workerPortOverride ?? workerPort

    // If workerScript is a .ts file, use tsx to run it
    const isTsFile = workerScript.endsWith('.ts') || workerScript.endsWith('.tsx')
    const execArgv = isTsFile
      ? ['--import', 'tsx']
      : []

    const child = fork(workerScript, [], {
      detached: true,
      env: { ...process.env, SENA_WORKER_PORT: String(wp), SENA_GENERATION: String(gen) },
      execArgv: [...process.execArgv, ...execArgv],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })

    const worker: WorkerInfo = {
      generation: gen,
      process: child,
      port: wp,
      ready: false,
      exited: false,
      released: false,
    }

    child.on('message', (msg: any) => {
      if (msg?.type === 'ready') {
        worker.ready = true
        // Worker reports actual port (important when spawned with port=0)
        if (typeof msg.port === 'number') {
          worker.port = msg.port
        }
      }
    })

    child.on('exit', (code) => {
      worker.exited = true
      if (!worker.released && currentWorker?.generation === gen) {
        console.error(`Worker gen ${gen} exited with code ${code}, respawning...`)
        currentWorker = spawnWorker(wp)
      }
    })

    return worker
  }

  /**
   * Release a worker: send drain, disconnect IPC, and unref so it can
   * finish in-flight work as an orphan and then exit naturally.
   */
  function releaseWorker(worker: WorkerInfo): void {
    worker.released = true

    try { worker.process.send({ type: 'drain' }) } catch { /* IPC may already be closed */ }
    try { worker.process.disconnect() } catch { /* already disconnected */ }
    worker.process.unref()

    // Safety net: force kill after a long grace period (only if still alive)
    const killTimer = setTimeout(() => {
      if (!worker.exited) {
        try {
          worker.process.kill()
          console.error(`Force-killed draining worker gen ${worker.generation} after timeout`)
        } catch { /* process already exited */ }
      }
    }, DRAIN_TIMEOUT_MS)
    killTimer.unref()

    // Cancel the timer if the worker exits on its own
    worker.process.on('exit', () => clearTimeout(killTimer))
  }

  async function waitForReady(worker: WorkerInfo, timeoutMs = 30000): Promise<boolean> {
    if (worker.ready) return true

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      const check = setInterval(() => {
        if (worker.ready) {
          clearTimeout(timer)
          clearInterval(check)
          resolve(true)
        }
      }, 100)
    })
  }

  function proxyRequest(req: IncomingMessage, res: ServerResponse): void {
    if (!currentWorker?.ready) {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('Service Unavailable')
      return
    }

    const proxyReq = httpRequest(
      {
        hostname: '127.0.0.1',
        port: currentWorker.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes: IncomingMessage) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
        proxyRes.pipe(res)
      },
    )

    proxyReq.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'text/plain' })
      res.end('Bad Gateway')
    })

    req.pipe(proxyReq)
  }

  async function start(): Promise<void> {
    currentWorker = spawnWorker()
    await waitForReady(currentWorker)

    server = createServer(proxyRequest)
    server.listen(port, () => {
      console.log(`Orchestrator listening on port ${port}`)
    })
  }

  async function restart(): Promise<void> {
    const oldWorker = currentWorker

    // Suppress auto-respawn of old worker during rolling restart.
    // Without this, if oldWorker crashes while we await the new one,
    // the exit handler would spawn a third worker that we'd then lose.
    if (oldWorker) oldWorker.released = true

    // When workerPort is 0 (OS-assigned), always use 0 so the OS picks a free port.
    // Only alternate when an explicit workerPort is configured.
    const newWorker = spawnWorker(workerPort === 0 ? 0 : workerPort + (generation % 2))

    const ready = await waitForReady(newWorker)
    if (!ready) {
      console.error('New worker failed to become ready, keeping old worker')
      newWorker.process.kill()
      // Restore old worker if still alive
      if (oldWorker && !oldWorker.exited) oldWorker.released = false
      return
    }

    // Switch traffic
    currentWorker = newWorker

    // Release old worker — it will drain in-flight work and exit naturally
    if (oldWorker) {
      releaseWorker(oldWorker)
    }
  }

  async function stop(): Promise<void> {
    server?.close()
    if (currentWorker) {
      releaseWorker(currentWorker)
      currentWorker = null
    }
  }

  return { start, restart, stop }
}
