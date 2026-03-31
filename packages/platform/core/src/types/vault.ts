/**
 * Vault interface for encrypting/decrypting secrets.
 * All methods return Promises to support Web Crypto (async) implementations.
 */
export interface Vault {
  encrypt(plaintext: string): Promise<string>
  decrypt(encoded: string): Promise<string>
}
