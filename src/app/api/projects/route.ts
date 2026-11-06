import { NextResponse } from 'next/server'
import { discoverProjects, discoverWorkspaces } from '@/lib/projects/discover'
import { rankWorkspaces, readLedgerRuns } from '@/lib/projects/recent'

export async function GET() {
  const projects = discoverProjects()
  const workspaces = rankWorkspaces(discoverWorkspaces(), readLedgerRuns())
  return NextResponse.json({ projects, workspaces })
}
