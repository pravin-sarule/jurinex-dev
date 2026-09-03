import { FEATURES } from "../../utils/landingConstants"
import { IconTile, Reveal, SectionHeading } from "./primitives"

/**
 * Core platform features in a varied bento layout — wide cards anchor the
 * first and last rows so the grid doesn't read as eight identical tiles.
 */
const FeaturesSection = () => (
  <section id="features" className="scroll-mt-20 bg-white py-20 sm:py-28" aria-labelledby="features-heading">
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="features-heading"
        eyebrow="The Platform"
        title="Everything You Need to Work Smarter"
        lede="One connected workspace where documents, research, evidence, and drafting share the same understanding of your case."
      />

      <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature, i) => {
          const wide = feature.span === "wide"
          return (
            <Reveal
              key={feature.title}
              delay={(i % 3) * 0.08}
              className={`group relative overflow-hidden rounded-2xl border border-nx-ink/75 p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_44px_-18px_rgba(6,52,44,0.22)] ${
                wide
                  ? "bg-nx-pale sm:col-span-2 hover:border-nx-teal"
                  : "bg-white hover:border-nx-teal"
              }`}
            >
              {wide && (
                <div
                  className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  aria-hidden="true"
                  style={{
                    background:
                      "radial-gradient(ellipse 60% 90% at 90% 10%, rgba(13,148,136,0.08), transparent 60%)",
                  }}
                />
              )}
              <div className="relative">
                <IconTile name={feature.icon} size={wide ? "lg" : "md"} />
                <h3
                  className={`mt-4 font-semibold text-nx-ink ${
                    wide ? "font-display text-xl" : "text-base"
                  }`}
                >
                  {feature.title}
                </h3>
                <p
                  className={`mt-2 leading-relaxed text-nx-muted ${
                    wide ? "max-w-2xl text-base" : "text-sm"
                  }`}
                >
                  {feature.text}
                </p>
              </div>
            </Reveal>
          )
        })}
      </div>
    </div>
  </section>
)

export default FeaturesSection
