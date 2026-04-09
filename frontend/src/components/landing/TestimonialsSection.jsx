import { useState, useRef, useEffect, useCallback } from "react"
import { motion as Motion } from "framer-motion"
import legalBg from "../../assets/advocate.png"

const TESTIMONIALS = [
    {
        id: "t1",
        quote: "JuriNex cut our contract review time by 70%. The inline citations linked directly to SCC are a game-changer for our litigation team.",
        name: "Priya Sharma",
        title: "Partner",
        firm: "Khaitan & Co",
        initials: "PS",
        color: "from-teal-500/20 to-cyan-50",
    },
    {
        id: "t2",
        quote: "We were sceptical about AI in legal work. JuriNex changed that. The AI drafts feel like they came from a senior associate, not a chatbot.",
        name: "Arjun Mehta",
        title: "Managing Partner",
        firm: "AZB & Partners",
        initials: "AM",
        color: "from-teal-100 to-cyan-50",
    },
    {
        id: "t3",
        quote: "Our research cycle went from days to hours. The jurisdiction-aware summaries are remarkably accurate for both High Court and Supreme Court matters.",
        name: "Deepa Iyer",
        title: "Head of Litigation",
        firm: "Trilegal",
        initials: "DI",
        color: "from-teal-500/20 to-cyan-50",
    },
    {
        id: "t4",
        quote: "Client confidentiality was our biggest concern. JuriNex's client-matter isolation and audit trails gave us complete peace of mind.",
        name: "Rahul Singhania",
        title: "General Counsel",
        firm: "Mahindra Group",
        initials: "RS",
        color: "from-teal-100 to-cyan-50",
    },
    {
        id: "t5",
        quote: "The matter intelligence module is like having an extra senior associate on every case — synthesising filings and flagging critical timelines automatically.",
        name: "Sneha Kapoor",
        title: "Senior Associate",
        firm: "Cyril Amarchand Mangaldas",
        initials: "SK",
        color: "from-teal-500/20 to-cyan-50",
    },
    {
        id: "t6",
        quote: "Implementation took one afternoon. Our team was fully onboarded within a week. The ROI was visible in the first billing cycle.",
        name: "Vikram Nair",
        title: "COO",
        firm: "Dentons India",
        initials: "VN",
        color: "from-teal-100 to-cyan-50",
    },
]

const N     = TESTIMONIALS.length   // 6
const GAP   = 16                     // px between cards
const TRACK = [...TESTIMONIALS, ...TESTIMONIALS, ...TESTIMONIALS]

const getVisible = (width) => {
    if (width < 640)  return 1
    if (width < 1024) return 2
    return 4
}

const StarIcon = () => (
    <svg className="h-3.5 w-3.5 text-teal-600" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 1l1.854 4.146L14 5.5l-3 3 .854 4.5L8 10.5 5.146 13 6 8.5l-3-3 4.146-.354z" />
    </svg>
)

