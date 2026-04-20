import { NextRequest, NextResponse } from 'next/server'
import { log } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Level = 'info' | 'warn' | 'error'

const ALLOWED_LEVELS: Level[] = ['info', 'warn', 'error']
const MAX_FIELD_LEN = 4000

function clamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.length > MAX_FIELD_LEN ? value.slice(0, MAX_FIELD_LEN) : value
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const levelRaw = typeof body.level === 'string' ? body.level.toLowerCase() : 'error'
  const level = (ALLOWED_LEVELS as string[]).includes(levelRaw) ? (levelRaw as Level) : 'error'
  const message = clamp(body.message) ?? 'client error'
  const stack = clamp(body.stack)
  const url = clamp(body.url)
  const userAgent = clamp(body.userAgent)
  const context =
    typeof body.context === 'object' && body.context !== null && !Array.isArray(body.context)
      ? (body.context as Record<string, unknown>)
      : undefined

  const forwardedIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  const emitCtx = {
    source: 'client',
    url,
    userAgent,
    stack,
    clientIp: forwardedIp,
    ...(context ?? {}),
  }

  if (level === 'error') {
    log.error(message, undefined, emitCtx)
  } else if (level === 'warn') {
    log.warn(message, emitCtx)
  } else {
    log.info(message, emitCtx)
  }

  return NextResponse.json({ ok: true })
}
