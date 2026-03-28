import type { FileStorage } from '../../types/storage.js'

/**
 * R2-based FileStorage implementation for CF Workers.
 */
export function createCfStorage(bucket: R2Bucket): FileStorage {
  return {
    async put(
      filename: string,
      data: ArrayBuffer,
      contentType: string,
    ): Promise<string> {
      await bucket.put(`uploads/${filename}`, data, {
        httpMetadata: { contentType },
      })
      return `/uploads/${filename}`
    },

    async get(filename: string): Promise<ArrayBuffer | null> {
      const obj = await bucket.get(`uploads/${filename}`)
      if (!obj) return null
      return obj.arrayBuffer()
    },
  }
}
