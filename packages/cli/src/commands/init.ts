import type { Command } from 'commander'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { input, select } from '@inquirer/prompts'

const TEMPLATES: Record<string, { label: string; repo: string; envHint: string }> = {
  'slack-integration': {
    label: 'Slack Integration — Slack Socket Mode 직접 연결',
    repo: 'unlimiting-studio/sena-ai/templates/slack-integration',
    envHint: '  # Edit .env with your Slack credentials',
  },
}

export function registerInit(program: Command): void {
  program
    .command('init [name]')
    .description('Create a new Sena bot project')
    .option('-t, --template <template>', 'template to use')
    .action(async (nameArg: string | undefined, opts: { template?: string }) => {
      // Interactive name prompt if not provided
      const name =
        nameArg ||
        (await input({
          message: 'Bot name:',
          validate: (v) => (v.trim() ? true : 'Name is required'),
        }))

      const targetDir = resolve(process.cwd(), name)
      const botName = basename(targetDir)

      if (existsSync(targetDir)) {
        console.error(`Directory '${botName}' already exists.`)
        process.exit(1)
      }

      // Interactive template selection if not provided
      const templateKeys = Object.keys(TEMPLATES)
      let templateKey = opts.template
      if (!templateKey) {
        if (templateKeys.length === 1) {
          templateKey = templateKeys[0]
        } else {
          templateKey = await select({
            message: 'Template:',
            choices: templateKeys.map((key) => ({
              name: TEMPLATES[key].label,
              value: key,
            })),
          })
        }
      }

      const tmpl = TEMPLATES[templateKey]
      if (!tmpl) {
        console.error(`Unknown template '${templateKey}'. Available: ${templateKeys.join(', ')}`)
        process.exit(1)
      }

      console.log(`\nCreating '${botName}' (template: ${templateKey})...\n`)

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
