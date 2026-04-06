'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState, useEffect, useRef } from 'react'
import { Card } from '@/components/ui/Card'
import { Logo } from '@/components/ui/Logo'

function LoginContent() {
  const searchParams = useSearchParams()
  const [sent, setSent] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState(searchParams.get('error') || '')
  const returnTo = searchParams.get('returnTo')

  const errorMessages: Record<string, string> = {
    expired: 'Link expired. Sending a new one...',
    missing_token: 'Invalid link. Sending a new one...',
  }

  const sentRef = useRef(false)
  useEffect(() => {
    if (sentRef.current) return
    sentRef.current = true

    const run = async () => {
      // Store returnTo server-side before sending the magic link
      if (returnTo) {
        await fetch('/api/auth/return-to', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ returnTo }),
        }).catch(() => {})
      }

      const res = await fetch('/api/auth/magic-link', { method: 'POST' })
      const data = await res.json()
      if (data.email) {
        setEmail(data.email)
        setSent(true)
        setError('')
      }
    }

    run().catch(() => setError('Connection error'))
  }, [returnTo])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="p-6 sm:p-8 w-full max-w-md text-center">
        <div className="flex justify-center mb-2">
          <Logo size={64} />
        </div>
        <p className="text-foreground-muted mb-8">
          Cloud Claude Code
        </p>

        {error && !sent && (
          <div className="bg-error/10 border border-error/30 text-error p-3 rounded-lg mb-6 text-sm">
            {errorMessages[error] || error}
          </div>
        )}

        {sent ? (
          <div>
            <p className="text-lg mb-2">Check your email</p>
            <p className="text-foreground-muted text-sm">
              Sign-in link sent to <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <p className="text-foreground-muted">Sending sign-in link...</p>
        )}
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-foreground-muted">Loading...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
