import type { Metadata } from 'next'
import { Inter, Lora } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
})

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-heading',
})

export const metadata: Metadata = {
  title: 'SentinelRAG',
  description: 'Production-grade RAG system with inspectable retrieval',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${lora.variable}`}>{children}</body>
    </html>
  )
}
