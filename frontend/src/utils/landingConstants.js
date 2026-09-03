/**
 * Landing-page content for the Jurinex.ai marketing site.
 * Primary copy mirrors the live production site (jurinex.ai); everything
 * here maps to a shipped capability or published company fact — do not
 * add customer names, statistics, or certifications beyond these.
 */

/**
 * Primary navigation. Items with `children` render a dropdown; every
 * child href is a real on-page anchor or app route.
 * @type {{ label: string, href: string, children?: { label: string, href: string }[] }[]}
 */
export const NAV_LINKS = [
  {
    label: "Product",
    href: "#features",
    children: [
      { label: "Core Features", href: "#features" },
      { label: "Document Intelligence", href: "#showcase-analyze" },
      { label: "Legal AI Assistant", href: "#showcase-ask" },
      { label: "Case Insights", href: "#showcase-insights" },
      { label: "Jurinex Workflow", href: "#workflow" },
      { label: "AI Capabilities", href: "#capabilities" },
    ],
  },
  {
    label: "Solutions",
    href: "#solutions",
    children: [
      { label: "Solo Practitioners", href: "#solutions" },
      { label: "Law Firms & Enterprises", href: "#solutions" },
      { label: "Built for Indian Courts", href: "#indian-courts" },
      { label: "Security & Trust", href: "#security" },
    ],
  },
  { label: "Why Jurinex", href: "#why" },
  {
    label: "Resources",
    href: "#resources",
    children: [
      { label: "Community", href: "#resources" },
      { label: "FAQs", href: "#faq" },
      { label: "Team", href: "#team" },
      { label: "Contact", href: "/contact" },
    ],
  },
  { label: "Pricing", href: "#pricing" },
]

export const HERO_COPY = {
  eyebrow: "AI-Powered Legal Intelligence",
  titleMain: "Enterprise grade legal operating system for Law Professionals",
  titleAccent: "powered by AI",
  subtitle:
    "Work faster, practice smarter with the power of AI. Jurinex handles your research, drafting, citations and case files — purpose-built for Indian courts, supports Indian languages.",
  primaryCta: "Start Free Trial",
  secondaryCta: "Explore the Platform",
  trustLine: "Developed, tried and tested by experienced lawyers",
}

/** Published platform stats (from jurinex.ai). */
export const STATS = [
  { value: "5,00,000+", label: "Pages processed" },
  { value: "95%", label: "Accuracy" },
  { value: "100%", label: "Data residency in India" },
]

/** Trust strip — capability claims only, no invented customers. */
export const TRUST_POINTS = [
  {
    icon: "ShieldCheck",
    title: "Zero-hallucination policy",
    text: "Responses come only from authorised, verified sources — if the system isn't confident, it flags rather than invents.",
  },
  {
    icon: "FolderLock",
    title: "Private case workspaces",
    text: "Each matter lives in its own encrypted vault with role-based access for your team.",
  },
  {
    icon: "Quote",
    title: "Citation-grounded answers",
    text: "Every citation is verified against source databases and shown in court-approved formats.",
  },
  {
    icon: "Scale",
    title: "Built for Indian practice",
    text: "Indian court hierarchy, Indian citation formats, and drafting in Indian languages.",
  },
]

export const PROBLEMS = [
  {
    icon: "FileStack",
    title: "Hours lost to reading",
    text: "Briefs, annexures, and precedents run into hundreds of pages before the real work begins.",
  },
  {
    icon: "SearchX",
    title: "Research that drags",
    text: "Finding the authority that actually supports your ground takes days of database trawling.",
  },
  {
    icon: "ScanSearch",
    title: "Buried clauses and dates",
    text: "The obligation, limitation date, or admission that decides the matter hides on page 214.",
  },
  {
    icon: "CopyX",
    title: "Repetitive drafting",
    text: "The same applications, notices, and replies get rebuilt from scratch, matter after matter.",
  },
  {
    icon: "FolderTree",
    title: "Scattered information",
    text: "Facts live across emails, scans, and drafts — nothing connects them into one case picture.",
  },
  {
    icon: "GitCompareArrows",
    title: "Manual cross-checking",
    text: "Reconciling pleadings against evidence and chronology is slow, error-prone work.",
  },
]

