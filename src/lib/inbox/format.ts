/**
 * One #needs-chip line: where the ask came from, the ask, and the link to the full post. Read on
 * a phone in one glance, so it stays under INBOX_LINE_LIMIT and carries no embed (the link is in
 * angle brackets). Links inside the ask are reduced to their text: the full post has them.
 */

export const INBOX_LINE_LIMIT = 300

export interface InboxLineInput {
  channelName: string
  agent?: string
  asks: string[]
  failed?: string | null
  jumpUrl: string
}

function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<?https?:\/\/\S+>?/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : text
}

export function formatInboxLine(input: InboxLineInput): string {
  const header = `**#${input.channelName}**${input.agent ? ` · ${input.agent}` : ''}`
  const link = `<${input.jumpUrl}>`
  const body = input.failed
    ? `Run failed: ${plain(input.failed)}`
    : input.asks.map(plain).filter(Boolean).join('\n')
  const room = INBOX_LINE_LIMIT - header.length - link.length - 2
  return [header, clip(body, Math.max(0, room)), link].join('\n')
}
