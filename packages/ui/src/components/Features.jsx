import ShaderCanvas from './ShaderCanvas'
import styles from './Features.module.css'

const MANAGERS = {
  title: 'Managers',
  desc: "Funds, advisors, curators, and agents — anyone who manages capital on someone else's behalf.",
  who: [
    'Crypto funds running SMAs for LPs',
    'DeFi curators',
    'Registered Investment Advisors',
    'Distribution platforms — wallets, neobanks, fintechs',
    'Autonomous agents',
  ],
  cta: 'Become a manager',
}

const ALLOCATORS = {
  title: 'Allocators',
  desc: 'The capital that needs separation, transparency, and revocability — onchain.',
  who: [
    'Treasuries',
    'Family offices and HNW individuals',
    'Retail through onchain SMA distribution',
    'Autonomous agents',
  ],
  cta: 'Become an allocator',
}

function ArrowBadge() {
  return (
    <span className={styles.arrowBadge} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function ActorCard({ data, mode, seed, tilt, onContact }) {
  return (
    <article className={styles.card}>
      <div className={styles.cardBg}>
        <ShaderCanvas mode={mode} seed={seed} tilt={tilt} />
      </div>
      <div className={styles.cardContent}>
        <div className={styles.cardTextBg} aria-hidden="true" />
        <div className={styles.cardBottom}>
          <h3 className={styles.cardTitle}>{data.title}</h3>
          <div className={styles.cardReveal}>
            <div className={styles.cardRevealInner}>
              <p className={styles.cardDesc}>{data.desc}</p>
              <span className={styles.cardSubLabel}>FOR...</span>
              <ul className={styles.cardList}>
                {data.who.map((item) => (
                  <li key={item} className={styles.cardItem}>
                    <ArrowBadge />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button type="button" className={styles.cardCta} onClick={onContact}>
                {data.cta}
                <svg className={styles.cardCtaArrow} viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
                    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

export default function Features({ onContact }) {
  return (
    <section className={styles.features}>
      <div className={styles.container}>
        <h2 className={styles.title}>
          Two types of users. <em className={styles.titleAccent}>One protocol between them.</em>
        </h2>

        <div className={styles.cards}>
          <ActorCard data={MANAGERS}   mode={3} seed={0.4} tilt={0}    onContact={onContact} />
          <ActorCard data={ALLOCATORS} mode={4} seed={1.7} tilt={0.6}  onContact={onContact} />
        </div>
      </div>
    </section>
  )
}
