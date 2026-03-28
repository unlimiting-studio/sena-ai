import type { Vault } from '../../types/vault.js'
import type { RelayHub } from '../../types/relay.js'
import type { CryptoProvider } from '../../types/crypto.js'
import { createCfVault } from './vault.js'
import { createCfCrypto } from './crypto.js'
import { createCfRelay } from './relay.js'

export interface CfEnv {
  RELAY_DO: DurableObjectNamespace
  VAULT_MASTER_KEY: string
  PLATFORM_BASE_URL: string
  SLACK_WORKSPACE_ID: string
}

export interface CfRuntime {
  vault: Vault
  relay: RelayHub
  crypto: CryptoProvider
}

/**
 * Create runtime services for Cloudflare Workers (vault, relay, crypto).
 * Does NOT include DB repositories -- those are created separately via the DB subpath.
 */
export async function createCfRuntime(env: CfEnv): Promise<CfRuntime> {
  const vault = await createCfVault(env.VAULT_MASTER_KEY)
  const crypto = createCfCrypto()
  const relay = createCfRelay(env.RELAY_DO)

  return { vault, relay, crypto }
}
