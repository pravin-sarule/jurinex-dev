import PropTypes from "prop-types"
import { useNavigate } from "react-router-dom"
import { Eyebrow, Icon, Reveal } from "./primitives"

/* ------------------------------------------------------------------ */
/* Lightweight product-UI mocks (pure JSX — no images to load)        */
/* ------------------------------------------------------------------ */

const MockFrame = ({ children, label }) => (
  <div className="relative w-full" aria-hidden="true">
    <div className="absolute -inset-4 rounded-3xl bg-nx-teal/8 blur-2xl" />
    <div className="relative overflow-hidden rounded-2xl border border-nx-ink/75 bg-white shadow-[0_28px_60px_-24px_rgba(6,52,44,0.28)]">
      <div className="flex items-center gap-2 border-b border-nx-line bg-nx-pale px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          <span className="h-2 w-2 rounded-full bg-slate-300" />
          <span className="h-2 w-2 rounded-full bg-slate-300" />
        </span>
        <span className="text-[11px] font-medium text-nx-muted">{label}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
)

MockFrame.propTypes = { children: PropTypes.node, label: PropTypes.string }

const AnalyzeMock = () => (
  <MockFrame label="Document Intelligence — Ground Summary">
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-nx-teal/40 bg-nx-teal/4 px-4 py-3">
      <Icon name="UploadCloud" className="h-5 w-5 text-nx-teal" />
      <div className="flex-1">
        <p className="text-xs font-semibold text-nx-ink">Special_Leave_Petition.pdf</p>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-nx-line">
          <div className="h-full w-full rounded-full bg-nx-teal" />
        </div>
      </div>
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        Processed
      </span>
    </div>
    <div className="mt-4 space-y-2.5">
      {[
        ["Parties", "Petitioner: M/s Sharma Traders · Respondent: State of Maharashtra"],
        ["Grounds", "3 grounds identified — jurisdiction, natural justice, limitation"],
        ["Key dates", "Impugned order 12 Jan 2026 · Filing window closes 11 Apr 2026"],
        ["Reliefs sought", "Stay of demand · Quashing of assessment order"],
      ].map(([k, v]) => (
        <div key={k} className="flex items-start gap-3 rounded-lg bg-nx-pale px-3.5 py-2.5">
          <span className="w-24 flex-none pt-px text-[10px] font-bold uppercase tracking-wide text-nx-faint">
            {k}
          </span>
          <span className="text-xs leading-relaxed text-nx-ink">{v}</span>
        </div>
      ))}
    </div>
  </MockFrame>
)

