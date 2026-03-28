import type { Vault } from '../../types/vault.js'
import type { RelayHub } from '../../types/relay.js'
import type { CryptoProvider } from '../../types/crypto.js'
import type { FileStorage } from '../../types/storage.js'
import { createNodeVault } from './vault.js'
import { createNodeCrypto } from './crypto.js'
import { createNodeRelay } from './relay.js'
import { createNodeStorage } from './storage.js'

export interface NodeRuntimeConfig {
  vaultMasterKey: string
  uploadsDir: string
}

export interface NodeRuntime {
  vault: Vault
  relay: RelayHub
  crypto: CryptoProvider
  storage: FileStorage
}

/**
 * Create runtime services for Node.js (vault, relay, crypto, storage).
 * Does NOT include DB repositories -- those are created separately via the DB subpath.
 */
export function createNodeRuntime(config: NodeRuntimeConfig): NodeRuntime {
  const vault = createNodeVault(config.vaultMasterKey)
  const crypto = createNodeCrypto()
  const relay = createNodeRelay()
  const storage = createNodeStorage(config.uploadsDir)

  return { vault, relay, crypto, storage }
}
