import jwt from 'jsonwebtoken'
import type { UserPayload } from '@/types/ws'

function getSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET must be set')
  }
  return secret
}

export function signToken(payload: UserPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '30d' })
}

export function verifyToken(token: string): UserPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret()) as UserPayload
    return {
      email: decoded.email,
      name: decoded.name,
      avatarUrl: decoded.avatarUrl,
    }
  } catch {
    return null
  }
}
