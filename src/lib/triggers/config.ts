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
  // When false, the webhook handler skips posting "session started" and
  // "investigation complete" replies in the alert channel thread. The agent
  // is then responsible for delivering the result itself (e.g. as a DM).
  // Defaults to true so existing Mentorly-style triggers keep their behavior.
  replyInThread?: boolean
}

export interface CronTrigger {
  name: string
  schedule: string
  prompt: string
  projectPath: string
  permissionMode: string
  model: string
  enabled?: boolean
}

interface TriggersConfig {
  channels: Record<string, ChannelTrigger>
  slack?: Record<string, SlackTrigger>
  cron?: Record<string, CronTrigger>
}

const HOME = process.env.HOME || '/tmp'

// Config resolution order:
// 1. C3_CONFIG_DIR env var (explicit override)
// 2. ~/.c3/ (standard location, like ~/.claude/)
// 3. CWD (development)
function resolveConfigDir(): string {
  if (process.env.C3_CONFIG_DIR) {
    return process.env.C3_CONFIG_DIR
  }
  // Standard location: ~/.c3/
  const c3Dir = path.join(HOME, '.c3')
  if (fs.existsSync(path.join(c3Dir, 'triggers.json'))) {
    return c3Dir
  }
  // Development fallback
  return process.cwd()
}

const CONFIG_DIR = resolveConfigDir()
const TRIGGERS_PATH = path.join(CONFIG_DIR, 'triggers.json')
const PROMPTS_DIR = path.join(CONFIG_DIR, 'prompts')

let cachedConfig: TriggersConfig | null = null
let cachedMtime: number = 0

export function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => {
      const resolved = process.env[name]
      if (resolved === undefined) {
        console.warn(`[Config] Env var ${name} referenced in triggers.json is not set`)
        return _match
      }
      return resolved
    })
  }
  if (Array.isArray(value)) return value.map(expandEnvVars)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandEnvVars(v)
    }
    return out
  }
  return value
}

export function loadTriggersConfig(): TriggersConfig {
  try {
    const stat = fs.statSync(TRIGGERS_PATH)
    if (cachedConfig && stat.mtimeMs === cachedMtime) {
      return cachedConfig
    }
    const raw = fs.readFileSync(TRIGGERS_PATH, 'utf-8')
    cachedConfig = expandEnvVars(JSON.parse(raw)) as TriggersConfig
    cachedMtime = stat.mtimeMs
    return cachedConfig
  } catch {
    return { channels: {}, slack: {} }
  }
}

function resolveProjectPath(projectPath: string): string {
  return projectPath
    .replace(/^\$HOME\b/, HOME)
    .replace(/^~\//, HOME + '/')
    .replace(/^~$/, HOME)
}

export function getChannelTrigger(channelId: string): ChannelTrigger | null {
  const config = loadTriggersConfig()
  for (const trigger of Object.values(config.channels)) {
    if (trigger.channelId === channelId) {
      return { ...trigger, projectPath: resolveProjectPath(trigger.projectPath) }
    }
  }
  return null
}

export function getSlackTrigger(channelId: string): SlackTrigger | null {
  const config = loadTriggersConfig()
  if (!config.slack) return null
  for (const trigger of Object.values(config.slack)) {
    if (trigger.channelId === channelId) {
      return { ...trigger, projectPath: resolveProjectPath(trigger.projectPath) }
    }
  }
  return null
}

export function getAllSlackTriggers(): SlackTrigger[] {
  const config = loadTriggersConfig()
  if (!config.slack) return []
  return Object.values(config.slack)
}

export function getCronTrigger(name: string): CronTrigger | null {
  const config = loadTriggersConfig()
  if (!config.cron) return null
  const trigger = config.cron[name]
  if (!trigger) return null
  return { ...trigger, projectPath: resolveProjectPath(trigger.projectPath) }
}

export function getAllCronTriggers(): CronTrigger[] {
  const config = loadTriggersConfig()
  if (!config.cron) return []
  return Object.values(config.cron)
    .filter(t => t.enabled !== false)
    .map(t => ({ ...t, projectPath: resolveProjectPath(t.projectPath) }))
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
