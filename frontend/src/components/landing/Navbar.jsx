import { useEffect, useState } from "react"
import PropTypes from "prop-types"
import { motion as Motion, AnimatePresence } from "framer-motion"
import { NAV_LINKS } from "../../utils/landingConstants"
import { useLandingScrollAnimation } from "../../hooks/useLandingScrollAnimation"
import gavelIcon from "../../assets/JuriNex_gavel_logo.png"

const SECTION_IDS = NAV_LINKS.map((l) => l.href.replace("#", ""))

const useActiveSection = () => {
  const [active, setActive] = useState("")

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id)
        })
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    )

    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [])

  return active
}

const handleNavClick = (e, href, closeMenu) => {
  e.preventDefault()
  if (closeMenu) {
    closeMenu()
    // Wait for menu to close and body overflow to restore before scrolling
    setTimeout(() => {
      const el = document.getElementById(href.replace("#", ""))
      if (el) el.scrollIntoView({ behavior: "smooth" })
    }, 320)
  } else {
    const el = document.getElementById(href.replace("#", ""))
    if (el) el.scrollIntoView({ behavior: "smooth" })
  }
}

const JurinexLogo = ({ scrolled }) => (
  <div className="flex items-center gap-2.5">
    <img src={gavelIcon} alt="" aria-hidden="true" className="h-10 w-10 flex-shrink-0 rounded-xl" />
    <span
      className={`flex items-start gap-0.5 font-playfair text-2xl font-extrabold leading-none tracking-tight transition-colors duration-500 ${
        scrolled ? "text-juri-ink" : "text-white"
      }`}
    >
      JuriNex
      <span
        aria-hidden="true"
        className="mt-0.5 font-dmSans font-semibold"
        style={{ verticalAlign: "super", fontSize: "9px" }}
      >
        TM
      </span>
    </span>
  </div>
)

JurinexLogo.propTypes = { scrolled: PropTypes.bool }

const Navbar = ({ onRequestDemo, onLogin, onSectionNav } = {}) => {
  const { scrolled } = useLandingScrollAnimation({ thresholdPx: 40 })
  const activeSection = useActiveSection()
  const [menuOpen, setMenuOpen] = useState(false)

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const onResize = () => { if (window.innerWidth >= 768) setMenuOpen(false) }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Prevent body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [menuOpen])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ease-out ${
        scrolled || menuOpen
          ? "border-b border-gray-200 bg-white shadow-sm backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav
        className="flex w-full items-center justify-between gap-6 px-6 py-4 sm:px-10 lg:px-20"
        aria-label="Primary"
      >
        {/* Logo */}
        <a
          href="#platform"
          onClick={(e) => handleNavClick(e, "#platform", () => setMenuOpen(false))}
          className="group flex shrink-0 items-center gap-2 transition-opacity hover:opacity-90"
        >
          <JurinexLogo scrolled={scrolled || menuOpen} />
        </a>

        {/* Desktop nav links */}
        <ul className="flex flex-1 items-center justify-center gap-3">
          {NAV_LINKS.map((link) => {
            const isActive = activeSection === link.href.replace("#", "")
            return (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={(e) => {
                    if (onSectionNav) { e.preventDefault(); onSectionNav(link.href.replace("#", "")) }
                    else handleNavClick(e, link.href)
                  }}
                  className={`relative px-1 py-1 text-sm font-bold uppercase tracking-wide transition-colors duration-300 ${
                    scrolled
                      ? "text-teal-700 hover:text-teal-800"
                      : "text-white hover:text-teal-200"
                  }`}
                >
                  {link.label}
                </a>
              </li>
            )
          })}
        </ul>

        {/* Desktop CTA buttons */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              scrolled
                ? "border border-gray-300 bg-transparent text-gray-800 hover:bg-gray-100"
                : "border border-white/40 bg-white/10 text-white hover:bg-white/20"
            }`}
            onClick={onLogin}
            aria-label="Log in to JuriNex"
          >
            Login
          </button>
          <button
            type="button"
            className="rounded-full bg-teal-600 px-4 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
            onClick={onRequestDemo}
            aria-label="Book a product demo"
          >
            Book a Demo
          </button>
        </div>

        {/* Mobile: hamburger */}
        <button
          type="button"
          className="hidden h-10 w-10 items-center justify-center rounded-full sm:hidden"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          <span className="relative flex h-5 w-6 flex-col justify-between">
            <Motion.span
              animate={menuOpen ? { rotate: 45, y: 9 } : { rotate: 0, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`block h-0.5 w-full rounded-full transition-colors duration-500 ${scrolled || menuOpen ? "bg-juri-ink" : "bg-white"}`}
            />
            <Motion.span
              animate={menuOpen ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
              transition={{ duration: 0.2 }}
              className={`block h-0.5 w-full rounded-full transition-colors duration-500 ${scrolled || menuOpen ? "bg-juri-ink" : "bg-white"}`}
            />
            <Motion.span
              animate={menuOpen ? { rotate: -45, y: -9 } : { rotate: 0, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`block h-0.5 w-full rounded-full transition-colors duration-500 ${scrolled || menuOpen ? "bg-juri-ink" : "bg-white"}`}
            />
          </span>
        </button>
      </nav>

      {/* Mobile menu drawer */}
      <AnimatePresence>
        {menuOpen && (
          <Motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-gray-100 bg-white md:hidden"
          >
            <div className="flex flex-col px-6 py-5 gap-1">
              {NAV_LINKS.map((link, i) => {
                const isActive = activeSection === link.href.replace("#", "")
                return (
                  <Motion.a
                    key={link.href}
                    href={link.href}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.25 }}
                    onClick={(e) => {
                      if (onSectionNav) { e.preventDefault(); setMenuOpen(false); onSectionNav(link.href.replace("#", "")) }
                      else handleNavClick(e, link.href, () => setMenuOpen(false))
                    }}
                    className={`rounded-xl px-4 py-3 font-dmSans text-sm font-semibold uppercase tracking-wider transition-colors ${
                      isActive
                        ? "bg-teal-500/10 text-teal-600"
                        : "text-juri-ink hover:bg-gray-50 hover:text-teal-600"
                    }`}
                  >
                    {link.label}
                  </Motion.a>
                )
              })}

              <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4">
                <button
                  type="button"
                  className="w-full rounded-full border border-gray-300 py-2.5 font-dmSans text-sm font-medium text-juri-ink transition-colors hover:bg-gray-50"
                  onClick={() => { onLogin?.(); setMenuOpen(false) }}
                >
                  Login
                </button>
                <button
                  type="button"
                  className="w-full rounded-full bg-teal-600 py-2.5 font-dmSans text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-transform hover:scale-[1.01] active:scale-[0.98]"
                  onClick={() => { onRequestDemo?.(); setMenuOpen(false) }}
                >
                  Book a Demo
                </button>
              </div>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

Navbar.propTypes = {
  onRequestDemo: PropTypes.func,
  onLogin: PropTypes.func,
}

export default Navbar



