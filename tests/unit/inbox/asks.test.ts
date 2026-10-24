import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { askKey, chipAsks, runFailed } from '@/lib/inbox/asks'

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

describe('askKey', () => {
  it('is the same for the same words with other case, markdown or punctuation', () => {
    expect(askKey('Merge #12? I recommend yes.')).toBe(askKey('**merge #12** I recommend yes'))
  })
  it('differs when only the words after the question differ', () => {
    expect(askKey('Merge it? The eli-kpi fix.')).not.toBe(askKey('Merge it? The tour-platform pricing fix.'))
  })
  it('differs between two pull requests', () => {
    expect(askKey('Merge #812?')).not.toBe(askKey('Merge #813?'))
  })
})
