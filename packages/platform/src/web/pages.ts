import { Hono } from 'hono'
import type { BotRepository } from '../types/repository.js'

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Sena Platform</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-white border-b border-gray-200">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="text-xl font-bold text-gray-900">Sena Platform</a>
      <span class="text-sm text-gray-500">Slack Bot Provisioning</span>
    </div>
  </nav>
  <main class="max-w-5xl mx-auto px-4 py-8">
    ${body}
  </main>
</body>
</html>`
}

export function createPages(botRepo: BotRepository, platformBaseUrl: string) {
  const app = new Hono()

  // GET / - Landing/dashboard
  app.get('/', async (c) => {
    const allBots = await botRepo.findAllSummary()

    const botRows = allBots
      .map(
        (bot) => `
      <tr class="border-b border-gray-100 hover:bg-gray-50">
        <td class="py-3 px-4">
          <div class="flex items-center gap-3">
            ${
              bot.profileImageUrl
                ? `<img src="${bot.profileImageUrl}" alt="${bot.name}" class="w-8 h-8 rounded-full object-cover">`
                : `<div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-semibold text-sm">${bot.name.charAt(0).toUpperCase()}</div>`
            }
            <span class="font-medium text-gray-900">${bot.name}</span>
          </div>
        </td>
        <td class="py-3 px-4">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            bot.status === 'active'
              ? 'bg-green-100 text-green-800'
              : bot.status === 'pending'
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-gray-100 text-gray-800'
          }">
            ${bot.status}
          </span>
        </td>
        <td class="py-3 px-4 text-sm text-gray-500">${bot.slackAppId || '-'}</td>
        <td class="py-3 px-4 text-sm text-gray-500">${bot.createdAt ? new Date(bot.createdAt).toLocaleDateString('ko-KR') : '-'}</td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-3">
            ${
              bot.status === 'pending'
                ? `<a href="/bots/${bot.id}/setup" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium">설정 계속하기</a>`
                : bot.status === 'active'
                  ? `<a href="/bots/${bot.id}/complete" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium">스크립트 보기</a>`
                  : ''
            }
            ${
              bot.slackAppId
                ? `<a href="https://api.slack.com/apps/${bot.slackAppId}" target="_blank" rel="noopener" class="text-gray-400 hover:text-gray-600 text-sm" title="Slack 앱 설정">&#x2699;&#xFE0F;</a>`
                : ''
            }
          </div>
        </td>
      </tr>`,
      )
      .join('')

    const html = layout(
      '대시보드',
      `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Slack Bots</h1>
          <p class="text-gray-500 mt-1">등록된 봇을 관리하고 새 봇을 추가하세요.</p>
        </div>
        <a href="/bots/new"
           class="inline-flex items-center px-4 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
          + 슬랙 봇 추가하기
        </a>
      </div>

      ${
        allBots.length > 0
          ? `
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table class="w-full">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-200">
                <th class="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">이름</th>
                <th class="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">상태</th>
                <th class="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">App ID</th>
                <th class="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">생성일</th>
                <th class="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">액션</th>
              </tr>
            </thead>
            <tbody>
              ${botRows}
            </tbody>
          </table>
        </div>`
          : `
        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <div class="text-gray-400 text-5xl mb-4">&#x1f916;</div>
          <h3 class="text-lg font-semibold text-gray-700 mb-2">아직 봇이 없어요</h3>
          <p class="text-gray-500 mb-6">"슬랙 봇 추가하기" 버튼을 눌러 첫 번째 봇을 만들어 보세요.</p>
          <a href="/bots/new"
             class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors">
            + 슬랙 봇 추가하기
          </a>
        </div>`
      }
    `,
    )

    return c.html(html)
  })

  // GET /bots/new - Bot creation form
  app.get('/bots/new', (c) => {
    const html = layout(
      '새 봇 만들기',
      `
      <div class="max-w-lg mx-auto">
        <div class="mb-6">
          <a href="/" class="text-sm text-gray-500 hover:text-gray-700">&larr; 대시보드로 돌아가기</a>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h1 class="text-xl font-bold text-gray-900 mb-1">새 슬랙 봇 만들기</h1>
          <p class="text-gray-500 text-sm mb-6">봇의 이름을 설정하세요.</p>

          <form id="create-bot-form" class="space-y-5">
            <div>
              <label for="name" class="block text-sm font-medium text-gray-700 mb-1">표시 이름 <span class="text-red-500">*</span></label>
              <input type="text" id="name" name="name" required
                     placeholder="예: 릴리"
                     class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors">
              <p class="mt-1 text-xs text-gray-400">Slack에서 보이는 봇 이름이에요. 한글도 사용할 수 있어요.</p>
            </div>

            <div>
              <label for="botUsername" class="block text-sm font-medium text-gray-700 mb-1">유저네임 <span class="text-red-500">*</span></label>
              <input type="text" id="botUsername" name="botUsername" required
                     pattern="[a-z0-9][a-z0-9-]*"
                     placeholder="예: lily-bot"
                     class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors">
              <p class="mt-1 text-xs text-gray-400">영문 소문자, 숫자, 하이픈만 가능. Slack 내부에서 사용되는 @username이에요.</p>
            </div>

            <div>
              <label for="profileImage" class="block text-sm font-medium text-gray-700 mb-1">프로필 이미지 (선택)</label>
              <input type="file" id="profileImage" accept="image/png,image/jpeg,image/gif"
                     class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-colors text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100">
              <p class="mt-1 text-xs text-gray-400">512x512px 권장. PNG, JPEG, GIF 지원.</p>
            </div>

            <div id="error-msg" class="hidden p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"></div>

            <button type="submit" id="submit-btn"
                    class="w-full py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              만들기
            </button>
          </form>
        </div>
      </div>

      <script>
        document.getElementById('create-bot-form').addEventListener('submit', async function(e) {
          e.preventDefault();
          const btn = document.getElementById('submit-btn');
          const errDiv = document.getElementById('error-msg');
          btn.disabled = true;
          btn.textContent = '생성 중...';
          errDiv.classList.add('hidden');

          try {
            const name = document.getElementById('name').value.trim();
            if (!name) throw new Error('봇 이름을 입력해주세요.');
            const botUsername = document.getElementById('botUsername').value.trim();
            if (!botUsername) throw new Error('봇 유저네임을 입력해주세요.');

            let profileImage = null;
            const fileInput = document.getElementById('profileImage');
            if (fileInput.files && fileInput.files.length > 0) {
              profileImage = await new Promise(function(resolve, reject) {
                const reader = new FileReader();
                reader.onload = function() { resolve(reader.result); };
                reader.onerror = function() { reject(new Error('이미지 읽기에 실패했습니다.')); };
                reader.readAsDataURL(fileInput.files[0]);
              });
            }

            const res = await fetch('/api/bots', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, botUsername, profileImage }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '봇 생성에 실패했습니다.');

            window.location.href = '/bots/' + data.botId + '/setup';
          } catch (err) {
            errDiv.textContent = err.message;
            errDiv.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = '만들기';
          }
        });
      </script>
    `,
    )

    return c.html(html)
  })

  // GET /bots/:botId/setup - Setup progress page
  app.get('/bots/:botId/setup', async (c) => {
    const botId = c.req.param('botId')
    const bot = await botRepo.findById(botId)

    if (!bot) {
      return c.html(
        layout('오류', '<p class="text-red-600">봇을 찾을 수 없습니다.</p>'),
        404,
      )
    }

    const hasSlackApp = !!bot.slackAppId
    const hasOAuth = bot.status === 'active'

    const html = layout(
      `${bot.name} 설정`,
      `
      <div class="max-w-lg mx-auto">
        <div class="mb-6">
          <a href="/" class="text-sm text-gray-500 hover:text-gray-700">&larr; 대시보드로 돌아가기</a>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h1 class="text-xl font-bold text-gray-900 mb-1">${bot.name} 설정</h1>
          <p class="text-gray-500 text-sm mb-6">아래 단계를 순서대로 진행하세요.</p>

          <div class="space-y-4">
            <!-- Step 1: Bot created -->
            <div class="flex items-start gap-3">
              <div class="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">&#x2713;</div>
              <div>
                <p class="font-medium text-gray-900">봇 생성 완료</p>
                <p class="text-sm text-gray-500">이름: ${bot.name}</p>
              </div>
            </div>

            <!-- Step 2: Slack app provisioned -->
            <div class="flex items-start gap-3">
              ${
                hasSlackApp
                  ? `<div class="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">&#x2713;</div>
                     <div>
                       <p class="font-medium text-gray-900">Slack 앱 생성 완료</p>
                       <p class="text-sm text-gray-500">App ID: <a href="https://api.slack.com/apps/${bot.slackAppId}" target="_blank" rel="noopener" class="text-indigo-600 hover:text-indigo-800">${bot.slackAppId} &#x2197;</a></p>
                       <p class="text-xs text-gray-400 mt-1">프로필 아이콘은 <a href="https://api.slack.com/apps/${bot.slackAppId}/general" target="_blank" rel="noopener" class="text-indigo-500 hover:text-indigo-700 underline">Slack 앱 설정</a>에서 직접 변경하세요.</p>
                     </div>`
                  : `<div class="w-6 h-6 rounded-full bg-yellow-400 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">2</div>
                     <div>
                       <p class="font-medium text-gray-900">Slack 앱 생성 중...</p>
                       <p class="text-sm text-gray-500">잠시만 기다려주세요.</p>
                     </div>`
              }
            </div>

            <!-- Step 3: OAuth -->
            <div class="flex items-start gap-3">
              ${
                hasOAuth
                  ? `<div class="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">&#x2713;</div>
                     <div>
                       <p class="font-medium text-gray-900">OAuth 승인 완료</p>
                       <p class="text-sm text-gray-500">워크스페이스에 설치되었습니다.</p>
                     </div>`
                  : hasSlackApp
                    ? `<div class="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">3</div>
                       <div>
                         <p class="font-medium text-gray-900">Slack 워크스페이스에 앱 설치</p>
                         <p class="text-sm text-gray-500 mb-3">아래 버튼을 클릭하여 앱을 설치하세요.</p>
                         <a href="/oauth/start/${bot.id}"
                            class="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
                           Slack에 설치하기
                         </a>
                       </div>`
                    : `<div class="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">3</div>
                       <div>
                         <p class="font-medium text-gray-400">Slack 워크스페이스에 앱 설치</p>
                         <p class="text-sm text-gray-400">이전 단계를 먼저 완료하세요.</p>
                       </div>`
              }
            </div>

            <!-- Step 4: Complete -->
            <div class="flex items-start gap-3">
              ${
                hasOAuth
                  ? `<div class="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">&#x2713;</div>
                     <div>
                       <p class="font-medium text-gray-900">설정 완료!</p>
                       <a href="/bots/${bot.id}/complete" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium">부트스트랩 스크립트 보기 &rarr;</a>
                     </div>`
                  : `<div class="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">4</div>
                     <div>
                       <p class="font-medium text-gray-400">부트스트랩 스크립트</p>
                       <p class="text-sm text-gray-400">모든 설정이 완료되면 스크립트를 받을 수 있습니다.</p>
                     </div>`
              }
            </div>
          </div>
        </div>

        ${
          !hasSlackApp
            ? `<script>
                let pollCount = 0;
                let retried = false;
                (async function poll() {
                  try {
                    pollCount++;
                    const res = await fetch('/api/bots/${bot.id}');
                    const data = await res.json();
                    if (data.bot && data.bot.slackAppId) {
                      window.location.reload();
                    } else {
                      // After 10s of polling with no result, retry provisioning once
                      if (pollCount >= 5 && !retried) {
                        retried = true;
                        await fetch('/api/bots/${bot.id}/provision', { method: 'POST' });
                      }
                      setTimeout(poll, 2000);
                    }
                  } catch { setTimeout(poll, 3000); }
                })();
              </script>`
            : ''
        }
      </div>
    `,
    )

    return c.html(html)
  })

  // GET /bots/:botId/complete - Bootstrap script page
  app.get('/bots/:botId/complete', async (c) => {
    const botId = c.req.param('botId')
    const bot = await botRepo.findById(botId)

    if (!bot) {
      return c.html(
        layout('오류', '<p class="text-red-600">봇을 찾을 수 없습니다.</p>'),
        404,
      )
    }

    const bootstrapScript = `curl -fsSL ${platformBaseUrl}/install.sh | sh -s -- \\
  --name "${bot.name}" \\
  --bot-username "${bot.botUsername}" \\
  --connect-key "${bot.connectKey}" \\
  --platform-url "${platformBaseUrl}"`

    const html = layout(
      `${bot.name} - 설정 완료`,
      `
      <div class="max-w-2xl mx-auto">
        <div class="mb-6">
          <a href="/" class="text-sm text-gray-500 hover:text-gray-700">&larr; 대시보드로 돌아가기</a>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div class="text-center mb-6">
            <div class="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-3">
              <span class="text-green-600 text-xl">&#x2713;</span>
            </div>
            <h1 class="text-xl font-bold text-gray-900">${bot.name} 설정 완료!</h1>
            <p class="text-gray-500 text-sm mt-1">아래 스크립트를 복사하여 로컬 터미널에서 실행하세요.</p>
          </div>

          <div class="relative">
            <div class="bg-gray-900 rounded-lg p-4 pr-12 overflow-x-auto">
              <pre class="text-green-400 text-sm font-mono whitespace-pre" id="script-content">${bootstrapScript}</pre>
            </div>
            <button onclick="copyScript()" id="copy-btn"
                    class="absolute top-3 right-3 px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded transition-colors"
                    title="복사">
              복사
            </button>
          </div>

          <div class="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 class="text-sm font-semibold text-blue-800 mb-2">참고 사항</h3>
            <ul class="text-sm text-blue-700 space-y-1">
              <li>- Node.js 18+ 및 pnpm이 설치되어 있어야 합니다.</li>
              <li>- 스크립트 실행 후 <code class="bg-blue-100 px-1 py-0.5 rounded">pnpm start</code>로 봇을 시작하세요.</li>
              <li>- connect_key는 외부에 노출하지 마세요.</li>
            </ul>
          </div>

          <div class="mt-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <h3 class="text-sm font-semibold text-gray-700 mb-2">봇 정보</h3>
            <dl class="grid grid-cols-2 gap-2 text-sm">
              <dt class="text-gray-500">이름</dt>
              <dd class="text-gray-900 font-medium">${bot.name}</dd>
              <dt class="text-gray-500">상태</dt>
              <dd><span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${bot.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">${bot.status}</span></dd>
              <dt class="text-gray-500">Slack App ID</dt>
              <dd class="text-gray-900 font-mono text-xs">${bot.slackAppId ? `<a href="https://api.slack.com/apps/${bot.slackAppId}" target="_blank" rel="noopener" class="text-indigo-600 hover:text-indigo-800">${bot.slackAppId} &#x2197;</a>` : '-'}</dd>
              <dt class="text-gray-500">Connect Key</dt>
              <dd class="text-gray-900 font-mono text-xs">${bot.connectKey}</dd>
            </dl>
          </div>
        </div>
      </div>

      <script>
        function copyScript() {
          const text = document.getElementById('script-content').textContent;
          navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('copy-btn');
            btn.textContent = '복사됨!';
            setTimeout(() => { btn.textContent = '복사'; }, 2000);
          });
        }
      </script>
    `,
    )

    return c.html(html)
  })

  return app
}
