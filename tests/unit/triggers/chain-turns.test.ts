import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { lastChainTurn, recordChainTurn } from '@/lib/triggers/chain-turns'

describe('the chain turn store', () => {
  const before = process.env.C3_STATE_DIR
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'c3-turns-'))
    process.env.C3_STATE_DIR = dir
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (before === undefined) delete process.env.C3_STATE_DIR
    else process.env.C3_STATE_DIR = before
  })

  it('round-trips a turn and keeps the other triggers\' turns when one is written', () => {
    recordChainTurn('help', new Date('2026-10-24T09:20:00Z'))
    recordChainTurn('judge', new Date('2026-10-24T09:38:00Z'))
    recordChainTurn('help', new Date('2026-10-25T09:21:00Z'))
    expect(lastChainTurn('help')?.toISOString()).toBe('2026-10-25T09:21:00.000Z')
    expect(lastChainTurn('judge')?.toISOString()).toBe('2026-10-24T09:38:00.000Z')
    expect(JSON.parse(readFileSync(join(dir, 'chain-turns.json'), 'utf-8'))).toEqual({
      help: '2026-10-25T09:21:00.000Z',
      judge: '2026-10-24T09:38:00.000Z',
    })
  })

  it('reads a missing or corrupt file as no turn, so the fallback runs', () => {
    expect(lastChainTurn('help')).toBeNull()
    writeFileSync(join(dir, 'chain-turns.json'), '{not json')
    expect(lastChainTurn('help')).toBeNull()
    writeFileSync(join(dir, 'chain-turns.json'), 'null')
    expect(lastChainTurn('help')).toBeNull()
  })
})
