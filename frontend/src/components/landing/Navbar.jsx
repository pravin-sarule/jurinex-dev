import { useEffect, useRef, useState } from "react"
import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import { motion as Motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { NAV_LINKS } from "../../utils/landingConstants"
import { useLandingScrollAnimation } from "../../hooks/useLandingScrollAnimation"
import { EASE } from "./motionTokens"
import { Icon } from "./primitives"
import BrandLogo from "./BrandLogo"

const SECTION_IDS = NAV_LINKS.filter((l) => l.href.startsWith("#")).map((l) =>
  l.href.replace("#", "")
)

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

/**
 * Brevo-style top bar: solid light-teal ground, brand + left-aligned nav
 * with dropdown menus, Login text link and a teal demo pill on the right.
 * Used on the landing page and all public pages. Always renders the solid
 * light bar, so callers passing a legacy `solid` prop are unaffected.
 */
const Navbar = ({ onRequestDemo, onLogin, onSectionNav } = {}) => {
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const { scrolled } = useLandingScrollAnimation({ thresholdPx: 8 })
  const activeSection = useActiveSection()
  const [menuOpen, setMenuOpen] = useState(false) // mobile drawer
  const [openDropdown, setOpenDropdown] = useState(null) // desktop dropdown label
  const navRef = useRef(null)

  // Close the mobile menu when resizing up to desktop
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) setMenuOpen(false)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Lock body scroll while the drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [menuOpen])

  // Close dropdowns on outside click / Escape
  useEffect(() => {
    const onDown = (e) => {
      if (navRef.current && !navRef.current.contains(e.target)) setOpenDropdown(null)
    }
    const onKey = (e) => {
      if (e.key === "Escape") setOpenDropdown(null)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [])

  /** Follow any nav href: route, in-page anchor, or cross-page section. */
  const go = (href, { fromDrawer = false } = {}) => {
    setOpenDropdown(null)
    if (fromDrawer) setMenuOpen(false)

    if (href.startsWith("/")) {
      navigate(href)
      return
    }
    const id = href.replace("#", "")
    if (onSectionNav) {
      onSectionNav(id)
      return
    }
    const scroll = () => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" })
      else navigate("/", { state: { scrollTo: id } })
    }
    // Wait for the drawer to close and body overflow to restore before scrolling
    if (fromDrawer) setTimeout(scroll, 320)
    else scroll()
  }

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b bg-teal-50 transition-shadow duration-300 ${
        scrolled || menuOpen
          ? "border-teal-100 shadow-[0_1px_12px_rgba(13,148,136,0.10)]"
          : "border-teal-100/60"
      }`}
    >
      <nav
        ref={navRef}
        className="mx-auto flex h-16 w-full max-w-7xl items-center gap-8 px-5 sm:px-8"
        aria-label="Primary"
      >
        {/* Brand */}
        <a
          href="#platform"
          onClick={(e) => {
            e.preventDefault()
            go("#platform")
          }}
          className="flex shrink-0 items-center transition-opacity hover:opacity-85"
          aria-label="Jurinex.ai — back to top"
        >
          <BrandLogo />
        </a>

        {/* Desktop links, left-aligned next to the brand */}
        <ul className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => {
            const hasMenu = Array.isArray(link.children) && link.children.length > 0
            const isActive = activeSection === link.href.replace("#", "")
            const isOpen = openDropdown === link.label

            return (
              <li
                key={link.label}
                className="relative"
                onMouseEnter={() => hasMenu && setOpenDropdown(link.label)}
                onMouseLeave={() => hasMenu && setOpenDropdown(null)}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (hasMenu) setOpenDropdown(isOpen ? null : link.label)
                    else go(link.href)
                  }}
                  aria-expanded={hasMenu ? isOpen : undefined}
                  aria-haspopup={hasMenu ? "menu" : undefined}
                  className={`flex items-center gap-1 rounded-md px-3.5 py-2 text-[15px] font-medium transition-colors duration-200 ${
                    isActive || isOpen ? "text-teal-700" : "text-black hover:text-teal-700"
                  }`}
                >
                  {link.label}
                  {hasMenu && (
                    <Icon
                      name="ChevronDown"
                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  )}
                </button>

                {/* Dropdown */}
                <AnimatePresence>
                  {hasMenu && isOpen && (
                    <Motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduceMotion ? undefined : { opacity: 0, y: 4 }}
                      transition={{ duration: 0.16, ease: EASE }}
                      className="absolute left-0 top-full z-50 w-60 pt-2"
                      role="menu"
                    >
                      <div className="overflow-hidden rounded-xl border border-teal-100 bg-white py-1.5 shadow-[0_16px_40px_-16px_rgba(13,60,55,0.25)]">
                        {link.children.map((child) => (
                          <button
                            key={child.label}
                            type="button"
                            role="menuitem"
                            onClick={() => go(child.href)}
                            className="block w-full px-4 py-2.5 text-left text-sm font-medium text-black transition-colors hover:bg-teal-50 hover:text-teal-700"
                          >
                            {child.label}
                          </button>
                        ))}
                      </div>
                    </Motion.div>
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>

        {/* Desktop actions */}
        <div className="ml-auto hidden items-center gap-4 lg:flex">
          <button
            type="button"
            onClick={() => onLogin?.()}
            aria-label="Log in to your account"
            className="text-[15px] font-medium text-black underline decoration-1 underline-offset-4 transition-colors hover:text-teal-700"
          >
            Login
          </button>
          {onRequestDemo && (
            <button
              type="button"
              onClick={onRequestDemo}
              aria-label="Book a product demo"
              className="rounded-full border border-teal-600 px-4.5 py-2 text-sm font-semibold text-teal-700 transition-all duration-200 hover:bg-teal-600 hover:text-white active:scale-[0.98]"
            >
              Book a Demo
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/register")}
            aria-label="Start your free trial"
            className="rounded-full bg-teal-600 px-4.5 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-all duration-200 hover:bg-teal-700 active:scale-[0.98]"
          >
            Start Free Trial
          </button>
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg text-black transition-colors hover:bg-teal-100/60 lg:hidden"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          <span className="relative flex h-4 w-5 flex-col justify-between" aria-hidden="true">
            <Motion.span
              animate={menuOpen ? { rotate: 45, y: 7 } : { rotate: 0, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.22 }}
              className="block h-0.5 w-full rounded-full bg-current"
            />
            <Motion.span
              animate={menuOpen ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
              className="block h-0.5 w-full rounded-full bg-current"
            />
            <Motion.span
              animate={menuOpen ? { rotate: -45, y: -7 } : { rotate: 0, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.22 }}
              className="block h-0.5 w-full rounded-full bg-current"
            />
          </span>
        </button>
      </nav>

      {/* Mobile drawer */}
      <AnimatePresence>
        {menuOpen && (
          <Motion.div
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-teal-100 bg-teal-50 lg:hidden"
          >
            <div className="flex flex-col gap-0.5 px-5 py-4">
              {NAV_LINKS.map((link, i) => (
                <Motion.div
                  key={link.label}
                  initial={reduceMotion ? false : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.22 }}
                >
                  <button
                    type="button"
                    onClick={() => go(link.href, { fromDrawer: true })}
                    className={`w-full rounded-lg px-4 py-3 text-left text-sm font-semibold transition-colors ${
                      activeSection === link.href.replace("#", "")
                        ? "bg-teal-500/10 text-teal-700"
                        : "text-black hover:bg-teal-100/60 hover:text-teal-700"
                    }`}
                  >
                    {link.label}
                  </button>
                  {link.children && (
                    <div className="mb-1 ml-4 border-l border-teal-200 pl-2">
                      {link.children.map((child) => (
                        <button
                          key={child.label}
                          type="button"
                          onClick={() => go(child.href, { fromDrawer: true })}
                          className="block w-full rounded-lg px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-teal-100/60 hover:text-teal-700"
                        >
                          {child.label}
                        </button>
                      ))}
                    </div>
                  )}
                </Motion.div>
              ))}

              <div className="mt-3 flex flex-col gap-2.5 border-t border-teal-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onLogin?.()
                  }}
                  className="w-full rounded-full border border-gray-400 py-2.5 text-sm font-medium text-black transition-colors hover:bg-white"
                >
                  Login
                </button>
                {onRequestDemo && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onRequestDemo()
                    }}
                    className="w-full rounded-full border border-teal-600 py-2.5 text-sm font-semibold text-teal-700 transition-colors hover:bg-teal-600 hover:text-white"
                  >
                    Book a Demo
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    navigate("/register")
                  }}
                  className="w-full rounded-full bg-teal-600 py-2.5 text-sm font-semibold text-white shadow-md shadow-teal-500/25 transition-transform hover:bg-teal-700 active:scale-[0.99]"
                >
                  Start Free Trial
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
  onSectionNav: PropTypes.func,
  solid: PropTypes.bool,
}

export default Navbar
