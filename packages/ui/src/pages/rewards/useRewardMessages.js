import { useCallback, useState } from 'react'
import {
  useSailorAccount,
  useSailorAccounts,
  useSailorActivity,
  useSailorPositions,
} from '../../hooks/useSailorData'
import { applyDismissals, deriveRewardMessages } from './rewardMessages'
import { formatTokenAmount } from './rewardsHistory'

const STORAGE_KEY = 'sail.rewardMessages.dismissed'

function loadDismissed() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/**
 * Wire the reward messages to REAL detected on-chain events:
 *  - smaDeployed  ← an SMA exists on disk/chain, or an `sma_created` event,
 *  - mandateSigned ← a `permission_registered` activity entry,
 *  - firstDeposit ← a non-empty positions snapshot (AUM),
 *  - weekly       ← the most recent weekly bucket from on-chain Transfer logs.
 *
 * Dismissals persist in localStorage so a dismissed message does not re-fire.
 * `weeks` (from the rewards history) is passed in by the page so the weekly line
 * shows the amount that actually landed.
 */
export function useRewardMessages({ weeks = [], decimals = 18, symbol = 'SAIL' } = {}) {
  const { accounts } = useSailorAccounts()
  const { account } = useSailorAccount()
  const { events } = useSailorActivity()
  const { positions } = useSailorPositions()
  const [dismissed, setDismissed] = useState(loadDismissed)

  const smaDeployed =
    (Array.isArray(accounts) && accounts.length > 0) ||
    !!account ||
    events.some((e) => e.type === 'sma_created')
  const mandateSigned = events.some((e) => e.type === 'permission_registered')
  const firstDeposit = Array.isArray(positions) && positions.length > 0
  const latestWeek = weeks?.[0] ?? null
  const weeklyAmount = latestWeek ? formatTokenAmount(latestWeek.amountWei, decimals) : null

  const all = deriveRewardMessages({
    smaDeployed,
    mandateSigned,
    firstDeposit,
    weeklyAmount,
    weeklySymbol: symbol,
  })
  const messages = applyDismissals(all, dismissed)

  const dismiss = useCallback((key) => {
    setDismissed((prev) => {
      const next = [...new Set([...prev, key])]
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore storage failures — dismissal still holds for this session */
      }
      return next
    })
  }, [])

  return { messages, dismiss }
}
