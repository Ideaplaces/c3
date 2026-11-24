import { randomUUID } from 'node:crypto'
import { loadPromptTemplate, type SlackTrigger } from '@/lib/triggers/config'
import { linkThread, recordSlackThreadReply, sessionForThread } from './discord-threads'
import { resolveSlackToken } from './resolve-slack-token'
import { discardRejectedSlackAnswer, finishSlackAnswer, queueSlackAnswer, slackAnswerKey, slackAnswersForThread } from './slack-answer'
import { slackThreadKey } from './slack-message'
import { resumeOrStart, withThreadLock } from './thread-session'

interface SlackThreadReply {
  threadTs: string
  messageTs: string
  message: string
  author?: string
  followUp: string
}

export async function handleSlackThreadReply(trigger: SlackTrigger, reply: SlackThreadReply): Promise<Response> {
  const { threadTs, messageTs, message, author, followUp } = reply
  const { channelId } = trigger
  const key = slackThreadKey(channelId, threadTs)
  const startId = randomUUID()
  const replyId = messageTs
  const answerKey = slackAnswerKey(channelId, threadTs, replyId)

  async function handle() {
    const answers = slackAnswersForThread(trigger, threadTs)
    const latest = answers.at(-1)
    let existing = sessionForThread(key)
    const supersedes = latest?.status === 'started' && existing?.trigger === trigger.name
      && existing.sessionId !== latest.sessionId && Date.parse(existing.linkedAt) < latest.createdAt
    if (latest && (!existing || supersedes)) {
      linkThread(key, latest.sessionId, trigger.name)
      existing = sessionForThread(key)
    }
    const saved = answers.find(answer => answer.replyId === replyId)
    const accepted = saved || (existing?.trigger === trigger.name && existing.slackReplies?.[replyId])
    if (accepted) {
      return Response.json({ sessionId: accepted.sessionId, status: accepted.status, trigger: trigger.name })
    }

    if (!resolveSlackToken(trigger.slackBotToken)) return Response.json({ error: 'missing_slack_token' }, { status: 502 })

    const result = await resumeOrStart({
      key, trigger, platform: 'Slack', author: author || 'someone', reply: followUp, startId,
      prompt: () => [
        loadPromptTemplate(trigger.prompt, {
          message, author: author || 'unknown', channel: trigger.name, channelId, threadTs,
          messageTs, sessionId: startId, sessionUrl: '', resumeCommand: '',
          timestamp: new Date().toISOString(),
        }),
        'Answer the Slack thread in your final message. C3 will deliver it. Keep session URLs out of the answer.',
      ].join('\n\n'),
      prepareRun: (sessionId, status, prompt) => {
        const taggedPrompt = `${prompt}\n\n<slack-reply-id>${replyId}</slack-reply-id>`
        queueSlackAnswer(answerKey, taggedPrompt, {
          sessionId, status, trigger: trigger.name, channelId, threadTs, replyId,
        })
        return taggedPrompt
      },
      onLaunchRejected: () => discardRejectedSlackAnswer(answerKey),
      onEnded: (_id, reason) => finishSlackAnswer(answerKey, trigger, reason),
    })
    const { sessionId, status } = result
    if (status === 'busy') return Response.json({ ...result, trigger: trigger.name }, { status: 409 })
    recordSlackThreadReply(key, trigger.name, messageTs, { sessionId, status }, existing)
    return Response.json({ ...result, trigger: trigger.name })
  }

  return await withThreadLock(key, handle, () => Response.json({ trigger: trigger.name, status: 'busy' }, { status: 409 }))
}
