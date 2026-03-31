import type { Vault } from '../types/vault.js'

export interface AuthSessionUser {
  slackUserId: string
  slackTeamId: string
  name: string
  email: string | null
  avatarUrl: string | null
}

export interface AuthSession {
  user: AuthSessionUser
  expiresAt: string
}

export const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export async function createSessionCookieValue(
  vault: Vault,
  user: AuthSessionUser,
  expiresAt: Date,
): Promise<string> {
  const encrypted = await vault.encrypt(
    JSON.stringify({
      user,
      expiresAt: expiresAt.toISOString(),
    } satisfies AuthSession),
  )

  return toBase64Url(encrypted)
}

export async function parseSessionCookieValue(
  vault: Vault,
  rawCookieValue: string,
): Promise<AuthSession | null> {
  try {
    const decrypted = await vault.decrypt(fromBase64Url(rawCookieValue))
    const parsed: unknown = JSON.parse(decrypted)

    if (!isAuthSession(parsed)) {
      return null
    }

    const expiresAt = new Date(parsed.expiresAt)
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
      return null
    }

    return {
      user: parsed.user,
      expiresAt: expiresAt.toISOString(),
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAuthSessionUser(value: unknown): value is AuthSessionUser {
  if (!isRecord(value)) return false

  return (
    typeof value.slackUserId === 'string' &&
    typeof value.slackTeamId === 'string' &&
    typeof value.name === 'string' &&
    (value.email === null || typeof value.email === 'string') &&
    (value.avatarUrl === null || typeof value.avatarUrl === 'string')
  )
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value)) return false

  return typeof value.expiresAt === 'string' && isAuthSessionUser(value.user)
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

function fromBase64Url(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const paddingLength = (4 - (base64.length % 4 || 4)) % 4
  return base64 + '='.repeat(paddingLength)
}
