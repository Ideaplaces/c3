import { describe, it, expect } from 'vitest'
import { formatInboxLine, INBOX_LINE_LIMIT } from '@/lib/inbox/format'

const jumpUrl = 'https://discord.com/channels/1462642831184232584/1500000000000000000/1600000000000000000'

describe('formatInboxLine', () => {
  it('names the channel and agent, keeps the ask, and links the full post without an embed', () => {
    const line = formatInboxLine({ channelName: 'plusgrade', agent: 'cron:plusgrade-pr-review', asks: ['Merge [#12](https://x/12)? I recommend yes.'], jumpUrl })
    expect(line).toBe(`**#plusgrade** · cron:plusgrade-pr-review\nMerge #12? I recommend yes.\n<${jumpUrl}>`)
  })

  it('clips a long ask to the limit and keeps the link whole', () => {
    const line = formatInboxLine({ channelName: 'tourcockpit-agents', asks: ['x'.repeat(1000)], jumpUrl })
    expect(line.length).toBeLessThanOrEqual(INBOX_LINE_LIMIT)
    expect(line.endsWith(`<${jumpUrl}>`)).toBe(true)
    expect(line).toContain('…')
  })

  it('says a run failed', () => {
    expect(formatInboxLine({ channelName: 'nous-mesh', asks: [], failed: 'precheck timed out', jumpUrl }).split('\n')[1]).toBe('Run failed: precheck timed out')
  })
})
