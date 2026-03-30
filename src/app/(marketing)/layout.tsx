import Link from 'next/link'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const isFullMode = process.env.C3_MODE !== 'marketing'

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border px-4 sm:px-8 py-4 relative">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold font-heading">
            <span className="text-gradient">C3</span>
          </Link>
          <div className="flex items-center gap-4 sm:gap-6">
            <Link href="/docs" className="text-sm text-foreground-muted hover:text-foreground transition-colors hidden sm:inline">
              Docs
            </Link>
            <a
              href="https://github.com/Ideaplaces/c3"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-foreground-muted hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            {isFullMode && (
              <Link
                href="/sessions"
                className="inline-flex items-center justify-center font-semibold rounded-md transition-all duration-200 bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary-dark px-4 py-2 text-sm"
              >
                Open App
              </Link>
            )}
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-secondary to-primary opacity-30" />
      </nav>

      {/* Content */}
      <main className="flex-1">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-border px-4 sm:px-8 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-foreground-muted">
          <div>Built by <a href="https://ideaplaces.com" className="text-foreground hover:text-primary transition-colors">IdeaPlaces</a></div>
          <div>Claude Code SDK + Next.js 15 + React 19</div>
        </div>
      </footer>
    </div>
  )
}
