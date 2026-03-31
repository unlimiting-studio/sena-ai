import type { Vault } from './vault.js'
import type { RelayHub } from './relay.js'
import type { CryptoProvider } from './crypto.js'
import type {
  BotRepository,
  ConfigTokenRepository,
  OAuthStateRepository,
  WorkspaceAdminConfigRepository,
} from './repository.js'

/**
 * Main Platform interface composing all platform-specific services.
 * Implemented by platform-node and platform-cf.
 */
export interface Platform {
  vault: Vault
  relay: RelayHub
  crypto: CryptoProvider
  bots: BotRepository
  configTokens: ConfigTokenRepository
  oauthStates: OAuthStateRepository
  workspaceAdminConfig: WorkspaceAdminConfigRepository
}

/**
 * Application configuration shared across runtimes.
 */
export interface AppConfig {
  platformBaseUrl: string
  workspaceId: string
}
