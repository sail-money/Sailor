import '../src/styles/globals.css'

export const metadata = {
  title: 'Sail · Local Dashboard',
  description:
    'Sail local dashboard — your AI-managed onchain SMA, running on your machine.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
  themeColor: '#000000',
}

export default function RootLayout({ children }) {
  // The dashboard ships as a static export inside the Sail Skill
  // package — every page is rendered with `'use client'` boundaries
  // below this root. We just hold the document shell + global CSS.
  return (
    <html lang="en" style={{ colorScheme: 'dark' }}>
      <body>{children}</body>
    </html>
  )
}
