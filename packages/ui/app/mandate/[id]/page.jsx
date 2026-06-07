'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import MandatePage from '../../../src/pages/dashboard/MandatePage'

export default function MandateRoute({ params }) {
  const { id } = use(params)
  const router = useRouter()
  return (
    <MandatePage
      mandateId={id}
      onBack={() => router.push('/dashboard')}
      onRevoke={() => router.push('/dashboard')}
    />
  )
}
