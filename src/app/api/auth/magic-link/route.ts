import { signToken } from '@/lib/auth/jwt'
import { Resend } from 'resend'
import { headers } from 'next/headers'

const ALLOWED_EMAILS = (process.env.CCC_ALLOWED_EMAILS || '').split(',').map(e => e.trim().toLowerCase())

// Dedup: prevent double sends from React re-renders
const lastSentAt = new Map<string, number>()
const DEDUP_WINDOW_MS = 30_000

export async function POST() {
  const email = ALLOWED_EMAILS[0]
  if (!email) {
    return Response.json({ error: 'No allowed email configured' }, { status: 500 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'Email not configured' }, { status: 500 })
  }

  // Dedup check
  const now = Date.now()
  const prev = lastSentAt.get(email) || 0
  if (now - prev < DEDUP_WINDOW_MS) {
    return Response.json({ ok: true, email })
  }
  lastSentAt.set(email, now)

  const headersList = await headers()
  const host = headersList.get('host') || 'localhost:8347'
  const proto = headersList.get('x-forwarded-proto') || 'https'
  const baseUrl = `${proto}://${host}`

  const token = signToken({ email, name: email.split('@')[0], avatarUrl: null })
  const magicUrl = `${baseUrl}/api/auth/magic-link/verify?token=${token}`

  console.log(`[Magic Link] Sending to ${email}`)

  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: process.env.C3_FROM_EMAIL || 'C3 <noreply@localhost>',
    to: email,
    subject: 'Sign in to C3',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="margin: 0 0 8px 0;">C3</h2>
        <p style="color: #666; margin: 0 0 32px 0;">Cloud Claude Code</p>
        <a href="${magicUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 500;">Sign in</a>
        <p style="color: #999; font-size: 13px; margin-top: 32px;">This link expires in 30 days.</p>
      </div>
    `,
  })

  return Response.json({ ok: true, email })
}
