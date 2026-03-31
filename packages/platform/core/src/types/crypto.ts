/**
 * CryptoProvider interface: platform-agnostic crypto operations.
 * Node.js uses node:crypto, CF Workers uses Web Crypto API.
 */
export interface CryptoProvider {
  /** Generate a random hex string of the given byte length. */
  randomHex(byteLength: number): Promise<string>
  /** Generate a UUID v4. */
  uuid(): string
  /** Compute HMAC-SHA256 and return hex digest. */
  hmacSha256(key: string, data: string): Promise<string>
  /** Constant-time string comparison. */
  timingSafeEqual(a: string, b: string): Promise<boolean>
}
