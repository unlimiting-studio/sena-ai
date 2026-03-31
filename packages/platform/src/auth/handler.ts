import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { OAuthStateRepository, WorkspaceAdminConfigRepository } from '../types/repository.js'
import type { CryptoProvider } from '../types/crypto.js'
import type { Vault } from '../types/vault.js'
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  createSessionCookieValue,
  parseSessionCookieValue,
  type AuthSession,
  type AuthSessionUser,
} from './session.js'

const DEFAULT_WORKSPACE_ADMIN_CONFIG_ID = 'default'
const LOGIN_STATE_PREFIX = 'login:'

interface SlackTokenResponse {
  ok: boolean
  access_token?: string
  error?: string
}

interface SlackUserInfoResponse {
  ok: boolean
  sub?: string
  'https://slack.com/team_id'?: string
  name?: string
  email?: string
  picture?: string
  error?: string
}

export interface AuthEnv {
  Variables: {
    user: AuthSessionUser
    session: AuthSession
  }
}

export function createAuthHandler(
  workspaceAdminConfig: WorkspaceAdminConfigRepository,
  oauthStates: OAuthStateRepository,
  crypto: CryptoProvider,
  vault: Vault,
  config: {
    platformBaseUrl: string
  },
) {
  const app = new Hono<AuthEnv>()

  app.get('/auth/login', async (c) => {
    const creds = await getSlackLoginCredentials(workspaceAdminConfig, vault)
    if (!creds) {
      return c.redirect('/setup')
    }

    const state = await crypto.randomHex(16)
    const nonce = await crypto.randomHex(8)

    await oauthStates.deleteExpired()
    await oauthStates.create({
      state,
      botId: `${LOGIN_STATE_PREFIX}${nonce}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: creds.clientId,
      scope: 'openid profile email',
      redirect_uri: `${config.platformBaseUrl}/auth/callback`,
      state,
      nonce,
    })

    return c.redirect(`https://slack.com/openid/connect/authorize?${params.toString()}`)
  })

  app.get('/auth/callback', async (c) => {
    const error = c.req.query('error')
    if (error) {
      return renderErrorPage(c, 'Slack 로그인 오류', error, 400)
    }

    const code = c.req.query('code')
    const state = c.req.query('state')
    if (!code || !state) {
      return renderErrorPage(c, '잘못된 요청', 'code/state가 누락됐어요.', 400)
    }

    await oauthStates.deleteExpired()
    const storedState = await oauthStates.consume(state)
    if (!storedState || !storedState.botId.startsWith(LOGIN_STATE_PREFIX)) {
      return renderErrorPage(c, '잘못된 상태', '로그인 상태가 만료됐거나 유효하지 않아요.', 400)
    }

    const creds = await getSlackLoginCredentials(workspaceAdminConfig, vault)
    if (!creds) {
      return c.redirect('/setup')
    }

    const redirectUri = `${config.platformBaseUrl}/auth/callback`
    const tokenRes = await fetch('https://slack.com/api/openid.connect.token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = (await tokenRes.json()) as SlackTokenResponse

    if (!tokenData.ok || !tokenData.access_token) {
      return renderErrorPage(
        c,
        'Slack 토큰 교환 실패',
        tokenData.error ?? 'unknown_error',
        400,
      )
    }

    const userInfoRes = await fetch(
      'https://slack.com/api/openid.connect.userInfo',
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
    )
    const userInfo = (await userInfoRes.json()) as SlackUserInfoResponse

    if (!userInfo.ok || !userInfo.sub) {
      return renderErrorPage(
        c,
        'Slack 사용자 정보 조회 실패',
        userInfo.error ?? 'unknown_error',
        400,
      )
    }

    const slackTeamId = userInfo['https://slack.com/team_id'] ?? ''
    if (!slackTeamId) {
      return renderErrorPage(c, 'Slack 팀 정보 누락', 'team_id를 확인할 수 없어요.', 400)
    }

    const configs = await listConfiguredSlackLoginConfigs(workspaceAdminConfig)
    const configuredTeamIds = getConfiguredTeamIds(configs)
    if (
      configuredTeamIds.length > 0 &&
      !configuredTeamIds.includes(slackTeamId)
    ) {
      return renderErrorPage(
        c,
        '허용되지 않은 워크스페이스',
        `${slackTeamId} 워크스페이스는 이 플랫폼에 접근할 수 없어요.`,
        403,
      )
    }

    const defaultConfig = configs.find(
      (cfg) => cfg.workspaceId === DEFAULT_WORKSPACE_ADMIN_CONFIG_ID,
    )
    const teamConfig = configs.find((cfg) => cfg.workspaceId === slackTeamId)
    if (!teamConfig && defaultConfig) {
      await workspaceAdminConfig.upsert({
        workspaceId: slackTeamId,
        slackClientId: defaultConfig.slackClientId,
        slackClientSecretEnc: defaultConfig.slackClientSecretEnc,
        dCookieEnc: defaultConfig.dCookieEnc,
        xoxcTokenEnc: defaultConfig.xoxcTokenEnc,
        workspaceDomain: defaultConfig.workspaceDomain,
        updatedByUserId: defaultConfig.updatedByUserId,
      })
    }

    const user: AuthSessionUser = {
      slackUserId: userInfo.sub,
      slackTeamId,
      name: userInfo.name ?? 'Slack User',
      email: userInfo.email ?? null,
      avatarUrl: userInfo.picture ?? null,
    }
    const expiresAt = new Date(
      Date.now() + AUTH_SESSION_MAX_AGE_SECONDS * 1000,
    )
    const sessionCookie = await createSessionCookieValue(vault, user, expiresAt)

    setCookie(c, 'sena_session', sessionCookie, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    })

    return c.redirect('/')
  })

  app.post('/auth/logout', (c) => {
    deleteCookie(c, 'sena_session', { path: '/' })
    return c.redirect('/auth/login')
  })

  return app
}

export function createAuthMiddleware(
  workspaceAdminConfig: WorkspaceAdminConfigRepository,
  vault: Vault,
) {
  const requireAuth = async (c: Context, next: Next) => {
    const configs = await listConfiguredSlackLoginConfigs(workspaceAdminConfig)
    if (configs.length === 0) {
      return unauthenticated(c, '/setup', 'slack_login_not_configured', 503)
    }

    const rawSession = getCookie(c, 'sena_session')
    if (!rawSession) {
      return unauthenticated(c, '/auth/login', 'unauthorized', 401)
    }

    const session = await parseSessionCookieValue(vault, rawSession)
    if (!session) {
      deleteCookie(c, 'sena_session', { path: '/' })
      return unauthenticated(c, '/auth/login', 'unauthorized', 401)
    }

    const configuredTeamIds = getConfiguredTeamIds(configs)
    if (
      configuredTeamIds.length > 0 &&
      !configuredTeamIds.includes(session.user.slackTeamId)
    ) {
      deleteCookie(c, 'sena_session', { path: '/' })
      return unauthenticated(c, '/auth/login', 'workspace_forbidden', 403)
    }

    c.set('user', session.user)
    c.set('session', session)
    await next()
  }

  return { requireAuth }
}

async function getSlackLoginCredentials(
  workspaceAdminConfig: WorkspaceAdminConfigRepository,
  vault: Vault,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const configs = await listConfiguredSlackLoginConfigs(workspaceAdminConfig)
  const preferredConfig =
    configs.find((cfg) => cfg.workspaceId !== DEFAULT_WORKSPACE_ADMIN_CONFIG_ID) ??
    configs[0]

  if (!preferredConfig?.slackClientId || !preferredConfig.slackClientSecretEnc) {
    return null
  }

  return {
    clientId: preferredConfig.slackClientId,
    clientSecret: await vault.decrypt(preferredConfig.slackClientSecretEnc),
  }
}

async function listConfiguredSlackLoginConfigs(
  workspaceAdminConfig: WorkspaceAdminConfigRepository,
) {
  const configs = await workspaceAdminConfig.findAll()
  return configs.filter(
    (config) =>
      typeof config.slackClientId === 'string' &&
      config.slackClientId.trim().length > 0 &&
      typeof config.slackClientSecretEnc === 'string' &&
      config.slackClientSecretEnc.length > 0,
  )
}

function getConfiguredTeamIds(configs: Array<{ workspaceId: string }>): string[] {
  return configs
    .map((config) => config.workspaceId)
    .filter((workspaceId) => workspaceId !== DEFAULT_WORKSPACE_ADMIN_CONFIG_ID)
}

function unauthenticated(
  c: Context,
  redirectPath: string,
  error: string,
  status: ContentfulStatusCode,
): Response | Promise<Response> {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error, redirectTo: redirectPath }, { status })
  }

  return c.redirect(redirectPath)
}

function renderErrorPage(
  c: Context,
  title: string,
  message: string,
  status: ContentfulStatusCode,
): Response {
  return c.html(
    `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Sena Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center px-4">
  <main class="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
    <h1 class="text-xl font-bold text-gray-900 mb-2">${escapeHtml(title)}</h1>
    <p class="text-sm text-gray-600 mb-6">${escapeHtml(message)}</p>
    <a href="/auth/login" class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">다시 로그인</a>
  </main>
</body>
</html>`,
    { status },
  )
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}
