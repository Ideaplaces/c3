import { NextResponse } from 'next/server'
import { getAllSessions } from '@/lib/store/sessions'

export async function GET() {
  const sessions = getAllSessions()
  return NextResponse.json({ sessions })
}
