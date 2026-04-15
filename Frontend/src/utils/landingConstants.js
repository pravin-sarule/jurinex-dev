/** @type {{ label: string, href: string }[]} */
export const NAV_LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "Features", href: "#features" },
  { label: "Testimonials", href: "#testimonials" },
  { label: "Pricing", href: "#pricing" },
]

/** @type {{ id: string; title: string; description: string; icon: string }[]} */
export const FEATURES = [
  {
    id: "research",
    title: "Legal Research AI",
    description:
      "Surface authoritative sources, citations, and precedents in seconds with context-aware retrieval tuned for practice areas.",
    icon: "BookOpen",
  },
  {
    id: "drafting",
    title: "Contract Drafting",
    description:
      "Generate and refine clauses with firm style rules, defined terms, and red-flag detection before you send a draft.",
    icon: "FilePenLine",
  },
  {
    id: "intelligence",
    title: "Case Intelligence",
    description:
      "Synthesize filings, timelines, and exposure so teams align on strategy without drowning in documents.",
    icon: "Brain",
  },
  {
    id: "compliance",
    title: "Compliance Monitoring",
    description:
      "Track regulatory change, map obligations to matters, and get alerts when policies need an update.",
    icon: "ShieldCheck",
  },
]

/** @type {string[]} */
export const TRUSTED_FIRMS = [
  "Dentons",
  "Trilegal",
  "Clifford Chance",
  "Latham & Watkins",
  "AZB & Partners",
  "Allen & Overy",
  "Khaitan & Co",
  "Herbert Smith Freehills",
  "Cyril Amarchand",
  "White & Case",
]

/** @type {{ heading: string; links: { title: string; href: string }[] }[]} */
export const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { title: "Platform", href: "#platform" },
      { title: "Features", href: "#features" },
      { title: "Integrations", href: "#integrations" },
      { title: "Pricing", href: "#pricing" },
    ],
  },
  {
    heading: "Trust",
    links: [
      { title: "Security", href: "#security" },
      { title: "Compliance", href: "#compliance" },
      { title: "Status", href: "#status" },
    ],
  },
  {
    heading: "Company",
    links: [
      { title: "About", href: "#about" },
      { title: "Careers", href: "#careers" },
      { title: "Privacy", href: "#privacy" },
      { title: "Terms", href: "#terms" },
      { title: "Contact", href: "#contact" },
    ],
  },
]

export const HERO_COPY = {
  eyebrow: "⚖ AI-Powered Legal Intelligence",
  titleMain: "Intelligent Assistant for",
  titleItalic: "Legal Professionals",
  subtitle:
    "Work Faster, Practice Smarter with Power of AI. ",
  primaryCta: "Book a Demo",
  secondaryCta: "Login",
  trustLine: "Trusted by 500+ legal firms worldwide",
}

export const CTA_COPY = {
  heading: "Ready to Transform Your Legal Practice?",
  button: "Book a Free Demo",
}

/**
 * @type {{
 *   id: string;
 *   number: string;
 *   title: string;
 *   description: string;
 *   bullets: string[];
 *   align: 'left' | 'right';
 *   mockupType: 'summary' | 'draft' | 'cite' | 'research';
 * }[]}
 */
export const FEATURES_CARDS = [
  {
    id: "summary",
    number: "01",
    title: "Document Summarization",
    description:
      "Extract key clauses, risks, and obligations from contracts instantly.",
    bullets: [
      "Key clause extraction",
      "Risk flagging",
      "Multi-document batch processing",
    ],
    align: "left",
    mockupType: "summary",
  },
  {
    id: "draft",
    number: "02",
    title: "AI-Powered Drafting",
    description:
      "Generate contracts, pleadings, notices with jurisdiction-aware AI.",
    bullets: [
      "Clause suggestions",
      "Jurisdiction-aware language",
      "Template library",
    ],
    align: "right",
    mockupType: "draft",
  },
  {
    id: "cite",
    number: "03",
    title: "Inline Citation & References",
    description:
      "Every answer backed by citations linked to SCC, AIR, Manupatra.",
    bullets: [
      "Automatic case law citation",
      "Linked to databases",
      "Indian citation formats",
    ],
    align: "left",
    mockupType: "cite",
  },
  {
    id: "research",
    number: "04",
    title: "Deep Legal Research",
    description:
      "Natural language search across judgments and statutes.",
    bullets: [
      "NLP queries",
      "Ranked by relevance",
      "Indian & global law",
    ],
    align: "right",
    mockupType: "research",
  },
]