const TestimonialCard = ({ testimonial, width }) => (
    <article
        className="flex flex-shrink-0 flex-col rounded-2xl border border-teal-300/60 bg-white p-6 shadow-[0_6px_28px_rgba(13,148,136,0.22)]"
        style={{ width }}
    >
        <div className="mb-4 flex gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => <StarIcon key={i} />)}
        </div>
        <blockquote className="flex-1 font-dmSans text-sm leading-relaxed text-juri-muted">
            &ldquo;{testimonial.quote}&rdquo;
        </blockquote>
        <footer className="mt-5 flex items-center gap-3">
            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${testimonial.color} border border-teal-300/60`}>
                <span className="font-playfair text-xs font-bold text-teal-600">{testimonial.initials}</span>
            </div>
            <div>
                <p className="font-dmSans text-sm font-semibold text-teal-700">{testimonial.name}</p>
                <p className="font-dmSans text-xs text-juri-muted">{testimonial.title}, {testimonial.firm}</p>
            </div>
        </footer>
    </article>
)

const ArrowBtn = ({ onClick, disabled, children }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white p-3 shadow-[0_2px_14px_rgba(13,148,136,0.22)] transition-all hover:scale-105 hover:shadow-[0_4px_22px_rgba(13,148,136,0.32)] active:scale-95 disabled:opacity-40"
        aria-label={typeof children === "string" ? children : undefined}
    >
        {children}
    </button>
)

const TestimonialsCarousel = () => {
    const containerRef  = useRef(null)
    const [cardWidth, setCardWidth]       = useState(0)
    const [trackIdx, setTrackIdx]         = useState(N)   // start at middle copy
    const [animate, setAnimate]           = useState(true) // false = instant (no transition)
    const [busy, setBusy]                 = useState(false)
    const [paused, setPaused]             = useState(false)
    const busyRef = useRef(false)

    // Keep busyRef in sync so the interval can read it without stale closure
    useEffect(() => { busyRef.current = busy }, [busy])

    // Recalculate card width + visible count when container resizes
    const calcWidth = useCallback(() => {
        if (containerRef.current) {
            const cw = containerRef.current.offsetWidth
            const v  = getVisible(cw)
            setCardWidth((cw - GAP * (v - 1)) / v)
        }
    }, [])

    useEffect(() => {
        calcWidth()
        const ro = new ResizeObserver(calcWidth)
        if (containerRef.current) ro.observe(containerRef.current)
        return () => ro.disconnect()
    }, [calcWidth])

    // Auto-scroll every 3.5 s; pause when user hovers
    useEffect(() => {
        if (paused) return
        const id = setInterval(() => {
            if (busyRef.current) return
            setBusy(true)
            setAnimate(true)
            setTrackIdx(i => i + 1)
        }, 3500)
        return () => clearInterval(id)
    }, [paused])

    const slotW = cardWidth + GAP   // width of one card slot

    const go = (dir) => {
        if (busy || cardWidth === 0) return
        setBusy(true)
        setAnimate(true)
        setTrackIdx(i => i + dir)
    }

    // After CSS transition ends — silently snap back if we've drifted to outer copies
    const onTransitionEnd = () => {
        setAnimate(false)   // disable transition for instant reset
        setTrackIdx(i => {
            if (i >= 2 * N) return i - N
            if (i < N)       return i + N
            return i
        })
        // Re-enable transition after DOM has painted the reset
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setAnimate(true)
                setBusy(false)
            })
        })
    }

    const translateX = -(trackIdx * slotW)
    const activeIdx  = ((trackIdx % N) + N) % N   // 0-5

    return (
        <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            {/* Carousel row: arrow + track + arrow */}
            <div className="flex items-center gap-4">
                <ArrowBtn onClick={() => go(-1)} disabled={busy}>
                    <svg className="h-5 w-5 text-teal-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                </ArrowBtn>

                {/* Track container — overflow hidden */}
                <div className="flex-1 overflow-hidden" ref={containerRef}>
                    <div
                        className="flex"
                        style={{
                            gap: GAP,
                            transform: `translateX(${translateX}px)`,
                            transition: animate ? "transform 0.42s cubic-bezier(0.4,0,0.2,1)" : "none",
                            willChange: "transform",
                        }}
                        onTransitionEnd={onTransitionEnd}
                    >
                        {TRACK.map((t, i) => (
                            <TestimonialCard key={`${t.id}-${i}`} testimonial={t} width={cardWidth} />
                        ))}
                    </div>
                </div>

                <ArrowBtn onClick={() => go(1)} disabled={busy}>
                    <svg className="h-5 w-5 text-teal-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                </ArrowBtn>
            </div>

            {/* Dot indicators */}
            <div className="mt-7 flex items-center justify-center gap-2">
                {TESTIMONIALS.map((_, i) => (
                    <button
                        key={i}
                        onClick={() => {
                            if (busy) return
                            setAnimate(true)
                            setBusy(true)
                            // find shortest path in current copy
                            setTrackIdx(cur => {
                                const base = ((cur % N) + N) % N
                                const diff = i - base
                                return cur + diff
                            })
                            setTimeout(() => setBusy(false), 450)
                        }}
                        className={[
                            "rounded-full transition-all duration-300",
                            i === activeIdx
                                ? "w-6 h-2.5 bg-teal-600"
                                : "w-2.5 h-2.5 bg-teal-200/80 hover:bg-teal-500/40",
                        ].join(" ")}
                        aria-label={`Go to testimonial ${i + 1}`}
                    />
                ))}
            </div>
        </div>
    )
}

const TestimonialsSection = () => (
    <section
        id="testimonials"
        className="relative overflow-hidden py-24 sm:py-32"
        aria-labelledby="testimonials-heading"
        style={{
            backgroundImage: `url(${legalBg})`,
            backgroundSize: "cover",
            backgroundPosition: "center center",
            backgroundAttachment: "fixed",
        }}
    >
        {/* Teal overlay so text remains readable over the image */}
        <div className="pointer-events-none absolute inset-0 bg-teal-900/45" aria-hidden="true" />

        <div className="relative mx-auto max-w-7xl px-6 sm:px-10 lg:px-14">
            {/* Header */}
            <Motion.div
                className="mb-14 text-center"
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            >
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
                    <span className="font-dmSans text-xs font-medium tracking-wide text-white">
                        Trusted By Legal Professionals
                    </span>
                </div>
                <h2
                    id="testimonials-heading"
                    className="font-playfair text-3xl font-bold text-white sm:text-4xl lg:text-[2.75rem] lg:leading-tight"
                >
                    Hear from the firms{" "}
                    <em className="not-italic text-teal-600">already transforming</em>
                </h2>
                <p className="mx-auto mt-4 max-w-xl font-dmSans text-base text-white/75">
                    4,000+ legal professionals across India use JuriNex every day.
                    Here&apos;s what they have to say.
                </p>
            </Motion.div>

            {/* Carousel */}
            <TestimonialsCarousel />

        </div>
    </section>
)

export default TestimonialsSection

