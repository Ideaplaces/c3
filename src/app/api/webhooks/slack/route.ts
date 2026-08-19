import { randomUUID } from 'crypto'
import { sessionManager } from '@/lib/sdk/session-manager'
import { DEFAULT_MODEL } from '@/lib/models'
import { getSlackTrigger, loadPromptTemplate } from '@/lib/triggers/config'
import { slackifyMarkdown } from 'slackify-markdown'
import { detectSessionFailure } from '@/lib/webhooks/failure-detector'
import { resolveSlackToken } from '@/lib/webhooks/resolve-slack-token'
import {
  openDirectMessageChannel,
  resolveNotificationDestination,
} from '@/lib/webhooks/notification-destination'
import {
  formatAlertMirror,
  formatInvestigationReply,
  postDiscordChunked,
} from '@/lib/webhooks/discord-mirror'

/** How much of the agent's report is carried into Discord, split across messages. */
const DISCORD_REPORT_LIMIT = 6000

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CCC_WEBHOOK_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { channelId, channelName, message, author, messageTs } = body

  if (!channelId || !message) {
    return Response.json({ error: 'Missing channelId or message' }, { status: 400 })
  }

  const trigger = getSlackTrigger(channelId)
  if (!trigger) {
    console.log(`[Slack Webhook] No trigger configured for channel ${channelId} (${channelName})`)
    return Response.json({ error: 'Channel not configured' }, { status: 404 })
  }

  console.log(`[Slack Webhook] Trigger "${trigger.name}" fired in #${channelName}`)

  // Generate the session ID up front so we can interpolate it into the prompt.
  // Agents that need to self-link (e.g. in a DM) can use {{sessionId}},
  // {{sessionUrl}}, and {{resumeCommand}} in their template.
  const sessionId = randomUUID()
  const baseUrl = process.env.C3_BASE_URL || 'http://localhost:8347'
  const sessionUrl = `${baseUrl}/sessions/${sessionId}`
  const resumeCommand = `cd ${trigger.projectPath} && claude --resume ${sessionId} --dangerously-skip-permissions`

  const prompt = loadPromptTemplate(trigger.prompt, {
    message,
    author: author || 'unknown',
    channel: channelName || trigger.name,
    channelId,
    messageTs: messageTs || '',
    timestamp: new Date().toISOString(),
    sessionId,
    sessionUrl,
    resumeCommand,
  })

  const slackBotToken = resolveSlackToken(trigger.slackBotToken)
  const replyInThread = trigger.replyInThread !== false
  const destination = resolveNotificationDestination({
    replyInThread,
    notifyUserId: trigger.notifyUserId,
  })

  // Discord mirror. When the trigger names a Discord channel, the alert is
  // copied there before the session starts (so the channel shows the alert and
  // "investigating" immediately) and the findings come back as an inline reply
  // to that copy. Nothing is written to the shared Slack channel at all.
  const discordBotToken = process.env.DISCORD_BOT_TOKEN
  const discordChannelId = trigger.discordChannelId
  const mirrorToDiscord = Boolean(discordChannelId && discordBotToken)

  let mirrorMessageId: string | null = null
  if (mirrorToDiscord) {
    const permalink =
      slackBotToken && messageTs
        ? await getSlackPermalink(slackBotToken, channelId, messageTs)
        : undefined
    mirrorMessageId = await postDiscordChunked(
      discordBotToken as string,
      discordChannelId as string,
      formatAlertMirror({
        channelName: channelName || trigger.name,
        author: author || 'unknown',
        message,
        sessionId,
        sessionUrl,
        permalink,
      }),
    )
    if (mirrorMessageId) {
      console.log(
        `[Slack Webhook] Mirrored ${trigger.name} alert to Discord ${discordChannelId} (${mirrorMessageId})`,
      )
    } else {
      console.error(
        `[Slack Webhook] Discord mirror failed for ${trigger.name};` +
        ` the report will be posted unthreaded or fall back to Slack DM`,
      )
    }
  }

  await sessionManager.startSession({
    sessionId,
    projectPath: trigger.projectPath,
    prompt,
    permissionMode: trigger.permissionMode || 'bypassPermissions',
    model: trigger.model || DEFAULT_MODEL,
  })

  console.log(`[Slack Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)

  // Immediately notify: session started (reply in thread)
  if (slackBotToken && messageTs && replyInThread && !mirrorToDiscord) {
    const startMessage = [
      `:robot_face: *Session started* (\`${sessionId.slice(0, 8)}\`)`,
      `Watch live: ${baseUrl}/sessions/${sessionId}`,
    ].join('\n')

    fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: messageTs,
        reply_broadcast: false,
        text: startMessage,
        unfurl_links: false,
      }),
    })
      .then(res => res.json())
      .then((data: Record<string, unknown>) => {
        if (data.ok) {
          console.log(`[Slack Webhook] Session start notification sent for ${sessionId}`)
        } else {
          console.error(`[Slack Webhook] Start notification failed:`, data.error)
        }
      })
      .catch(err => console.error(`[Slack Webhook] Start notification error:`, err))
  }

  // On completion: reply to the Slack thread with findings, OR with a failure
  // notice if the session died before producing meaningful output. The failure
  // notice ALWAYS goes out (even when replyInThread is false) so a silent agent
  // crash never goes unseen — but on a DM-only trigger it goes to the DM, not
  // into the shared alert channel where the whole team reads it.
  if (mirrorToDiscord) {
    const onDiscordSessionEnded = (sid: string, reason: string) => {
      if (sid !== sessionId) return
      sessionManager.removeListener('session_ended', onDiscordSessionEnded)
      console.log(`[Slack Webhook] Session ${sessionId} ended (${reason})`)

      const events = sessionManager.getBufferedEvents(sessionId)
      const failure = detectSessionFailure(events, reason)
      const body = failure.failed
        ? failure.reason
        : extractSummary(sessionId, reason, DISCORD_REPORT_LIMIT)

      const content = formatInvestigationReply({
        failed: failure.failed,
        body,
        sessionId,
        sessionUrl,
        resumeCommand,
      })

      void (async () => {
        const posted = await postDiscordChunked(
          discordBotToken as string,
          discordChannelId as string,
          content,
          mirrorMessageId ?? undefined,
        )
        if (posted) {
          console.log(
            `[Slack Webhook] Posted report to Discord ${discordChannelId} for ${sessionId}` +
            ` (failed=${failure.failed})`,
          )
          return
        }
        // Degraded path only. Discord is the destination; a DM beats losing the
        // report entirely when Discord refuses the post.
        console.error(
          `[Slack Webhook] Discord report failed for ${sessionId}; falling back to Slack DM`,
        )
        if (!slackBotToken || !trigger.notifyUserId) return
        const dmChannel = await openDirectMessageChannel(slackBotToken, trigger.notifyUserId)
        if (!dmChannel) return
        await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${slackBotToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: dmChannel,
            text: [
              `*Discord post failed for \`${trigger.name}\`* (\`${sessionId.slice(0, 8)}\`)`,
              '',
              slackifyMarkdown(body.length > 2500 ? body.slice(0, 2500) + '...' : body),
              '',
              `Browser: ${baseUrl}/sessions/${sessionId}`,
            ].join('\n'),
            unfurl_links: false,
          }),
        }).catch(err => console.error('[Slack Webhook] DM fallback error:', err))
      })().catch(err =>
        console.error(`[Slack Webhook] Discord report handling error for ${sessionId}:`, err),
      )
    }

    sessionManager.on('session_ended', onDiscordSessionEnded)
  } else if (slackBotToken && messageTs) {
    const onSessionEnded = (sid: string, reason: string) => {
      if (sid !== sessionId) return
      sessionManager.removeListener('session_ended', onSessionEnded)
      console.log(`[Slack Webhook] Session ${sessionId} ended (${reason})`)
      void postSessionNotice(reason).catch(err =>
        console.error(`[Slack Webhook] Notice handling error for ${sessionId}:`, err),
      )
    }

    const postSessionNotice = async (reason: string) => {
      const events = sessionManager.getBufferedEvents(sessionId)
      const failure = detectSessionFailure(events, reason)

      if (!failure.failed && !replyInThread) {
        // Trigger handles its own DM; nothing to post here.
        return
      }

      let slackMessage: string
      if (failure.failed) {
        const reasonText = failure.reason.length > 1500
          ? failure.reason.slice(0, 1500) + '...'
          : failure.reason
        slackMessage = [
          `:warning: *Agent session failed* (\`${sessionId.slice(0, 8)}\`)`,
          ...(destination.kind === 'dm'
            ? [`Trigger: \`${trigger.name}\` in #${channelName || trigger.name}`]
            : []),
          '',
          `*Reason:* ${reasonText}`,
          '',
          `*Take over this session:*`,
          `Browser: ${baseUrl}/sessions/${sessionId}`,
          `Resume in terminal:`,
          '```',
          resumeCommand,
          '```',
        ].join('\n')
      } else {
        const summary = extractSummary(sessionId, reason)
        const slackSummary = slackifyMarkdown(
          summary.length > 2500 ? summary.slice(0, 2500) + '...' : summary
        )
        slackMessage = [
          `*Agent Investigation Complete* (\`${sessionId.slice(0, 8)}\`)`,
          '',
          slackSummary,
          '',
          `*Continue this conversation:*`,
          `Browser: ${baseUrl}/sessions/${sessionId}`,
          `Resume in terminal:`,
          '```',
          resumeCommand,
          '```',
        ].join('\n')
      }

      // A DM-only trigger keeps its notices out of the alert channel entirely.
      // If opening the IM fails we still fall back to the thread rather than
      // dropping a failure notice on the floor.
      let targetChannel = channelId
      let targetThreadTs: string | undefined = messageTs
      if (destination.kind === 'dm') {
        const dmChannel = await openDirectMessageChannel(slackBotToken, destination.userId)
        if (dmChannel) {
          targetChannel = dmChannel
          targetThreadTs = undefined
        } else {
          console.error(
            `[Slack Webhook] Could not open DM with ${destination.userId};` +
            ` falling back to thread in ${channelId}`,
          )
        }
      }

      const asDm = targetThreadTs === undefined
      console.log(
        `[Slack Webhook] Posting notice: channel=${targetChannel} dm=${asDm}` +
        ` thread_ts=${targetThreadTs ?? 'none'} failed=${failure.failed}`,
      )
      fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackBotToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: targetChannel,
          ...(targetThreadTs ? { thread_ts: targetThreadTs, reply_broadcast: false } : {}),
          text: slackMessage,
          unfurl_links: false,
        }),
      })
        .then(res => res.json())
        .then((data: Record<string, unknown>) => {
          if (data.ok) {
            console.log(`[Slack Webhook] Posted notice for session ${sessionId} (channel=${targetChannel}, dm=${asDm}, failed=${failure.failed})`)
          } else {
            console.error(
              `[Slack Webhook] Slack post failed: ${data.error} channel=${targetChannel} dm=${asDm}` +
              ` trigger=${trigger.name} token_prefix=${slackBotToken?.slice(0, 12)}...`,
            )
          }
        })
        .catch(err => console.error(`[Slack Webhook] Slack post error:`, err))
    }

    sessionManager.on('session_ended', onSessionEnded)
  }

  return Response.json({ sessionId, trigger: trigger.name, status: 'started' })
}