const AssistantMock = () => (
  <MockFrame label="Legal AI Assistant — Sharma v. State">
    <div className="space-y-3">
      <div className="ml-auto max-w-[80%] rounded-xl rounded-tr-sm bg-nx-teal px-3.5 py-2.5 text-xs leading-relaxed text-white">
        Which annexure supports the natural-justice ground?
      </div>
      <div className="max-w-[90%] rounded-xl rounded-tl-sm border border-nx-line bg-white p-3.5 shadow-sm">
        <p className="text-xs leading-relaxed text-nx-ink">
          Annexure D (p. 63) — the show-cause notice granted only{" "}
          <span className="font-semibold">48 hours to reply</span>, and Annexure F
          records that the personal hearing was declined. Both support the ground
          of breach of natural justice.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {["Annexure D · p. 63", "Annexure F · p. 81"].map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-nx-pale px-2 py-0.5 text-[10px] font-medium text-nx-teal"
            >
              <Icon name="Link2" className="h-2.5 w-2.5" />
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="ml-auto max-w-[80%] rounded-xl rounded-tr-sm bg-nx-teal px-3.5 py-2.5 text-xs leading-relaxed text-white">
        Find Supreme Court authority on inadequate reply time.
      </div>
      <div className="flex items-center gap-2 pl-1 text-[11px] text-nx-muted">
        <span className="flex h-5 w-5 items-center justify-center rounded bg-nx-teal text-white">
          <Icon name="Sparkles" className="h-3 w-3" />
        </span>
        Searching Indian Kanoon…
      </div>
    </div>
  </MockFrame>
)

const InsightsMock = () => (
  <MockFrame label="Case Insights — Chronology & Evidence Matrix">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-nx-faint">Chronology</p>
        <div className="mt-2.5 space-y-0">
          {[
            ["04 Nov 2025", "Show-cause notice issued"],
            ["06 Nov 2025", "Reply filed — 48-hour window"],
            ["12 Jan 2026", "Assessment order passed"],
            ["09 Mar 2026", "Appeal window closing", true],
          ].map(([date, event, warn], i, arr) => (
            <div key={date} className="relative flex gap-3 pb-3.5">
              {i < arr.length - 1 && (
                <span className="absolute left-[5px] top-3.5 h-full w-px bg-nx-line" />
              )}
              <span
                className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${
                  warn ? "bg-amber-400" : "bg-nx-teal"
                }`}
              />
              <div>
                <p className="text-[10px] font-semibold text-nx-faint">{date}</p>
                <p className="text-xs font-medium text-nx-ink">{event}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-nx-faint">
          Evidence Matrix
        </p>
        <div className="mt-2.5 space-y-1.5">
          {[
            ["Exh. P-4", "Delivery challans", "Ground 1", "emerald"],
            ["Exh. P-9", "Bank statements", "Ground 3", "emerald"],
            ["Exh. R-2", "Inspection report", "Disputed", "amber"],
          ].map(([exh, doc, tag, tone]) => (
            <div
              key={exh}
              className="flex items-center gap-2.5 rounded-lg border border-nx-line px-3 py-2"
            >
              <span className="text-[10px] font-bold text-nx-teal-ink">{exh}</span>
              <span className="flex-1 truncate text-xs text-nx-ink">{doc}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${
                  tone === "amber"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {tag}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-800">
          <span className="font-semibold">Gap flagged:</span> no evidence mapped to
          Ground 2 yet.
        </div>
      </div>
    </div>
  </MockFrame>
)

/* ------------------------------------------------------------------ */

const SHOWCASES = [
  {
    id: "showcase-analyze",
    eyebrow: "Document Intelligence",
    title: "Analyze Documents in Seconds",
    text: "Upload the entire brief — including scans — and get back structure instead of a pile of pages. Parties, grounds, dates, and reliefs are extracted the moment processing finishes.",
    bullets: [
      "Upload PDFs, DOCX, and scanned documents with built-in OCR",
      "AI processes every page and indexes the full matter",
      "Key facts, clauses, and obligations extracted automatically",
      "Structured, ground-wise summaries — not vague abstracts",
    ],
    cta: "Explore Document Intelligence",
    Mock: AnalyzeMock,
  },
  {
    id: "showcase-ask",
    eyebrow: "Legal AI Assistant",
    title: "Ask Your Documents Anything",
    text: "Interrogate your case file the way you'd brief a junior — in plain language. Every answer is grounded in your own papers and shows exactly where it came from.",
    bullets: [
      "Context-aware answers drawn from the full case record",
      "References back to the exact document, page, and paragraph",
      "Follow-up questions keep the conversation's context",
      "Extend into Indian Kanoon research without leaving the chat",
    ],
    cta: "See the Assistant in Action",
    Mock: AssistantMock,
  },
  {
    id: "showcase-insights",
    eyebrow: "Case Analysis",
    title: "Turn Complex Documents Into Clear Insights",
    text: "Jurinex assembles the analytical scaffolding of a matter for you — a chronology of events, an evidence matrix mapped to grounds, and flags where the record is thin.",
    bullets: [
      "Auto-built chronology from dates across every document",
      "Evidence matrix linking each exhibit to the ground it supports",
      "Key dates, obligations, and risk indicators surfaced",
      "Gaps and missing information flagged before the other side finds them",
    ],
    cta: "Explore Case Insights",
    Mock: InsightsMock,
  },
]

/**
 * Three deep-dive feature sections with alternating layout. All CTAs lead
 * to account creation — the real entry point into the product.
 */
const FeatureShowcase = () => {
  const navigate = useNavigate()

  return (
    <section className="bg-nx-pale py-20 sm:py-28" aria-label="Product showcase">
      <div className="mx-auto max-w-7xl space-y-24 px-5 sm:px-8 lg:space-y-32">
        {SHOWCASES.map((showcase, i) => {
          const { id, eyebrow, title, text, bullets, cta } = showcase
          const Mock = showcase.Mock
          const flip = i % 2 === 1
          return (
            <div
              key={id}
              className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16"
            >
              <Reveal className={flip ? "lg:order-2" : ""}>
                <Eyebrow>{eyebrow}</Eyebrow>
                <h2
                  id={id}
                  className="mt-3 font-display text-3xl font-semibold leading-[1.15] tracking-tight text-nx-ink sm:text-4xl"
                >
                  {title}
                </h2>
                <p className="mt-4 text-base leading-relaxed text-nx-muted">{text}</p>
                <ul className="mt-6 space-y-3">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-3">
                      <Icon
                        name="CircleCheck"
                        className="mt-0.5 h-5 w-5 flex-none text-nx-teal"
                      />
                      <span className="text-sm leading-relaxed text-nx-ink">{b}</span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => navigate("/register")}
                  className="mt-7 inline-flex items-center gap-2 text-sm font-semibold text-nx-teal transition-colors hover:text-nx-teal-deep"
                >
                  {cta}
                  <Icon name="ArrowRight" className="h-4 w-4" />
                </button>
              </Reveal>

              <Reveal delay={0.12} y={30} className={flip ? "lg:order-1" : ""}>
                <Mock />
              </Reveal>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default FeatureShowcase
