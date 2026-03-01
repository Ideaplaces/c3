export type SessionStatus = 'running' | 'idle' | 'completed' | 'error'

export interface SessionMeta {
  id: string
  projectPath: string
  projectName: string
  machineName: string
  status: SessionStatus
  permissionMode: string
  model: string
  createdAt: string
  updatedAt: string
  turnCount: number
  totalCostUsd: number
  firstPrompt: string
  lastPrompt: string
  errorMessage?: string
}
