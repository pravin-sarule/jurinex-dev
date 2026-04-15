import { useState, useEffect } from "react"
import { motion as Motion } from "framer-motion"

const CITATIONS = [
  { num: "1", title: "AIR 2022 SC 445", source: "AIR", variant: "gold" },
  { num: "2", title: "(2021) 8 SCC 234", source: "SCC", variant: "blue" },
  { num: "3", title: "Manu/SC/1234/2023", source: "MANU", variant: "gold" },
]

const CiteMock = () => {
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setCycle((c) => c + 1), 5000)
    return () => clearInterval(t)
  }, [])

  return (
    <Motion.div
      key={cycle}
      aria-hidden="true"
      className="w-full max-w-[280px] space-y-2.5"
      initial="hidden"
      animate="visible"
    >
      {/* "Searching…" label */}
      <Motion.div
        className="flex items-center gap-2 px-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Motion.div
          className="h-1.5 w-1.5 rounded-full bg-teal-600"
          animate={{ scale: [1, 1.4, 1] }}
          transition={{ duration: 0.7, repeat: 2 }}
        />
        <span className="font-dmSans text-[10px] text-juri-muted">
          Found 3 matching citations
        </span>
      </Motion.div>

      {CITATIONS.map(({ num, title, source, variant }, i) => (
        <Motion.div
          key={num}
          className="flex items-start gap-3 rounded-lg border border-teal-500/40 bg-white p-3 shadow-sm"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{
            delay: i * 0.45 + 0.3,
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1],
          }}
        >
          {/* Numbered circle */}
          <Motion.div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-teal-400/40 bg-teal-500/10"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              delay: i * 0.45 + 0.45,
              type: "spring",
              stiffness: 350,
              damping: 20,
            }}
          >
            <span className="font-dmSans text-[10px] font-bold text-teal-600">
              {num}
            </span>
          </Motion.div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="truncate font-dmSans text-[11px] font-semibold text-teal-700">
              {title}
            </div>

            {/* Skeleton line → fills to full */}
            <div className="relative mt-1.5 h-1.5 w-5/6 overflow-hidden rounded bg-teal-200/80">
              <Motion.div
                className="absolute inset-y-0 left-0 rounded bg-teal-500/25"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ delay: i * 0.45 + 0.6, duration: 0.5 }}
              />
            </div>

            {/* Source badge pops in */}
            <Motion.span
              className={[
                "mt-2 inline-block rounded px-1.5 py-0.5 font-dmSans text-[9px]",
                variant === "blue"
                  ? "border border-teal-400/35 bg-teal-500/10 text-teal-600"
                  : "border border-teal-400/35 bg-teal-500/10 text-teal-600",
              ].join(" ")}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: i * 0.45 + 0.75,
                type: "spring",
                stiffness: 300,
                damping: 18,
              }}
            >
              {source}
            </Motion.span>
          </div>
        </Motion.div>
      ))}
    </Motion.div>
  )
}

export default CiteMock