export const SOLUTION_COPY = {
  headline: "One Intelligent Workspace for Your Legal Work",
  text: "Upload a matter once. Jurinex processes every page — including scans — then keeps the entire case in context: summaries, chronology, evidence, research, and drafts all draw from the same understanding of your file.",
  points: [
    "Every document analyzed, OCR included, the moment it lands in the case folder",
    "Ask questions in plain language and get answers grounded in your own papers",
    "Research, chronology, evidence matrix, and drafting share one case context",
  ],
}

/** Core features grid. `span` controls bento sizing: "wide" | "base". */
export const FEATURES = [
  {
    icon: "FileSearch",
    title: "AI Document Analysis",
    text: "Upload petitions, contracts, and scanned briefs. Jurinex reads every page — OCR included — and returns structure, parties, dates, and issues in seconds.",
    span: "wide",
  },
  {
    icon: "ListTree",
    title: "Intelligent Summarization",
    text: "Structured, ground-wise summaries of lengthy filings — not vague abstracts.",
    span: "base",
  },
  {
    icon: "MessageSquareText",
    title: "Legal AI Assistant",
    text: "Ask questions about your case files and get contextual answers that cite the exact passages they rely on.",
    span: "base",
  },
  {
    icon: "BookMarked",
    title: "Citation Research",
    text: "Find Indian Kanoon authorities matched to your pleaded grounds, with checks on whether a judgment still stands.",
    span: "base",
  },
  {
    icon: "FilePenLine",
    title: "AI Drafting",
    text: "Generate applications, notices, and pleadings from templates that follow your structure — section by section, in English or Marathi.",
    span: "base",
  },
  {
    icon: "TableProperties",
    title: "Evidence Matrix & Chronology",
    text: "Auto-built timelines and evidence tables that map each fact to its source document.",
    span: "base",
  },
  {
    icon: "Languages",
    title: "Legal Translation",
    text: "Translate documents between English and regional languages with Devanagari-ready exports.",
    span: "base",
  },
  {
    icon: "FolderLock",
    title: "Secure Case Workspace",
    text: "Organized matter folders with team roles, device-session controls, and private storage — intake to final filing.",
    span: "base",
  },
]

/** The Jurinex workflow — five stages, as published on jurinex.ai. */
export const WORKFLOW_STEPS = [
  {
    num: "01",
    label: "Understand",
    title: "Upload case documents.",
    text: "Scanned FIRs, bulky case files, judgments, affidavits. OCR extracts the text, RAG indexes it for semantic search, chronology builds automatically.",
  },
  {
    num: "02",
    label: "Converse & Summarize",
    title: "Ask anything about the case.",
    text: "Ask questions in plain English across an entire case folder. Surface prior statements, cross-reference dates, and pull key testimony in seconds.",
  },
  {
    num: "03",
    label: "Draft",
    title: "Generate court-ready documents.",
    text: "Bail applications, petitions, writs, agreements. Upload your own templates or use our library. Formatted for the bench you're filing in.",
  },
  {
    num: "04",
    label: "Research & Citation",
    title: "Every citation, verified and reference displayed.",
    text: "Court approved format citations verified against source databases. Zero-hallucination policy — if the system isn't confident, it flags rather than invents.",
  },
  {
    num: "05",
    label: "Storage & Case Lifecycle",
    title: "Every matter, end to end.",
    text: "Encrypted vault storage with full-text search. Track each case from filing through hearings to disposal, with deadlines, status, and a clean archive when it closes.",
  },
]

/** "Built for Indian courts." — the four commitments from jurinex.ai. */
export const INDIAN_COURTS = [
  {
    icon: "Languages",
    title: "Supports Indian languages.",
    text: "Marathi, Hindi, Tamil, Telugu, and other widely spoken Indian languages are supported by the system, enabling it to generate reports in these languages.",
  },
  {
    icon: "Landmark",
    title: "Built for Indian court hierarchy.",
    text: "Drafts are prepared in formats suitable for District Courts, High Courts, Supreme Court, and tribunals.",
  },
  {
    icon: "BadgeCheck",
    title: "Zero hallucination policy.",
    text: "The system retrieves information solely from authorised and verified sources, subjecting each response to multiple verification checks for accuracy.",
  },
  {
    icon: "ShieldCheck",
    title: "Data sensitivity and security.",
    text: "All data storage infrastructure is in India. Complies with the Data Protection and Privacy Act (DPDPA). No cross-border data transfer policy. End-to-end encryption is provided for all data processed.",
  },
]

