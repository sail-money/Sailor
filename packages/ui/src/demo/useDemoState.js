import { useEffect, useState } from 'react'
import { parseIncomingMandate } from './demoStates'

/**
 * Reads the `demo` query string from the current hash, plus any related
 * params used by the `incoming` state. Updates when the hash changes.
 *
 *   '#/dashboard?demo=full'                 → { demo: 'full' }
 *   '#/signing?demo=login'                  → { demo: 'login' }
 *   '#/dashboard?demo=incoming&ai=Claude…'  → { demo: 'incoming', incoming: { … } }
 */
export function useDemoState() {
  const [state, setState] = useState(readDemoState)

  useEffect(() => {
    const onChange = () => setState(readDemoState())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return state
}

function readDemoState() {
  if (typeof window === 'undefined') return { demo: null, incoming: null, raw: null }
  const hash = window.location.hash.replace(/^#/, '')
  const qIdx = hash.indexOf('?')
  if (qIdx < 0) return { demo: null, incoming: null, raw: null }
  const params = new URLSearchParams(hash.slice(qIdx + 1))
  const demo = params.get('demo')
  const incoming = parseIncomingMandate(params)
  return { demo, incoming, raw: params }
}
