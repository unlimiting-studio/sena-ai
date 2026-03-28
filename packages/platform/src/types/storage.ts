/**
 * FileStorage interface for file uploads.
 * Node.js uses filesystem, CF Workers uses R2.
 */
export interface FileStorage {
  /** Store a file and return its public URL path. */
  put(filename: string, data: ArrayBuffer, contentType: string): Promise<string>
  /** Retrieve a file's data. Returns null if not found. */
  get(filename: string): Promise<ArrayBuffer | null>
}