/** Practice-size fit cards ("Whether you're a solo practitioner…"). */
export const PRACTICE_SIZES = [
  { numeral: "I", title: "Solo Practitioners", seats: "3 seats" },
  { numeral: "II", title: "Small Law Firms", seats: "4 to 10 seats" },
  { numeral: "III", title: "Large Law Firms and Enterprises", seats: "11 and above seats" },
]

export const USE_CASES = [
  {
    icon: "Building2",
    title: "Law Firms",
    text: "Juniors upload and organize; seniors analyze and draft. Shared case folders keep the whole team on one version of the truth.",
  },
  {
    icon: "Briefcase",
    title: "Corporate Legal Teams",
    text: "Manage contracts, notices, and internal legal documents with structured extraction of obligations and key dates.",
  },
  {
    icon: "Gavel",
    title: "Litigation Teams",
    text: "Build chronologies and evidence matrices from case materials, and find the fact that matters before the other side does.",
  },
  {
    icon: "BookOpen",
    title: "Legal Researchers",
    text: "Search judgments in natural language and get authorities matched to specific grounds, not keyword noise.",
  },
  {
    icon: "ClipboardCheck",
    title: "Compliance Teams",
    text: "Review policies and regulatory documents with AI extraction of duties, deadlines, and exposure.",
  },
  {
    icon: "UserRound",
    title: "Individual Attorneys",
    text: "A solo practice with the document-handling depth of a large chamber — reading, research, and drafting handled.",
  },
]

export const AI_CAPABILITIES = [
  { icon: "Brain", title: "Context-aware analysis", text: "The AI holds your whole case in context — answers reflect the full record, not one page." },
  { icon: "Layers", title: "Multi-document reasoning", text: "Connects facts across 50+ documents in a single matter folder." },
  { icon: "FileText", title: "Long-document processing", text: "Handles filings running to hundreds of pages, scanned or digital." },
  { icon: "Braces", title: "Structured extraction", text: "Parties, dates, clauses, obligations, and reliefs pulled into usable structure." },
  { icon: "Search", title: "Semantic search", text: "Finds passages by meaning, so the answer surfaces even when the wording differs." },
  { icon: "AlignLeft", title: "Summarization", text: "Ground-wise, structured summaries tuned for legal reading." },
  { icon: "MessagesSquare", title: "Question answering", text: "Grounded responses with references back to your source documents." },
  { icon: "PenLine", title: "Draft generation", text: "Section-by-section drafting that follows your templates and instructions." },
  { icon: "Link2", title: "Grounded citations", text: "Research results link to the underlying judgments — verify everything." },
]

/** Security section — only claims the shipped product supports. */
export const SECURITY_POINTS = [
  {
    icon: "KeyRound",
    title: "Secure authentication",
    text: "Token-based sign-in with session controls — see every device logged into your account and revoke any of them.",
  },
  {
    icon: "Lock",
    title: "Encrypted data transfer",
    text: "Documents and messages move over encrypted HTTPS connections end to end.",
  },
  {
    icon: "MapPin",
    title: "Data residency in India",
    text: "All data storage infrastructure is in India, with a no cross-border data transfer policy — DPDPA compliant.",
  },
  {
    icon: "Users",
    title: "Role-based permissions",
    text: "Firm admins control who can upload, analyze, and manage cases across the team.",
  },
  {
    icon: "MonitorSmartphone",
    title: "Device session limits",
    text: "Concurrent-device caps and a live 'where you're logged in' view guard against shared credentials.",
  },
  {
    icon: "CreditCard",
    title: "Trusted payments",
    text: "Subscriptions are processed by Razorpay — card details never touch our servers.",
  },
]

