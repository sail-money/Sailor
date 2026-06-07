'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import JournalPage from '../../../src/pages/dashboard/JournalPage'

export default function JournalRoute({ params }) {
  const { id } = use(params)
  const router = useRouter()
  return (
    <JournalPage
      entryId={id}
      onBack={() => router.push('/dashboard')}
    />
  )
}
