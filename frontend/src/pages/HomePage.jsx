import { useState, useEffect, useRef } from "react"
import PropTypes from "prop-types"
import Navbar from "../components/landing/Navbar"
import HeroSection from "../components/landing/HeroSection"
import StatsSection from "../components/landing/StatsSection"
import TrustSection from "../components/landing/TrustSection"
import ProblemSolutionSection from "../components/landing/ProblemSolutionSection"
import FeaturesSection from "../components/landing/FeaturesSection"
import FeatureShowcase from "../components/landing/FeatureShowcase"
import WorkflowSection from "../components/landing/WorkflowSection"
import IndianCourtsSection from "../components/landing/IndianCourtsSection"
import UseCasesSection from "../components/landing/UseCasesSection"
import AICapabilitiesSection from "../components/landing/AICapabilitiesSection"
import SecuritySection from "../components/landing/SecuritySection"
import BenefitsSection from "../components/landing/BenefitsSection"
import WhyChooseSection from "../components/landing/WhyChooseSection"
import TestimonialsSection from "../components/landing/TestimonialsSection"
import TeamSection from "../components/landing/TeamSection"
import ThreeStepsSection from "../components/landing/ThreeStepsSection"
import PricingSection from "../components/landing/PricingSection"
import CommunitySection from "../components/landing/CommunitySection"
import FAQSection from "../components/landing/FAQSection"
import CTASection from "../components/landing/CTASection"
import Footer from "../components/landing/Footer"
import BookDemoModal from "../components/landing/BookDemoModal"
import PolicyModal from "../components/landing/PolicyModal"
import ChatbotWidget from "../components/landing/ChatbotWidget"

// Popup schedule: first show → 15 s, after 1st close → 30 s, after 2nd close → 60 s
const POPUP_DELAYS = [15_000, 30_000, 60_000]

/**
 * Marketing landing page composition.
 *
 * Section rhythm: hero → trust → problem/solution → features →
 * showcase → workflow → use cases → AI capabilities → security →
 * benefits → why NexIntel → pricing → community → FAQ → CTA → footer.
 */
const HomePage = ({ onNavigateLogin, onNavigateContact, pendingSection, onPendingSectionConsumed }) => {
  const [demoOpen, setDemoOpen] = useState(false)
  const [policyKey, setPolicyKey] = useState(null) // "terms" | "dpdpa" | null

  // Scroll to a section requested from another page (e.g. Contact nav links)
  useEffect(() => {
    if (!pendingSection) return
    const el = document.getElementById(pendingSection)
    if (el) el.scrollIntoView({ behavior: "smooth" })
    onPendingSectionConsumed?.()
  }, [pendingSection]) // eslint-disable-line react-hooks/exhaustive-deps

  const popupIndexRef = useRef(0) // which delay to use next
  const timerRef = useRef(null)

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
  }, [])

  const handleClose = () => {
    setDemoOpen(false)
    const next = popupIndexRef.current + 1
    popupIndexRef.current = next
    scheduleNext(next)
  }

  const openDemo = () => setDemoOpen(true)

  const handleLogin = (loginState) => {
    onNavigateLogin?.(loginState)
  }

  return (
    <div className="min-h-screen bg-white font-body text-nx-ink antialiased">
      <Navbar onRequestDemo={openDemo} onLogin={handleLogin} />
      <main>
        <HeroSection onLogin={handleLogin} />
        <StatsSection />
        <TrustSection />
        <ProblemSolutionSection />
        <FeaturesSection />
        <FeatureShowcase />
        <WorkflowSection />
        <IndianCourtsSection />
        <UseCasesSection />
        <AICapabilitiesSection />
        <SecuritySection />
        <BenefitsSection />
        <WhyChooseSection />
        <TestimonialsSection />
        <TeamSection />
        <ThreeStepsSection />
        <PricingSection
          onNavigateLogin={onNavigateLogin}
          onNavigateContact={onNavigateContact}
        />
        <CommunitySection />
        <FAQSection />
        <CTASection onBookDemo={openDemo} />
      </main>
      <Footer onOpenPolicy={setPolicyKey} onGetInTouch={onNavigateContact} />

      <BookDemoModal isOpen={demoOpen} onClose={handleClose} />

      {policyKey && (
        <PolicyModal policyKey={policyKey} onClose={() => setPolicyKey(null)} />
      )}

      <ChatbotWidget />
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
