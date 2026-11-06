import { NextResponse, type NextRequest } from 'next/server'
import { listSessions } from '@/lib/store/sessions'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const scope = params.get('scope') === 'all' ? 'all' : 'web'
  const asked = Number(params.get('limit'))
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT
  return NextResponse.json({ sessions: listSessions({ scope, limit }) })
}
