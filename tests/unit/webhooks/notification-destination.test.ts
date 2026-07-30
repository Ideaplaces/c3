import { describe, it, expect } from 'vitest'
import { resolveNotificationDestination } from '@/lib/webhooks/notification-destination'

describe('resolveNotificationDestination', () => {
  it('sends to the DM when the trigger opted out of thread replies and names a user', () => {
    expect(
      resolveNotificationDestination({ replyInThread: false, notifyUserId: 'U08L4JH9RDE' }),
    ).toEqual({ kind: 'dm', userId: 'U08L4JH9RDE' })
  })

  it('keeps thread replies for triggers that reply in the channel, even with notifyUserId set', () => {
    expect(
      resolveNotificationDestination({ replyInThread: true, notifyUserId: 'U08L4JH9RDE' }),
    ).toEqual({ kind: 'thread' })
  })

  it('falls back to the thread when no user is named, so a failure is never silent', () => {
    expect(resolveNotificationDestination({ replyInThread: false })).toEqual({ kind: 'thread' })
  })
})
