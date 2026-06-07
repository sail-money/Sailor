'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Root → dashboard. The marketing landing lives at /landing.
// With output: 'export', the root html is generated statically and a
// tiny client redirect runs on first paint.
export default function RootPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard')
  }, [router])
  return null
}
