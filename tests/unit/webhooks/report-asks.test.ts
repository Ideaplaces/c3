import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { chipAsks, runFailed } from '@/lib/webhooks/report-asks'

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/ask-lines.json'), 'utf-8')) as {
  name: string
  text: string
  chipAsks: string[]
}[]

describe('chipAsks', () => {
  for (const c of fixture) {
    it(c.name, () => {
      expect(chipAsks(c.text)).toEqual(c.chipAsks)
    })
  }

  it('reads "Needs Chip:" as Chip', () => {
    expect(chipAsks('Needs Chip: approve the budget?')).toEqual(['approve the budget?'])
  })
})

describe('runFailed', () => {
  it('returns what broke', () => {
    expect(runFailed('**Run failed:** precheck timed out\nSession: x')).toBe('precheck timed out')
  })
  it('is null for a report that did not break', () => {
    expect(runFailed('Needs from you: merge #12?')).toBeNull()
  })
})
