import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTemplateBuilderStore } from './templateBuilderStore';
import { templateBuilderApi } from './api';

const BRAND = '#21C1B6';
const BRAND_DARK = '#1AA49B';

type CategoryKey = 'Property' | 'Agreement' | 'Court' | 'Criminal' | 'Arbitration' | 'Trust' | 'Family' | 'Employment' | 'General';

type SubjectGroup = {
  label: string;
  category: CategoryKey;
  icon: string;
  docs: string[];
};

type ContextQuestion = {
  key: string;
  label: string;
  options: string[];
};

const SUBJECT_GROUPS: SubjectGroup[] = [
  {
    label: 'Property',
    category: 'Property',
    icon: 'Property',
    docs: ['Leave & Licence Agreement', 'Sale Deed', 'Gift Deed', 'Rent Agreement', 'Power of Attorney', 'Mortgage Deed', 'Lease Deed', 'Development Agreement'],
  },
  {
    label: 'Agreements',
    category: 'Agreement',
    icon: 'Agreements',
    docs: ['NDA', 'Service Agreement', 'Employment Agreement', 'Partnership Agreement', 'Franchise Agreement', 'Shareholders Agreement', 'Consultancy Agreement'],
  },
  {
    label: 'Court - Writ / Civil',
    category: 'Court',
    icon: 'Court',
    docs: ['Art. 226 Writ Petition', 'PIL', 'Civil Plaint', 'Written Statement', 'Interim Application', 'Execution Application'],
  },
  {
    label: 'Criminal',
    category: 'Criminal',
    icon: 'Criminal',
    docs: ['Regular Bail Application', 'Anticipatory Bail Application', 'Criminal Complaint', 'Quashing Petition'],
  },
  {
    label: 'Arbitration',
    category: 'Arbitration',
    icon: 'Arbitration',
    docs: ['Section 34 Challenge', 'Section 9 Interim Application', 'Section 11 Appointment Petition'],
  },
  {
    label: 'Trust & Family',
    category: 'Trust',
    icon: 'Trust',
    docs: ['Trust Deed', 'Society Registration Deed', 'Will', 'Adoption Deed'],
  },
];

const CATEGORY_KEYWORDS: Array<{ category: CategoryKey; regex: RegExp }> = [
  { category: 'Criminal', regex: /bail|fir|criminal|quashing|bnss|crpc|complaint/i },
  { category: 'Arbitration', regex: /arbitration|arbitral|sec(?:tion)?\s*9|sec(?:tion)?\s*11|sec(?:tion)?\s*34/i },
  { category: 'Court', regex: /writ|petition|plaint|written statement|appeal|civil|high court|supreme court|district court|pil/i },
  { category: 'Property', regex: /leave|licen[cs]e|lease|rent|sale deed|gift deed|mortgage|property|flat|shop|land/i },
  { category: 'Agreement', regex: /agreement|nda|service|employment|partnership|franchise|consult/i },
  { category: 'Trust', regex: /trust|society|charitable|foundation/i },
  { category: 'Family', regex: /will|adoption|custody|marriage|divorce|succession/i },
  { category: 'Employment', regex: /offer letter|appointment|termination|employee|employer/i },
];