export const BENEFITS = [
  {
    title: "Read less. Understand more.",
    text: "A 300-page brief becomes a structured summary, a chronology, and an evidence table before your first cup of chai is done.",
  },
  {
    title: "Research faster.",
    text: "Authorities matched to your pleaded grounds from Indian Kanoon — with the reasoning for why each one fits.",
  },
  {
    title: "Draft smarter.",
    text: "Filings generated from your own templates and the actual case record, ready for a senior's red pen instead of a blank page.",
  },
  {
    title: "Work with confidence.",
    text: "Every AI answer points back to its source, so you can verify before you rely.",
  },
]

export const WHY_CHOOSE = [
  {
    icon: "Scale",
    title: "Built for Indian legal practice",
    text: "Indian Kanoon research, Indian citation formats, bilingual drafting, and pricing in rupees — not a Western tool with a coat of paint.",
  },
  {
    icon: "Quote",
    title: "Answers you can verify",
    text: "Summaries, research, and chat responses reference the documents and judgments behind them.",
  },
  {
    icon: "Database",
    title: "The whole case in context",
    text: "Context caching keeps your entire matter in the AI's working memory across sessions — no re-uploading, no re-explaining.",
  },
  {
    icon: "Workflow",
    title: "Intake to filing, one place",
    text: "Upload, analysis, research, evidence, drafting, and export to Word or PDF — a complete pipeline, not a point tool.",
  },
]

/**
 * Real user testimonials, as published on jurinex.ai
 * ("Voices from the Bench & Bar").
 */
export const TESTIMONIALS = [
  {
    name: "Adv. Akshay Kulkarni",
    title: "Associate, Chamber of Adv. Yadkikar, Chhatrapati Sambhajinagar",
    photo: "akshay",
    quote:
      "Our chamber handles dense matters that move fast. The moment that tested me most was a client arriving when senior counsel wasn't around. Jurinex helps me grasp a matter well enough to explain where it stands, what comes next, and its real strengths and weaknesses - clearly, without the client having to wait. For a junior, that's been invaluable.",
  },
  {
    name: "Adv. Aashish Manglani",
    title: "Professional Corporate Legal Advisor",
    photo: null,
    quote:
      "I run a high volume of litigation, and the hardest part is holding it all clearly in view. Jurinex summarises matters fast and accurately, surfaces the right citations, and cuts drafting time - so I can focus on assessing exposure and advising the business. For a lean legal team, that efficiency is real.",
  },
  {
    name: "Adv. Shailesh Chapalgaonkar",
    title: "High Court, Chhatrapati Sambhajinagar",
    photo: "shailesh",
    quote:
      "Our work demands precision, and I doubted AI could deliver it in law - Jurinex proved me wrong. I was productive within hours, no training needed. Drafting that once took hours now takes thirty minutes, giving me time back for case strategy and court. For a lawyer, time is the one resource you can't recover - Jurinex gives it back.",
  },
  {
    name: "Adv. Prathamesh Borde",
    title: "Associate, Chamber of Adv. Shailesh Chapalgaonkar",
    photo: "prathamesh",
    quote:
      "As a junior, the hardest part is the volume - reading long matters and getting every date and timeline right before briefing senior counsel. Jurinex's summarisation gets me to the core fast, with the chronology laid out clearly, so my briefs are tighter and I walk in confident. The seniors have noticed.",
  },
]

/** The team behind Jurinex (from jurinex.ai). */
export const TEAM_INTRO = {
  eyebrow: "The Team Behind Jurinex",
  title: "Engineers and lawyers, building together.",
  lede: "Jurinex is built by NexIntel AI Pvt Ltd — a team that combines deep AI engineering with real legal practice.",
}

export const EXECUTIVE_CORE = [
  {
    name: "Santosh Dehadrai",
    role: "Founder, CTO & Principal Architect",
    photo: "santosh",
    bio: "Santosh Dehadrai is the founder & CTO of NexIntel AI, where he leads the development of Jurinex — an AI-powered legal platform built for Indian advocates and law firms. With 25+ years across networking, internet technologies, and large-scale systems, he brings deep technical depth and a practical understanding of how legal practice actually works.",
  },
  {
    name: "Saurabh Bhogale",
    role: "Co-founder, Executive Director & Project Coordinator",
    photo: "saurabh",
    bio: "Fifteen years in precision manufacturing and ten years building products gave Saurabh one non-negotiable standard: if a tool fails the person depending on it, it is not a product yet. Watching practicing advocates lose hours every day to drafting, documentation, and procedural paperwork made the problem clear — and the solution worth building. Jurinex exists because it was built by someone who understands what it truly means to engineer something a professional can depend on.",
  },
]

