import { TRUSTED_FIRMS } from "../../utils/landingConstants"

/**
 * Infinite horizontal marquee of firm names (placeholder logos).
 * No external props.
 */
const TrustedBySection = () => {
  const row = [...TRUSTED_FIRMS, ...TRUSTED_FIRMS]

  return (
    <section
      id="security"
      className="border-y border-juri-line bg-juri-canvas py-14"
      aria-labelledby="trusted-heading"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p
          id="trusted-heading"
          className="text-center text-xs font-semibold uppercase tracking-[0.3em] text-juri-muted"
        >
          Trusted by leading firms
        </p>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-juri-muted/80">
          SOC2-ready workflows and client-matter isolation — designed for
          sensitive legal work.
        </p>
      </div>
      <div
        className="relative mt-10 overflow-hidden marquee-mask"
        role="presentation"
      >
        <div className="flex w-max animate-marquee gap-16 px-8">
          {row.map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="shrink-0 font-playfair text-lg font-medium tracking-wide text-juri-subtle sm:text-xl"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

export default TrustedBySection

