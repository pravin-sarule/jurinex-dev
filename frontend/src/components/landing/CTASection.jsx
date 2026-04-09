import PropTypes from "prop-types"
import { motion as Motion } from "framer-motion"
import { CTA_COPY } from "../../utils/landingConstants"

/**
 * Compact card-style red CTA section.
 */
const CTASection = ({ onBookDemo } = {}) => {
  return (
    <section
      id="pricing"
      className="px-4 py-10 sm:px-6 lg:px-8"
      aria-labelledby="cta-heading"
    >
      <Motion.div
        className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-teal-600 px-8 py-14 text-center sm:px-16 sm:py-16"
        initial={{ opacity: 0, y: 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Background glow */}
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_50%,rgba(255,255,255,0.08),transparent_70%)]"
          aria-hidden="true"
        />

        {/* Shimmer sweep */}
        <Motion.div
          className="pointer-events-none absolute top-0 left-[-30%] h-full w-[35%] rounded-full bg-white/10 blur-[60px]"
          aria-hidden="true"
          animate={{ x: ["0%", "370%", "0%"] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Top / bottom edge lines */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-teal-300/40" aria-hidden="true" />

        {/* Content */}
        <div className="relative z-10">
          <h2
            id="cta-heading"
            className="font-playfair text-3xl font-semibold leading-tight text-white sm:text-4xl lg:text-[2.6rem]"
          >
            {CTA_COPY.heading}
          </h2>
          <p className="mx-auto mt-4 max-w-md font-dmSans text-base leading-relaxed text-white/75">
            See how Jurinex fits into your legal work — no pressure, no sales
            pitch.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button
              type="button"
              className="rounded-xl bg-white px-9 py-3 text-sm font-bold text-teal-600 shadow-md transition-all hover:scale-[1.03] hover:shadow-lg active:scale-[0.97]"
              aria-label="Request a demo of JuriNex"
              onClick={onBookDemo}
            >
              Book a Demo
            </button>
            <button
              type="button"
              className="text-sm font-semibold text-white/85 transition-all hover:text-white"
            >
              Talk to us →
            </button>
          </div>
        </div>
      </Motion.div>
    </section>
  )
}

CTASection.propTypes = {
  onBookDemo: PropTypes.func,
}

export default CTASection