export const ADVISORY_BOARD = [
  {
    name: "Adv. Amit A. Yadkikar",
    role: "Litigation & Procedural Rigour",
    photo: "amit",
    bio: "Amit Yadkikar approaches every matter the way his family has practised law for over a century — methodically, deliberately, leaving nothing to chance. A High Court Advocate at the Aurangabad Bench with nearly two decades at the Bar and a rare Diploma in Cyber Laws, he has made disciplined process his signature across commercial, banking, arbitration, and civil litigation. He brings the same rigour to Jurinex, ensuring the platform reasons the way a meticulous lawyer does, so speed never comes at the cost of soundness and every output holds up to the scrutiny of an Indian courtroom.",
    facts: [
      ["High Court Advocate", "Aurangabad Bench"],
      ["Experience", "Nearly two decades at the Bar"],
      ["Education", "Diploma in Cyber Laws"],
      ["Legacy", "Over a century of legal practice"],
    ],
  },
  {
    name: "Adv. Amar D. Soman",
    role: "Litigation & Case Strategy",
    photo: "amar",
    bio: "For fifteen years at the Bombay High Court, Amar Soman has done what the best litigators do but few can teach — read the room, read the witness, and read the lines no one wrote down. Leading Soman & Associates across commercial litigation, arbitration, debt recovery, and high-stakes due diligence for clients like Indian Railways, the Income Tax Department, and Saint-Gobain, he built an instinct for what a case is really about beneath what the file says. Jurinex drew him in because he saw a chance to encode the part of legal judgment that usually walks out the door with the senior lawyer — the ability to sense intent, weigh adversarial posture, and surface what matters before anyone asks.",
    facts: [
      ["High Court Advocate", "Bombay High Court"],
      ["Experience", "Fifteen years at the Bar"],
      ["Expertise", "Commercial litigation, arbitration, debt recovery and due diligence"],
      ["Client Work", "Indian Railways, Income Tax Department and Saint-Gobain"],
    ],
  },
  {
    name: "Adv. Anoop U. Patil",
    role: "Litigation, Commercial Law & Legal Advisory",
    photo: "anoop",
    bio: "Adv. Anoop Umakant Patil practises before the High Court of Judicature at Bombay and its Aurangabad Bench, handling independent work across civil, criminal, constitutional, commercial, arbitration, intellectual property, real estate, and banking matters. He appears regularly before the City Civil and Metropolitan Magistrate Courts and tribunals including the DRT, NCLT, and administrative and consumer forums. He has also served as panel counsel for institutions such as the Slum Rehabilitation Authority, IndusInd Bank, the Municipal Corporation of Greater Mumbai, NHAI, and the Dedicated Freight Corridor Corporation of India.",
    facts: [
      ["High Court Advocate", "Bombay High Court and Aurangabad Bench"],
      ["Experience", "Practicing since 2006"],
      ["Education", "LL.M., Queen Mary University of London | BSL LL.B., ILS Law College Pune"],
      ["Client Work", "MCGM, SRA, NHAI, DFCCIL, TATA Steel, WIPRO, Tech Mahindra and IndusInd Bank"],
    ],
  },
]

export const MENTOR = {
  eyebrow: "Mentor & Advisor",
  quote:
    "Absolute to us means free from imperfection, free from doubt — and where science prevails, always. Guided by our core quality policy of 100 - 1=ZERO, we look forward to creating a lasting impact in all our endeavours.",
  name: "Milind Kelkar",
  role: "Chairman & Managing Director, Grind Master",
  photo: "milind",
  text: "Jurinex is mentored by Milind Kelkar — founder of Grind Master, a 40-year Indian engineering legacy exporting precision machines to global manufacturers. The discipline that built Grind Master's “Absolute Engineering” philosophy guides the rigor, the zero-hallucination standard, and the long view we bring to legal AI.",
}