const CONTEXT_BY_CATEGORY: Record<CategoryKey, ContextQuestion[]> = {
  Property: [
    { key: 'propertyType', label: 'Type of property involved?', options: ['Residential Flat', 'Independent House', 'Commercial Office', 'Shop', 'Industrial', 'Agricultural Land', 'Plot', 'Mixed Use'] },
    { key: 'partyType', label: 'Who are the typical parties?', options: ['Individual to Individual', 'Individual to Company', 'Company to Individual', 'Company to Company', 'NRI Involved', 'Government / Authority', 'Housing Society', 'Keep generic placeholders'] },
    { key: 'valueRange', label: 'Typical transaction value range?', options: ['Below Rs. 10 Lakhs', 'Rs. 10-50 Lakhs', 'Rs. 50 Lakhs-2 Cr', 'Rs. 2-10 Cr', 'Above Rs. 10 Cr', 'Varies - keep flexible'] },
  ],
  Agreement: [
    { key: 'partyType', label: 'Who are the parties?', options: ['Individual to Individual', 'Individual to Company', 'Company to Individual', 'Company to Company', 'Freelancer to Company', 'Startup to Investor', 'Employer to Employee', 'Company to Consultant'] },
    { key: 'valueRange', label: 'Expected annual value?', options: ['Below Rs. 5 Lakhs', 'Rs. 5-25 Lakhs', 'Rs. 25 Lakhs-1 Cr', 'Above Rs. 1 Cr', 'Varies - keep flexible'] },
    { key: 'emphasis', label: 'Relationship posture?', options: ['Protection-heavy', 'Balanced risk allocation', 'Relationship-first', 'Compliance-heavy'] },
  ],
  Court: [
    { key: 'court', label: 'Which court will this be filed in?', options: ['Supreme Court', 'Bombay High Court', 'Delhi High Court', 'Other High Court', 'District Court', 'Sessions Court', 'Family Court', 'NCLT'] },
    { key: 'disputeNature', label: 'Nature of dispute?', options: ['Constitutional rights', 'Property dispute', 'Contract / Commercial', 'Employment', 'Consumer', 'Arbitration'] },
    { key: 'opposingParty', label: 'Who is the opposing party?', options: ['Central Government', 'State Government', 'Municipal Corporation', 'Private Individual', 'Private Company', 'PSU / Authority'] },
  ],
  Criminal: [
    { key: 'court', label: 'Which court will this be filed in?', options: ['Sessions Court', 'High Court', 'Magistrate Court', 'Special Court'] },
    { key: 'disputeNature', label: 'Nature of criminal issue?', options: ['FIR / Investigation', 'Cheating / Fraud', 'Violence / Threat', 'Economic Offence', 'Family Dispute', 'Regulatory Offence'] },
    { key: 'opposingParty', label: 'Who is the opposing party?', options: ['State / Police', 'Private Complainant', 'Regulatory Authority', 'Multiple Respondents'] },
  ],
  Arbitration: [
    { key: 'court', label: 'Where will this be filed / seated?', options: ['Bombay High Court', 'Delhi High Court', 'Commercial Court', 'Arbitral Tribunal', 'International Commercial Arbitration', 'Other'] },
    { key: 'disputeNature', label: 'Nature of dispute?', options: ['Construction', 'Shareholder', 'Service / Contract', 'Infrastructure', 'Technology / IP', 'Supply Chain'] },
    { key: 'opposingParty', label: 'Who is the opposing party?', options: ['Private Company', 'Joint Venture Partner', 'Government Entity', 'Vendor / Supplier', 'Employer / Principal'] },
  ],
  Trust: [
    { key: 'orgType', label: 'Type of organization?', options: ['Public Charitable Trust', 'Private Trust', 'Society', 'Section 8 Company'] },
    { key: 'trustPurpose', label: 'Primary charitable purpose?', options: ['Education', 'Medical', 'Poverty Relief', 'Religious', 'Environment', 'Multiple Objects'] },
    { key: 'corpusSize', label: 'Initial corpus / fund size?', options: ['Below Rs. 10 Lakhs', 'Rs. 10-50 Lakhs', 'Rs. 50 Lakhs-1 Cr', 'Above Rs. 1 Cr', 'Includes immovable property'] },
  ],
  Family: [
    { key: 'audienceType', label: 'Who is this document for?', options: ['Individual', 'Married Couple', 'Elderly Parent', 'Minor Child'] },
    { key: 'personalLaw', label: 'Religious personal law applicable?', options: ['Hindu Law', 'Muslim Personal Law', 'Christian Law', 'Indian Succession Act', 'Not sure'] },
    { key: 'urgency', label: 'Is this urgent or planned?', options: ['Planned - no rush', 'Moderate - within weeks', 'Urgent - immediately', 'Post-event / dispute driven'] },
  ],
  Employment: [
    { key: 'partyType', label: 'Employment structure?', options: ['Employer to Employee', 'Company to Individual', 'Company to Consultant', 'Startup to Advisor', 'Freelancer to Company', 'Keep generic placeholders'] },
    { key: 'valueRange', label: 'Compensation band?', options: ['Below Rs. 5 Lakhs', 'Rs. 5-15 Lakhs', 'Rs. 15-40 Lakhs', 'Above Rs. 40 Lakhs', 'Flexible'] },
    { key: 'emphasis', label: 'What should the template emphasize?', options: ['Protection-heavy', 'Balanced risk allocation', 'Relationship-first', 'Compliance-heavy'] },
  ],
  General: [
    { key: 'partyType', label: 'Who are the expected parties?', options: ['Individual to Individual', 'Individual to Company', 'Company to Individual', 'Company to Company', 'Freelancer to Company', 'Keep generic placeholders'] },
    { key: 'valueRange', label: 'Commercial value / exposure?', options: ['Low', 'Medium', 'High', 'Varies - keep flexible'] },
    { key: 'emphasis', label: 'What should the template emphasize?', options: ['Protection-heavy', 'Balanced risk allocation', 'Relationship-first', 'Compliance-heavy'] },
  ],
};

