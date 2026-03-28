import type { Vault } from './vault.js'
import type { RelayHub } from './relay.js'
import type { CryptoProvider } from './crypto.js'
import type { FileStorage } from './storage.js'
import type {
  BotRepository,
  ConfigTokenRepository,
  OAuthStateRepository,
} from './repository.js'

/**
 * Main Platform interface composing all platform-specific services.
 * Implemented by platform-node and platform-cf.
 */
export interface Platform {
  vault: Vault
  relay: RelayHub
  crypto: CryptoProvider
  storage: FileStorage
  bots: BotRepository
  configTokens: ConfigTokenRepository
  oauthStates: OAuthStateRepository
}

/**
 * Application configuration shared across runtimes.
 */
export interface AppConfig {
  platformBaseUrl: string
  workspaceId: string
  /** Optional bootstrap script content (Node.js reads from fs, CF can inline). */
  bootstrapScript?: string
}
