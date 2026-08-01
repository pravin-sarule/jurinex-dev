import React, { useMemo, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  HomeIcon,
  PencilIcon,
  PrinterIcon,
  ScaleIcon,
  Square2StackIcon,
  UserIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';
import judgementApi from '../../services/judgementApi';

// Review layout for search results: left "This search" rail, citation
// cards grouped by issue, and a per-citation Report/Document detail view.
// Light slate theme with the brand teal accent; red/amber/green appear
// only as semantic status colours.

const TEAL = '#21C1B6';
const TEAL_DARK = '#1AA49B';

const STATUS_STYLES = {
  pending: 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]',
  approved: 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]',
  rejected: 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]',
};

const STRENGTH_STYLES = {
  Strong: 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]',
  Moderate: 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]',
  Weak: 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]',
};

function courtTag(court = '', title = '') {
  const c = court.toLowerCase();
  if (c.includes('supreme')) return 'SUPREME COURT';
  if (c.includes('high court')) return 'HIGH COURT';
  if (/tribunal|itat|cestat|nclt|nclat|commission|appellate/.test(c)) return 'TRIBUNAL';
  if (/district|sessions|magistrate/.test(c)) return 'DISTRICT COURT';
  if (/order/i.test(title)) return 'ORDER';
  return court ? court.toUpperCase().slice(0, 22) : 'COURT';
}

