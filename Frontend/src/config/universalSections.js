/**
 * Universal Section Structure for ALL Legal Templates
 * 
 * These 23 sections apply to every legal document type.
 * Each section has a default prompt that users can edit before generation.
 */

export const UNIVERSAL_SECTIONS = [
  {
    section_key: 'document_information',
    section_name: 'Document Information',
    sort_order: 1,
    is_required: true,
    icon: '📄',
    default_prompt: 'Generate the document information section including: Document Title, Document Type, Category, Jurisdiction, Language, Date of Execution, and Effective Date. Use the provided field values and retrieved context to fill in accurate details. Format as a professional header section with proper HTML structure.',
  },
  {
    section_key: 'parties',
    section_name: 'Parties',
    sort_order: 2,
    is_required: true,
    icon: '👥',
    default_prompt: 'Generate the parties section listing all parties to this agreement. Include: First Party, Second Party, Additional Parties (if any), Legal Status, Address, and Authorized Signatory details. Use formal legal language and ensure all party information from the form fields is accurately represented. Format with clear headings for each party.',
  },
  {
    section_key: 'background_recitals',
    section_name: 'Background / Recitals',
    sort_order: 3,
    is_required: true,
    icon: '📋',
    default_prompt: 'Draft the background and recitals section explaining: Purpose of Agreement, Business Context, and Intent of Parties. Use WHEREAS clauses if appropriate. Base this on the retrieved context and form data to provide relevant background. Keep it concise but comprehensive.',
  },
  {
    section_key: 'definitions_interpretation',
    section_name: 'Definitions & Interpretation',
    sort_order: 4,
    is_required: false,
    icon: '📖',
    default_prompt: 'Generate definitions and interpretation rules for key terms used in this document. Define technical terms, legal terms, and specific terms relevant to this agreement. Include interpretation rules (e.g., singular includes plural, headings for reference only). Use alphabetical order for definitions.',
  },
  {
    section_key: 'subject_matter',
    section_name: 'Subject Matter',
    sort_order: 5,
    is_required: true,
    icon: '🎯',
    default_prompt: 'Draft the subject matter section describing what is being agreed upon. Include description of property, service, relationship, or transaction that forms the core of this agreement. Be specific and reference the retrieved context to ensure accuracy.',
  },
  {
    section_key: 'rights_obligations',
    section_name: 'Scope of Rights & Obligations',
    sort_order: 6,
    is_required: true,
    icon: '⚖️',
    default_prompt: 'Generate the rights and obligations section detailing: Rights of Party A, Rights of Party B, and Duties & Responsibilities of each party. Use numbered clauses for clarity. Base obligations on the retrieved context and legal standards for this type of agreement.',
  },
  {
    section_key: 'term_duration',
    section_name: 'Term & Duration',
    sort_order: 7,
    is_required: true,
    icon: '📅',
    default_prompt: 'Draft the term and duration section specifying: Start Date, End Date, Renewal terms, and Survival clauses (if applicable). Use the date fields from the form and ensure clarity about the agreement\'s timeline.',
  },
  {
    section_key: 'commercial_terms',
    section_name: 'Commercial Terms',
    sort_order: 8,
    is_required: false,
    icon: '💰',
    default_prompt: 'Generate the commercial terms section covering: Consideration, Payment Amount, Payment Method, Taxes, and Penalties (if applicable). Use specific amounts from the form fields. Include payment schedules, late payment penalties, and tax responsibilities clearly.',
  },
  {
    section_key: 'representations_warranties',
    section_name: 'Representations & Warranties',
    sort_order: 9,
    is_required: true,
    icon: '✅',
    default_prompt: 'Draft representations and warranties made by each party including: Legal Authority to enter this agreement, Compliance with laws, Ownership of assets/IP, and No Conflict with other agreements. Use standard legal representations appropriate for this type of agreement.',
  },
  {
    section_key: 'confidentiality_data',
    section_name: 'Confidentiality & Data Protection',
    sort_order: 10,
    is_required: false,
    icon: '🔒',
    default_prompt: 'Generate confidentiality and data protection clauses covering: Confidentiality obligations, Data Usage restrictions, and Privacy compliance. Include definition of confidential information, permitted disclosures, and data protection obligations under applicable law.',
  },
  {
    section_key: 'intellectual_property',
    section_name: 'Intellectual Property',
    sort_order: 11,
    is_required: false,
    icon: '💡',
    default_prompt: 'Draft intellectual property clauses addressing: IP Ownership, License grants, and Restrictions. Clarify who owns existing IP, who owns created IP, and any licenses granted. Include restrictions on use and protection obligations.',
  },
  {
    section_key: 'indemnity_liability',
    section_name: 'Indemnity & Liability',
    sort_order: 12,
    is_required: true,
    icon: '🛡️',
    default_prompt: 'Generate indemnity and liability clauses including: Indemnity obligations of each party and Limitation of Liability. Specify indemnification triggers, process, and limitations. Include liability caps if applicable based on the retrieved context.',
  },
  {
    section_key: 'termination',
    section_name: 'Termination',
    sort_order: 13,
    is_required: true,
    icon: '🚪',
    default_prompt: 'Draft termination clauses covering: Termination Events (breach, convenience, etc.), Notice Period required, and Effect of Termination. Include both termination for cause and termination for convenience if appropriate. Specify obligations upon termination.',
  },
  {
    section_key: 'force_majeure',
    section_name: 'Force Majeure',
    sort_order: 14,
    is_required: false,
    icon: '🌪️',
    default_prompt: 'Generate a force majeure clause defining events beyond parties\' control that excuse performance (e.g., natural disasters, war, pandemic, government actions). Include notification requirements and duration limits. Use standard force majeure language.',
  },
  {
    section_key: 'dispute_resolution',
    section_name: 'Dispute Resolution',
    sort_order: 15,
    is_required: true,
    icon: '⚖️',
    default_prompt: 'Draft dispute resolution clauses specifying: Governing Law, Jurisdiction, and Arbitration procedures. Include the jurisdiction from form fields. Specify whether disputes go to arbitration or courts, and the process for resolving disputes.',
  },
  {
    section_key: 'compliance_legal',
    section_name: 'Compliance & Legal',
    sort_order: 16,
    is_required: true,
    icon: '📜',
    default_prompt: 'Generate compliance clauses covering: Applicable Laws and Regulatory Compliance. Specify that parties must comply with all applicable laws, regulations, and industry standards. Include specific regulatory requirements if relevant to this agreement type.',
  },
  {
    section_key: 'assignment_transfer',
    section_name: 'Assignment & Transfer',
    sort_order: 17,
    is_required: false,
    icon: '🔄',
    default_prompt: 'Draft assignment and transfer clauses specifying whether and how rights/obligations can be assigned or transferred to third parties. Typically include restrictions on assignment without consent and exceptions (e.g., to affiliates).',
  },
  {
    section_key: 'notices',
    section_name: 'Notices',
    sort_order: 18,
    is_required: true,
    icon: '📧',
    default_prompt: 'Generate the notices clause specifying how parties must communicate official notices. Include addresses from the parties section, permitted delivery methods (email, registered post, courier), and when notices are deemed received.',
  },
  {
    section_key: 'amendments_waivers',
    section_name: 'Amendments & Waivers',
    sort_order: 19,
    is_required: false,
    icon: '✏️',
    default_prompt: 'Draft clauses about amendments and waivers stating that: amendments must be in writing and signed by both parties, no waiver of one breach waives future breaches, and waiver must be explicit and in writing.',
  },
  {
    section_key: 'general_clauses',
    section_name: 'General Clauses',
    sort_order: 20,
    is_required: true,
    icon: '📑',
    default_prompt: 'Generate general/boilerplate clauses including: Severability (invalid clauses don\'t affect rest of agreement), Entire Agreement (this document supersedes all prior agreements), and Relationship of Parties (no partnership/agency created). Use standard legal language.',
  },
  {
    section_key: 'special_terms',
    section_name: 'Special Terms',
    sort_order: 21,
    is_required: false,
    icon: '⭐',
    default_prompt: 'Generate special terms or clauses specific to this type of agreement. This section should include template-specific clauses that don\'t fit in the standard sections above. Base this entirely on the retrieved context and the specific requirements mentioned in the form or documents.',
  },
  {
    section_key: 'schedules_annexures',
    section_name: 'Schedules & Annexures',
    sort_order: 22,
    is_required: false,
    icon: '📎',
    default_prompt: 'List and format any schedules, annexures, or exhibits referenced in the main agreement. Include placeholders or descriptions for: List of Properties, Payment Schedules, Technical Specifications, or other attachments mentioned in the retrieved context.',
  },
  {
    section_key: 'signatures',
    section_name: 'Signatures',
    sort_order: 23,
    is_required: true,
    icon: '✍️',
    default_prompt: 'Generate the signature section with spaces for: Party Signatures (all parties listed in the Parties section), Witnesses (if required), and Date & Place of execution. Format with clear signature lines, name fields, and date fields for each party and witness.',
  },
];

