import {
  createHmac,
  randomBytes,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import type { CryptoProvider } from '../../types/crypto.js'

/**
 * CryptoProvider implementation using Node.js crypto module.
 */
export function createNodeCrypto(): CryptoProvider {
  return {
    async randomHex(byteLength: number): Promise<string> {
      return randomBytes(byteLength).toString('hex')
    },

    uuid(): string {
      return uuidv4()
    },

    async hmacSha256(key: string, data: string): Promise<string> {
      return createHmac('sha256', key).update(data).digest('hex')
    },

    async timingSafeEqual(a: string, b: string): Promise<boolean> {
      const bufA = Buffer.from(a, 'utf8')
      const bufB = Buffer.from(b, 'utf8')
      if (bufA.length !== bufB.length) return false
      return nodeTimingSafeEqual(bufA, bufB)
    },
  }
}
