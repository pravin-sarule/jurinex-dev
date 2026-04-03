import { useState, useEffect } from "react"
import { motion as Motion } from "framer-motion"

// Document lines: plain gray lines scan in first, then highlights appear
const SummaryMock = () => {
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setCycle((c) => c + 1), 5000)
    return () => clearInterval(t)
  }, [])

  return (
    <div aria-hidden="true" className="w-full max-w-[280px]">
      <Motion.div
        key={cycle}
        className="overflow-hidden rounded-xl border border-juri-line bg-white shadow-sm"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-juri-line bg-juri-canvas px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-teal-500/50" />
            <span className="font-dmSans text-[11px] text-juri-muted">
              Contract_NDA_2024.pdf
            </span>
          </div>
          <span className="rounded border border-teal-400/35 bg-teal-500/10 px-1.5 py-0.5 font-dmSans text-[9px] font-semibold text-teal-600">
            PDF
          </span>
        </div>

        {/* Scanning progress bar */}
        <div className="h-0.5 bg-juri-line">
          <Motion.div
            className="h-full bg-gradient-to-r from-teal-500/70 to-teal-600"
            initial={{ width: "0%" }}
            animate={{ width: "100%" }}
            transition={{ duration: 1.8, ease: "easeInOut", delay: 0.2 }}
          />
        </div>

        {/* Document body */}
        <div className="space-y-2.5 p-4">
          {/* Plain lines */}
          {[1, 0.8].map((w, i) => (
            <Motion.div
              key={i}
              className="h-2 rounded bg-juri-line"
              style={{ width: `${w * 100}%`, originX: 0 }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: 0.4 + i * 0.2, duration: 0.35 }}
            />
          ))}

          {/* Payment Clause highlighted row */}
          <Motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.0, duration: 0.35 }}
          >
            <div className="h-2 flex-1 rounded bg-teal-500/20" />
            <Motion.span
              className="whitespace-nowrap rounded-full border border-teal-400/35 bg-teal-500/10 px-2 py-1 font-dmSans text-[9px] text-teal-600"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 1.25,
                type: "spring",
                stiffness: 320,
                damping: 18,
              }}
            >
              ⚠ Payment Clause
            </Motion.span>
          </Motion.div>

          {/* Middle plain line */}
          <Motion.div
            className="h-2 w-3/4 rounded bg-juri-line"
            style={{ originX: 0 }}
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ delay: 1.6, duration: 0.3 }}
          />

          {/* Key Obligation highlighted row */}
          <Motion.div
            className="flex items-center gap-2"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 2.0, duration: 0.35 }}
          >
            <div className="h-2 flex-1 rounded bg-cyan-400/20" />
            <Motion.span
              className="whitespace-nowrap rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 font-dmSans text-[9px] text-cyan-700"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 2.25,
                type: "spring",
                stiffness: 320,
                damping: 18,
              }}
            >
              📋 Key Obligation
            </Motion.span>
          </Motion.div>

          {/* Bottom plain lines */}
          {[1, 0.65].map((w, i) => (
            <Motion.div
              key={i}
              className="h-2 rounded bg-juri-line"
              style={{ width: `${w * 100}%`, originX: 0 }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ delay: 2.6 + i * 0.2, duration: 0.3 }}
            />
          ))}
        </div>
      </Motion.div>
    </div>
  )
}

export default SummaryMock
