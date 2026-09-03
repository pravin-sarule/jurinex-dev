import { useState } from "react"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import { TESTIMONIALS } from "../../utils/landingConstants"
import { Icon, Reveal, SectionHeading } from "./primitives"
import { EASE } from "./motionTokens"
import akshayPhoto from "../../assets/team/akshay.jpg"
import shaileshPhoto from "../../assets/team/shailesh.jpg"
import prathameshPhoto from "../../assets/team/prathamesh.jpg"

const PHOTOS = { akshay: akshayPhoto, shailesh: shaileshPhoto, prathamesh: prathameshPhoto }

const initials = (name) =>
  name
    .replace(/^Adv\.\s*/, "")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")

/**
 * "Voices from the Bench & Bar" — real user testimonials published on
 * jurinex.ai, presented as an accessible carousel.
 */
const TestimonialsSection = () => {
  const reduce = useReducedMotion()
  const [index, setIndex] = useState(0)
  const count = TESTIMONIALS.length
  const current = TESTIMONIALS[index]
  const photo = current.photo ? PHOTOS[current.photo] : null

  const go = (dir) => setIndex((i) => (i + dir + count) % count)

  return (
    <section className="bg-nx-pale py-20 sm:py-28" aria-labelledby="testimonials-heading">
      <div className="mx-auto max-w-5xl px-5 sm:px-8">
        <SectionHeading
          id="testimonials-heading"
          eyebrow="Voices from the Bench & Bar"
          title="What Our Users Are Saying"
        />

        <Reveal className="mt-12">
          <div className="relative rounded-3xl border border-nx-ink/75 bg-white px-6 py-10 shadow-sm sm:px-12">
            <AnimatePresence mode="wait">
              <Motion.figure
                key={index}
                initial={reduce ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? undefined : { opacity: 0, x: -16 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="flex flex-col items-center gap-8 md:flex-row md:items-start"
              >
                <div className="flex w-40 flex-none flex-col items-center text-center">
                  {photo ? (
                    <img
                      src={photo}
                      alt={current.name}
                      className="h-24 w-24 rounded-full border-2 border-teal-100 object-cover object-top"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className="grid h-24 w-24 place-items-center rounded-full bg-nx-teal text-2xl font-bold text-white"
                      aria-hidden="true"
                    >
                      {initials(current.name)}
                    </span>
                  )}
                  <figcaption className="mt-4">
                    <p className="text-sm font-semibold text-nx-ink">{current.name}</p>
                    <p className="mt-1 text-xs leading-snug text-nx-muted">{current.title}</p>
                  </figcaption>
                </div>

                <blockquote className="relative flex-1">
                  <Icon
                    name="Quote"
                    className="absolute -left-1 -top-3 h-7 w-7 text-teal-100"
                  />
                  <p className="relative font-display text-lg font-medium italic leading-relaxed text-nx-ink">
                    “{current.quote}”
                  </p>
                </blockquote>
              </Motion.figure>
            </AnimatePresence>

            {/* Controls */}
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous testimonial"
              className="absolute -left-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-nx-line bg-white text-nx-ink shadow-md transition-colors hover:border-nx-teal hover:text-nx-teal sm:-left-5"
            >
              <Icon name="ChevronLeft" className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next testimonial"
              className="absolute -right-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-nx-line bg-white text-nx-ink shadow-md transition-colors hover:border-nx-teal hover:text-nx-teal sm:-right-5"
            >
              <Icon name="ChevronRight" className="h-5 w-5" />
            </button>
          </div>

          {/* Dots */}
          <div className="mt-6 flex justify-center gap-2" role="tablist" aria-label="Testimonials">
            {TESTIMONIALS.map((t, i) => (
              <button
                key={t.name}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Testimonial from ${t.name}`}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all duration-300 ${
                  i === index ? "w-7 bg-nx-teal" : "w-2 bg-nx-line hover:bg-nx-faint"
                }`}
              />
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export default TestimonialsSection