const CLAUSES_BY_CATEGORY: Record<CategoryKey, string[]> = {
  Property: ['RERA compliance', 'NRI / FEMA provisions', 'Joint / co-ownership', 'Arbitration clause', 'Furnishing / inventory schedule', 'Penalty / liquidated damages', 'Force majeure', 'Parking allocation', 'Society transfer provisions', 'Loan / mortgage disclosure', 'Auto stamp duty calculation', 'Police verification clause'],
  Agreement: ['Confidentiality / NDA', 'Non-compete / non-solicitation', 'IP ownership / assignment', 'Data protection / privacy', 'SLA with penalties', 'Indemnification', 'Liability limitation / cap', 'Auto-renewal', 'Escrow arrangement', 'Performance guarantee', 'GST compliance', 'TDS compliance'],
  Court: ['Interim relief prayer', 'Urgent listing request', 'Stay application', 'Condonation of delay', 'Affidavit verification', 'Document compilation note'],
  Criminal: ['Anticipatory bail provisions', 'Quashing of FIR', 'Compounding of offence', 'Interim bail grounds', 'Victim compensation', 'Plea bargaining'],
  Arbitration: ['Emergency arbitrator', 'Section 9 interim measures', 'Section 17 interim measures', 'Section 34 set aside grounds', 'Section 36 stay enforcement', 'Challenge to arbitrator'],
  Trust: ['12A / 80G note', 'Corpus donation clause', 'Trustee removal mechanism', 'Conflict of interest policy', 'Investment restrictions', 'Dissolution clause'],
  Family: ['Guardianship clause', 'Maintenance / alimony clause', 'Dispute mediation clause', 'Property settlement schedule', 'Child welfare safeguards', 'Succession fallback clause'],
  Employment: ['Confidentiality / NDA', 'IP ownership / assignment', 'Garden leave', 'Notice pay', 'Non-solicitation', 'Data protection / privacy'],
  General: ['Arbitration clause', 'Force majeure', 'Penalty / liquidated damages', 'Confidentiality clause', 'Compliance clause', 'No special clauses needed'],
};

function detectCategory(text: string): CategoryKey {
  const match = CATEGORY_KEYWORDS.find((item) => item.regex.test(text));
  return match?.category ?? 'General';
}

function getStep2Questions(category: CategoryKey): ContextQuestion[] {
  return CONTEXT_BY_CATEGORY[category] ?? CONTEXT_BY_CATEGORY.General;
}

function getStep4MiddleLabel(category: CategoryKey): string {
  if (category === 'Court' || category === 'Criminal' || category === 'Arbitration') {
    return 'Urgency level?';
  }
  return 'What should the template emphasize?';
}

function getStep4MiddleOptions(category: CategoryKey): string[] {
  if (category === 'Court' || category === 'Criminal' || category === 'Arbitration') {
    return ['Urgent - need interim relief immediately', 'Standard - regular filing timeline', 'Post-order - challenging existing order'];
  }
  return ['Protection-heavy', 'Balanced risk allocation', 'Relationship-first', 'Compliance-heavy'];
}

function getCategoryLabel(category: string, subjectLabel: string): string {
  return category || detectCategory(subjectLabel || '');
}

const JURISDICTION_OPTIONS = [
  'India - Andhra Pradesh',
  'India - Arunachal Pradesh',
  'India - Assam',
  'India - Bihar',
  'India - Chhattisgarh',
  'India - Goa',
  'India - Haryana',
  'India - Himachal Pradesh',
  'India - Jharkhand',
  'India - Kerala',
  'India - Madhya Pradesh',
  'India - Manipur',
  'India - Meghalaya',
  'India - Mizoram',
  'India - Nagaland',
  'India - Odisha',
  'India - Punjab',
  'India - Sikkim',
  'India - Telangana',
  'India - Tripura',
  'India - Uttarakhand',
  'India - West Bengal',
  'India - Maharashtra',
  'India - Karnataka',
  'India - Tamil Nadu',
  'India - Gujarat',
  'India - Uttar Pradesh',
  'India - Rajasthan',
  'India - Delhi NCR',
  'India - General (All States)',
];

const LANGUAGE_OPTIONS_BY_JURISDICTION: Record<string, string[]> = {
  'India - Andhra Pradesh': ['English', 'Telugu', 'Hindi', 'Bilingual (English + Telugu)'],
  'India - Arunachal Pradesh': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Assam': ['English', 'Assamese', 'Hindi', 'Bilingual (English + Assamese)'],
  'India - Bihar': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Chhattisgarh': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Goa': ['English', 'Konkani', 'Hindi', 'Bilingual (English + Konkani)'],
  'India - Haryana': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Himachal Pradesh': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Jharkhand': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Kerala': ['English', 'Malayalam', 'Bilingual (English + Malayalam)'],
  'India - Madhya Pradesh': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Manipur': ['English', 'Manipuri', 'Hindi', 'Bilingual (English + Manipuri)'],
  'India - Meghalaya': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Mizoram': ['English', 'Mizo', 'Hindi', 'Bilingual (English + Mizo)'],
  'India - Nagaland': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Odisha': ['English', 'Odia', 'Hindi', 'Bilingual (English + Odia)'],
  'India - Punjab': ['English', 'Punjabi', 'Hindi', 'Bilingual (English + Punjabi)'],
  'India - Sikkim': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Telangana': ['English', 'Telugu', 'Hindi', 'Bilingual (English + Telugu)'],
  'India - Tripura': ['English', 'Bengali', 'Hindi', 'Bilingual (English + Bengali)'],
  'India - Uttarakhand': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - West Bengal': ['English', 'Bengali', 'Hindi', 'Bilingual (English + Bengali)'],
  'India - Maharashtra': ['English', 'Marathi', 'Hindi', 'Bilingual (English + Marathi)', 'Bilingual (English + Hindi)'],
  'India - Delhi NCR': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Karnataka': ['English', 'Kannada', 'Bilingual (English + Kannada)'],
  'India - Tamil Nadu': ['English', 'Tamil', 'Bilingual (English + Tamil)'],
  'India - Gujarat': ['English', 'Gujarati', 'Hindi', 'Bilingual (English + Gujarati)'],
  'India - Uttar Pradesh': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - Rajasthan': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
  'India - General (All States)': ['English', 'Hindi', 'Bilingual (English + Hindi)'],
};

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div className="w-full max-w-3xl bg-white rounded-2xl border border-gray-200 shadow-md overflow-hidden">
    <div style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }} className="px-5 py-4 text-white">
      <p className="text-sm font-bold">{title}</p>
    </div>
    <div className="px-5 py-5">{children}</div>
  </div>
);

