import { afterEach, expect, it, vi } from 'vitest'
import { slackConversationMessages } from '@/lib/slack-poller/client'

afterEach(() => vi.unstubAllGlobals())

it('follows every Slack conversations cursor and preserves the replies query', async () => {
  const first = { ts: '1.1', text: 'first' }
  const last = { ts: '2.1', text: 'last' }
  const fetchHttp = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ok: true, messages: [first], response_metadata: { next_cursor: 'here+next' } }))
    .mockResolvedValueOnce(Response.json({ ok: true, messages: [last], response_metadata: { next_cursor: '' } }))
  vi.stubGlobal('fetch', fetchHttp)

  expect(await slackConversationMessages('bot', 'replies', { channel: 'C1', ts: '1.0' })).toEqual([first, last])
  expect(fetchHttp.mock.calls.map(([url]) => Object.fromEntries(new URL(String(url)).searchParams))).toEqual([
    { channel: 'C1', ts: '1.0' },
    { channel: 'C1', ts: '1.0', cursor: 'here+next' },
  ])
})
