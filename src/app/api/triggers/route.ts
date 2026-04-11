import fs from 'fs'
import path from 'path'
import {
  loadTriggersConfig,
  getAllCronTriggers,
  getAllSlackTriggers,
} from '@/lib/triggers/config'

const HOME = process.env.HOME || '/tmp'

function resolvePromptsDir(): string {
  if (process.env.C3_CONFIG_DIR) {
    return path.join(process.env.C3_CONFIG_DIR, 'prompts')
  }
  const c3Dir = path.join(HOME, '.c3')
  if (fs.existsSync(path.join(c3Dir, 'prompts'))) {
    return path.join(c3Dir, 'prompts')
  }
  return path.join(process.cwd(), 'prompts')
}

export async function GET() {
  const config = loadTriggersConfig()
  const promptsDir = resolvePromptsDir()

  // Cron triggers
  const cronTriggers = getAllCronTriggers().map((t) => ({
    ...t,
    type: 'cron' as const,
  }))

  // Slack triggers
  const slackTriggers = getAllSlackTriggers().map((t) => ({
    name: t.name,
    type: 'slack' as const,
    channelId: t.channelId,
    prompt: t.prompt,
    projectPath: t.projectPath,
    permissionMode: t.permissionMode,
    model: t.model,
    pollIntervalMs: (t as unknown as Record<string, unknown>).pollIntervalMs as number | undefined,
  }))

  // Discord triggers
  const discordTriggers = Object.values(config.channels || {}).map((t) => ({
    name: t.name,
    type: 'discord' as const,
    channelId: t.channelId,
    prompt: t.prompt,
    projectPath: t.projectPath,
    permissionMode: t.permissionMode,
    model: t.model,
  }))

  // Load prompt contents
  const promptFiles: Record<string, string> = {}
  const allPromptNames = new Set([
    ...cronTriggers.map((t) => t.prompt),
    ...slackTriggers.map((t) => t.prompt),
    ...discordTriggers.map((t) => t.prompt),
  ])

  for (const promptName of allPromptNames) {
    try {
      const fullPath = path.isAbsolute(promptName)
        ? promptName
        : path.join(promptsDir, promptName)
      promptFiles[promptName] = fs.readFileSync(fullPath, 'utf-8')
    } catch {
      promptFiles[promptName] = '(prompt file not found)'
    }
  }

  return Response.json({
    triggers: [...cronTriggers, ...slackTriggers, ...discordTriggers],
    prompts: promptFiles,
  })
}
