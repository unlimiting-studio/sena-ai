import type { CryptoProvider } from '../../types/crypto.js'

/**
 * CryptoProvider implementation using Web Crypto API.
 * Compatible with CF Workers runtime.
 */
export function createCfCrypto(): CryptoProvider {
  return {
    async randomHex(byteLength: number): Promise<string> {
      const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    },

    uuid(): string {
      return crypto.randomUUID()
    },

    async hmacSha256(key: string, data: string): Promise<string> {
      const encoder = new TextEncoder()
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )

      const signature = await crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        encoder.encode(data),
      )

      return Array.from(new Uint8Array(signature))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    },

    async timingSafeEqual(a: string, b: string): Promise<boolean> {
      const encoder = new TextEncoder()
      const bufA = encoder.encode(a)
      const bufB = encoder.encode(b)

      if (bufA.length !== bufB.length) return false

      // Import both as HMAC keys and compare by signing
      // This provides constant-time comparison without node:crypto
      const key = crypto.getRandomValues(new Uint8Array(32))
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )

      const [sigA, sigB] = await Promise.all([
        crypto.subtle.sign('HMAC', cryptoKey, bufA),
        crypto.subtle.sign('HMAC', cryptoKey, bufB),
      ])

      const arrA = new Uint8Array(sigA)
      const arrB = new Uint8Array(sigB)

      let result = 0
      for (let i = 0; i < arrA.length; i++) {
        result |= arrA[i] ^ arrB[i]
      }
      return result === 0
    },
  }
}
