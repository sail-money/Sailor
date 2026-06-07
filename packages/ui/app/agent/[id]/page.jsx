'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import AgentPage from '../../../src/pages/dashboard/AgentPage'

export default function AgentRoute({ params }) {
  const { id } = use(params)
  const router = useRouter()
  return (
    <AgentPage
      agentId={id}
      onBack={() => router.push('/dashboard')}
      onEdit={() => router.push(`/dashboard?edit=${id}`)}
      onRevoke={() => router.push('/dashboard')}
    />
  )
}
