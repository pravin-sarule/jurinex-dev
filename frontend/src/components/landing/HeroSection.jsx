import PropTypes from "prop-types"
import { motion as Motion } from "framer-motion"
import { HERO_COPY } from "../../utils/landingConstants"
import heroImage from "../../assets/landing-hero.jpg"

const stagger = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
}

const fadeUp = {
  hidden: { opacity: 0, y: 36 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
  },
}


/**
 * Full-viewport hero — red & white theme.
 */
const HeroSection = ({ onRequestDemo, onLogin } = {}) => {

  return (
    <section
      id="platform"
      className="relative flex min-h-screen flex-col overflow-hidden bg-white pt-24 lg:pt-28"
      aria-labelledby="hero-heading"
    >
      {/* Red mesh background */}
      <div
        className="pointer-events-none absolute inset-0 hero-mesh-bg animate-mesh-shift"
        aria-hidden="true"
      />

      {/* Hero image */}
      <Motion.div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
        initial={{ scale: 1.03 }}
        animate={{
          scale: [1.04, 1.08, 1.04],
          x: [0, 12, -10, 0],
          y: [0, -10, 6, 0],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <Motion.img
          src={heroImage}
          alt=""
          className="h-full w-full object-cover object-center"
          animate={{ rotate: [0, 0.4, 0] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Dark overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-black/20" />
      </Motion.div>

      {/* Content */}
      <div className="relative z-10 flex w-full flex-1 items-center px-6 pb-16 sm:px-10 lg:px-20 lg:pb-24">
        <Motion.div
          className="flex max-w-2xl flex-col"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          <Motion.h1
            id="hero-heading"
            variants={fadeUp}
            className="font-playfair text-5xl font-medium leading-[1.08] tracking-[0.01em] text-white sm:text-6xl md:text-7xl lg:text-[5.5rem]"
          >
            {HERO_COPY.titleMain}
            <br />
            <Motion.span
              className="font-playfair italic text-teal-600 inline-block"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              {HERO_COPY.titleItalic}
            </Motion.span>
          </Motion.h1>

          <Motion.p
            variants={fadeUp}
            className="mt-7 max-w-lg text-base leading-relaxed text-white/80 sm:text-lg"
          >
            {HERO_COPY.subtitle}
          </Motion.p>

          <Motion.div
            variants={fadeUp}
            className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center"
          >
            <Motion.button
              type="button"
              className="rounded-full bg-teal-600 px-8 py-3 text-center text-sm font-semibold text-white shadow-md shadow-teal-500/30"
              aria-label="Request a demo of JuriNex"
              onClick={onRequestDemo}
              whileHover={{ scale: 1.05, boxShadow: "0 8px 28px rgba(13,148,136,0.45)" }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              {HERO_COPY.primaryCta}
            </Motion.button>

            <Motion.button
              type="button"
              className="rounded-full border border-white/40 bg-white/10 px-8 py-3 text-center text-sm font-semibold text-white shadow-sm backdrop-blur-sm"
              aria-label="Log in to your JuriNex account"
              onClick={onLogin}
              whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.2)" }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              {HERO_COPY.secondaryCta}
            </Motion.button>
          </Motion.div>
        </Motion.div>
      </div>

      {/* Scroll indicator */}
      <Motion.div
        className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35, duration: 0.15 }}
        aria-hidden="true"
      >
        <span className="text-xs font-medium uppercase tracking-widest text-white/50">Scroll</span>
        <Motion.div
          className="h-8 w-5 rounded-full border-2 border-white/30 flex items-start justify-center pt-1.5"
        >
          <Motion.div
            className="h-1.5 w-1 rounded-full bg-white/60"
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 0.35, repeat: Infinity, ease: "easeInOut" }}
          />
        </Motion.div>
      </Motion.div>
    </section>
  )
}

HeroSection.propTypes = {
  onRequestDemo: PropTypes.func,
  onLogin: PropTypes.func,
}

export default HeroSection


