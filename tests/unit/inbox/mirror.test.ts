import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { mirrorToInbox, nonceFor, type MirrorDeps } from '@/lib/inbox/mirror'
import { getItem, markAnswered, saveItem } from '@/lib/inbox/store'
import type { InboxConfig } from '@/lib/inbox/config'

const config: InboxConfig = { channelId: 'INBOX', guildId: 'G', trigger: 'needs-chip', skipChannelIds: ['LUCA'] }
const ask = 'Needs from you: merge #12? I recommend yes.\n\nSession: abc'

let file: string
let deps: MirrorDeps & { post: ReturnType<typeof vi.fn>; openThread: ReturnType<typeof vi.fn>; link: ReturnType<typeof vi.fn> }
let ids: number

beforeEach(() => {
  file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-')), 'needs-chip.json')
  ids = 0
  deps = {
    post: vi.fn(async () => `L${++ids}`),
    openThread: vi.fn(async () => true),
    channelName: async (id: string) => ({ C1: 'plusgrade', C2: 'eli-pull-requests' } as Record<string, string>)[id] ?? id,
    link: vi.fn(),
    now: () => new Date('2026-10-24T12:00:00Z'),
    file,
  }
})

describe('mirrorToInbox', () => {
  it('posts one line, opens its thread, links it to the asking session and records it open', async () => {
    const r = await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask, agent: 'cron:plusgrade-pr-review', sessionId: 'S1' }, config, deps)
    expect(r).toEqual({ status: 'posted', inboxMessageId: 'L1' })
    expect(deps.post).toHaveBeenCalledOnce()
    const [channel, content, nonce] = deps.post.mock.calls[0]
    expect(channel).toBe('INBOX')
    expect(content).toBe('**#plusgrade** · cron:plusgrade-pr-review\nmerge #12? I recommend yes.\n<https://discord.com/channels/G/C1/M1>')
    expect(nonce).toBe(nonceFor('M1'))
    expect(nonce.length).toBeLessThanOrEqual(25)
    expect(deps.openThread).toHaveBeenCalledWith('INBOX', 'L1', 'plusgrade: merge #12? I recommend yes.')
    expect(deps.link).toHaveBeenCalledWith('L1', 'S1', 'needs-chip')
    expect(getItem('M1', file)?.status).toBe('open')
  })

  it('posts nothing the second time the same source post arrives', async () => {
    await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask, sessionId: 'S1' }, config, deps)
    const r = await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask, sessionId: 'S1' }, config, deps)
    expect(r.status).toBe('duplicate')
    expect(deps.post).toHaveBeenCalledOnce()
  })

  it('retries a post whose answer was lost with the same nonce', async () => {
    deps.post.mockResolvedValueOnce(null)
    expect((await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask }, config, deps)).status).toBe('failed')
    expect(getItem('M1', file)?.status).toBe('posting')
    expect((await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask }, config, deps)).status).toBe('posted')
    expect(deps.post.mock.calls[0][2]).toBe(deps.post.mock.calls[1][2])
  })

  it('notes the same ask from another agent in the open thread instead of a new line', async () => {
    await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask, sessionId: 'S1' }, config, deps)
    const r = await mirrorToInbox({ sourceChannelId: 'C2', sourceMessageId: 'M2', text: 'Needs from you: **Merge #12? I recommend yes**', agent: 'cron:eli-pr-review', sessionId: 'S2' }, config, deps)
    expect(r).toEqual({ status: 'duplicate', inboxMessageId: 'L1' })
    expect(deps.post).toHaveBeenCalledTimes(2)
    expect(deps.post.mock.calls[1][0]).toBe('L1')
    expect(deps.post.mock.calls[1][1]).toBe('Asked again in #eli-pull-requests by cron:eli-pr-review: <https://discord.com/channels/G/C2/M2>')
  })

  it('stays quiet when the same session repeats its own open ask', async () => {
    await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask, sessionId: 'S1' }, config, deps)
    await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M2', text: ask, sessionId: 'S1' }, config, deps)
    expect(deps.post).toHaveBeenCalledOnce()
  })

  it('posts a new line when one ask among the old ones is new', async () => {
    await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask }, config, deps)
    const r = await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M2', text: 'Needs from you:\n- merge #12?\n- merge #13?' }, config, deps)
    expect(r.status).toBe('posted')
  })

  it('asks again once Chip has answered the earlier item', async () => {
    await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask }, config, deps)
    expect(markAnswered('L1', new Date('2026-10-24T13:00:00Z'), file)).toBe(true)
    expect((await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M2', text: ask }, config, deps)).status).toBe('posted')
  })

  it('treats an open item older than 14 days as gone', async () => {
    saveItem({ sourceKey: 'OLD', askKeys: [], status: 'open', channelName: 'x', createdAt: '2026-10-01T00:00:00Z', inboxMessageId: 'L0' }, new Date('2026-10-01T00:00:00Z'), file)
    await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: ask }, config, deps)
    expect(getItem('OLD', file)).toBeNull()
  })

  it('copies a failed run once per agent until it is answered', async () => {
    const failed = 'Run failed: precheck timed out'
    expect((await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: failed, agent: 'cron:nous-mesh' }, config, deps)).status).toBe('posted')
    expect((await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M2', text: failed, agent: 'cron:nous-mesh' }, config, deps)).status).toBe('duplicate')
    expect(deps.post.mock.calls[0][1]).toContain('Run failed: precheck timed out')
  })

  it('leaves out Luca, channels Chip reads, posts with no ask, and the inbox itself', async () => {
    expect((await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M1', text: 'Needs Luca: free disk.' }, config, deps)).status).toBe('no-ask')
    expect((await mirrorToInbox({ sourceChannelId: 'LUCA', sourceMessageId: 'M2', text: ask }, config, deps)).status).toBe('skipped')
    expect((await mirrorToInbox({ sourceChannelId: 'INBOX', sourceMessageId: 'M3', text: ask }, config, deps)).status).toBe('skipped')
    expect((await mirrorToInbox({ sourceChannelId: 'C1', sourceMessageId: 'M4', text: ask }, null, deps)).status).toBe('skipped')
    expect(deps.post).not.toHaveBeenCalled()
  })

  it('links through the thread when the post is inside one', async () => {
    await mirrorToInbox({ sourceChannelId: 'C1', sourceThreadId: 'T9', sourceMessageId: 'M1', text: ask }, config, deps)
    expect(deps.post.mock.calls[0][1]).toContain('<https://discord.com/channels/G/T9/M1>')
  })
})
