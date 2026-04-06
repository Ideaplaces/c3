import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DATA_DIR = join(homedir(), '.ccc', 'data')
const FILE = join(DATA_DIR, 'return-to.json')

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
  data[email] = path
  write(data)
}

export function getReturnTo(email: string): string {
  const data = read()
  const path = data[email] || '/sessions'
  delete data[email]
  write(data)
  return path
}
