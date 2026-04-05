import type { Command } from 'commander'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { execSync } from 'node:child_process'

const TEMPLATES: Record<string, { repo: string; envHint: string }> = {
  'slack-integration': {
    repo: 'unlimiting-studio/sena-ai/templates/slack-integration',
    envHint: '  # Edit .env with your Slack credentials',
  },
  'platform-integration': {
    repo: 'unlimiting-studio/sena-ai/templates/platform-integration',
    envHint: '  # Edit .env with your CONNECT_KEY and PLATFORM_URL',
  },
}

const DEFAULT_TEMPLATE = 'slack-integration'

export function registerInit(program: Command): void {
  program
    .command('init <name>')
    .description('Create a new Sena bot project')
    .option('-t, --template <template>', `template to use (${Object.keys(TEMPLATES).join(', ')})`, DEFAULT_TEMPLATE)
    .action(async (name: string, opts: { template: string }) => {
      const targetDir = resolve(process.cwd(), name)
      const botName = basename(targetDir)

      const tmpl = TEMPLATES[opts.template]
      if (!tmpl) {
        console.error(`Unknown template '${opts.template}'. Available: ${Object.keys(TEMPLATES).join(', ')}`)
        process.exit(1)
      }

      if (existsSync(targetDir)) {
        console.error(`Directory '${botName}' already exists.`)
        process.exit(1)
      }

      console.log(`Creating '${botName}' (template: ${opts.template})...`)

      // Download template via degit
      const degit = (await import('degit')).default
      const emitter = degit(tmpl.repo, { cache: false })
      await emitter.clone(targetDir)

      // Replace placeholders
      const configPath = resolve(targetDir, 'sena.config.ts')
      const pkgPath = resolve(targetDir, 'package.json')

      let config = readFileSync(configPath, 'utf-8')
      config = config.replace(/%%BOT_NAME%%/g, botName)
      writeFileSync(configPath, config)

      let pkg = readFileSync(pkgPath, 'utf-8')
      pkg = pkg.replace('"sena-bot"', `"${botName}"`)
      writeFileSync(pkgPath, pkg)

      // Replace placeholders in manifest if present
      const manifestPath = resolve(targetDir, 'slack-app-manifest.json')
      if (existsSync(manifestPath)) {
        let manifest = readFileSync(manifestPath, 'utf-8')
        manifest = manifest.replace(/%%BOT_NAME%%/g, botName)
        writeFileSync(manifestPath, manifest)
      }

      // .env.template → .env
      const envTemplate = resolve(targetDir, '.env.template')
      if (existsSync(envTemplate)) {
        renameSync(envTemplate, resolve(targetDir, '.env'))
      }

      // Install dependencies
      console.log('Installing dependencies...')
      execSync('pnpm install', { cwd: targetDir, stdio: 'inherit' })

      console.log('')
      console.log(`Done! Your bot '${botName}' is ready.`)
      console.log('')
      console.log('Next steps:')
      console.log(`  cd ${botName}`)
      console.log(tmpl.envHint)
      console.log('  npx sena start')
    })
}
