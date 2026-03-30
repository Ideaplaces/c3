import type { Metadata } from 'next'
import { Roboto, Montserrat, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const roboto = Roboto({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-roboto' })
const montserrat = Montserrat({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-montserrat' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-jetbrains' })

export const metadata: Metadata = {
  title: 'Cloud Claude Code',
  description: 'Claude Code in the browser — accessible from any device',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${roboto.variable} ${montserrat.variable} ${jetbrainsMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  )
}
