import { describe, it, expect } from 'vitest'
import { withToolDirs, toolDirs } from './env-path.js'

describe('withToolDirs', () => {
  const dirs = toolDirs('/home/u', '/home/u/.nvm/versions/node/v22/bin/node')

  it('prepends the tool dirs a bare cron PATH is missing', () => {
    const out = withToolDirs('/usr/bin:/bin', dirs).split(':')
    expect(out).toEqual([
      '/home/u/.nvm/versions/node/v22/bin',
      '/home/u/google-cloud-sdk/bin',
      '/home/u/.local/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ])
  })

  it('leaves a PATH that already has them untouched, in its own order', () => {
    const full = '/home/u/.nvm/versions/node/v22/bin:/home/u/google-cloud-sdk/bin:/home/u/.local/bin:/usr/local/bin:/usr/bin:/bin'
    expect(withToolDirs(full, dirs)).toBe(full)
  })

  it('never duplicates a dir and never drops one the caller had', () => {
    const out = withToolDirs('/opt/custom/bin:/home/u/google-cloud-sdk/bin', dirs).split(':')
    expect(out.filter((d) => d === '/home/u/google-cloud-sdk/bin')).toHaveLength(1)
    expect(out).toContain('/opt/custom/bin')
  })

  it('works from an empty PATH', () => {
    expect(withToolDirs(undefined, dirs).split(':')).toEqual(dirs)
  })
})
