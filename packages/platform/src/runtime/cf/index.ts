import type { Vault } from '../../types/vault.js'
import type { RelayHub } from '../../types/relay.js'
import type { CryptoProvider } from '../../types/crypto.js'
import type { FileStorage } from '../../types/storage.js'
import { createCfVault } from './vault.js'
import { createCfCrypto } from './crypto.js'
import { createCfRelay } from './relay.js'
import { createCfStorage } from './storage.js'

export interface CfEnv {
  RELAY_DO: DurableObjectNamespace
  UPLOADS: R2Bucket
  VAULT_MASTER_KEY: string
  PLATFORM_BASE_URL: string
  SLACK_WORKSPACE_ID: string
}

export interface CfRuntime {
  vault: Vault
  relay: RelayHub
  crypto: CryptoProvider
  storage: FileStorage
}

/**
 * Create runtime services for Cloudflare Workers (vault, relay, crypto, storage).
 * Does NOT include DB repositories -- those are created separately via the DB subpath.
 */
export async function createCfRuntime(env: CfEnv): Promise<CfRuntime> {
  const vault = await createCfVault(env.VAULT_MASTER_KEY)
  const crypto = createCfCrypto()
  const relay = createCfRelay(env.RELAY_DO)
  const storage = createCfStorage(env.UPLOADS)

  return { vault, relay, crypto, storage }
}
