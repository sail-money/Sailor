import { useState, useRef, useEffect } from 'react'
import styles from './FAQ.module.css'

const faqs = [
  {
    question: 'What is Sail?',
    answer: 'Sail is SMA infrastructure for DeFi. We turn any Safe into a non-custodial Separately Managed Account: the user\'s Safe holds the assets, the mandate is enforced by code at calldata level, fees settle atomically, and revocation is one transaction.'
  },
  {
    question: 'Is Sail custodial?',
    answer: 'No. Sail is fully non-custodial. The subject account or Safe always holds the assets — Sail never holds keys or funds. The protocol authorizes execution at the policy boundary; it does not become the custodian.'
  },
  {
    question: 'What does Sail offer?',
    answer: 'Two products. Sail Protocol — the open, non-custodial standard for onchain SMAs. Sail Intelligence — a catalog of execution and risk agents that run on the protocol, including the Yield Agent and the Sonar Security Agent, with tax, portfolio, analytics, and structured-product agents on the roadmap.'
  },
  {
    question: 'How are mandates enforced?',
    answer: 'Every transaction a manager submits is checked at runtime by the kernel and the constraint VM: routes, selectors, calldata, return data, value, gas, approvals, and workflow structure. If the call sits outside the mandate, the chain rejects it.'
  },
  {
    question: 'Who can be a manager?',
    answer: 'Any human, autonomous agent, institution, curator, or application — bounded by the same session, policy, and revocation rules. Managers sign delegated execution; they cannot exceed the active mandate at the policy layer.'
  },
  {
    question: 'How does revocation work?',
    answer: 'Onchain. Sessions, signers, policies, registry routes, transfer targets, workflows, and versions can be paused, revoked, disabled, replaced, or expired through explicit state changes — typically in seconds, one transaction. Written notice is not a primitive that fits machine-speed execution.'
  },
  {
    question: 'How are fees handled?',
    answer: 'Through the FeeKernel. Fee hooks accrue and settle atomically with execution, separated into base, protocol, and distributor buckets. Performance, management, and distributor splits are coordinated onchain, and protected principal is not charged as feeable profit.'
  },
  {
    question: 'Which networks does Sail support?',
    answer: 'Sail Intelligence currently runs across Base, Arbitrum, and Ethereum. Sonar monitors 143 vaults across those networks today.'
  },
  {
    question: 'Is the protocol audited?',
    answer: 'Audit is in progress with a top-tier security firm. Until those results land we operate with internal review, fork-test gates, evidence reports, and conservative deployment configurations.'
  },
  {
    question: 'Who is Sail for?',
    answer: 'Two actors. Managers — funds, advisors, DeFi curators, distribution platforms (wallets, neobanks, fintechs), and autonomous agents managing capital on someone else\'s behalf. Allocators — treasuries, family offices, HNW individuals, retail through SMA distribution, and autonomous agents that need separation, transparency, and revocability.'
  }
]

function FAQItem({ faq, index, isOpen, onToggle, isRevealed }) {
  return (
    <div className={`${styles.faqItem} ${isRevealed ? styles.revealed : ''}`}>
      <button
        type="button"
        className={`${styles.question} ${isOpen ? styles.questionOpen : ''}`}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span className={styles.questionText}>{faq.question}</span>
        <span className={styles.icon} aria-hidden="true">
          {isOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          )}
        </span>
      </button>

      {isOpen && (
        <div className={styles.answerContainer}>
          <div className={styles.answer}>
            {faq.answer}
          </div>
        </div>
      )}
    </div>
  )
}

function FAQ() {
  const [openIndex, setOpenIndex] = useState(0)
  const sectionRef = useRef(null)
  const [revealedItems, setRevealedItems] = useState([])

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          faqs.forEach((_, index) => {
            setTimeout(() => {
              setRevealedItems(prev => [...prev, index])
            }, index * 80)
          })
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )

    if (sectionRef.current) {
      observer.observe(sectionRef.current)
    }

    return () => observer.disconnect()
  }, [])

  const handleToggle = (index) => {
    setOpenIndex(prevIndex => prevIndex === index ? null : index)
  }

  return (
    <section className={styles.faq} ref={sectionRef}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h2 className={styles.title}>FAQ</h2>
        </div>

        <div className={styles.chatHeader}>
          <span className={styles.teamName}>Team Sail</span>
          <span className={styles.timestamp}>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        <div className={styles.chatContainer}>
          {faqs.map((faq, index) => (
            <FAQItem
              key={index}
              faq={faq}
              index={index}
              isOpen={openIndex === index}
              onToggle={() => handleToggle(index)}
              isRevealed={revealedItems.includes(index)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

export default FAQ
