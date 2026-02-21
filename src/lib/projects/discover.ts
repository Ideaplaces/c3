import { readdirSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'

export interface DiscoveredProject {
  name: string
  path: string
}

function getScanDirs(): string[] {
  const raw = process.env.CCC_PROJECT_DIRS || ''
  return raw.split(',').map((d) => d.trim()).filter(Boolean)
}

export function discoverProjects(): DiscoveredProject[] {
  const scanDirs = getScanDirs()
  const projects: DiscoveredProject[] = []

  for (const dir of scanDirs) {
    if (!existsSync(dir)) continue

    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        const fullPath = join(dir, entry)
        try {
          const stat = statSync(fullPath)
          if (!stat.isDirectory()) continue
          if (entry.startsWith('.')) continue

          // Check for .git directory
          const gitDir = join(fullPath, '.git')
          if (existsSync(gitDir)) {
            projects.push({
              name: basename(fullPath),
              path: fullPath,
            })
          }
        } catch {
          // Skip entries we can't stat
        }
      }
    } catch {
      // Skip dirs we can't read
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name))
}
