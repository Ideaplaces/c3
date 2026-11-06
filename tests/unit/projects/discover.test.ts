import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDirs: Record<string, string[]> = {}
const mockExists: Set<string> = new Set()

vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  readdirSync: vi.fn((dir: string) => mockDirs[dir] || []),
  statSync: vi.fn(() => ({ isDirectory: () => true })),
  existsSync: vi.fn((path: string) => mockExists.has(path)),
}))

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/testuser'),
}))

import { discoverProjects, discoverWorkspaces } from '@/lib/projects/discover'

describe('discoverProjects', () => {
  beforeEach(() => {
    Object.keys(mockDirs).forEach((k) => delete mockDirs[k])
    mockExists.clear()
    vi.stubEnv('CCC_PROJECT_DIRS', '')
  })

  it('always includes full access entry even with no scan dirs', () => {
    const projects = discoverProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]).toEqual({
      name: 'testuser (full access)',
      path: '/home/testuser',
    })
  })

  it('discovers git repos and includes workspace and full access entries', () => {
    vi.stubEnv('CCC_PROJECT_DIRS', '/home/user/projects')
    mockExists.add('/home/user/projects')
    mockExists.add('/home/user/projects/my-app/.git')
    mockDirs['/home/user/projects'] = ['my-app', 'not-a-repo']

    const projects = discoverProjects()
    expect(projects).toHaveLength(3)
    expect(projects[0].name).toBe('testuser (full access)')
    expect(projects[1].name).toBe('projects (workspace)')
    expect(projects[2]).toEqual({
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
    // Full access + workspace entry, no hidden repos
    expect(projects).toHaveLength(2)
    expect(projects[0].name).toBe('testuser (full access)')
    expect(projects[1].name).toBe('projects (workspace)')
  })

  it('sorts projects alphabetically after full access and workspace entries', () => {
    vi.stubEnv('CCC_PROJECT_DIRS', '/home/user/projects')
    mockExists.add('/home/user/projects')
    mockExists.add('/home/user/projects/zebra/.git')
    mockExists.add('/home/user/projects/alpha/.git')
    mockDirs['/home/user/projects'] = ['zebra', 'alpha']

    const projects = discoverProjects()
    expect(projects[0].name).toBe('testuser (full access)')
    expect(projects[1].name).toBe('projects (workspace)')
    expect(projects[2].name).toBe('alpha')
    expect(projects[3].name).toBe('zebra')
  })
})

describe('discoverWorkspaces', () => {
  beforeEach(() => {
    mockExists.clear()
  })

  it('lists each existing scan dir by its folder name, skipping missing ones', () => {
    vi.stubEnv('CCC_PROJECT_DIRS', '/home/u/ideaplaces-meta/, /home/u/gone, /home/u/eli.health-meta')
    mockExists.add('/home/u/ideaplaces-meta')
    mockExists.add('/home/u/eli.health-meta')

    expect(discoverWorkspaces()).toEqual([
      { name: 'ideaplaces-meta', path: '/home/u/ideaplaces-meta' },
      { name: 'eli.health-meta', path: '/home/u/eli.health-meta' },
    ])
  })

  it('expands ~ to the home folder', () => {
    vi.stubEnv('CCC_PROJECT_DIRS', '~/mentorly-meta')
    mockExists.add('/home/testuser/mentorly-meta')

    expect(discoverWorkspaces()).toEqual([{ name: 'mentorly-meta', path: '/home/testuser/mentorly-meta' }])
  })
})
