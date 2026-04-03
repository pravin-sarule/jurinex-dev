import { useState, useEffect, useRef } from "react"
import PropTypes from "prop-types"
import Navbar from "../components/landing/Navbar"
import HeroSection from "../components/landing/HeroSection"
import FeaturesSection from "../components/landing/FeaturesSection"
import TestimonialsSection from "../components/landing/TestimonialsSection"
import PricingSection from "../components/landing/PricingSection"
import CTASection from "../components/landing/CTASection"
import Footer from "../components/landing/Footer"
import BookDemoModal from "../components/landing/BookDemoModal"
import PolicyModal from "../components/landing/PolicyModal"

// Popup schedule: first show → 15 s, after 1st close → 30 s, after 2nd close → 60 s
const POPUP_DELAYS = [15_000, 30_000, 60_000]

/**
 * Marketing landing page composition.
 * No external props.
 */
const HomePage = ({ onNavigateLogin, onNavigateContact, pendingSection, onPendingSectionConsumed }) => {
  const [demoOpen, setDemoOpen]     = useState(false)
  const [policyKey, setPolicyKey]   = useState(null) // "terms" | "dpdpa" | null

  // Scroll to a section requested from another page (e.g. Contact nav links)
  useEffect(() => {
    if (!pendingSection) return
    const el = document.getElementById(pendingSection)
    if (el) el.scrollIntoView({ behavior: "smooth" })
    onPendingSectionConsumed?.()
  }, [pendingSection]) // eslint-disable-line react-hooks/exhaustive-deps
  const popupIndexRef = useRef(0)   // which delay to use next
  const timerRef     = useRef(null)

  const scheduleNext = (index) => {
    if (index >= POPUP_DELAYS.length) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setDemoOpen(true)
    }, POPUP_DELAYS[index])
  }

  // Kick off the first popup on mount (15 s)
  useEffect(() => {
    scheduleNext(0)
    return () => clearTimeout(timerRef.current)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    setDemoOpen(false)
    const next = popupIndexRef.current + 1
    popupIndexRef.current = next
    scheduleNext(next)
  }

  const openDemo = () => setDemoOpen(true)

  const handleLogin = () => {
    onNavigateLogin?.()
  }

  return (
    <div className="min-h-screen bg-juri-canvas">
      <Navbar onRequestDemo={openDemo} onLogin={handleLogin} />
      <main>
        <HeroSection onRequestDemo={openDemo} onLogin={handleLogin} />
        <FeaturesSection />
        <TestimonialsSection />
        <PricingSection />
        <CTASection onBookDemo={openDemo} />
      </main>
      <Footer onOpenPolicy={setPolicyKey} onGetInTouch={onNavigateContact} />

      <BookDemoModal
        isOpen={demoOpen}
        onClose={handleClose}
      />

      {policyKey && (
        <PolicyModal
          policyKey={policyKey}
          onClose={() => setPolicyKey(null)}
        />
      )}
    </div>
  )
}

HomePage.propTypes = {
  onNavigateLogin: PropTypes.func,
  onNavigateContact: PropTypes.func,
  pendingSection: PropTypes.string,
  onPendingSectionConsumed: PropTypes.func,
}

export default HomePage
