import { setReturnTo, sanitizeReturnTo } from '@/lib/auth/return-to'

export async function POST(request: Request) {
  try {
    const { returnTo } = await request.json()
    const safe = sanitizeReturnTo(returnTo)
    setReturnTo('_pending', safe)
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
}
