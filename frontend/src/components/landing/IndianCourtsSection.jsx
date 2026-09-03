import { INDIAN_COURTS } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"
import courtroomPhoto from "../../assets/landing/courtroom.jpg"

/**
 * "Built for Indian courts." — the four platform commitments published
 * on jurinex.ai beside a real Indian courtroom, on a dark forest ground.
 */
const IndianCourtsSection = () => (
  <section
    id="indian-courts"
    className="relative scroll-mt-20 overflow-hidden bg-nx-forest py-20 sm:py-28"
    aria-labelledby="indian-courts-heading"
  >
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      style={{
        background:
          "radial-gradient(ellipse 55% 50% at 50% 0%, rgba(13,148,136,0.20), transparent 65%)",
      }}
    />
    <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
      <SectionHeading
        id="indian-courts-heading"
        dark
        eyebrow="Purpose-Built"
        title="Built for Indian Courts"
        lede="Not adapted for India as an afterthought — engineered for how Indian legal practice actually works."
      />

      <div className="mt-14 grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        {/* Courtroom photo */}
        <Reveal className="relative overflow-hidden rounded-3xl border border-white/25">
          <img
            src={courtroomPhoto}
            alt="An Indian courtroom with the gavel, scales of justice, and national flag"
            className="h-72 w-full object-cover lg:h-full"
            loading="lazy"
          />
          <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-nx-forest/90 px-3.5 py-1.5 text-xs font-semibold text-teal-50 backdrop-blur-sm">
            <Icon name="Landmark" className="h-3.5 w-3.5 text-nx-mint" />
            District Courts · High Courts · Supreme Court · Tribunals
          </span>
        </Reveal>

        {/* Commitments */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {INDIAN_COURTS.map((item, i) => (
            <Reveal
              key={item.title}
              delay={(i % 2) * 0.08}
              className="rounded-2xl border border-white/15 bg-white/[0.05] p-6 transition-all duration-300 hover:border-teal-300/50 hover:bg-white/[0.08]"
            >
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-nx-teal text-white">
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <h3 className="mt-3.5 font-display text-base font-semibold text-white">
                {item.title}
              </h3>
              <p className="mt-2 text-[13px] leading-relaxed text-teal-100/70">{item.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  </section>
)

export default IndianCourtsSection