/**
 * Get all universal sections
 */
export const getUniversalSections = () => {
  return UNIVERSAL_SECTIONS;
};

/**
 * Get a specific section by key
 */
export const getUniversalSection = (sectionKey) => {
  return UNIVERSAL_SECTIONS.find((s) => s.section_key === sectionKey);
};

/**
 * Get required sections only
 */
export const getRequiredSections = () => {
  return UNIVERSAL_SECTIONS.filter((s) => s.is_required);
};

/**
 * Get optional sections only
 */
export const getOptionalSections = () => {
  return UNIVERSAL_SECTIONS.filter((s) => !s.is_required);
};

/**
 * Section categories for UI grouping
 */
export const SECTION_CATEGORIES = {
  HEADER: {
    name: 'Document Header',
    sections: ['document_information', 'parties', 'background_recitals'],
  },
  CORE_TERMS: {
    name: 'Core Terms',
    sections: [
      'definitions_interpretation',
      'subject_matter',
      'rights_obligations',
      'term_duration',
      'commercial_terms',
    ],
  },
  LEGAL_PROTECTIONS: {
    name: 'Legal Protections',
    sections: [
      'representations_warranties',
      'confidentiality_data',
      'intellectual_property',
      'indemnity_liability',
    ],
  },
  TERMINATION_DISPUTES: {
    name: 'Termination & Disputes',
    sections: ['termination', 'force_majeure', 'dispute_resolution', 'compliance_legal'],
  },
  ADMINISTRATIVE: {
    name: 'Administrative Clauses',
    sections: ['assignment_transfer', 'notices', 'amendments_waivers', 'general_clauses'],
  },
  SPECIAL: {
    name: 'Special & Attachments',
    sections: ['special_terms', 'schedules_annexures', 'signatures'],
  },
};
