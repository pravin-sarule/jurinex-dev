import { AI_CAPABILITIES } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"

/**
 * The intelligence layer behind the platform — rendered on a dark ground
 * to read as the "engine room" of the product.
 */
const AICapabilitiesSection = () => (
  <section
    id="capabilities"
    className="relative scroll-mt-20 overflow-hidden bg-nx-forest py-20 sm:py-28"
    aria-labelledby="capabilities-heading"
  >
    {/* Ambient glow + fine grid */}
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      style={{
        background:
          "radial-gradient(ellipse 55% 50% at 50% 0%, rgba(13,148,136,0.18), transparent 65%)",
      }}
    />
    <div
      className="pointer-events-none absolute inset-0 opacity-25"
      aria-hidden="true"
      style={{
        backgroundImage:
          "linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)",
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(ellipse 75% 65% at 50% 40%, black, transparent 80%)",
      }}
    />

    <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="capabilities-heading"
        dark
        eyebrow="The AI Engine"
        title="The Intelligence Behind the Platform"
        lede="Every feature on the surface is powered by the same set of legal-tuned AI capabilities underneath."
      />

      <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AI_CAPABILITIES.map((cap, i) => (
          <Reveal
            key={cap.title}
            delay={(i % 3) * 0.07}
            className="group rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-[2px] transition-all duration-300 hover:border-nx-mint/40 hover:bg-white/[0.07]"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-nx-teal/20 text-nx-mint transition-colors duration-300 group-hover:bg-nx-teal/30">
                <Icon name={cap.icon} className="h-4.5 w-4.5" />
              </span>
              <h3 className="text-sm font-semibold text-white">{cap.title}</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-teal-100/70">{cap.text}</p>
          </Reveal>
        ))}
      </div>
    </div>
  </section>
)

export default AICapabilitiesSection
