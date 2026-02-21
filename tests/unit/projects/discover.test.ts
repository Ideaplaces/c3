import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDirs: Record<string, string[]> = {}
const mockExists: Set<string> = new Set()

vi.mock('fs', () => ({
  readdirSync: vi.fn((dir: string) => mockDirs[dir] || []),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
  existsSync: vi.fn((path: string) => mockExists.has(path)),
}))

import { discoverProjects } from '@/lib/projects/discover'

describe('discoverProjects', () => {
  beforeEach(() => {
    Object.keys(mockDirs).forEach((k) => delete mockDirs[k])
    mockExists.clear()
    vi.stubEnv('CCC_PROJECT_DIRS', '')
  })

  it('returns empty array when no scan dirs configured', () => {
    expect(discoverProjects()).toEqual([])
  })

  it('discovers git repos in scan directories', () => {
    vi.stubEnv('CCC_PROJECT_DIRS', '/home/user/projects')
    mockExists.add('/home/user/projects')
    mockExists.add('/home/user/projects/my-app/.git')
    mockDirs['/home/user/projects'] = ['my-app', 'not-a-repo']

    const projects = discoverProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]).toEqual({
      name: 'my-app',
      path: '/home/user/projects/my-app',
    })
  })

  it('skips hidden directories', () => {
    vi.stubEnv('CCC_PROJECT_DIRS', '/home/user/projects')
    mockExists.add('/home/user/projects')
    mockExists.add('/home/user/projects/.hidden/.git')
    mockDirs['/home/user/projects'] = ['.hidden']

    const projects = discoverProjects()
    expect(projects).toHaveLength(0)
  })

  it('sorts projects alphabetically', () => {
    vi.stubEnv('CCC_PROJECT_DIRS', '/home/user/projects')
    mockExists.add('/home/user/projects')
    mockExists.add('/home/user/projects/zebra/.git')
    mockExists.add('/home/user/projects/alpha/.git')
    mockDirs['/home/user/projects'] = ['zebra', 'alpha']

    const projects = discoverProjects()
    expect(projects[0].name).toBe('alpha')
    expect(projects[1].name).toBe('zebra')
  })
})
