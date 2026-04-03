import { useState } from "react"
import { motion as Motion } from "framer-motion"

const PLANS = [
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Custom enterprise plan - Contact sales for pricing and features",
    monthlyPrice: null,
    annualPrice: null,
    monthlyPeriod: null,
    annualPeriod: null,
    features: [
      "Customizable Systems (Tailored to your requirements)",
      "Custom Case Management (Designed for your workflow)",
      "Advanced Context Memory (Customizable retention policies)",
      "Custom Prompts & Templates (Built for your firm)",
      "Unlimited Users (Scalable to your organization size)",
      "Storage: Custom Storage (Scalable based on requirements)",
      "Usage: Custom Usage Limits (Tailored to your needs)",
    ],
    cta: "Select Plan",
    monthlyHighlighted: false,
    annualHighlighted: true,
  },
  {
    id: "free",
    name: "Free",
    description: "Free plan with limited time and features",
    monthlyPrice: "₹0",
    annualPrice: "₹0",
    monthlyPeriod: null,
    annualPeriod: null,
    features: [
      "System 1 + System 2 (Chat + Deep Case Mgmt)",
      "Full Project Folders (Interact with 50+ docs)",
      "Context Caching (Remembers entire case)",
      "Unlock ALL Prompts (+ Drafting, Evidence Matrix, Strategy, Cross-Exam)",
      "1 User",
      "Limited-Time Free Trial",
      "Storage: 10 GB",
      "Usage: FUP",
    ],
    cta: "Select Plan",
    monthlyHighlighted: false,
    annualHighlighted: false,
  },
  {
    id: "law-firm",
    name: "Law Firm",
    description: "Full access for law firms with 5 users",
    monthlyPrice: "₹2",
    annualPrice: "₹59,990",
    monthlyPeriod: "/month",
    annualPeriod: "/year",
    features: [
      "System 1 + System 2 (Multi-User Collaboration)",
      "Shared Project Folders (Junior uploads, Senior analyzes)",
      "Context Caching (Shared Team Context)",
      "Unlock ALL Prompts (+ Custom Firm Templates)",
      "Up to 5 Users",
      "Storage: 50 GB",
      "Usage: FUP",
    ],
    cta: "Select Plan",
    monthlyHighlighted: true,
    annualHighlighted: false,
  },
  {
    id: "solo-lawyer",
    name: "Solo Lawyer",
    description: "Full access for individual lawyers",
    monthlyPrice: "₹1",
    annualPrice: "₹24,990",
    monthlyPeriod: "/month",
    annualPeriod: "/year",
    features: [
      "System 1 + System 2 (Chat + Deep Case Mgmt)",
      "Full Project Folders (Interact with 50+ docs)",
      "Context Caching (Remembers entire case)",
      "Unlock ALL Prompts (+ Drafting, Evidence Matrix, Strategy, Cross-Exam)",
      "1 User",
      "Storage: 10 GB",
      "Usage: FUP",
    ],
    cta: "Select Plan",
    monthlyHighlighted: false,
    annualHighlighted: false,
  },
]

const CheckIcon = () => (
  <svg
    className="h-4 w-4 flex-shrink-0 text-teal-600"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M3.5 8.5l3 3 6-6"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const PricingSection = () => {
  const [billing, setBilling] = useState("monthly")
  const isAnnual = billing === "annual"

  return (
    <section
      id="pricing"
      className="bg-white py-20 sm:py-28"
      aria-labelledby="pricing-heading"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <Motion.div
          className="text-center"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <h2
            id="pricing-heading"
            className="font-playfair text-3xl font-bold text-juri-ink sm:text-4xl"
          >
            Choose Your Plan
          </h2>
          <p className="mx-auto mt-4 max-w-xl font-dmSans text-base text-juri-muted">
            Select the perfect plan for your legal practice. All plans include our core
            AI features with scalable pricing.
          </p>

          {/* Toggle */}
          <div className="mt-8 inline-flex items-center gap-3">
            <div className="relative flex rounded-full border border-juri-line bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setBilling("monthly")}
                className={`rounded-full px-6 py-2 font-dmSans text-sm font-semibold transition-all duration-200 ${
                  !isAnnual
                    ? "bg-teal-600 text-white shadow"
                    : "text-juri-ink hover:text-juri-muted"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBilling("annual")}
                className={`rounded-full px-6 py-2 font-dmSans text-sm font-semibold transition-all duration-200 ${
                  isAnnual
                    ? "bg-teal-600 text-white shadow"
                    : "text-juri-ink hover:text-juri-muted"
                }`}
              >
                Annual
              </button>
            </div>
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-dmSans text-xs font-semibold text-emerald-700">
              Save 20%
            </span>
          </div>
        </Motion.div>

        {/* Cards */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan, i) => {
            const price = isAnnual ? plan.annualPrice : plan.monthlyPrice
            const period = isAnnual ? plan.annualPeriod : plan.monthlyPeriod
            return (
              <Motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 32 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="group flex flex-col rounded-2xl border border-juri-line bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-2 hover:border-teal-500 hover:shadow-[0_8px_32px_rgba(13,148,136,0.2)]"
              >
                {/* Plan name */}
                <h3 className="text-center font-playfair text-lg font-semibold text-juri-ink transition-colors duration-300 group-hover:text-teal-600">
                  {plan.name}
                </h3>

                {/* Description */}
                <p className="mt-2 text-center font-dmSans text-xs leading-snug text-juri-muted">
                  {plan.description}
                </p>

                {/* Price */}
                <div className="mt-5 flex items-end justify-center gap-1">
                  {price ? (
                    <>
                      <span className="font-playfair text-4xl font-bold text-juri-ink">
                        {price}
                      </span>
                      {period && (
                        <span className="mb-1 font-dmSans text-sm text-juri-muted">
                          {period}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="font-dmSans text-sm italic text-juri-muted">
                      Contact us for pricing
                    </span>
                  )}
                </div>

                {/* CTA */}
                <button
                  type="button"
                  className="mt-5 w-full rounded-lg border border-juri-line bg-white py-2.5 font-dmSans text-sm font-medium text-juri-ink transition-all duration-300 active:scale-[0.98] group-hover:border-teal-500 group-hover:bg-teal-600 group-hover:text-white"
                >
                  {plan.cta}
                </button>

                {/* Divider */}
                <hr className="my-5 border-juri-line" />

                {/* Features */}
                <ul className="flex flex-col gap-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <CheckIcon />
                      <span className="font-dmSans text-xs leading-snug text-juri-ink">
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </Motion.div>
            )
          })}
        </div>

        {/* Bottom CTA */}
        <div className="mt-12 flex justify-center">
          <button
            type="button"
            className="rounded-full bg-teal-600 px-10 py-3 font-dmSans text-sm font-semibold text-white shadow-md shadow-teal-500/30 transition-all hover:bg-teal-600/90 active:scale-[0.98]"
          >
            {isAnnual ? "Contact Us" : "Subscribe"}
          </button>
        </div>
      </div>
    </section>
  )
}

export default PricingSection
