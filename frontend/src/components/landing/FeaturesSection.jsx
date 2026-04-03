import PropTypes from "prop-types"
import { motion as Motion } from "framer-motion"
import { FEATURES_CARDS } from "../../utils/landingConstants"
import SummaryMock from "./feature-mocks/SummaryMock"
import DraftMock from "./feature-mocks/DraftMock"
import CiteMock from "./feature-mocks/CiteMock"
import ResearchMock from "./feature-mocks/ResearchMock"

const MOCK_MAP = {
  summary: SummaryMock,
  draft: DraftMock,
  cite: CiteMock,
  research: ResearchMock,
}

const GoldCheck = () => (
  <span
    className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-teal-500/10 text-teal-600"
    aria-hidden="true"
  >
    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
      <path
        d="M1 4l2.5 2.5L9 1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
)

const cardVariants = {
  hidden: (isLeft) => ({
    opacity: 0,
    x: isLeft ? -100 : 100,
    y: 40,
    scale: 0.94,
  }),
  visible: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.85,
      ease: [0.22, 1, 0.36, 1],
    },
  },
}

const headerVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
}

const bulletVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: { delay: i * 0.08 + 0.3, duration: 0.4, ease: "easeOut" },
  }),
}

/**
 * @param {{ feature: object, index: number }} props
 */
const FeatureCard = ({ feature, index }) => {
  const MockComponent = MOCK_MAP[feature.mockupType]
  const isLeft = feature.align === "left"

  return (
    <Motion.div
      custom={isLeft}
      variants={cardVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      whileHover={{ y: -5, transition: { duration: 0.28, ease: "easeOut" } }}
      className={[
        "group relative w-full overflow-hidden rounded-3xl bg-white md:max-w-[60%]",
        "border border-slate-100",
        "shadow-[0_4px_24px_rgba(0,0,0,0.06)]",
        "transition-shadow duration-300",
        "hover:shadow-[0_16px_56px_rgba(0,0,0,0.10),0_2px_12px_rgba(13,148,136,0.10)]",
        isLeft ? "md:mr-auto md:ml-0" : "md:ml-auto md:mr-0",
      ].join(" ")}
    >
      {/* Corner number watermark */}
      <span
        className="pointer-events-none absolute top-4 right-5 font-playfair text-6xl font-bold leading-none text-teal-600/20 select-none"
        aria-hidden="true"
      >
        {feature.number}
      </span>

      <div
        className={[
          "flex min-h-[380px] flex-col md:flex-row",
          !isLeft ? "md:flex-row-reverse" : "",
        ].join(" ")}
      >
        {/* ── Text panel ── */}
        <div className="relative flex flex-col justify-center px-8 py-10 md:w-[44%] md:px-10 md:py-12">
          {/* Coloured left/right edge line */}
          <div
            className={[
              "absolute top-8 bottom-8 w-[3px] rounded-full bg-gradient-to-b from-teal-500/70 via-teal-500 to-teal-600/20",
              isLeft ? "left-0" : "right-0",
            ].join(" ")}
            aria-hidden="true"
          />

          <h3 className="font-playfair text-2xl font-semibold leading-snug text-juri-ink">
            {feature.title}
          </h3>
          <p className="mt-3 font-dmSans text-sm leading-relaxed text-juri-muted">
            {feature.description}
          </p>

          <ul className="mt-5 space-y-2.5">
            {feature.bullets.map((bullet, i) => (
              <Motion.li
                key={bullet}
                custom={i}
                variants={bulletVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                className="flex items-center gap-3 font-dmSans text-sm text-juri-ink"
              >
                <GoldCheck />
                {bullet}
              </Motion.li>
            ))}
          </ul>
        </div>

        {/* ── Mockup panel ── */}
        <div
          className={[
            "flex flex-1 items-center justify-center overflow-hidden px-8 py-10 md:px-10 md:py-12",
            "rounded-b-3xl md:rounded-b-none",
            isLeft
              ? "md:rounded-r-3xl bg-gradient-to-br from-teal-50/80 via-slate-50 to-cyan-50/50"
              : "md:rounded-l-3xl bg-gradient-to-bl from-teal-50/80 via-slate-50 to-cyan-50/50",
          ].join(" ")}
          aria-hidden="true"
        >
          <Motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.65, delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="w-full"
          >
            <MockComponent />
          </Motion.div>
        </div>
      </div>
    </Motion.div>
  )
}

FeatureCard.propTypes = {
  feature: PropTypes.shape({
    id: PropTypes.string.isRequired,
    number: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    description: PropTypes.string.isRequired,
    bullets: PropTypes.arrayOf(PropTypes.string).isRequired,
    align: PropTypes.oneOf(["left", "right"]).isRequired,
    mockupType: PropTypes.oneOf(["summary", "draft", "cite", "research"])
      .isRequired,
  }).isRequired,
  index: PropTypes.number.isRequired,
}

const FeaturesSection = () => (
  <section
    id="features"
    className="relative overflow-hidden bg-juri-canvas py-16 sm:py-20"
    aria-labelledby="features-heading"
  >
    {/* Background radial glow */}
    <div
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_0%,rgba(13,148,136,0.08),transparent_65%)]"
      aria-hidden="true"
    />

    {/* Subtle dot grid */}
    <div
      className="pointer-events-none absolute inset-0 opacity-[0.018]"
      style={{
        backgroundImage:
          "radial-gradient(circle, #1a1a2e 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
      aria-hidden="true"
    />

    <div className="relative mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-4 xl:px-6">

      {/* ── Section header ── */}
      <Motion.div
        className="mb-14 text-center"
        variants={headerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-60px" }}
      >
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-500/10 px-4 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-600" aria-hidden="true" />
          <span className="font-dmSans text-xs font-medium tracking-wide text-teal-600">
            What JuriNex Does
          </span>
        </div>

        <h2
          id="features-heading"
          className="font-playfair text-3xl font-semibold text-juri-ink sm:text-4xl lg:text-[2.75rem] lg:leading-tight"
        >
          Everything your legal practice{" "}
          <em className="not-italic text-teal-600">needs to move faster</em>
        </h2>

        <p className="mx-auto mt-4 max-w-xl font-dmSans text-base text-juri-muted">
          Research deeper, draft sharper, and cite with confidence — built
          specifically for how lawyers actually work.
        </p>
      </Motion.div>

      {/* ── Feature cards ── */}
      <div className="flex flex-col gap-8 md:gap-10">
        {FEATURES_CARDS.map((feature, index) => (
          <FeatureCard key={feature.id} feature={feature} index={index} />
        ))}
      </div>
    </div>
  </section>
)

export default FeaturesSection

