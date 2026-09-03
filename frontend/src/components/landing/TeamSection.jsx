import { useState } from "react"
import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion"
import {
  ADVISORY_BOARD,
  EXECUTIVE_CORE,
  MENTOR,
  TEAM_INTRO,
} from "../../utils/landingConstants"
import { Reveal, SectionHeading } from "./primitives"
import { EASE } from "./motionTokens"
import santoshPhoto from "../../assets/team/santosh.jpg"
import saurabhPhoto from "../../assets/team/saurabh.jpg"
import milindPhoto from "../../assets/team/milind.jpg"
import amitPhoto from "../../assets/team/amit.jpg"
import amarPhoto from "../../assets/team/amar.jpg"
import anoopPhoto from "../../assets/team/anoop.jpg"
import nexintelLogo from "../../assets/landing/nexintel-logo.jpg"

const PHOTOS = {
  santosh: santoshPhoto,
  saurabh: saurabhPhoto,
  milind: milindPhoto,
  amit: amitPhoto,
  amar: amarPhoto,
  anoop: anoopPhoto,
}

const TABS = [
  { key: "core", label: "Executive Core" },
  { key: "advisory", label: "Advisory Board" },
]

/**
 * "Engineers and lawyers, building together." — executive core,
 * advisory board, and the mentor behind Jurinex (from jurinex.ai).
 */
const TeamSection = () => {
  const reduce = useReducedMotion()
  const [tab, setTab] = useState("core")

  return (
    <section id="team" className="scroll-mt-20 bg-white py-20 sm:py-28" aria-labelledby="team-heading">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            id="team-heading"
            eyebrow={TEAM_INTRO.eyebrow}
            title={TEAM_INTRO.title}
            lede={TEAM_INTRO.lede}
            align="left"
          />
          <Reveal delay={0.05} className="flex flex-none flex-col items-start gap-5 md:items-end">
            {/* Company mark */}
            <span className="inline-flex items-center gap-3 rounded-2xl border border-nx-ink/75 bg-white px-5 py-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-nx-faint">
                A product of
              </span>
              <img src={nexintelLogo} alt="NexIntel AI" className="h-6 w-auto" loading="lazy" />
            </span>
            {/* Tabs */}
            <span className="flex gap-1 rounded-full border border-nx-line bg-nx-pale p-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-pressed={tab === t.key}
                className={`rounded-full px-5 py-2 text-xs font-bold uppercase tracking-wider transition-all duration-200 ${
                  tab === t.key
                    ? "bg-nx-teal text-white shadow"
                    : "text-nx-muted hover:text-nx-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
            </span>
          </Reveal>
        </div>

        <AnimatePresence mode="wait">
          <Motion.div
            key={tab}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="mt-12"
          >
            {tab === "core" ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {EXECUTIVE_CORE.map((person) => (
                  <article
                    key={person.name}
                    className="grid grid-cols-1 gap-6 rounded-3xl border border-nx-ink/75 bg-white p-7 transition-all duration-300 hover:border-nx-teal hover:shadow-[0_18px_44px_-18px_rgba(6,52,44,0.2)] sm:grid-cols-[200px_1fr]"
                  >
                    <img
                      src={PHOTOS[person.photo]}
                      alt={person.name}
                      className="mx-auto h-64 w-full max-w-[220px] rounded-2xl bg-nx-pale object-cover object-top sm:mx-0 sm:h-full sm:max-h-72"
                      loading="lazy"
                    />
                    <div>
                      <h3 className="font-display text-xl font-semibold text-nx-ink">
                        {person.name}
                      </h3>
                      <p className="mt-1 text-xs font-bold uppercase tracking-wider text-nx-teal">
                        {person.role}
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-nx-muted">{person.bio}</p>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {ADVISORY_BOARD.map((person) => (
                  <article
                    key={person.name}
                    className="grid grid-cols-1 gap-7 rounded-3xl border border-nx-ink/75 bg-white p-7 transition-all duration-300 hover:border-nx-teal hover:shadow-[0_18px_44px_-18px_rgba(6,52,44,0.2)] md:grid-cols-[220px_1fr]"
                  >
                    <img
                      src={PHOTOS[person.photo]}
                      alt={person.name}
                      className="h-64 w-full rounded-2xl bg-nx-pale object-cover object-top md:h-full md:max-h-72"
                      loading="lazy"
                    />
                    <div>
                      <h3 className="font-display text-xl font-semibold text-nx-ink">
                        {person.name}
                      </h3>
                      <p className="mt-1 text-xs font-bold uppercase tracking-wider text-nx-teal">
                        {person.role}
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-nx-muted">{person.bio}</p>
                      <dl className="mt-5 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
                        {person.facts.map(([label, value]) => (
                          <div key={label} className="border-t border-nx-line pt-2.5">
                            <dt className="text-[10px] font-bold uppercase tracking-wider text-nx-faint">
                              {label}
                            </dt>
                            <dd className="mt-0.5 text-xs font-medium leading-snug text-nx-ink">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Motion.div>
        </AnimatePresence>

        {/* Mentor & Advisor */}
        <Reveal className="mt-16" y={26}>
          <div className="grid grid-cols-1 items-center gap-10 rounded-3xl bg-nx-pale p-7 sm:p-12 lg:grid-cols-[260px_1fr]">
            <img
              src={PHOTOS[MENTOR.photo]}
              alt={MENTOR.name}
              className="mx-auto h-72 w-full max-w-[260px] rounded-2xl object-cover object-top"
              loading="lazy"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-nx-teal">
                {MENTOR.eyebrow}
              </p>
              <blockquote className="mt-4 border-l-4 border-nx-teal pl-5 font-display text-xl font-medium italic leading-relaxed text-nx-teal-ink sm:text-2xl">
                “{MENTOR.quote}”
              </blockquote>
              <p className="mt-4 text-sm font-semibold text-nx-ink">{MENTOR.name}</p>
              <p className="text-xs text-nx-muted">{MENTOR.role}</p>
              <p className="mt-5 text-sm leading-relaxed text-nx-muted">{MENTOR.text}</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export default TeamSection
