import { TRUST_POINTS } from "../../utils/landingConstants"
import { IconTile, Reveal } from "./primitives"

/**
 * Trust strip directly under the hero. Capability-based trust signals —
 * no invented customer logos or statistics.
 */
const TrustSection = () => (
  <section className="border-b border-nx-line bg-white" aria-labelledby="trust-heading">
    <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8">
      <Reveal>
        <p
          id="trust-heading"
          className="text-center text-sm font-semibold uppercase tracking-[0.16em] text-nx-faint"
        >
          Built for modern legal teams
        </p>
      </Reveal>

      <div className="mt-9 grid grid-cols-1 gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST_POINTS.map((point, i) => (
          <Reveal key={point.title} delay={i * 0.07} className="flex items-start gap-3.5">
            <IconTile name={point.icon} />
            <div>
              <h3 className="text-sm font-semibold text-nx-ink">{point.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-nx-muted">{point.text}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
)

export default TrustSection
