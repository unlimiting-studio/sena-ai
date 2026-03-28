import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileStorage } from '../../types/storage.js'

/**
 * Filesystem-based FileStorage implementation for Node.js.
 */
export function createNodeStorage(uploadsDir: string): FileStorage {
  return {
    async put(
      filename: string,
      data: ArrayBuffer,
      _contentType: string,
    ): Promise<string> {
      await mkdir(uploadsDir, { recursive: true })
      const filePath = join(uploadsDir, filename)
      await writeFile(filePath, Buffer.from(data))
      return `/uploads/${filename}`
    },

    async get(filename: string): Promise<ArrayBuffer | null> {
      try {
        const filePath = join(uploadsDir, filename)
        const buffer = await readFile(filePath)
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        )
      } catch {
        return null
      }
    },
  }
}