/**
 * Permalink back to the Slack alert, so the Discord copy can point at the
 * original. Returns undefined when Slack refuses; the mirror works without it.
 */
async function getSlackPermalink(
  botToken: string,
  channelId: string,
  messageTs: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(
      `https://slack.com/api/chat.getPermalink?channel=${channelId}&message_ts=${messageTs}`,
      { headers: { 'Authorization': `Bearer ${botToken}` } },
    )
    const data = (await res.json()) as { ok: boolean; permalink?: string; error?: string }
    if (!data.ok) {
      console.error(`[Slack Webhook] chat.getPermalink failed: ${data.error}`)
      return undefined
    }
    return data.permalink
  } catch (err) {
    console.error('[Slack Webhook] chat.getPermalink error:', err)
    return undefined
  }
}

function extractSummary(sessionId: string, reason: string, maxChars = 3000): string {
  const events = sessionManager.getBufferedEvents(sessionId)

  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].message as Record<string, unknown>
    if (msg.type === 'assistant' && msg.message) {
      const assistantMsg = msg.message as Record<string, unknown>
      const content = assistantMsg.content
      if (Array.isArray(content)) {
        const textParts = content
          .filter((c: Record<string, unknown>) => c.type === 'text')
          .map((c: Record<string, unknown>) => c.text)
          .join('\n')
        if (textParts) return textParts.slice(0, maxChars)
      } else if (typeof content === 'string' && content) {
        return content.slice(0, maxChars)
      }
    }
  }

  return `Session completed (${reason})`
}

