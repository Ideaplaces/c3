'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'

function LoginContent() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(searchParams.get('error') || '')
  const [loading, setLoading] = useState(false)

  const errorMessages: Record<string, string> = {
    expired: 'Link expired. Request a new one.',
    missing_token: 'Invalid link. Request a new one.',
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setSent(true)
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="card p-6 sm:p-8 w-full max-w-md text-center">
        <h1 className="text-3xl font-bold mb-2 font-heading">
          <span className="text-gradient">C3</span>
        </h1>
        <p className="text-foreground-muted mb-8">
          Cloud Claude Code
        </p>

        {error && (
          <div className="badge-error p-3 rounded-lg mb-6 text-sm">
            {errorMessages[error] || error}
          </div>
        )}

        {sent ? (
          <div>
            <p className="text-lg mb-2">Check your email</p>
            <p className="text-foreground-muted text-sm mb-6">
              We sent a sign-in link to <strong>{email}</strong>
            </p>
            <button
              onClick={() => { setSent(false); setEmail('') }}
              className="text-sm text-brand hover:underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              autoFocus
              required
              className="w-full px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-900 mb-4 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
            />
            <button
              type="submit"
              disabled={loading || !email}
              className="btn btn-primary w-full py-3 px-6 text-lg"
            >
              {loading ? 'Sending...' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
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
