import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'
import type { Vault } from '../../types/vault.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

/**
 * AES-256-GCM Vault implementation using Node.js crypto.
 * Returns Promises to match the Vault interface (Web Crypto compatibility).
 */
export function createNodeVault(masterKeyHex: string): Vault {
  const masterKey = Buffer.from(masterKeyHex, 'hex')
  if (masterKey.length !== 32) {
    throw new Error('VAULT_MASTER_KEY must be 32 bytes (64 hex chars)')
  }

  return {
    async encrypt(plaintext: string): Promise<string> {
      const iv = randomBytes(IV_LENGTH)
      const cipher = createCipheriv(ALGORITHM, masterKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      })
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ])
      const authTag = cipher.getAuthTag()
      // Format: base64(iv + authTag + ciphertext)
      return Buffer.concat([iv, authTag, encrypted]).toString('base64')
    },

    async decrypt(encoded: string): Promise<string> {
      const data = Buffer.from(encoded, 'base64')
      const iv = data.subarray(0, IV_LENGTH)
      const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
      const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

      const decipher = createDecipheriv(ALGORITHM, masterKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
      })
      decipher.setAuthTag(authTag)
      return decipher.update(ciphertext) + decipher.final('utf8')
    },
  }
}
