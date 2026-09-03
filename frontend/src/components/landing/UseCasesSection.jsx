import { PRACTICE_SIZES, USE_CASES } from "../../utils/landingConstants"
import { IconTile, Reveal, SectionHeading } from "./primitives"

/**
 * "Solutions": practice-size fit (from jurinex.ai) plus persona-based
 * use cases for every stage of legal work.
 */
const UseCasesSection = () => (
  <section
    id="solutions"
    className="scroll-mt-20 bg-nx-pale py-20 sm:py-28"
    aria-labelledby="solutions-heading"
  >
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="solutions-heading"
        eyebrow="Built for Every Kind of Legal Practice"
        title="Whether You're a Solo Practitioner or a Corporate Legal Team — Jurinex Is the Solution"
        lede="Plans and workspaces scale from a single chamber to a multi-partner firm."
      />

      {/* Practice-size cards */}
      <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-3">
        {PRACTICE_SIZES.map((size, i) => (
          <Reveal
            key={size.numeral}
            delay={i * 0.08}
            className="rounded-2xl border border-nx-ink/75 bg-white p-7 text-center transition-all duration-300 hover:-translate-y-1 hover:border-nx-teal hover:shadow-[0_18px_44px_-18px_rgba(6,52,44,0.22)]"
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-nx-teal font-display text-lg font-semibold text-nx-teal">
              {size.numeral}
            </span>
            <h3 className="mt-4 text-base font-semibold text-nx-ink">{size.title}</h3>
            <p className="mt-1 text-sm text-nx-muted">{size.seats}</p>
          </Reveal>
        ))}
      </div>

      {/* Persona use cases */}
      <Reveal className="mt-16 text-center" y={16}>
        <h3 className="font-display text-2xl font-semibold text-nx-ink">
          Built for Every Stage of Legal Work
        </h3>
      </Reveal>

      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {USE_CASES.map((useCase, i) => (
          <Reveal
            key={useCase.title}
            delay={(i % 3) * 0.08}
            className="group rounded-2xl border border-nx-ink/75 bg-white p-7 transition-all duration-300 hover:-translate-y-1 hover:border-nx-teal hover:shadow-[0_18px_44px_-18px_rgba(6,52,44,0.22)]"
          >
            <div className="flex items-center gap-3.5">
              <IconTile name={useCase.icon} />
              <h4 className="text-base font-semibold text-nx-ink">{useCase.title}</h4>
            </div>
            <p className="mt-3.5 text-sm leading-relaxed text-nx-muted">{useCase.text}</p>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
)

export default UseCasesSection
