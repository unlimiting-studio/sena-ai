#!/usr/bin/env node
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { registerStart } from './commands/start.js'
import { registerStop } from './commands/stop.js'
import { registerRestart } from './commands/restart.js'
import { registerStatus } from './commands/status.js'
import { registerLogs } from './commands/logs.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Read version from package.json
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8')) as { version: string }

const program = new Command()

program
  .name('sena')
  .description('Sena AI agent lifecycle manager')
  .version(pkg.version)
  .option('-c, --config <path>', 'path to sena.config.ts')

registerStart(program)
registerStop(program)
registerRestart(program)
registerStatus(program)
registerLogs(program)

program.parse()
