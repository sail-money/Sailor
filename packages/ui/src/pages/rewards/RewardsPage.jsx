import { useEffect, useMemo, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { HorizonBackground, GlassCard, Sai, SailButton } from '../shared'
import PageHeader from '../shared/PageHeader'
import shared from '../shared/shared.module.css'
import styles from './RewardsPage.module.css'
import RewardMessages from './RewardMessagesPanel'
import { useSailorAccounts, useSailorAccount } from '../../hooks/useSailorData'
import {
  ERC20_REWARDS_ABI,
  isTokenConfigured,
  resolveFromBlock,
  resolveTokenAddress,
} from './rewardsConfig'
import {
  formatTokenAmount,
  groupTransfersByWeek,
  totalReceivedWei,
} from './rewardsHistory'
import * as copy from './rewardsCopy'

/**
 * $SAIL Rewards — a self-contained, additive page.
 *
 * ISOLATION: this module imports only shared design-system components, shared
 * data hooks, and its own pure config/copy/history modules. Nothing in the
 * operational dashboard imports from here; deleting `pages/rewards/` leaves the
 * dashboard working exactly as before (enforced by rewards-isolation.test.js).
 *
 * The balance and weekly history are read LIVE from the token (balanceOf +
 * inbound Transfer logs) — no indexer, only on-chain reality. The token address
 * comes from config (`resolveTokenAddress`), never hardcoded.
 */
export default function RewardsPage() {
  const { accounts } = useSailorAccounts()
  const { account: activeAccount } = useSailorAccount()
  const publicClient = usePublicClient()

  // Rewards land in the FIRST SMA the operator deployed.
  const firstSma = accounts?.[0]?.safe ?? activeAccount?.safe ?? null

  const tokenAddress = resolveTokenAddress()
  const configured = isTokenConfigured()

  const [balance, setBalance] = useState(null) // { raw: bigint, decimals, symbol }
  const [weeks, setWeeks] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!configured || !firstSma || !publicClient) {
      setBalance(null)
      setWeeks([])
      return
    }
    let alive = true
    setLoading(true)

    async function load() {
      try {
        const [raw, decimals, symbol] = await Promise.all([
          publicClient.readContract({
            address: tokenAddress,
            abi: ERC20_REWARDS_ABI,
            functionName: 'balanceOf',
            args: [firstSma],
          }),
          publicClient
            .readContract({ address: tokenAddress, abi: ERC20_REWARDS_ABI, functionName: 'decimals' })
            .catch(() => 18),
          publicClient
            .readContract({ address: tokenAddress, abi: ERC20_REWARDS_ABI, functionName: 'symbol' })
            .catch(() => 'SAIL'),
        ])
        if (alive) setBalance({ raw, decimals: Number(decimals), symbol })

        // Reconstruct what actually landed on-chain from inbound Transfer logs.
        const logs = await publicClient.getLogs({
          address: tokenAddress,
          event: ERC20_REWARDS_ABI.find((x) => x.type === 'event' && x.name === 'Transfer'),
          args: { to: firstSma },
          fromBlock: resolveFromBlock(),
          toBlock: 'latest',
        })
        // Resolve a timestamp per unique block (few inbound transfers in practice).
        const blockNumbers = [...new Set(logs.map((l) => l.blockNumber))]
        const tsByBlock = new Map()
        await Promise.all(
          blockNumbers.map(async (bn) => {
            try {
              const blk = await publicClient.getBlock({ blockNumber: bn })
              tsByBlock.set(bn, Number(blk.timestamp) * 1000)
            } catch {
              /* skip blocks we can't resolve */
            }
          }),
        )
        const transfers = logs
          .filter((l) => tsByBlock.has(l.blockNumber))
          .map((l) => ({ valueWei: l.args?.value ?? 0n, timestampMs: tsByBlock.get(l.blockNumber) }))
        if (alive) setWeeks(groupTransfersByWeek(transfers))
      } catch {
        // Live read unavailable (no RPC / wrong chain): show the empty state
        // rather than crash. The operational dashboard is unaffected regardless.
        if (alive) {
          setBalance(null)
          setWeeks([])
        }
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => {
      alive = false
    }
  }, [configured, firstSma, tokenAddress, publicClient])

  return (
    <div className={`${shared.pageShell} ${styles.shell}`}>
      <HorizonBackground />
      <PageHeader eyebrow={copy.TOKEN_NAME} title="Rewards" />
      <main className={styles.main}>
        {!firstSma ? <NoSmaState /> : (
          <div className={styles.grid}>
            <RewardMessages weeks={weeks} decimals={balance?.decimals} symbol={balance?.symbol} />
            <BalanceCard configured={configured} balance={balance} />
            <WeeklyCard loading={loading} weeks={weeks} balance={balance} configured={configured} />
            <AboutCard />
            <DestinationNote sma={firstSma} />
          </div>
        )}
      </main>
    </div>
  )
}

