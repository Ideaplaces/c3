import { fireCronTrigger } from '@/lib/triggers/fire'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CCC_WEBHOOK_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { triggerName, schedule, timestamp } = body

  if (!triggerName) {
    return Response.json({ error: 'Missing triggerName' }, { status: 400 })
  }

  const { status, body: result } = await fireCronTrigger(triggerName, { kind: 'clock', chain: [], schedule, timestamp })
  return Response.json(result, { status })
}
