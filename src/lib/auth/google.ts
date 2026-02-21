import { Google } from 'arctic'

function getGoogleClient(): Google {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:8347'
  const redirectUri = `${baseUrl}/api/auth/google/callback`

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set')
  }

  return new Google(clientId, clientSecret, redirectUri)
}

export { getGoogleClient }

export interface GoogleUser {
  googleId: string
  email: string
  name: string
  avatarUrl: string | null
}

export async function getGoogleUser(accessToken: string): Promise<GoogleUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Google user info: ${response.status}`)
  }

  const data = await response.json()

  return {
    googleId: data.id,
    email: data.email,
    name: data.name,
    avatarUrl: data.picture || null,
  }
}
