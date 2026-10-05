import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * Every trigger's prompt ends with the config's `prompts/_all-agents.md` when
 * it exists, so a rule all agents follow (report in a few lines, say first
 * what you need from Chip) lives in one file. Added 2026-10-05 after the CI
 * agent posted 14,000 characters across a head and seven thread messages.
 */
describe('loadPromptTemplate with a shared prompt', () => {
  const before = process.env.C3_CONFIG_DIR
  let dir: string
  let load: typeof import('@/lib/triggers/config').loadPromptTemplate

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'c3-shared-'))
    mkdirSync(join(dir, 'prompts'))
    writeFileSync(join(dir, 'prompts', 'job.md'), 'Do the job for {{who}}.\n\n')
    process.env.C3_CONFIG_DIR = dir
    vi.resetModules()
    load = (await import('@/lib/triggers/config')).loadPromptTemplate
  })
  afterAll(() => {
    if (before === undefined) delete process.env.C3_CONFIG_DIR
    else process.env.C3_CONFIG_DIR = before
  })

  it('returns the prompt alone when there is no shared file', () => {
    expect(load('job.md', { who: 'Chip' })).toBe('Do the job for Chip.\n\n')
  })

  it('appends the shared file after the prompt, with the variables filled in both', () => {
    writeFileSync(join(dir, 'prompts', '_all-agents.md'), 'Start with what {{who}} must do.\n')
    expect(load('job.md', { who: 'Chip' })).toBe('Do the job for Chip.\n\nStart with what Chip must do.\n')
  })

  it('does not append the shared file to itself', () => {
    expect(load('_all-agents.md', { who: 'Chip' })).toBe('Start with what Chip must do.\n')
  })
})
