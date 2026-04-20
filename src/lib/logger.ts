type LogLevel = 'info' | 'warn' | 'error'
type LogContext = Record<string, unknown>

function emit(level: LogLevel, message: string, ctx: LogContext = {}): void {
  const line = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...ctx,
  }
  const serialized = JSON.stringify(line)
  if (level === 'error') {
    process.stderr.write(serialized + '\n')
  } else {
    process.stdout.write(serialized + '\n')
  }
}

function serializeError(err: unknown): LogContext {
  if (err instanceof Error) {
    return {
      error: err.message,
      errorName: err.name,
      stack: err.stack,
    }
  }
  return { error: String(err) }
}

export const log = {
  info: (message: string, ctx?: LogContext) => emit('info', message, ctx),
  warn: (message: string, ctx?: LogContext) => emit('warn', message, ctx),
  error: (message: string, err?: unknown, ctx?: LogContext) =>
    emit('error', message, { ...(err !== undefined ? serializeError(err) : {}), ...ctx }),
}
