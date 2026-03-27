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

const HOME = process.env.HOME || '/tmp'

// Config resolution order:
// 1. C3_CONFIG_DIR env var (explicit override)
// 2. Sibling c3-data/ directory (user symlinks this to their config repo)
// 3. ~/.c3/ (fallback)
// 4. CWD (development)
function resolveConfigDir(): string {
  if (process.env.C3_CONFIG_DIR) {
    return process.env.C3_CONFIG_DIR
  }
  // Check for sibling c3-data/ directory
  // Users symlink this to their own config repo (e.g., c3-chip, c3-luca)
  const parentDir = path.dirname(process.cwd())
  const siblingPath = path.join(parentDir, 'c3-data')
  if (fs.existsSync(path.join(siblingPath, 'triggers.json'))) {
    return siblingPath
  }
  // Fallback to ~/.c3/
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
