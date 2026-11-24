import { afterEach, expect, it, vi } from 'vitest'
import { sendSlackDeliveryPart } from '@/lib/webhooks/slack-delivery'

afterEach(() => vi.unstubAllGlobals())

it('refuses to send a chunk with an outstanding Slack reservation', async () => {
  const slack = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', slack)
  await expect(sendSlackDeliveryPart({
    file: '/dev/null/deliveries.json', key: 'key',
    state: { fingerprint: 'fingerprint', chunksPosted: 1, sending: true },
    token: 'bot', channelId: 'C1', threadTs: '1.0', text: 'second chunk',
  })).rejects.toMatchObject({ message: 'slack_delivery_unknown', deliveryUnknown: true })
  expect(slack).not.toHaveBeenCalled()
})
