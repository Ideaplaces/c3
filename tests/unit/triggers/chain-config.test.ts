import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Which triggers run after a given one, read from a real triggers.json.
describe('getCronDependents', () => {
  const before = process.env.C3_CONFIG_DIR
  let deps: typeof import('@/lib/triggers/config').getCronDependents

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'c3-chain-'))
    writeFileSync(
      join(dir, 'triggers.json'),
      JSON.stringify({
        channels: {},
        cron: {
          judge: { name: 'judge', after: ['help'] },
          translate: { name: 'translate', after: ['judge', 'week'] },
          week: { name: 'week', after: [{ trigger: 'judge', weekdays: [5] }] },
          off: { name: 'off', enabled: false, after: ['judge'] },
          broken: { name: 'broken', after: 'judge' },
          odd: { name: 'odd', after: [{ trigger: 'judge', weekdays: ['Fri'] }, 42, null, { trigger: 'judge', weekdays: 5 }, 'help'] },
        },
      }),
    )
    process.env.C3_CONFIG_DIR = dir
    vi.resetModules()
    deps = (await import('@/lib/triggers/config')).getCronDependents
  })
  afterAll(() => {
    if (before === undefined) delete process.env.C3_CONFIG_DIR
    else process.env.C3_CONFIG_DIR = before
  })

  it('follows a weekly link only on its day, never wakes a disabled trigger, and drops a malformed link instead of throwing', () => {
    expect(deps('judge', 4)).toEqual(['translate'])
    expect(deps('judge', 5)).toEqual(['translate', 'week'])
    expect(deps('week', 5)).toEqual(['translate'])
    expect(deps('help', 1)).toEqual(['judge', 'odd'])
  })
})
