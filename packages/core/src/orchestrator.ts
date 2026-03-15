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
}

export function createOrchestrator(options: OrchestratorOptions) {
  const { port, workerScript, workerPort = port + 1 } = options

  let currentWorker: WorkerInfo | null = null
  let generation = 0
  let server: Server | null = null

  function spawnWorker(workerPortOverride?: number): WorkerInfo {
    const gen = ++generation
    const wp = workerPortOverride ?? workerPort

    const child = fork(workerScript, [], {
      env: { ...process.env, SENA_WORKER_PORT: String(wp), SENA_GENERATION: String(gen) },
      stdio: 'inherit',
    })

    const worker: WorkerInfo = {
      generation: gen,
      process: child,
      port: wp,
      ready: false,
    }

    child.on('message', (msg: any) => {
      if (msg?.type === 'ready') {
        worker.ready = true
      }
    })

    child.on('exit', (code) => {
      if (currentWorker?.generation === gen) {
        console.error(`Worker gen ${gen} exited with code ${code}, respawning...`)
        currentWorker = spawnWorker(wp)
      }
    })

    return worker
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
    const newWorker = spawnWorker(workerPort + (generation % 2)) // Alternate ports

    const ready = await waitForReady(newWorker)
    if (!ready) {
      console.error('New worker failed to become ready, keeping old worker')
      newWorker.process.kill()
      return
    }

    // Switch traffic
    currentWorker = newWorker

    // Drain old worker
    if (oldWorker) {
      oldWorker.process.send({ type: 'drain' })
      setTimeout(() => {
        if (!oldWorker.process.killed) {
          oldWorker.process.kill()
        }
      }, 10000)
    }
  }

  async function stop(): Promise<void> {
    server?.close()
    currentWorker?.process.kill()
    currentWorker = null
  }

  return { start, restart, stop }
}
