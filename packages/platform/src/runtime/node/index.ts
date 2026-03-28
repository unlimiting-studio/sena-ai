import type { Vault } from '../../types/vault.js'
import type { RelayHub } from '../../types/relay.js'
import type { CryptoProvider } from '../../types/crypto.js'
import { createNodeVault } from './vault.js'
import { createNodeCrypto } from './crypto.js'
import { createNodeRelay } from './relay.js'

export interface NodeRuntimeConfig {
  vaultMasterKey: string
}

export interface NodeRuntime {
  vault: Vault
  relay: RelayHub
  crypto: CryptoProvider
}

/**
 * Create runtime services for Node.js (vault, relay, crypto).
 * Does NOT include DB repositories -- those are created separately via the DB subpath.
 */
export function createNodeRuntime(config: NodeRuntimeConfig): NodeRuntime {
  const vault = createNodeVault(config.vaultMasterKey)
  const crypto = createNodeCrypto()
  const relay = createNodeRelay()

  return { vault, relay, crypto }
}