function NoSmaState() {
  return (
    <GlassCard className={styles.emptyCard}>
      <div className={styles.emptySai} aria-hidden>
        <Sai size={56} animate />
      </div>
      <h1 className={`${shared.displayHeadline} ${styles.emptyHeadline}`}>{copy.TOKEN_TAGLINE}</h1>
      <p className={styles.emptyBody}>{copy.EMPTY_NO_SMA}</p>
      <SailButton onClick={() => { window.location.hash = '#/dashboard' }}>
        Go to dashboard
      </SailButton>
    </GlassCard>
  )
}

function BalanceCard({ configured, balance }) {
  const amount = balance ? formatTokenAmount(balance.raw, balance.decimals) : '0'
  return (
    <GlassCard className={styles.balanceCard}>
      <div className={styles.balanceHead}>
        <span className={styles.kicker}>{copy.TOKEN_NAME} BALANCE</span>
        <span className={styles.nonTransferPill} title={copy.NON_TRANSFERABLE_NOTE}>
          {copy.NON_TRANSFERABLE_LABEL}
        </span>
      </div>
      {configured ? (
        <>
          <div className={styles.balanceAmount}>
            {amount}
            <span className={styles.balanceSymbol}>{balance?.symbol ?? 'SAIL'}</span>
          </div>
          <p className={styles.balanceNote}>{copy.NON_TRANSFERABLE_NOTE}</p>
        </>
      ) : (
        <p className={styles.balanceNote}>{copy.TOKEN_NOT_CONFIGURED}</p>
      )}
    </GlassCard>
  )
}

function WeeklyCard({ loading, weeks, balance, configured }) {
  const decimals = balance?.decimals ?? 18
  const total = totalReceivedWei(weeks)
  return (
    <GlassCard className={styles.weeklyCard}>
      <header className={styles.cardHead}>
        <h2 className={styles.cardTitle}>{copy.WEEKLY_HISTORY_TITLE}</h2>
        <p className={styles.cardSub}>{copy.WEEKLY_HISTORY_SUB}</p>
      </header>
      {!configured || weeks.length === 0 ? (
        <p className={styles.weeklyEmpty}>{loading ? 'Reading on-chain…' : copy.EMPTY_NO_REWARDS}</p>
      ) : (
        <>
          <ul className={styles.weeklyList}>
            {weeks.map((w) => (
              <li key={w.weekStartMs} className={styles.weeklyRow}>
                <span className={styles.weeklyWeek}>{w.weekLabel}</span>
                <span className={styles.weeklyAmount}>
                  +{formatTokenAmount(w.amountWei, decimals)} {balance?.symbol ?? 'SAIL'}
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.weeklyTotal}>
            <span>Total received</span>
            <span>{formatTokenAmount(total, decimals)} {balance?.symbol ?? 'SAIL'}</span>
          </div>
        </>
      )}
    </GlassCard>
  )
}

function AboutCard() {
  return (
    <GlassCard className={styles.aboutCard}>
      <header className={styles.cardHead}>
        <h2 className={styles.cardTitle}>About {copy.TOKEN_NAME}</h2>
      </header>
      <p className={styles.aboutBody}>{copy.TOKEN_WHAT_IS}</p>
      <p className={styles.aboutBody}>{copy.CAMPAIGN_HOW}</p>
      <p className={styles.aboutFact}>{copy.NON_TRANSFERABLE_TGE_FACT}</p>
    </GlassCard>
  )
}

function DestinationNote({ sma }) {
  const short = sma ? `${sma.slice(0, 10)}…${sma.slice(-6)}` : '—'
  return (
    <p className={styles.destination}>
      {copy.REWARDS_DESTINATION_NOTE} <code title={sma}>{short}</code>
    </p>
  )
}
