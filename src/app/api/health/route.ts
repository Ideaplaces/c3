import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ status: 'ok', mode: process.env.C3_MODE || 'full' })
}
