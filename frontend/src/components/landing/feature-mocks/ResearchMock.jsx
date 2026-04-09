import { useState, useEffect } from "react"
import { motion as Motion } from "framer-motion"

const RESULTS = [
  { court: "Supreme Court", year: "2023", relevance: 4 },
  { court: "High Court Delhi", year: "2021", relevance: 3 },
]

const SEARCH_TEXT = "Section 138 NI Act dishonour"

const ResearchMock = () => {
  const [cycle, setCycle] = useState(0)
  const [visibleChars, setVisibleChars] = useState(0)

  // Reset on cycle change
  useEffect(() => {
    setVisibleChars(0)
  }, [cycle])

  // Type out search text character by character
  useEffect(() => {
    if (visibleChars >= SEARCH_TEXT.length) return
    const t = setTimeout(
      () => setVisibleChars((v) => v + 1),
      55 // ms per character
    )
    return () => clearTimeout(t)
  }, [visibleChars])

  // Restart loop
  useEffect(() => {
    const t = setInterval(() => setCycle((c) => c + 1), 6000)
    return () => clearInterval(t)
  }, [])

  const typed = SEARCH_TEXT.slice(0, visibleChars)
  const doneTyping = visibleChars >= SEARCH_TEXT.length
  // results appear ~0.4s after typing finishes
  const resultDelay = SEARCH_TEXT.length * 0.055 + 0.4

  return (
    <Motion.div
      key={cycle}
      aria-hidden="true"
      className="w-full max-w-[280px] space-y-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Search bar */}
      <div className="flex items-center gap-2 rounded-lg border border-teal-500/40 bg-white px-3 py-2.5 shadow-sm">
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 text-juri-muted"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>

        <span className="min-w-0 flex-1 overflow-hidden font-dmSans text-[11px] text-teal-700">
          {typed}
          {/* blinking cursor while typing */}
          <Motion.span
            className="inline-block text-teal-600"
            animate={{ opacity: doneTyping ? 0 : [1, 0, 1] }}
            transition={{ duration: 0.6, repeat: doneTyping ? 0 : Infinity }}
          >
            |
          </Motion.span>
        </span>
      </div>

      {/* Searching indicator */}
      <Motion.div
        className="overflow-hidden rounded-lg border border-teal-500/40 bg-white px-3 py-2 shadow-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: doneTyping ? 1 : 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center gap-2">
          <Motion.div
            className="h-1.5 w-1.5 rounded-full bg-teal-600"
            animate={{ scale: [1, 1.5, 1] }}
            transition={{ duration: 0.6, repeat: 3 }}
          />
          <span className="font-dmSans text-[10px] text-juri-muted">
            Searching precedents…
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-1 w-full overflow-hidden rounded bg-teal-200/80">
          <Motion.div
            className="h-full rounded bg-teal-500/60"
            initial={{ width: "0%" }}
            animate={{ width: doneTyping ? "100%" : "0%" }}
            transition={{ duration: 0.9, ease: "easeInOut" }}
          />
        </div>
      </Motion.div>

      {/* Result cards */}
      {RESULTS.map(({ court, year, relevance }, i) => (
        <Motion.div
          key={`${court}-${year}`}
          className="rounded-lg border border-teal-500/40 bg-white p-3 shadow-sm"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: resultDelay + 0.95 + i * 0.4,
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="font-dmSans text-[11px] font-semibold text-teal-700">
                {court}
              </div>
              <div className="font-dmSans text-[10px] text-juri-muted">{year}</div>
            </div>
            <span className="flex-shrink-0 rounded border border-teal-400/35 bg-teal-500/10 px-1.5 py-0.5 font-dmSans text-[9px] text-teal-600">
              Judgment
            </span>
          </div>

          <div className="mb-2 h-1.5 w-full rounded bg-teal-200/80" />

          {/* Relevance dots fill in one by one */}
          <div className="flex items-center gap-1">
            <span className="mr-1 font-dmSans text-[9px] text-juri-muted">
              Relevance
            </span>
            {Array.from({ length: 5 }, (_, dotIndex) => (
              <Motion.div
                key={dotIndex}
                className={[
                  "h-2 w-2 rounded-full",
                  dotIndex < relevance ? "bg-teal-600" : "bg-teal-200/80",
                ].join(" ")}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  delay: resultDelay + 1.1 + i * 0.4 + dotIndex * 0.07,
                  type: "spring",
                  stiffness: 400,
                  damping: 18,
                }}
              />
            ))}
          </div>
        </Motion.div>
      ))}
    </Motion.div>
  )
}

export default ResearchMock
