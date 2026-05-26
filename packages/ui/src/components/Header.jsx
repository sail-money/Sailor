import { useState, useEffect, useRef } from 'react'
import styles from './Header.module.css'
import Button from './Button'

const productHero = {
  label: 'SMAs',
  tagline: 'Separately Managed Accounts',
  description:
    'Onchain accounts where allocators keep self-custody while managers operate under bounded, revocable delegation.',
  icon: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="14" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M8 15h4" />
    </svg>
  ),
}

const productsLive = [
  {
    label: 'Yield Agent',
    description: 'Autonomous yield optimization',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="15 7 21 7 21 13" />
      </svg>
    ),
  },
  {
    label: 'Security Agent (Sonar)',
    description: 'Continuous on-chain risk monitoring',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
]

const productsComingSoon = [
  {
    label: 'Tax optimization agent',
    description: 'Loss harvesting and cost basis tracking.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M8 8h8M8 12h6M8 16h4" />
      </svg>
    ),
  },
  {
    label: 'Portfolio construction agent',
    description: 'Risk-targeted allocation across DeFi venues.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v9l6 4" />
      </svg>
    ),
  },
  {
    label: 'Data & analytics layer',
    description: 'Positions, PnL, and exposure for any Safe.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V8M10 20V4M16 20v-9M22 20v-5" />
      </svg>
    ),
  },
  {
    label: 'Trading & structured products',
    description: 'Options, perps, and principal-protected vaults.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l5-5 4 4 8-8" />
        <path d="M14 8h6v6" />
      </svg>
    ),
  },
]

const resources = [
  {
    label: 'Docs',
    description: 'Guides, integration, and API reference',
    href: 'https://docs.sail.money',
    external: true,
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <line x1="9" y1="9" x2="15" y2="9" />
        <line x1="9" y1="13" x2="13" y2="13" />
      </svg>
    ),
  },
  {
    label: 'Support',
    description: 'Get help from the Sail team',
    href: '#contact',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9z" />
        <path d="M9 10h.01M12 10h.01M15 10h.01" />
      </svg>
    ),
  },
]

const mobileLinks = [
  { key: 'about',        label: 'About',                       href: '#about' },
  { key: 'sma',          label: 'SMAs',                        href: '#contact', section: 'Products' },
  { key: 'yield',        label: 'Yield Agent',                 href: '#contact' },
  { key: 'security',     label: 'Security Agent (Sonar)',      href: '#contact' },
  { key: 'docs',         label: 'Docs',                        href: 'https://docs.sail.money', external: true, section: 'Resources' },
  { key: 'support',      label: 'Support',                     href: '#contact' },
  { key: 'contact',      label: 'Contact',                     href: '#contact' },
]