function StatusPill({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ScoreBar({ label, value, hint }) {
  const pct = Math.round((value || 0) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-[#475569] uppercase tracking-wide">{label}</span>
        <span className="font-bold text-[#0F172A]">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-[#F1F5F9] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TEAL }} />
      </div>
      {hint && <div className="mt-1 text-[10px] text-[#94A3B8]">{hint}</div>}
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <h4 className="flex items-center gap-2 text-[13px] font-bold text-[#0F172A] uppercase tracking-wide">
      <span className="h-4 w-1 rounded-full" style={{ background: TEAL }} />
      {children}
    </h4>
  );
}

function Bullets({ items }) {
  if (!items || items.length === 0) return <div className="text-xs text-[#94A3B8] italic">—</div>;
  return (
    <ul className="space-y-1.5">
      {items.map((line, idx) => (
        <li key={idx} className="flex gap-2 text-[13px] text-[#334155] leading-relaxed">
          <span className="mt-2 h-1 w-1 rounded-full bg-[#94A3B8] shrink-0" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Citation card in the review list ────────────────────────────────────────

function CitationCard({ item, status, onView }) {
  return (
    <div className="relative rounded-xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden flex">
      <div className="w-1 shrink-0" style={{ background: TEAL }} />
      <div className="flex-1 min-w-0 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0]">
            {courtTag(item.court, item.title)}
          </span>
          {item.side && (
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider border ${
              item.side === 'support'
                ? 'text-[#15803D] bg-[#F0FDF4] border-[#BBF7D0]'
                : item.side === 'contra'
                  ? 'text-[#B91C1C] bg-[#FEF2F2] border-[#FECACA]'
                  : 'text-[#92400E] bg-[#FFFBEB] border-[#FDE68A]'
            }`}>
              {item.side === 'support' ? 'SUPPORTS YOUR CASE'
                : item.side === 'contra' ? 'CONTRA — AGAINST YOU' : 'INTERIM ONLY'}
            </span>
          )}
          <StatusPill status={status} />
        </div>
        <h4 className="mt-2 text-[15px] font-bold text-[#0F172A] leading-snug font-serif">
          {item.title || item.docId}
        </h4>
        {(item.headline || item.pinpoint) && (
          <p className="mt-1.5 text-xs text-[#64748B] leading-relaxed line-clamp-2">
            {item.headline || item.pinpoint}
          </p>
        )}
        {item.doctrineLink && (
          <p className="mt-1.5 text-[11px] text-[#475569] leading-relaxed">
            <span className="font-bold" style={{ color: TEAL_DARK }}>Doctrine: </span>
            {item.doctrineLink}
          </p>
        )}
        {(item.opponentArgument || item.counterStrategy) && (
          <div className="mt-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 space-y-1.5">
            {item.opponentArgument && (
              <p className="text-[11px] leading-relaxed text-[#334155]">
                <span className="font-bold text-[#B45309]">Opponent may argue: </span>
                {item.opponentArgument}
              </p>
            )}
            {item.counterStrategy && (
              <p className="text-[11px] leading-relaxed text-[#334155]">
                <span className="font-bold" style={{ color: TEAL_DARK }}>Your counter: </span>
                {item.counterStrategy}
              </p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-1.5">
          <span className="flex items-start gap-1.5 text-[11px] text-[#64748B] min-w-[180px]">
            <HomeIcon className="h-3.5 w-3.5 text-[#94A3B8] mt-0.5" />
            <span><span className="uppercase text-[9px] font-semibold text-[#94A3B8] block leading-none mb-1">Source</span>
              <span className="font-semibold text-[#334155]">{item.court || '—'}</span></span>
          </span>
          <span className="flex items-start gap-1.5 text-[11px] text-[#64748B] min-w-[100px]">
            <CalendarIcon className="h-3.5 w-3.5 text-[#94A3B8] mt-0.5" />
            <span><span className="uppercase text-[9px] font-semibold text-[#94A3B8] block leading-none mb-1">Published</span>
              <span className="font-semibold text-[#334155]">{item.year || '—'}</span></span>
          </span>
          <span className="ml-auto self-center text-[11px] font-semibold text-[#475569] whitespace-nowrap">
            {item.signals?.aiRelevance != null
              ? `${Math.round(item.signals.aiRelevance * 100)}% on point`
              : `similarity ${Math.round((item.signals?.semantic || 0) * 100)}% — unverified`}
          </span>
        </div>
        {Array.isArray(item.matchedTerms) && item.matchedTerms.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.matchedTerms.slice(0, 3).map((term, idx) => (
              <span key={idx} className="px-2 py-0.5 rounded-full text-[10px] text-[#0D9488] bg-[#F0FDFA] border border-[#99F6E4] truncate max-w-[340px]">
                {term}
              </span>
            ))}
            {item.matchedTerms.length > 3 && (
              <span className="text-[10px] text-[#94A3B8] self-center">+{item.matchedTerms.length - 3} more</span>
            )}
          </div>
        )}
      </div>
      <button
        onClick={onView}
        className="w-20 shrink-0 flex flex-col items-center justify-center gap-1 border-l border-[#F1F5F9] text-[11px] font-bold tracking-wider hover:bg-[#F0FDFA] transition-colors"
        style={{ color: TEAL_DARK }}
      >
        VIEW
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Detail view (Report / Document tabs) ────────────────────────────────────

function ReportDetail({ sessionId, issueId, item, status, onStatus, onBack }) {
  const [tab, setTab] = useState('report');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    judgementApi.getReport(sessionId, issueId, item.docId)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        // Server-persisted decision wins over whatever the pill showed.
        if (data.status && data.status !== status) onStatus(data.status);
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Report failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, issueId, item.docId]);

  const applyStatus = async (next) => {
    setSaving(true);
    try {
      await judgementApi.setReportStatus(sessionId, issueId, item.docId, next);
      onStatus(next);
      toast.success(next === 'approved' ? 'Citation approved' : 'Citation rejected');
    } catch (err) {
      toast.error(err.message || 'Could not save status');
    } finally {
      setSaving(false);
    }
  };

  const copyCitation = () => {
    const line = `${report?.title || item.title} — ${report?.url || item.url}`;
    navigator.clipboard?.writeText(line);
    toast.success('Citation copied');
  };

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
      {/* Toolbar — stays fixed; only the report body scrolls */}
      <div className="shrink-0 flex items-center gap-2 border-b border-[#E2E8F0] bg-white px-4 py-2.5 z-10">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-[#475569] hover:text-[#0F172A]">
          <ArrowLeftIcon className="h-4 w-4" /> Back to results
        </button>
        <div className="ml-3 flex rounded-lg border border-[#E2E8F0] overflow-hidden">
          {[['report', 'Report', Square2StackIcon], ['document', 'Document', DocumentTextIcon]].map(([key, label, TabIcon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                tab === key ? 'bg-[#F0FDFA] text-[#0D9488]' : 'bg-white text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <TabIcon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StatusPill status={status} />
          <button
            onClick={() => applyStatus('approved')}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#16A34A] hover:bg-[#15803D] text-white disabled:opacity-60"
          >
            <CheckCircleIcon className="h-4 w-4" /> Approve
          </button>
          <button
            onClick={() => applyStatus('rejected')}
            disabled={saving}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#FECACA] text-[#DC2626] bg-white hover:bg-[#FEF2F2] disabled:opacity-60"
          >
            <XCircleIcon className="h-4 w-4" /> Reject
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto bg-[#F8FAFC] p-4 md:p-8">
        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-[#64748B]">
            <ArrowPathIcon className="h-6 w-6 animate-spin" style={{ color: TEAL }} />
            <div className="text-sm">Generating legal intelligence report…</div>
            <div className="text-xs text-[#94A3B8]">Grounded on the fetched judgment text — nothing is invented.</div>
          </div>
        )}
        {error && !loading && (
          <div className="max-w-xl mx-auto mt-10 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]">{error}</div>
        )}

        {report && !loading && tab === 'report' && (
          <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6 md:p-8">
            <div className="text-center">
              <div className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: TEAL_DARK }}>
                {report.court || 'Indian Kanoon'}
              </div>
              <h2 className="mt-2 text-xl font-bold text-[#0F172A] font-serif leading-snug">{report.title}</h2>
            </div>

            <div className="mt-5 grid grid-cols-3 divide-x divide-[#E2E8F0] rounded-xl border border-[#E2E8F0] text-center">
              {[['Primary citation', report.docId ? `IK ${report.docId}` : '—'],
                ['Date of judgment', report.publishDate || (item.year ?? '—')],
                ['Author', report.author || '—']].map(([label, value]) => (
                <div key={label} className="px-3 py-3">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-[#94A3B8]">{label}</div>
                  <div className="mt-1 text-xs font-semibold text-[#0F172A] truncate">{value}</div>
                </div>
              ))}
            </div>

            {report.bench?.length > 0 && (
              <div className="mt-3 rounded-xl border border-[#E2E8F0] px-4 py-3">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-[#94A3B8]">Coram / Bench</div>
                <div className="mt-1.5 space-y-1">
                  {report.bench.map((judge, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs font-medium text-[#334155]">
                      <UserIcon className="h-3.5 w-3.5 text-[#94A3B8]" /> {judge}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Relevance & accuracy — deterministic, never model-claimed */}
            <div className="mt-5 rounded-xl border border-[#99F6E4] bg-[#F0FDFA] p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#0D9488]">Relevance & accuracy</span>
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${STRENGTH_STYLES[report.applicabilityStrength] || STRENGTH_STYLES.Weak}`}>
                  {report.applicabilityStrength} match
                </span>
              </div>
              <div className="mt-3 grid md:grid-cols-2 gap-4">
                <ScoreBar label="On point (semantic)" value={report.semanticMatch}
                          hint="Closeness of this judgment to your issue" />
                <ScoreBar label="Factual relevance" value={report.factualRelevance}
                          hint="Share of your case's fact terms found in this judgment" />
              </div>
              <div className="mt-2 text-[10px] text-[#64748B]">
                Computed mechanically from the fetched judgment text — not an AI estimate.
              </div>
            </div>

            {/* Web-grounded good-law status (Google Search grounding) */}
            {report.goodLawCheck?.status && (
              <div className={`mt-4 rounded-xl border p-4 ${
                report.goodLawCheck.status === 'good_law'
                  ? 'border-[#BBF7D0] bg-[#F0FDF4]'
                  : report.goodLawCheck.status === 'unknown'
                    ? 'border-[#E2E8F0] bg-[#F8FAFC]'
                    : 'border-[#FECACA] bg-[#FEF2F2]'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#475569]">
                    Good-law web check
                  </span>
                  <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                    report.goodLawCheck.status === 'good_law'
                      ? 'text-[#15803D] bg-white border border-[#BBF7D0]'
                      : report.goodLawCheck.status === 'unknown'
                        ? 'text-[#64748B] bg-white border border-[#E2E8F0]'
                        : 'text-[#B91C1C] bg-white border border-[#FECACA]'
                  }`}>
                    {{
                      good_law: 'No negative treatment found',
                      overruled: 'OVERRULED — do not rely',
                      reversed: 'REVERSED in appeal',
                      stayed: 'STAYED',
                      slp_pending: 'SLP pending',
                      unknown: 'Not found on the web',
                    }[report.goodLawCheck.status] || report.goodLawCheck.status}
                  </span>
                </div>
                {report.goodLawCheck.note && (
                  <p className="mt-2 text-[12px] text-[#334155] leading-relaxed">{report.goodLawCheck.note}</p>
                )}
                {Array.isArray(report.goodLawCheck.sources) && report.goodLawCheck.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {report.goodLawCheck.sources.map((src, idx) => (
                      <a key={idx} href={src.uri} target="_blank" rel="noreferrer"
                         className="text-[11px] font-semibold hover:underline truncate max-w-[260px]"
                         style={{ color: TEAL_DARK }}>
                        {src.title || src.uri} ↗
                      </a>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-[10px] text-[#94A3B8]">
                  Google-grounded web check — verify on the official court website before filing.
                </div>
              </div>
            )}

            {report.analysis?.why_this_helps && (
              <div className="mt-5 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#475569]">Why this helps</div>
                <p className="mt-1.5 text-[13px] font-semibold text-[#0F172A] font-serif">{report.issue}</p>
                <p className="mt-2 text-[13px] text-[#334155] leading-relaxed">{report.analysis.why_this_helps}</p>
              </div>
            )}

            <div className="mt-6 space-y-2">
              <SectionHeading>I. Citation excerpt</SectionHeading>
              <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 text-[13px] text-[#334155] italic leading-relaxed">
                {report.excerpt || 'No pinpoint excerpt was verified for this citation.'}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <SectionHeading>II. Legal analysis and ratio</SectionHeading>
              <div className="rounded-xl border-l-4 border border-[#E2E8F0] p-4 space-y-4" style={{ borderLeftColor: TEAL }}>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Key legal issues</div>
                  <div className="mt-1.5"><Bullets items={report.analysis?.key_legal_issues} /></div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Key facts</div>
                  <div className="mt-1.5"><Bullets items={report.analysis?.key_facts} /></div>
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Legal analysis</div>
                  <div className="mt-1.5"><Bullets items={report.analysis?.legal_analysis} /></div>
                </div>
                {report.analysis?.ratio_decidendi && (
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">Ratio decidendi</div>
                    <p className="mt-1.5 text-[13px] text-[#334155] leading-relaxed">{report.analysis.ratio_decidendi}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <SectionHeading>III. Citation context</SectionHeading>
              <div className="grid grid-cols-2 gap-3">
                {[['Total cases cited (index)', report.citesTotal], ['Total cited by (index)', report.citedByTotal]].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-[#E2E8F0] px-4 py-3">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-[#94A3B8]">{label}</div>
                    <div className="mt-1 text-lg font-bold text-[#0F172A]">{value}</div>
                  </div>
                ))}
              </div>
              {(report.casesCitedSample?.length > 0 || report.citedBySample?.length > 0) && (
                <div className="rounded-xl border border-[#E2E8F0] p-4 grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs font-bold" style={{ color: TEAL_DARK }}>
                      Cases cited (showing {report.casesCitedSample?.length || 0} of {report.citesTotal})
                    </div>
                    <ul className="mt-2 divide-y divide-[#F1F5F9]">
                      {(report.casesCitedSample || []).map((item, idx) => (
                        <li key={idx} className="py-1.5 text-xs text-[#334155] font-serif">
                          {item.docId ? (
                            <a href={`https://indiankanoon.org/doc/${item.docId}/`} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: TEAL_DARK }}>
                              {item.title}
                            </a>
                          ) : (item.title || item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-bold" style={{ color: TEAL_DARK }}>Cited by ({report.citedByTotal})</div>
                    <ul className="mt-2 divide-y divide-[#F1F5F9]">
                      {(report.citedBySample || []).length === 0 && <li className="py-1.5 text-xs text-[#94A3B8]">—</li>}
                      {(report.citedBySample || []).map((item, idx) => (
                        <li key={idx} className="py-1.5 text-xs text-[#334155] font-serif">
                          {item.docId ? (
                            <a href={`https://indiankanoon.org/doc/${item.docId}/`} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: TEAL_DARK }}>
                              {item.title}
                            </a>
                          ) : (item.title || item)}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="md:col-span-2 text-[10px] text-[#94A3B8]">
                    Lists reflect a sample returned with this citation; totals are from the document index.
                  </div>
                </div>
              )}
            </div>

            {report.matchedTerms?.length > 0 && (
              <div className="mt-6">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#475569]">Matched on this citation</div>
                <div className="mt-2 space-y-1.5">
                  {report.matchedTerms.map((term, idx) => (
                    <div key={idx} className="rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2 text-xs text-[#334155]">{term}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 pt-5 border-t border-[#E2E8F0] flex flex-wrap items-center gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold text-[#0F172A] uppercase tracking-wide">Jurinex Legal Intelligence Report</div>
                <div className="text-[11px] text-[#94A3B8]">Generated on {report.generatedOn}</div>
                {report.url && (
                  <a href={report.url} target="_blank" rel="noreferrer"
                     className="text-[11px] font-semibold underline" style={{ color: TEAL_DARK }}>
                    View on Indian Kanoon ↗
                  </a>
                )}
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={copyCitation}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#E2E8F0] text-[#475569] bg-white hover:bg-[#F8FAFC]">
                  <Square2StackIcon className="h-3.5 w-3.5" /> Copy citation
                </button>
                <button onClick={() => window.print()}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
                        style={{ background: TEAL }}>
                  <PrinterIcon className="h-3.5 w-3.5" /> Print
                </button>
              </div>
            </div>
          </div>
        )}

        {report && !loading && tab === 'document' && (
          <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-[#E2E8F0] shadow-sm p-6 md:p-8">
            <h2 className="text-lg font-bold text-[#0F172A] font-serif">{report.title}</h2>
            {report.bench?.length > 0 && (
              <div className="mt-1 text-sm text-[#475569]">
                Bench: <span className="font-semibold" style={{ color: TEAL_DARK }}>{report.bench.join(', ')}</span>
              </div>
            )}
            <pre className="mt-4 whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-[#1E293B] border border-[#E2E8F0] rounded-xl p-4 max-h-[70vh] overflow-y-auto">
              {report.documentText || 'Full document text unavailable.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main review layout ──────────────────────────────────────────────────────

export default function CitationReviewResults({
  searchResponse, caseContext, caseTitle, researchMode = 'issues', onEditIssues, onReset,
}) {
  const issues = searchResponse?.issues || [];
  const sessionId = searchResponse?.sessionId;
  // Grounds-mode sessions label each research unit "Ground", not "Issue".
  const isGrounds = researchMode === 'grounds';
  const unitLabel = isGrounds ? 'Ground' : 'Issue';
  const unitHeading = (issue) => (issue.title ? `${unitLabel} ${issue.id}: ${issue.title}` : issue.issue);
  const [detail, setDetail] = useState(null); // {issueId, item}
  const [openQueries, setOpenQueries] = useState({}); // issueId -> bool
  // Click an issue in the left rail → show only that issue's judgments.
  const [activeIssueId, setActiveIssueId] = useState(null);
  // Court-wise filter: 'all' or an EXACT court name from the fetched results.
  const [courtFilter, setCourtFilter] = useState('all');
  // Approve/Reject decisions: server-persisted per session, mirrored in
  // sessionStorage so pills survive navigating away and back.
  const statusStorageKey = sessionId ? `jurinex.reviewStatuses.${sessionId}` : null;
  const [statuses, setStatuses] = useState(() => {
    try {
      return statusStorageKey ? JSON.parse(sessionStorage.getItem(statusStorageKey) || '{}') : {};
    } catch { return {}; }
  });
  React.useEffect(() => {
    if (!statusStorageKey) return;
    try { sessionStorage.setItem(statusStorageKey, JSON.stringify(statuses)); } catch { /* non-fatal */ }
  }, [statusStorageKey, statuses]);

  // Bench category + sort: support (petitioner side) first, then the
  // client's OWN High Court (binding at the forum — e.g. Bombay HC for a
  // Maharashtra matter), then bench-wise (Supreme Court → High Courts →
  // other forums), top verified score first. forumCourt comes from the
  // backend ("Bombay High Court"); matching uses its first word so IK
  // docsource variants still match.
  const forumCourtKey = (searchResponse?.forumCourt || '').toLowerCase().split(/\s+/)[0] || null;
  const isOwnCourt = (court) => {
    if (!forumCourtKey) return false;
    const c = (court || '').toLowerCase();
    return c.includes('high court') && c.includes(forumCourtKey);
  };
  const benchCat = (court) => (/supreme court/i.test(court || '') ? 'supreme'
    : /high court/i.test(court || '') ? 'high' : 'other');
  const BENCH_ORDER = { supreme: 0, high: 1, other: 2 };
  const courtRank = (court) => (isOwnCourt(court) ? -1 : BENCH_ORDER[benchCat(court)]);
  const SIDE_ORDER = { support: 0, interim: 2, contra: 3 };
  const scoreOf = (it) => it.signals?.aiRelevance ?? it.signals?.semantic ?? 0;
  const sortResults = (results) => [...results].sort((a, b) => {
    const s = (SIDE_ORDER[a.side] ?? 1) - (SIDE_ORDER[b.side] ?? 1);
    if (s) return s;
    const c = courtRank(a.court) - courtRank(b.court);
    if (c) return c;
    return scoreOf(b) - scoreOf(a);
  });

  const visibleIssues = useMemo(
    () => issues
      .filter((issue) => activeIssueId == null || issue.id === activeIssueId)
      .map((issue) => ({
        ...issue,
        results: sortResults((issue.results || []).filter(
          (it) => courtFilter === 'all' || (it.court || 'Unknown court') === courtFilter,
        )),
      })),
    [issues, activeIssueId, courtFilter], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Every distinct court present in the fetched judgments (scoped to the
  // selected issue), ordered bench-wise then alphabetically, with counts.
  const courtOptions = useMemo(() => {
    const counts = new Map();
    issues
      .filter((issue) => activeIssueId == null || issue.id === activeIssueId)
      .forEach((issue) => (issue.results || []).forEach((it) => {
        const court = it.court || 'Unknown court';
        counts.set(court, (counts.get(court) || 0) + 1);
      }));
    return [...counts.entries()].sort((a, b) =>
      (BENCH_ORDER[benchCat(a[0])] - BENCH_ORDER[benchCat(b[0])]) || a[0].localeCompare(b[0]));
  }, [issues, activeIssueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A court selection that no longer exists in scope falls back to All.
  React.useEffect(() => {
    if (courtFilter !== 'all' && !courtOptions.some(([court]) => court === courtFilter)) {
      setCourtFilter('all');
    }
  }, [courtFilter, courtOptions]);

  const totalCitations = useMemo(
    () => visibleIssues.reduce((sum, issue) => sum + (issue.results?.length || 0), 0),
    [visibleIssues],
  );

  const contextLine = useMemo(() => {
    const summary = caseContext?.raw_case_summary || caseContext?.facts || '';
    return summary.length > 200 ? `${summary.slice(0, 200)}…` : summary;
  }, [caseContext]);

  const statusOf = (issueId, docId) => statuses[`${issueId}:${docId}`] || 'pending';

  return (
    // Fills the bounded layout height; ONLY the citation list / report
    // pane scrolls — the left rail and toolbar stay put.
    <div className="flex-1 min-h-0 bg-white flex flex-col">
      <div className="flex-1 flex min-h-0 items-stretch">
        {/* Left rail — This search (fixed, scrolls its own issue list) */}
        <aside className="w-72 shrink-0 border-r border-[#E2E8F0] bg-white flex flex-col min-h-0">
          <div className="p-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#0F172A]">This search</h3>
            <button onClick={onEditIssues}
                    className="flex items-center gap-1 text-xs font-semibold hover:opacity-80"
                    style={{ color: TEAL_DARK }}>
              <PencilIcon className="h-3.5 w-3.5" /> Edit
            </button>
          </div>
          <div className="px-4 pb-4 space-y-3 overflow-y-auto flex-1">
            {contextLine && (
              <div className="rounded-xl border border-[#99F6E4] bg-[#F0FDFA] px-3 py-2.5 flex gap-2">
                <ScaleIcon className="h-4 w-4 shrink-0 mt-0.5" style={{ color: TEAL_DARK }} />
                <p className="text-[11px] text-[#334155] leading-relaxed">
                  {caseTitle ? <span className="font-semibold">{caseTitle}: </span> : null}
                  {contextLine}
                </p>
              </div>
            )}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">
                {isGrounds ? 'Grounds' : 'Issues'} ({issues.length})
              </div>
              <div className="mt-2 space-y-2">
                {activeIssueId != null && (
                  <button
                    onClick={() => setActiveIssueId(null)}
                    className="w-full text-left rounded-xl border border-dashed border-[#99F6E4] bg-white px-3 py-2 text-[11px] font-semibold hover:bg-[#F0FDFA]"
                    style={{ color: TEAL_DARK }}
                  >
                    ← Show all {isGrounds ? 'grounds' : 'issues'}
                  </button>
                )}
                {issues.map((issue) => {
                  const active = activeIssueId === issue.id;
                  return (
                    <button
                      key={issue.id}
                      onClick={() => setActiveIssueId(active ? null : issue.id)}
                      className={`w-full text-left rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed transition-colors ${
                        active
                          ? 'border-[#21C1B6] bg-[#F0FDFA] text-[#0F172A] font-semibold'
                          : 'border-[#E2E8F0] bg-white text-[#334155] hover:border-[#99F6E4] hover:bg-[#F8FAFC]'
                      }`}
                    >
                      {unitHeading(issue)}
                      <span className="ml-1.5 text-[10px] text-[#94A3B8]">({issue.results?.length || 0})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="p-4 border-t border-[#E2E8F0] space-y-2">
            <button onClick={onEditIssues}
                    className="w-full flex items-center justify-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm font-semibold text-[#475569] hover:bg-[#F8FAFC]">
              <PencilIcon className="h-4 w-4" /> Refine search
            </button>
            <button onClick={onReset}
                    className="w-full rounded-xl px-3 py-2 text-xs font-semibold text-[#94A3B8] hover:text-[#475569]">
              Start a new research
            </button>
          </div>
        </aside>

        {/* Main area */}
        {detail ? (
          <ReportDetail
            sessionId={sessionId}
            issueId={detail.issueId}
            item={detail.item}
            status={statusOf(detail.issueId, detail.item.docId)}
            onStatus={(next) => setStatuses((prev) => ({ ...prev, [`${detail.issueId}:${detail.item.docId}`]: next }))}
            onBack={() => setDetail(null)}
          />
        ) : (
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-white">
            <div className="max-w-5xl px-6 lg:px-10 py-5">
              <div className="flex items-center gap-3">
                <button
                  onClick={onEditIssues}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F8FAFC]"
                >
                  <ArrowLeftIcon className="h-3.5 w-3.5" /> Back
                </button>
                <h2 className="text-base font-bold text-[#0F172A]">{totalCitations} citations to review</h2>
              </div>

              {/* Court-wise filter: every court present in the fetched judgments */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">Court</span>
                <select
                  value={courtFilter}
                  onChange={(e) => setCourtFilter(e.target.value)}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#334155] focus:border-[#21C1B6] focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/10"
                >
                  <option value="all">
                    All courts ({courtOptions.reduce((sum, [, n]) => sum + n, 0)})
                  </option>
                  {courtOptions.map(([court, count]) => (
                    <option key={court} value={court}>{court} ({count})</option>
                  ))}
                </select>
                {courtFilter !== 'all' && (
                  <button
                    onClick={() => setCourtFilter('all')}
                    className="text-[11px] font-semibold hover:underline"
                    style={{ color: TEAL_DARK }}
                  >
                    Clear filter
                  </button>
                )}
                {searchResponse?.forumCourt && (
                  <span className="text-[11px] text-[#64748B]">
                    <span className="font-semibold" style={{ color: TEAL_DARK }}>{searchResponse.forumCourt}</span>
                    {' '}judgments ranked first — your forum
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-8">
                {visibleIssues.map((issue) => {
                  const queries = issue.keywords
                    ? [...(issue.keywords.doctrinal || []), ...(issue.keywords.statutory || []),
                       ...(issue.keywords.factual || []), ...(issue.keywords.outcome || [])]
                    : [];
                  const open = !!openQueries[issue.id];
                  return (
                    <section key={issue.id}>
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 h-2 w-2 rounded-full shrink-0" style={{ background: TEAL }} />
                        <div className="min-w-0">
                          <h3 className="text-[15px] font-bold text-[#0F172A] font-serif leading-snug">
                            {unitHeading(issue)}
                          </h3>
                          {issue.title && (
                            <p className="mt-0.5 text-[12px] text-[#64748B] leading-relaxed">{issue.issue}</p>
                          )}
                          {queries.length > 0 && (
                            <button
                              onClick={() => setOpenQueries((prev) => ({ ...prev, [issue.id]: !open }))}
                              className="mt-1 flex items-center gap-1 text-[11px] text-[#64748B] hover:text-[#0F172A]"
                            >
                              {open ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
                              {queries.length} queries used
                            </button>
                          )}
                          {open && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {queries.map((query, idx) => (
                                <span key={idx} className="px-2 py-0.5 rounded-full text-[10px] text-[#0D9488] bg-[#F0FDFA] border border-[#99F6E4]">
                                  {query}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="ml-auto shrink-0 self-start mt-0.5 text-[11px] font-semibold text-[#94A3B8] bg-[#F8FAFC] border border-[#E2E8F0] rounded-full px-2.5 py-0.5">
                          {issue.results?.length || 0}
                        </span>
                      </div>

                      <div className="mt-3 space-y-3">
                        {(issue.results || []).length === 0 && (
                          <div className="text-xs text-[#94A3B8] italic pl-4">
                            {courtFilter === 'all'
                              ? 'No precedents surfaced for this issue.'
                              : 'No precedents from this court level — try another court filter.'}
                          </div>
                        )}
                        {(issue.results || []).map((item) => (
                          <CitationCard
                            key={item.docId}
                            item={item}
                            status={statusOf(issue.id, item.docId)}
                            onView={() => setDetail({ issueId: issue.id, item })}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
