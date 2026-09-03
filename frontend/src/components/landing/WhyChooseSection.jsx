import { WHY_CHOOSE } from "../../utils/landingConstants"
import { Icon, IconTile, Reveal, SectionHeading } from "./primitives"
import advocatePhoto from "../../assets/landing/advocate.jpg"

/**
 * "Why Jurinex" — product substance beside a real chamber at work,
 * in Brevo-style outlined photo and content cards.
 */
const WhyChooseSection = () => (
  <section id="why" className="scroll-mt-20 bg-white py-20 sm:py-28" aria-labelledby="why-heading">
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="why-heading"
        eyebrow="Why Jurinex"
        title="Why Legal Professionals Choose Jurinex"
        lede="Not another general-purpose chatbot with a legal skin — a platform built around how matters are actually run."
      />

      <div className="mt-14 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[1fr_1.15fr]">
        {/* Chamber photo */}
        <Reveal className="relative overflow-hidden rounded-3xl border border-nx-ink/75">
          <img
            src={advocatePhoto}
            alt="Advocates working through case files in an Indian legal chamber"
            className="h-72 w-full object-cover lg:h-full"
            loading="lazy"
          />
          <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full border border-nx-ink/75 bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-nx-ink">
            <Icon name="Scale" className="h-3.5 w-3.5 text-nx-teal" />
            Built with practicing advocates
          </span>
        </Reveal>

        {/* Reasons */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {WHY_CHOOSE.map((reason, i) => (
            <Reveal
              key={reason.title}
              delay={(i % 2) * 0.08}
              className="rounded-2xl border border-nx-ink/75 bg-nx-pale p-6 transition-all duration-300 hover:-translate-y-1 hover:border-nx-teal hover:bg-white hover:shadow-[0_18px_44px_-18px_rgba(6,52,44,0.2)]"
            >
              <IconTile name={reason.icon} />
              <h3 className="mt-4 font-display text-lg font-semibold leading-snug text-nx-ink">
                {reason.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-nx-muted">{reason.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  </section>
)

export default WhyChooseSection