function Header({ onOpenProtocol, onOpenIntelligence, onContact }) {
  const handleContactClick = (e) => {
    if (e) e.preventDefault()
    if (onContact) onContact()
  }
  const [productsOpen, setProductsOpen] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const lastScrollY = useRef(0)
  const productsTimer = useRef(null)
  const resourcesTimer = useRef(null)

  const openProducts  = () => { clearTimeout(productsTimer.current);  setProductsOpen(true) }
  const closeProducts = () => { productsTimer.current  = setTimeout(() => setProductsOpen(false),  200) }
  const openResources  = () => { clearTimeout(resourcesTimer.current); setResourcesOpen(true) }
  const closeResources = () => { resourcesTimer.current = setTimeout(() => setResourcesOpen(false), 200) }

  useEffect(() => {
    const onScroll = () => {
      const currentY = window.scrollY
      const delta = currentY - lastScrollY.current
      if (delta > 6 && currentY > 80) {
        setHidden(true)
      } else if (delta < -4) {
        setHidden(false)
      }
      lastScrollY.current = currentY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const ProductDropdown = ({ open }) => (
    <div className={`${styles.dropdown} ${styles.dropdownWide} ${open ? styles.dropdownOpen : ''}`}>
      <div className={styles.dropdownNotch} aria-hidden="true" />

      {/* ── Sail Protocol — SMAs hero ────────────────────────── */}
      <div className={styles.dropdownSectionLabel}>Sail Protocol</div>
      <a href="#" onClick={handleContactClick} className={`${styles.productItem} ${styles.productItemHero}`}>
        <div className={styles.productHeroIcon}>{productHero.icon}</div>
        <div className={styles.productText}>
          <span className={styles.productHeroLabel}>{productHero.label}</span>
          <span className={styles.productHeroTagline}>{productHero.tagline}</span>
          <span className={styles.productHeroDesc}>{productHero.description}</span>
        </div>
      </a>

      <div className={styles.dropdownDivider} aria-hidden="true" />

      {/* ── Sail Intelligence — agent catalog ────────────────── */}
      <div className={styles.dropdownSectionLabel}>Sail Intelligence</div>
      <div className={styles.dropdownGrid}>
        {productsLive.map(item => (
          <a key={item.label} href="#" onClick={handleContactClick} className={styles.productItem}>
            <div className={styles.productIcon}>{item.icon}</div>
            <div className={styles.productText}>
              <span className={styles.productLabel}>{item.label}</span>
              <span className={styles.productDesc}>{item.description}</span>
            </div>
          </a>
        ))}
      </div>

      <div className={styles.dropdownDivider} aria-hidden="true" />
      <div className={styles.dropdownSectionLabel}>Sail Intelligence — Coming Soon</div>
      <div className={styles.dropdownGrid}>
        {productsComingSoon.map(item => (
          <a key={item.label} href="#" onClick={handleContactClick} className={`${styles.productItem} ${styles.productItemSoon}`}>
            <div className={styles.productIcon}>{item.icon}</div>
            <div className={styles.productText}>
              <span className={styles.productLabel}>{item.label}</span>
              <span className={styles.productDesc}>{item.description}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )

  const ResourcesDropdown = ({ open }) => (
    <div className={`${styles.dropdown} ${open ? styles.dropdownOpen : ''}`}>
      <div className={styles.dropdownNotch} aria-hidden="true" />
      <div className={styles.dropdownSectionLabel}>Resources</div>
      <div className={styles.dropdownGrid}>
        {resources.map(item => (
          <a
            key={item.label}
            href={item.href}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noopener noreferrer' : undefined}
            className={styles.productItem}
          >
            <div className={styles.productIcon}>{item.icon}</div>
            <div className={styles.productText}>
              <span className={styles.productLabel}>{item.label}</span>
              <span className={styles.productDesc}>{item.description}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  )

  return (
    <>
    <header className={`${styles.header} ${hidden ? styles.hidden : ''}`}>
      <div className={styles.container}>
        <a href="/" className={styles.logo}>Sail</a>

        <nav className={styles.nav}>
          {/* About */}
          <a href="#about" className={styles.navLink}>About</a>

          {/* Products dropdown */}
          <div
            className={styles.productsWrapper}
            onMouseEnter={openProducts}
            onMouseLeave={closeProducts}
          >
            <button
              className={`${styles.navLink} ${styles.productsToggle} ${productsOpen ? styles.productsActive : ''}`}
              aria-expanded={productsOpen}
              aria-haspopup="true"
            >
              Products
              <svg className={`${styles.chevron} ${productsOpen ? styles.chevronUp : ''}`} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <polyline points="2 4 6 8 10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <ProductDropdown open={productsOpen} />
          </div>

          {/* Resources dropdown */}
          <div
            className={styles.productsWrapper}
            onMouseEnter={openResources}
            onMouseLeave={closeResources}
          >
            <button
              className={`${styles.navLink} ${styles.productsToggle} ${resourcesOpen ? styles.productsActive : ''}`}
              aria-expanded={resourcesOpen}
              aria-haspopup="true"
            >
              Resources
              <svg className={`${styles.chevron} ${resourcesOpen ? styles.chevronUp : ''}`} width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <polyline points="2 4 6 8 10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <ResourcesDropdown open={resourcesOpen} />
          </div>

          {/* Contact */}
          <a href="#contact" onClick={handleContactClick} className={styles.navLink}>Contact</a>
        </nav>

        <div className={styles.actions}>
          <Button variant="primary" magnetic onClick={handleContactClick}>Talk to us</Button>
          <button
            className={styles.hamburger}
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
              <line x1="3" y1="6"  x2="21" y2="6"  stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </header>

      {/* Mobile side drawer */}
      <div
        className={`${styles.drawerOverlay} ${menuOpen ? styles.drawerOverlayOpen : ''}`}
        onClick={() => setMenuOpen(false)}
      />
      <div className={`${styles.drawer} ${menuOpen ? styles.drawerOpen : ''}`}>
        <a href="/" className={styles.drawerLogo}>Sail</a>
        <nav className={styles.drawerNav}>
          {mobileLinks.map(({ key, href, label, section, external }) => (
            <span key={key} className={styles.drawerItem}>
              {section && (
                <span className={styles.drawerSection}>{section}</span>
              )}
              <a
                href={href || '#'}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                className={styles.drawerLink}
                onClick={(e) => {
                  if (href === '#contact') { e.preventDefault(); handleContactClick(); }
                  setMenuOpen(false)
                }}
              >
                {label}
              </a>
            </span>
          ))}
        </nav>
        <Button variant="primary" magnetic className={styles.drawerBtn} onClick={(e) => { handleContactClick(e); setMenuOpen(false) }}>Talk to us</Button>
      </div>
    </>
  )
}

export default Header
