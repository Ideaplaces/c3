import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const DEFAULT_RETURN_PATH = '/sessions'

const DATA_DIR = join(homedir(), '.ccc', 'data')
const FILE = join(DATA_DIR, 'return-to.json')

/** Validate and sanitize a returnTo path. Rejects absolute and protocol-relative URLs. */
export function sanitizeReturnTo(returnTo: string | null | undefined): string {
  if (!returnTo || typeof returnTo !== 'string' || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return DEFAULT_RETURN_PATH
  }
  return returnTo
}

function read(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function write(data: Record<string, string>) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(data))
}

export function setReturnTo(email: string, path: string) {
  const data = read()
  data[email] = sanitizeReturnTo(path)
  write(data)
}

/** Read and delete the stored returnTo for this email (consume-once). */
export function popReturnTo(email: string): string {
  const data = read()
  const path = data[email] || DEFAULT_RETURN_PATH
  delete data[email]
  write(data)
  return path
}
