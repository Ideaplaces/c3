import { slackifyMarkdown } from 'slackify-markdown'
import type { SlackTrigger } from '@/lib/triggers/config'

export function slackThreadKey(channelId: string, threadTs: string): string {
  return `slack:${channelId}:${threadTs}`
}

function parseLink(url: string): URL | undefined {
  try {
    return new URL(url.startsWith('//') ? `https:${url}` : url)
  } catch {
    return undefined
  }
}

function hostOf(url: string): string | undefined {
  return parseLink(url)?.hostname.toLowerCase().replace(/\.$/, '')
}

function decodeLinkPart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function formatSlackReport(markdown: string, trigger?: Pick<SlackTrigger, 'workspace' | 'projectPath'>): string {
  const mentorly = trigger?.workspace
    ? trigger.workspace.toLowerCase() === 'mentorly'
    : /(?:^|\/)mentorly-meta(?:\/|$)/i.test(trigger?.projectPath || '')
  const c3Hosts = new Set([
    'c3.ideaplaces.com', 'localhost',
    hostOf(process.env.C3_BASE_URL || ''), hostOf(process.env.CCC_URL || ''),
    hostOf(process.env.NEXT_PUBLIC_BASE_URL || ''),
  ].filter((host): host is string => Boolean(host)))
  const ideaPlacesName = /\bideaplaces\b/i
  const hosts = [...c3Hosts].map(host => host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (mentorly) hosts.unshift('(?:[a-z0-9-]+\\.)*ideaplaces\\.com')
  const bareHost = `(?<![\\w.-])(?:${hosts.join('|')})(?![\\w-]|\\.[\\w-])\\.?(?::\\d+)?(?:[/?#][^\\s<>|\\x60*)\\]]*)?`
  const embeddedHost = new RegExp(bareHost, 'i')
  const isInternal = (url: string) => {
    const link = parseLink(url)
    if (!link) return false
    const host = link.hostname.toLowerCase().replace(/\.$/, '')
    if (c3Hosts.has(host)) return true
    if (!mentorly) return embeddedHost.test(url)
    const target = decodeLinkPart(link.pathname + link.search + link.hash)
    return ideaPlacesName.test(host) || ideaPlacesName.test(target) || embeddedHost.test(target)
  }
  const bareHostPattern = new RegExp(bareHost, 'gi')
  const stripBare = (value: string) => {
    const stripped = value.replace(bareHostPattern, '')
    return mentorly ? stripped.replace(/\bideaplaces\b/gi, '') : stripped
  }
  const prefix = String.raw`(?:[a-z][a-z\d+.-]*:)?//`
  const slackLink = String.raw`<(${prefix}[^<>\s|]+)(?:\|([^<>]*))?>`
  const rawMarkdownLink = String.raw`!?\[([^\]\n]*)\]\(<?(${prefix}(?:[^\s<>()]|\([^\s<>()]*\))+)>?(?:\s+["'][^\n]*?["'])?\)`
  const linkOrBare = new RegExp([
    rawMarkdownLink, slackLink, String.raw`(${prefix}[^\s<>\x60*)\]]+)`,
    bareHost, ...(mentorly ? [String.raw`\bideaplaces\b`] : []),
  ].join('|'), 'gi')
  const scrub = (text: string) => text.replace(linkOrBare,
    (match, rawLabel?: string, rawUrl?: string, url?: string, label?: string, bareUrl?: string) => {
      const href = rawUrl || url || bareUrl
      if (!href) return ''
      if (isInternal(href)) return mentorly ? '' : stripBare(rawLabel || label || '')
      if (rawLabel) return match.replace(rawLabel, stripBare(rawLabel))
      if (label !== undefined) return `<${url}|${stripBare(label) || url}>`
      return match
    })
  const input = scrub(markdown)
  try {
    return scrub(slackifyMarkdown(input)).trim()
  } catch (err) {
    if (!(err instanceof URIError)) throw err
    return input.trim()
  }
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
      signal: AbortSignal.timeout(15_000),
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
