import { slackifyMarkdown } from 'slackify-markdown'

export function slackThreadKey(channelId: string, threadTs: string): string {
  return `slack:${channelId}:${threadTs}`
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

export function formatSlackReport(markdown: string): string {
  const c3Hosts = new Set([
    'c3.ideaplaces.com', 'localhost', hostOf(process.env.C3_BASE_URL || ''), hostOf(process.env.CCC_URL || ''),
  ].filter((host): host is string => Boolean(host)))
  const hosts = [...c3Hosts].map(host => host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const bareC3Url = new RegExp(`(?<![\\w.-])(?:${hosts})(?![\\w-]|\\.[\\w-])(?::\\d+)?(?:/[^\\s<>|\x60*]*)?`, 'gi')
  return slackifyMarkdown(markdown)
    .replace(/<(https?:\/\/[^<>\s|]+)(?:\|([^<>]*))?>|https?:\/\/[^\s<>`]+/gi, (match, link?: string, label?: string) => {
      const url = link || match
      const host = hostOf(url)
      if (!(host && c3Hosts.has(host)) && !url.match(bareC3Url)) return match
      return (label || '').replace(/https?:\/\/[^\s<>`]+/gi, '')
    })
    .replace(bareC3Url, '')
    .trim()
}

/** Slack recommends keeping chat.postMessage text under 4,000 characters. */
export function slackReportChunks(text: string): string[] {
  return text.match(/[\s\S]{1,3900}(?:\s|$)|[\s\S]{1,3900}/gu)?.map(chunk => chunk.trim()).filter(Boolean) || []
}

export class SlackApiError extends Error {
  constructor(message: string, readonly deliveryUnknown = false, readonly retryAfterMs?: number) {
    super(message)
  }
}

async function slackRequest(token: string, endpoint: string, body?: object) {
  try {
    const response = await fetch(`https://slack.com/api/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      const seconds = retryAfter === null ? NaN : Number(retryAfter)
      throw new SlackApiError('ratelimited', false, Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined)
    }
    if (response.status >= 500) throw new SlackApiError(`slack_http_${response.status}`, true)
    const data = await response.json() as { ok: boolean; error?: string; ts?: string; permalink?: string }
    if (!response.ok || !data.ok) {
      const error = data.error || `slack_http_${response.status}`
      throw new SlackApiError(error, error === 'internal_error' || error === 'fatal_error')
    }
    return data
  } catch (err) {
    if (err instanceof SlackApiError) throw err
    throw new SlackApiError('slack_request_failed', true)
  }
}

export async function postSlackReportMessage(token: string, channelId: string, text: string, threadTs?: string): Promise<string> {
  const response = await slackRequest(token, 'chat.postMessage', {
    channel: channelId, text, unfurl_links: false, unfurl_media: false,
    ...(threadTs ? { thread_ts: threadTs, reply_broadcast: false } : {}),
  })
  if (!response.ts) throw new SlackApiError('slack_missing_ts', true)
  return response.ts
}

export async function getSlackReportPermalink(token: string, channelId: string, ts: string): Promise<string> {
  const query = new URLSearchParams({ channel: channelId, message_ts: ts })
  const { permalink } = await slackRequest(token, `chat.getPermalink?${query}`)
  if (!permalink) throw new SlackApiError('slack_missing_permalink')
  return permalink
}
