import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import type { WorkspaceAdminConfigRepository } from '../types/repository.js'
import type { Vault } from '../types/vault.js'
import { parseSessionCookieValue } from '../auth/session.js'

const DEFAULT_WORKSPACE_ADMIN_CONFIG_ID = 'default'

export function createSetupPage(
  workspaceAdminConfig: WorkspaceAdminConfigRepository,
  vault: Vault,
) {
  const app = new Hono()

  app.get('/setup', async (c) => {
    const access = await getSetupAccess(
      workspaceAdminConfig,
      vault,
      getCookie(c, 'sena_session') ?? null,
    )
    if (!access.allowed) {
      return c.redirect('/auth/login')
    }

    const origin = new URL(c.req.url).origin
    const redirectUrl = `${origin}/auth/callback`
    const currentClientId = access.currentConfig?.slackClientId ?? ''

    return c.html(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>초기 설정 - Sena Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
  <main class="w-full max-w-lg px-4">
    <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
      <div class="text-center mb-6">
        <h1 class="text-2xl font-bold text-gray-900">Sena Platform 초기 설정</h1>
        <p class="text-gray-500 text-sm mt-2">플랫폼 접근을 Slack 로그인으로 보호하려면 로그인 앱 정보를 먼저 넣어야 해요.</p>
      </div>

      <div class="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 class="text-sm font-semibold text-blue-800 mb-2">Slack 로그인 앱 준비</h3>
        <ol class="text-sm text-blue-700 space-y-1 list-decimal list-inside">
          <li><a href="https://api.slack.com/apps" target="_blank" rel="noopener" class="underline">api.slack.com/apps</a>에서 로그인용 Slack 앱을 만드세요.</li>
          <li>OAuth &amp; Permissions → Redirect URL에 아래 값을 추가하세요.<br>
            <code class="bg-blue-100 px-1 py-0.5 rounded text-xs">${redirectUrl}</code>
          </li>
          <li>OpenID Connect scopes로 <code class="bg-blue-100 px-1 py-0.5 rounded text-xs">openid, profile, email</code> 을 추가하세요.</li>
          <li>Basic Information에서 Client ID / Client Secret을 복사하세요.</li>
        </ol>
      </div>

      <form id="setup-form" class="space-y-5">
        <div>
          <label for="slack-client-id" class="block text-sm font-medium text-gray-700 mb-1">Slack Login App Client ID <span class="text-red-500">*</span></label>
          <input type="text" id="slack-client-id" name="slackClientId" required
                 placeholder="1234567890.1234567890"
                 value="${escapeHtml(currentClientId)}"
                 class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
        </div>

        <div>
          <label for="slack-client-secret" class="block text-sm font-medium text-gray-700 mb-1">Slack Login App Client Secret <span class="text-red-500">*</span></label>
          <input type="password" id="slack-client-secret" name="slackClientSecret" required
                 placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                 class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none">
        </div>

        <div id="setup-msg" class="hidden p-3 rounded-lg text-sm"></div>

        <button type="submit" id="setup-btn"
                class="w-full py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          저장하고 Slack 로그인 연결하기
        </button>
      </form>
    </div>
  </main>

  <script>
    document.getElementById('setup-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const button = document.getElementById('setup-btn');
      const message = document.getElementById('setup-msg');
      button.disabled = true;
      button.textContent = '저장 중...';
      message.classList.add('hidden');

      try {
        const payload = {
          slackClientId: document.getElementById('slack-client-id').value.trim(),
          slackClientSecret: document.getElementById('slack-client-secret').value.trim(),
        };

        if (!payload.slackClientId || !payload.slackClientSecret) {
          throw new Error('Client ID와 Client Secret을 모두 입력해주세요.');
        }

        const response = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || '설정 저장에 실패했습니다.');
        }

        window.location.href = data.redirectTo || '/auth/login';
      } catch (error) {
        message.className = 'p-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700';
        message.textContent = error.message;
        message.classList.remove('hidden');
        button.disabled = false;
        button.textContent = '저장하고 Slack 로그인 연결하기';
      }
    });
  </script>
</body>
</html>`)
  })

  app.post('/api/setup', async (c) => {
    const access = await getSetupAccess(
      workspaceAdminConfig,
      vault,
      getCookie(c, 'sena_session') ?? null,
    )
    if (!access.allowed) {
      return c.json(
        { error: '이미 설정된 워크스페이스라 Slack 로그인 후에만 수정할 수 있어요.' },
        401,
      )
    }

    const body = await c.req.json<{
      slackClientId?: string
      slackClientSecret?: string
    }>()

    const slackClientId = (body.slackClientId ?? '').trim()
    const slackClientSecret = (body.slackClientSecret ?? '').trim()
    if (!slackClientId || !slackClientSecret) {
      return c.json(
        { error: 'slackClientId와 slackClientSecret은 필수예요.' },
        400,
      )
    }

    const targetWorkspaceId =
      access.session?.user.slackTeamId ?? DEFAULT_WORKSPACE_ADMIN_CONFIG_ID
    const existing =
      (await workspaceAdminConfig.findByWorkspaceId(targetWorkspaceId)) ??
      (targetWorkspaceId !== DEFAULT_WORKSPACE_ADMIN_CONFIG_ID
        ? await workspaceAdminConfig.findByWorkspaceId(
            DEFAULT_WORKSPACE_ADMIN_CONFIG_ID,
          )
        : null)

    await workspaceAdminConfig.upsert({
      workspaceId: targetWorkspaceId,
      slackClientId,
      slackClientSecretEnc: await vault.encrypt(slackClientSecret),
      dCookieEnc: existing?.dCookieEnc ?? null,
      xoxcTokenEnc: existing?.xoxcTokenEnc ?? null,
      workspaceDomain: existing?.workspaceDomain ?? null,
      updatedByUserId: access.session?.user.slackUserId ?? existing?.updatedByUserId ?? null,
    })

    return c.json({
      ok: true,
      redirectTo: access.session ? '/' : '/auth/login',
    })
  })

  return app
}

async function getSetupAccess(
  workspaceAdminConfig: WorkspaceAdminConfigRepository,
  vault: Vault,
  rawSession: string | null,
) {
  const configuredConfigs = await listConfiguredSlackLoginConfigs(
    workspaceAdminConfig,
  )
  const configuredTeamIds = configuredConfigs
    .map((config) => config.workspaceId)
    .filter((workspaceId) => workspaceId !== DEFAULT_WORKSPACE_ADMIN_CONFIG_ID)

  if (configuredConfigs.length === 0) {
    return {
      allowed: true,
      session: null,
      currentConfig: null,
    }
  }

  const session = rawSession
    ? await parseSessionCookieValue(vault, rawSession)
    : null

  if (!session) {
    return {
      allowed: false,
      session: null,
      currentConfig: null,
    }
  }

  if (
    configuredTeamIds.length > 0 &&
    !configuredTeamIds.includes(session.user.slackTeamId)
  ) {
    return {
      allowed: false,
      session,
      currentConfig: null,
    }
  }

  const currentConfig =
    configuredConfigs.find(
      (config) => config.workspaceId === session.user.slackTeamId,
    ) ?? configuredConfigs[0]

  return {
    allowed: true,
    session,
    currentConfig,
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
