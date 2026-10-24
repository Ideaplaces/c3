import { loadTriggersConfig } from '@/lib/triggers/config'

/**
 * Where the inbox lives, from the `inbox` block of triggers.json:
 * `{ "channelId", "guildId", "trigger", "skipChannelIds" }`. `trigger` names the channel trigger
 * that serves replies in #needs-chip threads; `skipChannelIds` are channels Chip already reads
 * (Luca's channel, Stripe), whose asks are not copied. No block, no inbox.
 */
export interface InboxConfig {
  channelId: string
  guildId: string
  trigger: string
  skipChannelIds: string[]
}

export function getInboxConfig(): InboxConfig | null {
  const raw = (loadTriggersConfig() as unknown as { inbox?: Partial<InboxConfig> }).inbox
  if (!raw?.channelId || !raw.guildId || !raw.trigger) return null
  return {
    channelId: raw.channelId,
    guildId: raw.guildId,
    trigger: raw.trigger,
    skipChannelIds: Array.isArray(raw.skipChannelIds) ? raw.skipChannelIds : [],
  }
}
