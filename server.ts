import { createServer } from 'http'
import { parse } from 'url'
import fs from 'fs'
import path from 'path'
import next from 'next'
import { WebSocketServer } from 'ws'
import { verifyToken } from './src/lib/auth/jwt.js'
import { handleConnection } from './src/lib/ws/handler.js'

// Load .env.local into process.env. Next.js loads env files for its own code
// paths, but webhook route handlers (src/app/api/webhooks/*) read process.env
// directly and, for custom servers, not every key reliably makes it through.
// Missing SLACK_BOT_TOKEN / DISCORD_BOT_TOKEN silently disables the bot-token
// gate in the Slack webhook handler, which is how five alerts-backend-prod
// replies and Nicoleta's intercom reply went missing on Apr 22-24.
try {
  const envPath = path.join(process.cwd(), '.env.local')
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
} catch {
  // .env.local not found; rely on the process environment.
}

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '8347', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true)
    handle(req, res, parsedUrl)
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const { pathname, query } = parse(request.url!, true)
    console.log(`[WS] Upgrade request: ${pathname}`)

    if (pathname !== '/ws') {
      socket.destroy()
      return
    }

    const token = query.token as string | undefined
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    const user = verifyToken(token)
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    console.log(`[WS] Authenticated: ${user.email}`)
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
      handleConnection(ws, user)
    })
  })

  server.listen(port, hostname, () => {
    console.log(`> C3 server ready on http://${hostname}:${port}`)
  })
})