/** "Getting started" — three steps, as published on jurinex.ai. */
export const THREE_STEPS = [
  {
    numeral: "I",
    title: "Create your account",
    text: "Sign up in under two minutes. Add your Bar Council registration, choose your practice areas, and invite your team with role-based access.",
  },
  {
    numeral: "II",
    title: "Upload your case",
    text: "Add documents — FIRs, judgments, contracts, affidavits. OCR scanning, indexing and chronology happens automatically.",
  },
  {
    numeral: "III",
    title: "Chat, draft, cite, edit, collaborate",
    text: "Ask questions. Generate drafts. Verify citations. Share with your team. The work that took hours now takes minutes.",
  },
]

/** Features included in every subscription plan (from jurinex.ai). */
export const PLAN_FEATURES = [
  "Chat & Assistance",
  "Case Management",
  "Document Vault",
  "AI Drafting",
  "Citation",
  "Branding & Output",
  "Multi Languages",
  "Role based User management",
  "DPDPA compliant",
  "In-app ticket system",
]

export const FAQS = [
  {
    q: "What is Jurinex.ai?",
    a: "Jurinex.ai is NexIntel AI's legal operating system for advocates, law firms, and legal teams. It analyzes case documents, answers questions about them, researches Indian case law, builds chronologies and evidence matrices, and drafts legal documents — all inside secure, per-matter workspaces purpose-built for Indian courts.",
  },
  {
    q: "What types of legal documents can I analyze?",
    a: "FIRs, petitions, written statements, contracts, notices, judgments, affidavits, annexures, and general case papers. PDF and DOCX files are supported, and scanned documents are read with built-in OCR.",
  },
  {
    q: "How does the AI document analysis work?",
    a: "When you upload documents to a case folder, every page is processed and indexed. The AI then produces structured summaries and extracts parties, dates, issues, and reliefs, and the chronology builds automatically. From there, everything else — chat, research, drafting — works from that same understanding of your file.",
  },
  {
    q: "Can I ask questions about my documents?",
    a: "Yes. The Legal AI Assistant answers questions in plain language, grounded in your uploaded case files, and shows the passages it relied on so you can verify the answer.",
  },
  {
    q: "Which languages does Jurinex support?",
    a: "Marathi, Hindi, Tamil, Telugu, and other widely spoken Indian languages are supported, and the system can generate reports and drafts in these languages.",
  },
  {
    q: "Can I upload large legal documents?",
    a: "Yes. The platform is built for long filings — documents running to hundreds of pages, and matter folders containing 50+ documents, including scans processed through OCR.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. All data storage infrastructure is in India, DPDPA compliant, with a no cross-border data transfer policy and end-to-end encryption for all data processed. Access is controlled through token-based authentication with device-session limits, and firm accounts get role-based permissions.",
  },
  {
    q: "Can teams collaborate?",
    a: "Yes. Plans scale from solo practitioners to firms — juniors can upload and organize while seniors analyze and draft — with admin control over roles and access.",
  },
  {
    q: "Does Jurinex support legal drafting?",
    a: "Yes. AI Drafting generates bail applications, petitions, writs, and agreements from your own templates or the built-in library, formatted for the bench you're filing in, with export to Word and PDF.",
  },
  {
    q: "Does it cover Indian case law?",
    a: "Yes. Citation Research finds authorities matched to your pleaded grounds, verified against source databases and presented in court-approved formats — with a zero-hallucination policy: if the system isn't confident, it flags rather than invents.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — every plan starts with a 7-day free trial.",
  },
]

export const CTA_COPY = {
  heading: "Ready to Transform Your Legal Workflow?",
  text: "Bring document intelligence, AI research, evidence analysis, and drafting into one secure workspace built for legal professionals.",
  primary: "Start Free Trial",
  secondary: "Talk to Us",
  trial: "Start your 7-day free trial today",
}

/**
 * Footer columns. `type`: "route" → react-router navigation, "anchor" →
 * in-page scroll, "policy" → PolicyModal key, "external" → new tab,
 * "mailto" → mail link.
 */
