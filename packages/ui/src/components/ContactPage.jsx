import { useState } from 'react'
import Header from './Header'
import Footer from './Footer'
import styles from './ContactPage.module.css'

const INQUIRY_TYPES = [
  'Separately Managed Accounts (SMAs)',
  'Yield Agent',
  'Security Agent',
  'Other',
]


export default function ContactPage({ onBack }) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    company: '',
    inquiryType: '',
    message: '',
  })
  const [submitted, setSubmitted] = useState(false)

  const update = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.fullName || !form.email || !form.inquiryType || !form.message) return
    setSubmitted(true)
  }

  return (
    <div className={styles.page}>
      {/* Layered ambient backdrop — radial glow + dot grid */}
      <div className={styles.glowTop} aria-hidden="true" />
      <div className={styles.glowBottom} aria-hidden="true" />
      <div className={styles.dotGrid} aria-hidden="true" />

      {/* Site navbar — same as the landing page. We're already on contact,
          so the contact-CTAs just scroll to the top of the form. */}
      <Header
        onOpenProtocol={onBack}
        onOpenIntelligence={onBack}
        onContact={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      />

      <main className={styles.content}>
        {/* ── Intro column ─────────────────────────────────── */}
        <section className={styles.intro}>
          <h1 className={styles.title}>
            Contact <span className={styles.titleAccent}>team</span>
          </h1>

          <p className={styles.description}>
            Have a question or want to work together? Drop us a line and
            we'll get back to you shortly.
          </p>

          {/* Contact email */}
          <div className={styles.contactBlock}>
            <a className={styles.contactMail} href="mailto:hello@sail.money">
              <span className={styles.contactLabel}>EMAIL</span>
              <span className={styles.contactValue}>hello@sail.money</span>
            </a>
          </div>
        </section>

        {/* ── Form column ──────────────────────────────────── */}
        <section className={styles.formSection}>
          <div className={styles.formCard}>
            <span className={styles.formCardEdge} aria-hidden="true" />

            {submitted ? (
              <div className={styles.thankYou}>
                <span className={styles.thankYouMark} aria-hidden="true">
                  <svg viewBox="0 0 16 16" fill="none">
                    <path d="M3.5 8.5 l3 3 l6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <h2 className={styles.thankYouTitle}>
                  Thanks, {form.fullName.split(' ')[0] || 'there'}.
                </h2>
                <p className={styles.thankYouDesc}>
                  Your message is in. We'll be in touch soon —
                  always from a human, never an autoresponder.
                </p>
                <button className={styles.linkBtn} onClick={onBack}>
                  Return to the homepage
                  <span className={styles.linkArrow} aria-hidden="true">→</span>
                </button>
              </div>
            ) : (
              <form className={styles.form} onSubmit={handleSubmit} noValidate>
                <header className={styles.formHead}>
                  <span className={styles.formHeadLabel}>SECURE FORM</span>
                  <span className={styles.formHeadDot} aria-hidden="true" />
                </header>

                <Field
                  id="fullName"
                  label="Full name"
                  required
                  placeholder="Vitalik Buterin"
                  value={form.fullName}
                  onChange={update('fullName')}
                />
                <Field
                  id="email"
                  type="email"
                  label="Email address"
                  required
                  placeholder="your.email@example.com"
                  value={form.email}
                  onChange={update('email')}
                />
                <Field
                  id="company"
                  label="Company"
                  hint="optional"
                  placeholder="Your company name"
                  value={form.company}
                  onChange={update('company')}
                />

                <div className={styles.field}>
                  <label htmlFor="inquiryType" className={styles.label}>
                    Inquiry
                  </label>
                  <div className={styles.selectWrap}>
                    <select
                      id="inquiryType"
                      className={styles.select}
                      value={form.inquiryType}
                      onChange={update('inquiryType')}
                      required
                    >
                      <option value="" disabled>Select one…</option>
                      {INQUIRY_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <span className={styles.selectChevron} aria-hidden="true">
                      <svg viewBox="0 0 16 16" fill="none">
                        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="message" className={styles.label}>
                    Subject
                  </label>
                  <textarea
                    id="message"
                    className={styles.textarea}
                    placeholder="A few lines about your project or question…"
                    rows={4}
                    value={form.message}
                    onChange={update('message')}
                    required
                  />
                </div>

                <button type="submit" className={styles.submit}>
                  <span>Send message</span>
                  <span className={styles.submitArrow} aria-hidden="true">
                    <svg viewBox="0 0 16 16" fill="none">
                      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor"
                        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              </form>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  )
}

/* ── Single text field with label + optional hint ────────────────────── */
function Field({ id, type = 'text', label, required, hint, placeholder, value, onChange }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {hint && <span className={styles.hint}> ({hint})</span>}
      </label>
      <input
        id={id}
        type={type}
        className={styles.input}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required={required}
      />
    </div>
  )
}
