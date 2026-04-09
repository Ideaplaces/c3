import type { Metadata, Viewport } from 'next'
import { Roboto, Montserrat, JetBrains_Mono } from 'next/font/google'
import { PostHogProvider } from './posthog-provider'
import './globals.css'

const roboto = Roboto({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-roboto' })
const montserrat = Montserrat({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-montserrat' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-jetbrains' })

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'C3 — Claude Code, from any browser',
  description: 'Remote Claude Code sessions and autonomous agents triggered by Discord and Slack. Open source.',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'C3 — Claude Code, from any browser',
    description: 'Remote Claude Code sessions and autonomous agents triggered by Discord and Slack. Open source.',
    siteName: 'C3',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${roboto.variable} ${montserrat.variable} ${jetbrainsMono.variable} antialiased`}>
        <PostHogProvider>
          {children}
        </PostHogProvider>
      </body>
    </html>
  )
}
