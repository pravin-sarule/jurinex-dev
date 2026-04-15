import { useState, useEffect } from "react"
import { motion as Motion } from "framer-motion"

const CODE_LINES = [
  { text: `const agreement = {`, cls: "text-juri-muted" },
  { text: `  parties: ["Client", "Firm"],`, cls: "rounded bg-teal-500/10 px-2 text-teal-600" },
  { text: `  jurisdiction: "India",`, cls: "rounded bg-teal-500/10 px-2 text-teal-600" },
  { text: `  governing_law: "ICA 1872",`, cls: "rounded bg-teal-500/10 px-2 text-teal-600" },
  { text: `}`, cls: "text-juri-muted" },
]

const DraftMock = () => {
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setCycle((c) => c + 1), 5500)
    return () => clearInterval(t)
  }, [])

  return (
    <div aria-hidden="true" className="w-full max-w-[280px]">
      <Motion.div
        key={cycle}
        className="overflow-hidden rounded-xl border border-teal-500/40 bg-white shadow-sm font-mono text-[11px]"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Window chrome */}
        <div className="flex items-center gap-1.5 border-b border-teal-500/30 bg-teal-50/50 px-4 py-3">
          <div className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
          <div className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
          <span className="ml-2 font-dmSans text-[10px] text-juri-muted">
            contract_draft.doc
          </span>
        </div>

        {/* Code lines — each "types" in */}
        <div className="space-y-1.5 p-4">
          {CODE_LINES.map((line, i) => (
            <div key={i} className="overflow-hidden">
              <Motion.div
                className={line.cls}
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: i * 0.32 + 0.15,
                  duration: 0.3,
                  ease: "easeOut",
                }}
              >
                {line.text}
                {/* blinking cursor on the last line */}
                {i === CODE_LINES.length - 1 && (
                  <Motion.span
                    className="inline-block text-teal-700"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                  >
                    |
                  </Motion.span>
                )}
              </Motion.div>
            </div>
          ))}
        </div>

        {/* AI Suggestion slides up after typing */}
        <Motion.div
          className="mx-4 mb-4 rounded-lg border border-teal-400/30 bg-teal-500/10 p-3"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            delay: CODE_LINES.length * 0.32 + 0.5,
            duration: 0.45,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <Motion.div
              className="h-1.5 w-1.5 rounded-full bg-teal-600"
              animate={{ scale: [1, 1.5, 1] }}
              transition={{
                delay: CODE_LINES.length * 0.32 + 1.0,
                duration: 0.5,
                repeat: 3,
              }}
            />
            <span className="font-dmSans text-[10px] font-semibold text-teal-600">
              AI Suggestion
            </span>
          </div>
          <Motion.p
            className="font-dmSans text-[11px] text-teal-700"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: CODE_LINES.length * 0.32 + 0.75, duration: 0.3 }}
          >
            Add indemnity clause for IP disputes?
          </Motion.p>
        </Motion.div>
      </Motion.div>
    </div>
  )
}

export default DraftMock
