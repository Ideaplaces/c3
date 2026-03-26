import fs from 'fs'
import path from 'path'

export interface ChannelTrigger {
  name: string
  channelId: string
  prompt: string
  projectPath: string
  permissionMode: string
  model: string
  maxTurns?: number
}

export interface SlackTrigger extends ChannelTrigger {
  slackBotToken?: string
}

interface TriggersConfig {
  channels: Record<string, ChannelTrigger>
  slack?: Record<string, SlackTrigger>
}

const TRIGGERS_PATH = path.join(process.cwd(), 'triggers.json')
const PROMPTS_DIR = path.join(process.cwd(), 'prompts')

let cachedConfig: TriggersConfig | null = null
let cachedMtime: number = 0

export function loadTriggersConfig(): TriggersConfig {
  try {
    const stat = fs.statSync(TRIGGERS_PATH)
    if (cachedConfig && stat.mtimeMs === cachedMtime) {
      return cachedConfig
    }
    const raw = fs.readFileSync(TRIGGERS_PATH, 'utf-8')
    cachedConfig = JSON.parse(raw) as TriggersConfig
    cachedMtime = stat.mtimeMs
    return cachedConfig
  } catch {
    return { channels: {}, slack: {} }
  }
}

export function getChannelTrigger(channelId: string): ChannelTrigger | null {
  const config = loadTriggersConfig()
  for (const trigger of Object.values(config.channels)) {
    if (trigger.channelId === channelId) {
      return trigger
    }
  }
  return null
}

export function getSlackTrigger(channelId: string): SlackTrigger | null {
  const config = loadTriggersConfig()
  if (!config.slack) return null
  for (const trigger of Object.values(config.slack)) {
    if (trigger.channelId === channelId) {
      return trigger
    }
  }
  return null
}

export function getAllSlackTriggers(): SlackTrigger[] {
  const config = loadTriggersConfig()
  if (!config.slack) return []
  return Object.values(config.slack)
}

export function loadPromptTemplate(
  templatePath: string,
  variables: Record<string, string>
): string {
  const fullPath = path.isAbsolute(templatePath)
    ? templatePath
    : path.join(PROMPTS_DIR, templatePath)

  let prompt = fs.readFileSync(fullPath, 'utf-8')
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value)
  }
  return prompt
}