export const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { title: "Features", href: "#features", type: "anchor" },
      { title: "Workflow", href: "#workflow", type: "anchor" },
      { title: "Security", href: "#security", type: "anchor" },
      { title: "Pricing", href: "#pricing", type: "anchor" },
      { title: "Demo Request", href: "mailto:connect@jurinex.ai", type: "external" },
    ],
  },
  {
    heading: "Solutions",
    links: [
      { title: "Solo Practitioners", href: "#solutions", type: "anchor" },
      { title: "Law Firms", href: "#solutions", type: "anchor" },
      { title: "Corporate Legal", href: "#solutions", type: "anchor" },
      { title: "Indian Courts", href: "#indian-courts", type: "anchor" },
    ],
  },
  {
    heading: "Resources",
    links: [
      { title: "Community", href: "#resources", type: "anchor" },
      { title: "FAQs", href: "#faq", type: "anchor" },
      { title: "Services", href: "/services", type: "route" },
      { title: "Contact", href: "/contact", type: "route" },
    ],
  },
  {
    heading: "Company",
    links: [
      { title: "Team", href: "#team", type: "anchor" },
      { title: "Why Jurinex", href: "#why", type: "anchor" },
      { title: "About", href: "/aboutus", type: "route" },
      { title: "Contact", href: "/contact", type: "route" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { title: "Terms of Services", href: "https://drive.google.com/open?id=1BTXf-YUiOjQiJmdwM9QS0GCgbGUXRBOO&usp=drive_copy", type: "external" },
      { title: "Master Service Agreement", href: "https://drive.google.com/open?id=1iUYu1fDiqp95_GV16G8w_Su-EIgBg4aT&usp=drive_copy", type: "external" },
      { title: "DPA", href: "https://drive.google.com/open?id=1MEYVdK5NtlqkhlhPrCi_q4o6zCvsyBTP&usp=drive_copy", type: "external" },
      { title: "Privacy Policy", href: "https://drive.google.com/open?id=10RKK0Eh7ybm0mRNpbsDx4ecMs5ymedWa&usp=drive_copy", type: "external" },
      { title: "Data Security Policy", href: "https://drive.google.com/open?id=1X0qE1gpz-oVfy9qfL7UdIhcoLezhIEeZ&usp=drive_copy", type: "external" },
      { title: "Disclosures", href: "https://drive.google.com/open?id=11oc-dhaFbjhPtraRuYucjfOtnE5WqQj4&usp=drive_copy", type: "external" },
      { title: "Cookie Policy", href: "https://drive.google.com/open?id=1iKeGRa0w86ERuGJLYRSaAFnw7H1fYeNS&usp=drive_copy", type: "external" },
      { title: "Refund Policy", href: "https://drive.google.com/open?id=1ryZoxjk55ESOU4QaSximCarJe2236DAC&usp=drive_copy", type: "external" },
      { title: "Terms & Conditions", href: "terms", type: "policy" },
      { title: "DPDPA Policy", href: "dpdpa", type: "policy" },
    ],
  },
]

export const SOCIAL_LINKS = [
  { label: "Instagram", icon: "Instagram", href: "https://www.instagram.com/jurinex_/" },
  { label: "LinkedIn", icon: "Linkedin", href: "https://www.linkedin.com/in/jurinex-ai-47935a3aa/" },
  { label: "YouTube", icon: "Youtube", href: "https://www.youtube.com/@jurinex-b5t" },
  { label: "Pinterest", icon: "pinterest", href: "https://in.pinterest.com/nexintel_ai/" },
  { label: "X", icon: "x", href: "https://x.com/nexintel_ai" },
]

export const CONTACT_INFO = {
  company: "NexIntel AI Pvt Ltd",
  tagline: "Enterprise grade legal operating system for Professionals powered by AI",
  addressLines: [
    "B11, Near Railway Station Road, MIDC,",
    "Chhatrapati Sambhajinagar, Maharashtra 431010",
  ],
  phone: "+91 9684027372",
  email: "connect@jurinex.ai",
  cin: "U62010MH2025PTC448297",
  gstin: "27AAKCN4811B1ZQ",
  registeredOffice: "Chhatrapati Sambhajinagar, Maharashtra 431005",
  incorporation: "Incorporated under the Companies Act, 2013.",
}
