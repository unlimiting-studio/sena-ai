import type { Vault } from '../../types/vault.js'

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12

/**
 * AES-256-GCM Vault implementation using Web Crypto API.
 * Compatible with CF Workers runtime.
 */
export async function createCfVault(masterKeyHex: string): Promise<Vault> {
  const rawKey = hexToArrayBuffer(masterKeyHex)
  if (rawKey.byteLength !== 32) {
    throw new Error('VAULT_MASTER_KEY must be 32 bytes (64 hex chars)')
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: ALGORITHM },
    false,
    ['encrypt', 'decrypt'],
  )

  return {
    async encrypt(plaintext: string): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
      const encoded = new TextEncoder().encode(plaintext)

      const ciphertext = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv },
        cryptoKey,
        encoded,
      )

      // Web Crypto appends authTag to ciphertext
      // Format: base64(iv + ciphertext_with_tag) -- matches Node.js layout
      // Node layout: iv(12) + authTag(16) + ciphertext
      // WebCrypto layout: ciphertext + authTag(16)
      // We need to rearrange to match Node.js format
      const ctBytes = new Uint8Array(ciphertext)
      const actualCiphertext = ctBytes.slice(0, ctBytes.length - 16)
      const authTag = ctBytes.slice(ctBytes.length - 16)

      const result = new Uint8Array(
        iv.length + authTag.length + actualCiphertext.length,
      )
      result.set(iv, 0)
      result.set(authTag, iv.length)
      result.set(actualCiphertext, iv.length + authTag.length)

      return uint8ArrayToBase64(result)
    },

    async decrypt(encoded: string): Promise<string> {
      const data = base64ToUint8Array(encoded)
      const iv = data.slice(0, IV_LENGTH)
      const authTag = data.slice(IV_LENGTH, IV_LENGTH + 16)
      const ciphertext = data.slice(IV_LENGTH + 16)

      // Reconstruct WebCrypto format: ciphertext + authTag
      const combined = new Uint8Array(ciphertext.length + authTag.length)
      combined.set(ciphertext, 0)
      combined.set(authTag, ciphertext.length)

      const decrypted = await crypto.subtle.decrypt(
        { name: ALGORITHM, iv },
        cryptoKey,
        combined,
      )

      return new TextDecoder().decode(decrypted)
    },
  }
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes.buffer
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