const OptionGrid: React.FC<{
  idPrefix: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
  multi?: boolean;
}> = ({ idPrefix, value, options, onSelect, multi = false }) => {
  const selectedValues = multi ? value.split('||').filter(Boolean) : [value].filter(Boolean);
  return (
    <div id={`${idPrefix}-opts`} className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const selected = selectedValues.includes(opt);
        return (
          <button
            key={opt}
            id={`${idPrefix}-${opt.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}
            type="button"
            onClick={() => onSelect(opt)}
            className={`px-3 py-2 rounded-xl text-sm border transition-all ${selected ? 'text-white border-transparent shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:border-teal-400 hover:text-teal-700'}`}
            style={selected ? { backgroundColor: BRAND } : undefined}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
};

const DocumentSelector: React.FC = () => {
  const { updateRequirements, setCurrentStep, setDynamicMode, clearDynamicState } = useTemplateBuilderStore();
  const [search, setSearch] = useState('');
  const [customDescription, setCustomDescription] = useState('');

  const filteredGroups = useMemo(() => {
    if (!search.trim()) return SUBJECT_GROUPS;
    return SUBJECT_GROUPS.map((group) => ({
      ...group,
      docs: group.docs.filter((doc) => doc.toLowerCase().includes(search.toLowerCase())),
    })).filter((group) => group.docs.length > 0);
  }, [search]);

  const handleSelect = (doc: string, category: CategoryKey) => {
    clearDynamicState();
    updateRequirements({
      subject: doc.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      subjectLabel: doc,
      category,
      customDescription: '',
    });
    setCurrentStep(2);
  };

  const handleCustomSubmit = () => {
    const value = customDescription.trim();
    if (!value) return;
    const category = detectCategory(value);
    clearDynamicState();
    setDynamicMode(true);
    updateRequirements({
      subject: 'custom',
      subjectLabel: value,
      category,
      customDescription: value,
    });
    // Step 3 (jurisdiction) runs first so AI knows the jurisdiction when generating questions
    setCurrentStep(3);
  };

  return (
    <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
      <SectionCard title="What kind of template do you need?">
        <div className="space-y-5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search template types like NDA, sale deed, bail application..."
            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2"
            style={{ ['--tw-ring-color' as string]: BRAND }}
          />

          <div className="space-y-4">
            {filteredGroups.map((group) => (
              <div key={group.label} className="border border-gray-100 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-800">{group.label}</h3>
                  <span className="text-xs text-gray-400">{group.docs.length} options</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.docs.map((doc) => (
                    <button
                      key={doc}
                      type="button"
                      onClick={() => handleSelect(doc, group.category)}
                      className="px-3 py-2 text-sm rounded-xl border border-gray-200 bg-gray-50 text-gray-700 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 transition-all"
                    >
                      {doc}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-sm font-semibold text-gray-800 mb-2">Can&apos;t find what you need?</p>
            <div className="flex flex-col gap-3">
              <textarea
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                placeholder='Example: "Commercial rent for mall shop with revenue sharing clause"'
                rows={3}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 resize-none"
                style={{ ['--tw-ring-color' as string]: BRAND }}
              />
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={!customDescription.trim()}
                className="self-start px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

const Step2Context: React.FC = () => {
  const { requirements, updateRequirements, setCurrentStep } = useTemplateBuilderStore();
  const category = getCategoryLabel(requirements.category, requirements.subjectLabel) as CategoryKey;
  const questions = getStep2Questions(category);
  const firstIncompleteIndex = questions.findIndex((q) => !((requirements as Record<string, string>)[q.key]));
  const activeIndex = firstIncompleteIndex === -1 ? questions.length - 1 : firstIncompleteIndex;
  const activeQuestion = questions[activeIndex];
  const activeValue = (requirements as Record<string, string>)[activeQuestion.key] || '';
  const canContinue = questions.every((q) => Boolean((requirements as Record<string, string>)[q.key]));

  return (
    <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
      <SectionCard title="Tell me more about the context. This helps me build a better template.">
        <div className="space-y-5">
          <div id={`cq-answer-2-q${activeIndex + 1}`} className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Question {activeIndex + 1} of {questions.length}</p>
            <p className="text-base font-semibold text-gray-800">{activeQuestion.label}</p>
            <OptionGrid
              idPrefix={`cq-opts-2-q${activeIndex + 1}`}
              value={activeValue}
              options={activeQuestion.options}
              onSelect={(value) => updateRequirements({ [activeQuestion.key]: value } as Record<string, string>)}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => {
                const previous = questions[activeIndex - 1];
                if (previous) updateRequirements({ [previous.key]: '' } as Record<string, string>);
              }}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              ← Back
            </button>
            {canContinue ? (
              <button
                id="context-done-2"
                type="button"
                onClick={() => setCurrentStep(3)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
              >
                Continue →
              </button>
            ) : (
              <span className="text-sm text-gray-400">Select an answer to move forward</span>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

// ── Dynamic Questionnaire (custom description mode) ──────────────────────────

const DynamicQuestionnaire: React.FC = () => {
  const {
    requirements,
    dynamicQuestions,
    dynamicAnswers,
    dynamicQuestionsLoading,
    dynamicQuestionsError,
    setDynamicQuestions,
    setDynamicAnswer,
    setDynamicQuestionsLoading,
    setDynamicQuestionsError,
    setCurrentStep,
  } = useTemplateBuilderStore();

  const [currentIndex, setCurrentIndex] = useState(0);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || dynamicQuestions.length > 0) return;
    fetchedRef.current = true;
    setDynamicQuestionsLoading(true);
    templateBuilderApi
      .getStructureQuestions(requirements.customDescription, requirements.jurisdiction)
      .then((res) => setDynamicQuestions(res.questions))
      .catch((err) => setDynamicQuestionsError(err instanceof Error ? err.message : 'Failed to generate questions'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = () => {
    fetchedRef.current = false;
    setDynamicQuestionsLoading(true);
    templateBuilderApi
      .getStructureQuestions(requirements.customDescription, requirements.jurisdiction)
      .then((res) => {
        setCurrentIndex(0);
        setDynamicQuestions(res.questions);
      })
      .catch((err) => setDynamicQuestionsError(err instanceof Error ? err.message : 'Failed to generate questions'));
  };

  if (dynamicQuestionsLoading) {
    return (
      <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
        <SectionCard title="Analysing your description...">
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="flex gap-2">
              {[0, 150, 300].map((delay) => (
                <div key={delay} className="w-3 h-3 rounded-full animate-bounce" style={{ backgroundColor: BRAND, animationDelay: `${delay}ms` }} />
              ))}
            </div>
            <p className="text-sm text-gray-500">Generating structure questions tailored to your document...</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  if (dynamicQuestionsError) {
    return (
      <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
        <SectionCard title="Couldn't generate questions">
          <div className="space-y-4">
            <p className="text-sm text-red-600">{dynamicQuestionsError}</p>
            <div className="flex gap-3">
              <button type="button" onClick={() => setCurrentStep(3)} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700">← Back</button>
              <button type="button" onClick={handleRetry} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: BRAND }}>Retry</button>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

  if (dynamicQuestions.length === 0) return null;

  const activeQ = dynamicQuestions[currentIndex];
  const activeValue = dynamicAnswers[activeQ.id] || '';
  const isMulti = activeQ.type === 'multi_select';
  const isLast = currentIndex === dynamicQuestions.length - 1;
  const canAdvance = activeValue.length > 0;
  const progressPct = ((currentIndex + 1) / dynamicQuestions.length) * 100;

  const handleSelect = (value: string) => {
    if (isMulti) {
      const current = activeValue ? activeValue.split('||') : [];
      const idx = current.indexOf(value);
      if (idx === -1) current.push(value);
      else current.splice(idx, 1);
      setDynamicAnswer(activeQ.id, current.join('||'));
    } else {
      setDynamicAnswer(activeQ.id, value);
      if (!isLast) {
        setTimeout(() => setCurrentIndex((i) => i + 1), 220);
      }
    }
  };

  const handleNext = () => {
    if (isLast) {
      setCurrentStep(6);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleBack = () => {
    if (currentIndex === 0) {
      setCurrentStep(3);
    } else {
      setCurrentIndex((i) => i - 1);
    }
  };

  const options = activeQ.options ?? [];

  return (
    <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
      <SectionCard title="A few questions to structure your template perfectly">
        <div className="space-y-5">
          {/* Progress bar */}
          <div className="space-y-1">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Question {currentIndex + 1} of {dynamicQuestions.length}
            </p>
            <div className="w-full h-1 bg-gray-100 rounded-full">
              <div className="h-1 rounded-full transition-all duration-300" style={{ width: `${progressPct}%`, backgroundColor: BRAND }} />
            </div>
          </div>

          {/* Active question */}
          <div className="space-y-2">
            <p className="text-base font-semibold text-gray-800">{activeQ.question}</p>
            {activeQ.hint && <p className="text-xs text-gray-400">{activeQ.hint}</p>}
            <OptionGrid
              idPrefix={`dq-${currentIndex}`}
              value={activeValue}
              options={options}
              onSelect={handleSelect}
              multi={isMulti}
            />
          </div>

          {/* Answered summary */}
          {currentIndex > 0 && (
            <div className="border-t border-gray-100 pt-3 space-y-1">
              {dynamicQuestions.slice(0, currentIndex).map((q) => (
                <div key={q.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5" style={{ color: BRAND }}>✓</span>
                  <span className="text-gray-500 flex-1 truncate">{q.question}</span>
                  <span className="text-gray-700 font-medium text-right max-w-[150px] truncate">
                    {(dynamicAnswers[q.id] || '').replace(/\|\|/g, ', ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-2">
            <button type="button" onClick={handleBack} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700">
              ← Back
            </button>
            {(isMulti || isLast) ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={!canAdvance}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
              >
                {isLast ? 'Review →' : 'Next →'}
              </button>
            ) : (
              <span className="text-sm text-gray-400">Select an answer to continue</span>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const Step3Jurisdiction: React.FC = () => {
  const { requirements, updateRequirements, setCurrentStep, dynamicMode } = useTemplateBuilderStore();
  const languageOptions = requirements.jurisdiction
    ? (LANGUAGE_OPTIONS_BY_JURISDICTION[requirements.jurisdiction] ?? LANGUAGE_OPTIONS_BY_JURISDICTION['India - General (All States)'])
    : [];

  const questions = [
    { key: 'jurisdiction', label: 'State / Jurisdiction?', options: JURISDICTION_OPTIONS },
    { key: 'language', label: 'Template language?', options: languageOptions },
  ];
  const firstIncompleteIndex = questions.findIndex((q) => !requirements[q.key as 'jurisdiction' | 'language']);
  const activeIndex = firstIncompleteIndex === -1 ? questions.length - 1 : firstIncompleteIndex;
  const activeQuestion = questions[activeIndex];
  const activeValue = requirements[activeQuestion.key as 'jurisdiction' | 'language'] || '';
  const canContinue = Boolean(requirements.jurisdiction && requirements.language);

  return (
    <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
      <SectionCard title="Which jurisdiction and language should this template follow?">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Question {activeIndex + 1} of {questions.length}</p>
            <p className="text-base font-semibold text-gray-800">{activeQuestion.label}</p>
            <OptionGrid
              idPrefix={`cq-opts-3-q${activeIndex + 1}`}
              value={activeValue}
              options={activeQuestion.options}
              onSelect={(value) => {
                if (activeQuestion.key === 'jurisdiction') {
                  const nextLanguageOptions = LANGUAGE_OPTIONS_BY_JURISDICTION[value] ?? LANGUAGE_OPTIONS_BY_JURISDICTION['India - General (All States)'];
                  updateRequirements({
                    jurisdiction: value,
                    language: nextLanguageOptions.includes(requirements.language) ? requirements.language : '',
                  });
                  return;
                }

                updateRequirements({ [activeQuestion.key]: value } as Record<string, string>);
              }}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => {
                const previous = questions[activeIndex - 1];
                if (previous) updateRequirements({ [previous.key]: '' } as Record<string, string>);
              }}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              ← Back
            </button>
            {canContinue ? (
              <button
                id="context-done-3"
                type="button"
                onClick={() => setCurrentStep(dynamicMode ? 2 : 4)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
              >
                {dynamicMode ? 'Set Up Template →' : 'Continue →'}
              </button>
            ) : (
              <span className="text-sm text-gray-400">Select an answer to move forward</span>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

const Step4Structure: React.FC = () => {
  const { requirements, updateRequirements, setCurrentStep } = useTemplateBuilderStore();
  const category = getCategoryLabel(requirements.category, requirements.subjectLabel) as CategoryKey;
  const middleLabel = getStep4MiddleLabel(category);
  const middleOptions = getStep4MiddleOptions(category);
  const canContinue = Boolean(requirements.detailLevel && requirements.schedulePreference && (category === 'Court' || category === 'Criminal' || category === 'Arbitration' ? requirements.urgency : requirements.emphasis));
  const questions = [
    { key: 'detailLevel', label: 'How detailed should it be?', options: ['Concise (5-8 pages)', 'Balanced (8-15 pages)', 'Detailed (15-25 pages)'] },
    { key: category === 'Court' || category === 'Criminal' || category === 'Arbitration' ? 'urgency' : 'emphasis', label: middleLabel, options: middleOptions },
    { key: 'schedulePreference', label: 'Include schedules / annexures?', options: ['Minimal (1-2 schedules)', 'Standard (3-4 schedules)', 'Comprehensive (5+ with checklists)'] },
  ];
  const firstIncompleteIndex = questions.findIndex((q) => !(requirements as Record<string, string>)[q.key]);
  const activeIndex = firstIncompleteIndex === -1 ? questions.length - 1 : firstIncompleteIndex;
  const activeQuestion = questions[activeIndex];
  const activeValue = (requirements as Record<string, string>)[activeQuestion.key] || '';

  return (
    <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
      <SectionCard title="How should the template be structured?">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Question {activeIndex + 1} of {questions.length}</p>
            <p className="text-base font-semibold text-gray-800">{activeQuestion.label}</p>
            <OptionGrid
              idPrefix={`cq-opts-4-q${activeIndex + 1}`}
              value={activeValue}
              options={activeQuestion.options}
              onSelect={(value) => updateRequirements({ [activeQuestion.key]: value } as Record<string, string>)}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => {
                const previous = questions[activeIndex - 1];
                if (previous) updateRequirements({ [previous.key]: '' } as Record<string, string>);
              }}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 disabled:opacity-50"
            >
              ← Back
            </button>
            {canContinue ? (
              <button
                type="button"
                onClick={() => setCurrentStep(5)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
              >
                Continue →
              </button>
            ) : (
              <span className="text-sm text-gray-400">Select an answer to move forward</span>
            )}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

const Step5Clauses: React.FC = () => {
  const { requirements, updateRequirements, setCurrentStep } = useTemplateBuilderStore();
  const category = getCategoryLabel(requirements.category, requirements.subjectLabel) as CategoryKey;
  const clauseOptions = CLAUSES_BY_CATEGORY[category] ?? CLAUSES_BY_CATEGORY.General;
  const [isNotesStage, setIsNotesStage] = useState(false);

  const toggleClause = (clause: string) => {
    const current = new Set(requirements.specialClauses);
    const noneLabel = 'No special clauses needed';

    if (clause === noneLabel) {
      updateRequirements({ specialClauses: current.has(noneLabel) ? [] : [noneLabel] });
      return;
    }

    current.delete(noneLabel);
    if (current.has(clause)) current.delete(clause);
    else current.add(clause);
    updateRequirements({ specialClauses: Array.from(current) });
  };

  return (
    <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
      <SectionCard title="Any special clauses or specific requirements?">
        <div className="space-y-5">
          {!isNotesStage ? (
            <>
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Question 1 of 2</p>
                <p className="text-base font-semibold text-gray-800 mb-2">Select one or more special clauses for this template</p>
                <div className="flex flex-wrap gap-2">
                  {clauseOptions.map((clause) => {
                    const selected = requirements.specialClauses.includes(clause);
                    return (
                      <button
                        key={clause}
                        type="button"
                        onClick={() => toggleClause(clause)}
                        className={`px-3 py-2 rounded-xl text-sm border transition-all ${selected ? 'text-white border-transparent' : 'bg-white text-gray-700 border-gray-200 hover:border-teal-400 hover:text-teal-700'}`}
                        style={selected ? { backgroundColor: BRAND } : undefined}
                      >
                        {clause}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => toggleClause('No special clauses needed')}
                    className={`px-3 py-2 rounded-xl text-sm border transition-all ${requirements.specialClauses.includes('No special clauses needed') ? 'text-white border-transparent' : 'bg-white text-gray-700 border-gray-200 hover:border-teal-400 hover:text-teal-700'}`}
                    style={requirements.specialClauses.includes('No special clauses needed') ? { backgroundColor: BRAND } : undefined}
                  >
                    No special clauses needed
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsNotesStage(true);
                    updateRequirements({ specialClauses: [] });
                  }}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700"
                >
                  Skip This Section
                </button>
                <button
                  type="button"
                  disabled={requirements.specialClauses.length === 0}
                  onClick={() => setIsNotesStage(true)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
                >
                  Continue →
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Question 2 of 2</p>
                <p className="text-base font-semibold text-gray-800">Add any custom notes for the template</p>
                <textarea
                  value={requirements.freeText}
                  onChange={(e) => updateRequirements({ freeText: e.target.value })}
                  rows={5}
                  placeholder='Example: "Add clause about sub-licensing prohibition with 3x penalty. Strong holdover clause. No business from residential premises."'
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 resize-none"
                  style={{ ['--tw-ring-color' as string]: BRAND }}
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsNotesStage(false);
                  }}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(6)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
                >
                  Continue →
                </button>
              </div>
            </>
          )}
        </div>
      </SectionCard>
    </div>
  );
};

const Step6Review: React.FC = () => {
  const {
    requirements,
    dynamicMode,
    dynamicQuestions,
    dynamicAnswers,
    updateRequirements,
    setGenerationStreamText,
    appendGenerationStreamText,
    clearGenerationStreamText,
    setCurrentStep,
    setPhase,
    setGenerationResult,
    setError,
  } = useTemplateBuilderStore();
  const [loading, setLoading] = useState(false);
  const detailOptions = ['Concise (5-8 pages)', 'Balanced (8-15 pages)', 'Detailed (15-25 pages)'];
  const canGenerate = Boolean(requirements.detailLevel) && !loading;

  // Build summary rows based on mode
  const summaryRows: [string, string][] = dynamicMode
    ? ([
        ['Template Description', requirements.subjectLabel],
        ['Jurisdiction', requirements.jurisdiction],
        ['Language', requirements.language],
        ['Template Length', requirements.detailLevel],
        ...dynamicQuestions.map((q) => [
          q.question,
          (dynamicAnswers[q.id] || '').replace(/\|\|/g, ', '),
        ] as [string, string]),
      ] as [string, string][]).filter(([, v]) => Boolean(v))
    : ([
        ['Subject', requirements.subjectLabel || requirements.subject],
        ['Category', requirements.category],
        ['Property Type', requirements.propertyType],
        ['Party Type', requirements.partyType],
        ['Value Range', requirements.valueRange],
        ['Court', requirements.court],
        ['Dispute Nature', requirements.disputeNature],
        ['Opposing Party', requirements.opposingParty],
        ['Trust / Org Type', requirements.orgType],
        ['Trust Purpose', requirements.trustPurpose],
        ['Corpus Size', requirements.corpusSize],
        ['Jurisdiction', requirements.jurisdiction],
        ['Language', requirements.language],
        ['Detail Level', requirements.detailLevel],
        ['Emphasis', requirements.emphasis],
        ['Urgency', requirements.urgency],
        ['Schedules', requirements.schedulePreference],
        ['Special Clauses', requirements.specialClauses.join(', ')],
        ['Custom Notes', requirements.freeText],
      ] as [string, string][]).filter(([, v]) => Boolean(v));

  const handleGenerate = async () => {
    if (!requirements.detailLevel) {
      return;
    }
    clearGenerationStreamText();
    setGenerationStreamText(`Preparing ${requirements.subjectLabel || 'template'}...\n\n`);
    setLoading(true);
    setPhase('generating');
    try {
      const response = await templateBuilderApi.streamGenerateTemplate(
        dynamicMode
          ? { requirements, dynamicQuestions, dynamicAnswers }
          : { requirements },
        {
          onEvent: (event) => {
            if (event.type === 'start' && event.message) {
              setGenerationStreamText(`${event.message}\n\n`);
            }
            if (event.type === 'chunk' && event.text) {
              appendGenerationStreamText(event.text);
            }
          },
        },
      );
      setGenerationResult(response.templateText, response.fields, response.sections, response.metadata);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Template generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = () => setCurrentStep(dynamicMode ? 2 : 1);

  return (
    <div className="min-h-[calc(100vh-72px)] px-6 py-6 flex items-center justify-center">
      <SectionCard title="Here's everything I've collected. Review and confirm to generate your template.">
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50/70">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Length Control</p>
              <p className="text-base font-semibold text-gray-800">How long should the template be?</p>
              <p className="text-sm text-gray-500">Choose the target page range here. The generated template will follow this page limit.</p>
            </div>
            <div className="mt-4">
              <OptionGrid
                idPrefix="review-detail-level"
                value={requirements.detailLevel}
                options={detailOptions}
                onSelect={(value) => updateRequirements({ detailLevel: value })}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 overflow-hidden">
            {summaryRows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[200px_1fr] gap-4 px-4 py-3 border-b border-gray-100 last:border-b-0">
                <span className="text-sm text-gray-500">{label}</span>
                <span className="text-sm font-medium text-gray-800">{value}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleChange}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 bg-white hover:bg-gray-50"
            >
              ← Change something
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${BRAND} 0%, ${BRAND_DARK} 100%)` }}
            >
              {loading ? 'Generating...' : 'Generate Template →'}
            </button>
          </div>
          {!requirements.detailLevel ? (
            <p className="text-sm text-amber-700">Select the template length first so the draft stays within the page range you want.</p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
};

const GeneratingState: React.FC = () => {
  const { generationStreamText, requirements } = useTemplateBuilderStore();
  return (
    <div className="px-6 py-10 max-w-5xl">
      <SectionCard title="Generating your custom template...">
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex gap-2">
              {[0, 150, 300].map((delay) => (
                <div
                  key={delay}
                  className="w-3 h-3 rounded-full animate-bounce"
                  style={{ backgroundColor: BRAND, animationDelay: `${delay}ms` }}
                />
              ))}
            </div>
            <p className="text-sm text-gray-600">
              Live drafting in progress for <span className="font-semibold text-gray-800">{requirements.subjectLabel || 'your template'}</span>.
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-[#fcfcfb] p-5">
            <div className="max-h-[65vh] overflow-y-auto whitespace-pre-wrap font-serif text-[15px] leading-7 text-gray-800">
              {generationStreamText || 'Waiting for draft output...'}
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Streaming shows the draft as it is being written. Final formatting, fields, and section parsing are applied when generation completes.
          </p>
        </div>
      </SectionCard>
    </div>
  );
};

const ErrorState: React.FC = () => {
  const { errorMessage, reset } = useTemplateBuilderStore();
  return (
    <div className="px-6 py-10 max-w-2xl">
      <SectionCard title="Something went wrong">
        <div className="space-y-4">
          <p className="text-sm text-red-600">{errorMessage || 'The template builder could not complete the request.'}</p>
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: BRAND }}
          >
            Start Over
          </button>
        </div>
      </SectionCard>
    </div>
  );
};

export const BuilderChat: React.FC = () => {
  const { phase, currentStep, dynamicMode } = useTemplateBuilderStore();

  if (phase === 'generating') return <GeneratingState />;
  if (phase === 'error') return <ErrorState />;
  if (phase !== 'selecting' && phase !== 'answering') return null;

  if (currentStep === 1) return <DocumentSelector />;
  if (currentStep === 2) return dynamicMode ? <DynamicQuestionnaire /> : <Step2Context />;
  if (currentStep === 3) return <Step3Jurisdiction />;
  if (currentStep === 4) return <Step4Structure />;
  if (currentStep === 5) return <Step5Clauses />;
  return <Step6Review />;
};
