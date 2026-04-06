import type { Command } from 'commander'
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from 'node:fs'
import { resolve, basename, extname } from 'node:path'
import { execSync } from 'node:child_process'
import { input, select } from '@inquirer/prompts'

/** Text file extensions to scan for placeholder replacement */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.js', '.json', '.md', '.txt', '.yaml', '.yml', '.toml', '.env', '.template',
])

/** Recursively replace %%BOT_NAME%% in all text files under a directory */
function replacePlaceholdersRecursive(dir: string, botName: string): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue
      replacePlaceholdersRecursive(fullPath, botName)
    } else if (stat.isFile() && TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) {
      const content = readFileSync(fullPath, 'utf-8')
      if (content.includes('%%BOT_NAME%%')) {
        writeFileSync(fullPath, content.replace(/%%BOT_NAME%%/g, botName))
      }
    }
  }
}

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

      // Replace %%BOT_NAME%% in all text files recursively
      replacePlaceholdersRecursive(targetDir, botName)

      // Also replace package name
      const pkgPath = resolve(targetDir, 'package.json')
      let pkg = readFileSync(pkgPath, 'utf-8')
      pkg = pkg.replace('"sena-bot"', `"${botName}"`)
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
      console.log(`Done! Your bot '${botName}' is ready.`)
      console.log('')
      console.log('Next steps:')
      console.log(`  cd ${botName}`)
      console.log('')
      if (existsSync(resolve(targetDir, 'slack-app-manifest.json'))) {
        console.log('  1. Create a Slack app using the manifest:')
        console.log('     → https://api.slack.com/apps?new_app=1')
        console.log('     → Choose "From a manifest" and paste the contents of slack-app-manifest.json')
        console.log('')
        console.log('  2. Install the app to your workspace and copy the tokens into .env:')
        console.log('     → SLACK_APP_ID    : Basic Information → App ID')
        console.log('     → SLACK_BOT_TOKEN : OAuth & Permissions → Bot User OAuth Token (xoxb-...)')
        console.log('     → SLACK_APP_TOKEN : Basic Information → App-Level Tokens → Generate (connections:write scope, xapp-...)')
        console.log('')
        console.log('  3. Start your bot:')
        console.log('     npx sena start')
      } else {
        console.log(tmpl.envHint)
        console.log('  npx sena start')
      }

      process.exit(0)
    })
}
