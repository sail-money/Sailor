import { useState, useEffect } from 'react'
import Header from './components/Header'
import Partners from './components/Partners'
import OptimizationEngine from './components/OptimizationEngine'
import SailProtocolSection from './components/SailProtocolSection'
import Features from './components/Features'
import FAQ from './components/FAQ'
import CTA from './components/CTA'
import Footer from './components/Footer'
import AmbientBackground from './components/AmbientBackground'
import OurProducts from './components/OurProducts'
import ScrollProgress from './components/ScrollProgress'
import WaterFloatingUI from './components/WaterFloatingUI'
import ContactPage from './components/ContactPage'
import styles from './App.module.css'

function App() {
  const [page, setPage] = useState('landing')

  // Route every product CTA to the unified contact page
  const openContact = () => setPage('contact')

  // Scroll back to top whenever we switch pages
  useEffect(() => {
    if (page === 'contact') window.scrollTo({ top: 0, behavior: 'instant' })
  }, [page])

  if (page === 'contact') return <ContactPage onBack={() => setPage('landing')} />

  return (
    <>
      <AmbientBackground />
      <Header
        onOpenProtocol={openContact}
        onOpenIntelligence={openContact}
        onContact={openContact}
      />
      <ScrollProgress />

      {/* Hero */}
      <div id="section-hero" className={styles.heroCard} data-card-index="0">
        <WaterFloatingUI onContact={openContact} />
      </div>

      <div className={styles.mainContent}>

        {/* About / Two Ways */}
        <div id="section-about" data-card-index="1" className={styles.secBase}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <OurProducts
              onOpenProtocol={openContact}
              onOpenIntelligence={openContact}
            />
          </div>
        </div>

        {/* Security (Sonar) */}
        <div id="section-security" data-card-index="2" className={styles.securityCard} style={{ position: 'relative', overflow: 'hidden' }}>
          <Partners onContact={openContact} />
        </div>

        {/* Sail Intelligence — Yield Agent */}
        <div id="section-engine" data-card-index="3" className={styles.engineCard} style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <OptimizationEngine onContact={openContact} />
          </div>
        </div>

        {/* Sail Protocol */}
        <div id="section-protocol" data-card-index="4" className={styles.protocolCard} style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <SailProtocolSection onOpenProtocol={openContact} />
          </div>
        </div>

        {/* Users */}
        <div id="section-users" data-card-index="5" className={styles.usersCard} style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <Features onContact={openContact} />
          </div>
        </div>

        {/* FAQ */}
        <div id="section-faq" data-card-index="6" className={styles.faqCard} style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <FAQ />
            <CTA onOpenApi={openContact} />
            <Footer />
          </div>
        </div>

      </div>
    </>
  )
}

export default App
