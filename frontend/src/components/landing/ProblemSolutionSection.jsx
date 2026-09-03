import { PROBLEMS, SOLUTION_COPY } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"

/**
 * Problem → solution narrative: the pains of document-heavy legal work,
 * then the pivot into the unified NexIntel workspace.
 */
const ProblemSolutionSection = () => (
  <section className="bg-nx-pale py-20 sm:py-28" aria-labelledby="problem-heading">
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="problem-heading"
        eyebrow="The Problem"
        title="Legal Work Shouldn't Be Slowed Down by Information Overload"
        lede="The practice of law is judgment and strategy. Yet most of a legal professional's week disappears into reading, searching, and re-typing."
      />

      {/* Problem grid */}
      <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {PROBLEMS.map((problem, i) => (
          <Reveal
            key={problem.title}
            delay={(i % 3) * 0.08}
            className="group rounded-2xl border border-nx-ink/75 bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-nx-teal hover:shadow-[0_14px_36px_-16px_rgba(6,52,44,0.18)]"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500">
              <Icon name={problem.icon} className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold text-nx-ink">{problem.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-nx-muted">{problem.text}</p>
          </Reveal>
        ))}
      </div>

      {/* Pivot into the solution */}
      <Reveal className="mt-16" y={30}>
        <div className="relative overflow-hidden rounded-3xl bg-nx-forest px-7 py-12 sm:px-12 lg:px-16">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden="true"
            style={{
              background:
                "radial-gradient(ellipse 60% 80% at 85% 20%, rgba(13,148,136,0.25), transparent 60%)",
            }}
          />
          <div className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">
                The Solution
              </p>
              <h3 className="mt-3 font-display text-2xl font-semibold leading-snug text-white sm:text-3xl">
                {SOLUTION_COPY.headline}
              </h3>
              <p className="mt-4 text-base leading-relaxed text-teal-50/80">
                {SOLUTION_COPY.text}
              </p>
            </div>
            <ul className="space-y-4">
              {SOLUTION_COPY.points.map((point) => (
                <li
                  key={point}
                  className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3.5"
                >
                  <Icon name="CircleCheck" className="mt-0.5 h-5 w-5 flex-none text-emerald-400" />
                  <span className="text-sm leading-relaxed text-teal-50/90">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Reveal>
    </div>
  </section>
)

export default ProblemSolutionSection
