import { NextResponse } from 'next/server'
import { discoverProjects } from '@/lib/projects/discover'

export async function GET() {
  const projects = discoverProjects()
  return NextResponse.json({ projects })
}
