import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Inventory MCP Server',
  description: 'Auth0-protected MCP server for inventory management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
