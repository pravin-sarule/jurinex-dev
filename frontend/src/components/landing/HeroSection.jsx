import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import { motion as Motion, useReducedMotion } from "framer-motion"
import { HERO_COPY } from "../../utils/landingConstants"
import { Icon, PrimaryButton, SecondaryButton } from "./primitives"
import { EASE } from "./motionTokens"

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
}

const fadeUp = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
}

/* ------------------------------------------------------------------ */
/* Product mockup — a stylised Jurinex case workspace                 */
/* ------------------------------------------------------------------ */

const DocLine = ({ w, highlight = false }) => (
  <div
    className={`h-1.5 rounded-full ${highlight ? "bg-amber-300/80" : "bg-slate-200"}`}
    style={{ width: w }}
  />
)

DocLine.propTypes = { w: PropTypes.string, highlight: PropTypes.bool }

const InsightRow = ({ icon, label, value, delay, reduce }) => (
  <Motion.div
    initial={reduce ? false : { opacity: 0, x: 10 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay, duration: 0.4, ease: EASE }}
    className="flex items-start gap-2 rounded-lg bg-nx-pale px-2.5 py-2"
  >
    <Icon name={icon} className="mt-0.5 h-3.5 w-3.5 flex-none text-nx-teal" />
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-nx-faint">{label}</p>
      <p className="truncate text-[11px] font-medium text-nx-ink">{value}</p>
    </div>
  </Motion.div>
)

InsightRow.propTypes = {
  icon: PropTypes.string,
  label: PropTypes.string,
  value: PropTypes.string,
  delay: PropTypes.number,
  reduce: PropTypes.bool,
}

