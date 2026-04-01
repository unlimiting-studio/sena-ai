import type { Command } from 'commander'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'

export function registerInit(program: Command): void {
  program
    .command('init <name>')
    .description('Create a new Sena bot project')
    .action(async (name: string) => {
      const targetDir = resolve(process.cwd(), name)

      if (existsSync(targetDir)) {
        console.error(`Directory '${name}' already exists.`)
        process.exit(1)
      }

      console.log(`Creating '${name}'...`)

      // Download template via degit
      const degit = (await import('degit')).default
      const emitter = degit('unlimiting-studio/sena-ai/templates/bot-starter', { cache: false })
      await emitter.clone(targetDir)

      // Replace placeholders
      const configPath = resolve(targetDir, 'sena.config.ts')
      const pkgPath = resolve(targetDir, 'package.json')

      let config = readFileSync(configPath, 'utf-8')
      config = config.replace(/%%BOT_NAME%%/g, name)
      writeFileSync(configPath, config)

      let pkg = readFileSync(pkgPath, 'utf-8')
      pkg = pkg.replace('"sena-bot"', `"${name}"`)
      writeFileSync(pkgPath, pkg)

      // .env.template → .env
      const envTemplate = resolve(targetDir, '.env.template')
      if (existsSync(envTemplate)) {
        renameSync(envTemplate, resolve(targetDir, '.env'))
      }

      // Install dependencies
      console.log('Installing dependencies...')
      execSync('pnpm install', { cwd: targetDir, stdio: 'inherit' })

      console.log('')
      console.log(`Done! Your bot '${name}' is ready.`)
      console.log('')
      console.log('Next steps:')
      console.log(`  cd ${name}`)
      console.log('  # Edit .env with your CONNECT_KEY and PLATFORM_URL')
      console.log('  npx sena start')
    })
}