const WorkspaceMock = () => {
  const reduce = useReducedMotion()

  return (
    <Motion.div
      initial={reduce ? false : { opacity: 0, y: 34 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
      className="relative w-full max-w-2xl"
      aria-hidden="true"
    >
      {/* Soft ambient tint behind the window */}
      <div className="absolute -inset-6 rounded-3xl bg-teal-200/50 blur-3xl" />

      <Motion.div
        animate={reduce ? undefined : { y: [0, -8, 0] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        className="relative overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-[0_32px_70px_-28px_rgba(6,52,44,0.35)]"
      >
        {/* Window chrome */}
        <div className="flex items-center gap-3 border-b border-nx-line bg-nx-pale px-4 py-2.5">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          </span>
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-white px-3 py-1 text-[11px] font-medium text-nx-muted shadow-sm">
            <Icon name="FolderOpen" className="h-3 w-3 text-nx-teal" />
            <span className="truncate">Sharma v. Mehta Industries — Case Workspace</span>
          </div>
          <span className="ml-auto hidden items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 sm:flex">
            <span className="relative flex h-1.5 w-1.5">
              {!reduce && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Analysis complete
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5">
          {/* Document viewer (hidden on very small screens) */}
          <div className="hidden border-r border-nx-line p-4 sm:col-span-2 sm:block">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-nx-muted">
              <Icon name="FileText" className="h-3 w-3 text-nx-teal-ink" />
              Written_Statement.pdf
              <span className="ml-auto rounded bg-nx-pale px-1.5 py-0.5 text-[9px] text-nx-faint">
                p. 12 / 214
              </span>
            </div>
            <div className="mt-3 space-y-2">
              <DocLine w="92%" />
              <DocLine w="100%" />
              <DocLine w="84%" />
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
                <div className="space-y-1.5">
                  <DocLine w="95%" highlight />
                  <DocLine w="88%" highlight />
                  <DocLine w="60%" highlight />
                </div>
                <p className="mt-1.5 text-[9px] font-semibold text-amber-700">
                  § Limitation — key admission
                </p>
              </div>
              <DocLine w="97%" />
              <DocLine w="90%" />
              <DocLine w="72%" />
              <DocLine w="96%" />
              <DocLine w="58%" />
            </div>
            <div className="mt-3 flex gap-1.5">
              {["OCR", "Marathi", "214 pp"].map((t) => (
                <span
                  key={t}
                  className="rounded bg-nx-pale px-1.5 py-0.5 text-[9px] font-medium text-nx-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* AI assistant panel */}
          <div className="flex flex-col p-4 sm:col-span-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-nx-muted">
              <span className="flex h-4 w-4 items-center justify-center rounded bg-nx-teal text-white">
                <Icon name="Sparkles" className="h-2.5 w-2.5" />
              </span>
              Legal AI Assistant
            </div>

            {/* User question */}
            <div className="mt-3 ml-auto max-w-[85%] rounded-lg rounded-tr-sm bg-nx-teal px-3 py-2 text-[11px] leading-snug text-white">
              What are the limitation risks in the written statement?
            </div>

            {/* AI answer */}
            <Motion.div
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.45, ease: EASE }}
              className="mt-2.5 max-w-[92%] rounded-lg rounded-tl-sm border border-nx-line bg-white p-3 shadow-sm"
            >
              <p className="text-[11px] leading-relaxed text-nx-ink">
                The defendant admits receiving the demand notice on{" "}
                <span className="font-semibold">14 March 2022</span> (p. 12, ¶ 8),
                which restarts limitation under{" "}
                <span className="font-semibold">Section 18</span>. Two risks flagged:
              </p>
              <div className="mt-2 space-y-1.5">
                {[
                  "Acknowledgment of debt — ¶ 8, Written Statement",
                  "Part-payment entry — Ledger Annexure C, p. 47",
                ].map((line) => (
                  <div key={line} className="flex items-center gap-1.5 text-[10px] text-nx-muted">
                    <Icon name="CircleAlert" className="h-3 w-3 flex-none text-amber-500" />
                    <span className="truncate">{line}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full border border-nx-line bg-nx-pale px-2 py-0.5 text-[9px] font-medium text-nx-teal">
                  <Icon name="BookMarked" className="h-2.5 w-2.5" />
                  2 authorities · Indian Kanoon
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-nx-line bg-nx-pale px-2 py-0.5 text-[9px] font-medium text-nx-muted">
                  <Icon name="Link2" className="h-2.5 w-2.5" />
                  Sources: 3 documents
                </span>
              </div>
            </Motion.div>

            {/* Extracted insights */}
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <InsightRow icon="CalendarDays" label="Next hearing" value="09 Oct 2026 · Aurangabad" delay={reduce ? 0 : 1.1} reduce={reduce} />
              <InsightRow icon="Users" label="Parties" value="Sharma vs. Mehta Ind." delay={reduce ? 0 : 1.25} reduce={reduce} />
              <InsightRow icon="TableProperties" label="Evidence matrix" value="18 exhibits mapped" delay={reduce ? 0 : 1.4} reduce={reduce} />
              <InsightRow icon="History" label="Chronology" value="42 events extracted" delay={reduce ? 0 : 1.55} reduce={reduce} />
            </div>

            {/* Prompt chips, mirroring the real app */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {["Case Summary", "List of Dates & Events", "Case Gist", "Grounds", "Hearing Preparation"].map((chip) => (
                <span
                  key={chip}
                  className="rounded-full border border-nx-line bg-white px-2 py-0.5 text-[9px] font-medium text-nx-muted"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </div>
      </Motion.div>
    </Motion.div>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Light hero on the same mint ground as the navbar — flat, warm,
 * editorial. Copy left, live product mock right.
 */
const HeroSection = ({ onLogin } = {}) => {
  const navigate = useNavigate()
  const reduce = useReducedMotion()

  const explorePlatform = () => {
    const el = document.getElementById("features")
    if (el) el.scrollIntoView({ behavior: reduce ? "auto" : "smooth" })
  }

  return (
    <section
      id="platform"
      className="relative overflow-hidden bg-teal-50"
      aria-labelledby="hero-heading"
    >
      {/* Soft tonal blobs — quiet, flat color */}
      <div
        className="pointer-events-none absolute -right-40 -top-40 h-[480px] w-[480px] rounded-full bg-teal-100/80 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -bottom-48 -left-32 h-[420px] w-[420px] rounded-full bg-emerald-100/60 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-5 pb-20 pt-28 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-10 lg:pb-24 lg:pt-36">
        {/* Copy */}
        <Motion.div
          variants={reduce ? undefined : stagger}
          initial={reduce ? false : "hidden"}
          animate="show"
          className="max-w-xl"
        >
          <Motion.p
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal-700"
          >
            <Icon name="Sparkles" className="h-3.5 w-3.5" />
            {HERO_COPY.eyebrow}
          </Motion.p>

          <Motion.h1
            id="hero-heading"
            variants={fadeUp}
            className="mt-6 font-display text-[2.1rem] font-semibold leading-[1.14] tracking-tight text-nx-ink sm:text-[2.7rem] lg:text-[3.05rem]"
          >
            {HERO_COPY.titleMain}{" "}
            <span className="relative whitespace-nowrap text-teal-700">
              {HERO_COPY.titleAccent}
              <svg
                className="absolute -bottom-2 left-0 w-full"
                viewBox="0 0 220 8"
                fill="none"
                aria-hidden="true"
                preserveAspectRatio="none"
              >
                <path
                  d="M2 6C60 1.5 160 1.5 218 6"
                  stroke="#0d9488"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </Motion.h1>

          <Motion.p
            variants={fadeUp}
            className="mt-6 text-base leading-relaxed text-gray-700 sm:text-lg"
          >
            {HERO_COPY.subtitle}
          </Motion.p>

          <Motion.div
            variants={fadeUp}
            className="mt-9 flex flex-col gap-3.5 sm:flex-row sm:items-center"
          >
            <PrimaryButton
              onClick={() => navigate("/register")}
              ariaLabel="Create a free Jurinex account"
              className="px-8"
            >
              {HERO_COPY.primaryCta}
              <Icon name="ArrowRight" className="h-4 w-4" />
            </PrimaryButton>
            <SecondaryButton
              onClick={explorePlatform}
              ariaLabel="Scroll to the platform overview"
              className="px-8"
            >
              {HERO_COPY.secondaryCta}
            </SecondaryButton>
          </Motion.div>

          <Motion.p
            variants={fadeUp}
            className="mt-5 flex items-center gap-2 text-sm text-gray-600"
          >
            <Icon name="CircleCheck" className="h-4 w-4 text-teal-600" />
            {HERO_COPY.trustLine}
          </Motion.p>

          <Motion.p variants={fadeUp} className="mt-1.5 flex items-center gap-2 text-sm text-gray-600">
            <Icon name="CircleCheck" className="h-4 w-4 text-teal-600" />
            7-day free trial on every plan
          </Motion.p>

          <Motion.button
            type="button"
            variants={fadeUp}
            onClick={() => onLogin?.()}
            className="mt-3 text-sm text-gray-600 underline-offset-4 transition-colors hover:text-teal-700 hover:underline"
          >
            Already using Jurinex? Sign in →
          </Motion.button>
        </Motion.div>

        {/* Product visual */}
        <div className="flex justify-center lg:justify-end">
          <WorkspaceMock />
        </div>
      </div>
    </section>
  )
}

HeroSection.propTypes = {
  onLogin: PropTypes.func,
}

export default HeroSection
