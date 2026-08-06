import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  BriefcaseIcon,
  CheckIcon,
  ChevronLeftIcon,
  DocumentTextIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ScaleIcon,
  SparklesIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'react-toastify';
import Swal from 'sweetalert2';
import judgementApi from '../../services/judgementApi';
import documentApi from '../../services/documentApi';
import CitationReviewResults from './CitationReviewResults';
import { useSidebar } from '../../context/SidebarContext';

// Palette matches the app's light theme: slate text/borders, the brand
// teal (#21C1B6 / hover #1AA49B) as accent, and tinted status colours
// (red/amber/green stay semantic — bands and warnings, not theme).
const BAND_STYLES = {
  GREEN: 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]',
  YELLOW: 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]',
  RED: 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]',
};

// Grounds-mode extraction confidence (per ground) — semantic status tints,
// same palette as the bands.
const CONFIDENCE_STYLES = {
  high: 'bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]',
  medium: 'bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]',
  low: 'bg-[#FEF2F2] text-[#991B1B] border border-[#FECACA]',
};

const REFINE_MODES = [
  { value: 'facet', label: 'Filter (court / year / band)' },
  { value: 'keyword', label: 'Keyword' },
  { value: 'semantic', label: 'Semantic' },
];

function BandPill({ band }) {
  return (
    <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide ${BAND_STYLES[band] || BAND_STYLES.RED}`}>
      {band}
    </span>
  );
}

function Chip({ text }) {
  return (
    <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0] whitespace-nowrap">
      {text}
    </span>
  );
}

function ResultCard({ item, demoted }) {
  return (
    <div className={`rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-sm transition-opacity ${demoted ? 'opacity-45' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <a
          href={item.url || undefined}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-semibold text-[#0F172A] hover:text-[#21C1B6] leading-snug"
        >
          {item.title || item.docId}
        </a>
        <div className="flex items-center gap-2 shrink-0">
          <BandPill band={item.band} />
          <span className="text-xs text-[#64748B] font-semibold">{Math.round((item.score || 0) * 100)}%</span>
        </div>
      </div>
      <div className="mt-1 text-xs text-[#64748B]">
        {item.court}{item.year ? ` · ${item.year}` : ''}
      </div>
      {item.redFlag && (
        <div className="mt-2 rounded-lg bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 text-xs font-semibold text-[#991B1B]">
          ⚠ Flagged: negative treatment — do not rely without checking.
        </div>
      )}
      {item.pinpoint && (
        <blockquote className="mt-3 border-l-2 border-[#21C1B6]/50 bg-[#F8FAFC] rounded-r-lg pl-3 pr-3 py-2 text-xs text-[#475569] italic leading-relaxed">
          {item.pinpoint}
        </blockquote>
      )}
      {Array.isArray(item.chips) && item.chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {item.chips.map((chip, idx) => <Chip key={idx} text={chip} />)}
        </div>
      )}
    </div>
  );
}

function IssueResults({ sessionId, issue }) {
  const [mode, setMode] = useState('keyword');
  const [query, setQuery] = useState('');
  const [refined, setRefined] = useState(null);
  const [refining, setRefining] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const applyRefine = async (overrideMode) => {
    const useMode = overrideMode || mode;
    if (!query.trim() && useMode !== 'facet') {
      toast.info('Type what to refine by first');
      return;
    }
    setRefining(true);
    try {
      const data = await judgementApi.refine(sessionId, { issueId: issue.id, mode: useMode, query });
      setRefined(data);
      setCurrentPage(1); // Reset to first page on refinement
    } catch (err) {
      toast.error(err.message || 'Refine failed');
    } finally {
      setRefining(false);
    }
  };

  const rows = refined
    ? refined.items.map((entry) => ({ item: entry.result, demoted: entry.demoted }))
    : issue.results.map((item) => ({ item, demoted: false }));

  const totalPages = Math.ceil(rows.length / itemsPerPage);
  const paginatedRows = rows.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <span className="h-8 w-8 rounded-lg bg-[#F0FDFA] flex items-center justify-center shrink-0">
            <ScaleIcon className="h-4.5 w-4.5 text-[#21C1B6]" style={{ height: 18, width: 18 }} />
          </span>
          <h3 className="text-[15px] font-bold text-[#0F172A] leading-snug font-serif pt-1">{issue.issue}</h3>
        </div>
        <div className="text-[11px] font-medium text-[#94A3B8] whitespace-nowrap pt-1.5">
          {rows.length} result{rows.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Search within these results — reorders, never deletes */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="bg-white border border-[#E2E8F0] text-[#475569] text-xs rounded-lg px-2 py-2 outline-none focus:border-[#21C1B6]/50"
        >
          {REFINE_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyRefine(); }}
          placeholder='Refine these results, e.g. "Supreme Court after 2015"'
          className="flex-1 min-w-[220px] bg-white border border-[#E2E8F0] text-[#0F172A] text-xs rounded-lg px-3 py-2 outline-none focus:border-[#21C1B6]/50 placeholder:text-[#94A3B8]"
        />
        <button
          onClick={() => applyRefine()}
          disabled={refining}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0] disabled:opacity-50"
        >
          {refining ? 'Refining…' : 'Refine'}
        </button>
        {(refined || query) && (
          <button
            onClick={() => { setRefined(null); setQuery(''); setCurrentPage(1); }}
            className="px-2 py-2 rounded-lg text-xs text-[#94A3B8] hover:text-[#475569]"
          >
            Reset
          </button>
        )}
      </div>

      {refined?.escapeHatch && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5">
          <span className="text-xs text-[#92400E]">{refined.escapeHatch.offer}</span>
          <button
            onClick={() => applyRefine('ik_escape')}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#21C1B6] hover:bg-[#1AA49B] text-white"
          >
            Search all of Indian Kanoon
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-3">
        {paginatedRows.length === 0 && (
          <div className="text-xs text-[#94A3B8] italic">No precedents surfaced for this issue.</div>
        )}
        {paginatedRows.map(({ item, demoted }) => (
          <ResultCard key={item.docId} item={item} demoted={demoted} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 pt-4 border-t border-[#F1F5F9] flex items-center justify-between">
          <div className="text-xs text-[#64748B]">
            Showing <span className="font-semibold text-[#0F172A]">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-semibold text-[#0F172A]">{Math.min(currentPage * itemsPerPage, rows.length)}</span> of <span className="font-semibold text-[#0F172A]">{rows.length}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              <ChevronLeftIcon className="h-4 w-4 text-[#475569]" />
            </button>
            <div className="flex items-center gap-1 mx-1">
              {[...Array(totalPages)].map((_, i) => {
                const p = i + 1;
                // Show first, last, current, and one around current
                if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
                  return (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`min-w-[28px] h-7 text-xs font-semibold rounded-lg transition-colors ${
                        currentPage === p
                          ? 'bg-[#21C1B6] text-white'
                          : 'text-[#475569] hover:bg-[#F1F5F9]'
                      }`}
                    >
                      {p}
                    </button>
                  );
                }
                if (p === currentPage - 2 || p === currentPage + 2) {
                  return <span key={p} className="text-[#94A3B8] px-0.5">…</span>;
                }
                return null;
              })}
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] disabled:opacity-40 disabled:hover:bg-white transition-colors"
            >
              {/* Reuse ChevronLeft but rotate it or use ChevronRight if available */}
              <ChevronLeftIcon className="h-4 w-4 text-[#475569] rotate-180" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CitationResearchPanel() {
  const { isSidebarCollapsed, isSidebarHidden } = useSidebar();
  const [step, setStep] = useState('input'); // input | issues | results
  const [inputMode, setInputMode] = useState('case'); // case | text
  // How research items are derived: 'issues' (issue spotter — existing
  // behaviour, default) or 'grounds' (extract the grounds pleaded in the
  // filing and fetch verified judgments for each ground).
  // 'combined' = ONE pass extracting pleaded grounds AND spotting issues,
  // merged — the only mode for new analyses; 'issues'/'grounds' survive
  // solely for rendering sessions analysed before the merge.
  const [researchMode, setResearchMode] = useState('combined');
  const [cases, setCases] = useState([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesPage, setCasesPage] = useState(1);
  const casesPerPage = 6;
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [caseText, setCaseText] = useState('');
  // Fresh matter: the case has NO drafted pleading yet — the system reads
  // ALL of the case's source documents and the lawyer's stated objective
  // (typed in the textarea, required) drives PROPOSED grounds via the
  // dedicated /analyze/case/fresh route.
  const [freshMode, setFreshMode] = useState(false);
  const [file, setFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [customIssues, setCustomIssues] = useState([]);
  const [customDraft, setCustomDraft] = useState('');
  const [searchResponse, setSearchResponse] = useState(null);

  // Per-issue query curation: issueId -> { selected: [system queries kept
  // checked], custom: [user-typed queries] }. Issues with no entry run
  // with their full generated query set server-side.
  const [queryPicks, setQueryPicks] = useState({});
  const [queryDrafts, setQueryDrafts] = useState({}); // issueId -> input text

  const totalSelected = selectedIds.size + customIssues.length;
  const suggested = analysis?.suggestedIssues || [];
  // Once analysed, the server's researchMode is the truth for this session.
  const isGrounds = (analysis?.researchMode || researchMode) === 'grounds';
  const isCombined = (analysis?.researchMode || researchMode) === 'combined';
  const isFresh = (analysis?.researchMode || researchMode) === 'fresh';
  const groundsMeta = analysis?.groundsMeta || null;

  // Persist the whole research flow (analysis, selections, fetched
  // citations) so navigating away and coming back restores everything.
  const STORAGE_KEY = 'jurinex.citationResearch.v1';
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.inputMode) setInputMode(saved.inputMode);
        // researchMode is NOT restored — new analyses always run combined;
        // reopened sessions render from analysis.researchMode instead.
        if (saved.selectedCaseId) setSelectedCaseId(saved.selectedCaseId);
        if (typeof saved.caseText === 'string') setCaseText(saved.caseText);
        if (saved.analysis) setAnalysis(saved.analysis);
        if (Array.isArray(saved.selectedIds)) setSelectedIds(new Set(saved.selectedIds));
        if (saved.queryPicks) setQueryPicks(saved.queryPicks);
        if (Array.isArray(saved.customIssues)) setCustomIssues(saved.customIssues);
        if (saved.searchResponse) setSearchResponse(saved.searchResponse);
        const step_ = saved.step === 'results' && !saved.searchResponse
          ? (saved.analysis ? 'issues' : 'input')
          : (saved.step === 'issues' && !saved.analysis ? 'input' : saved.step);
        if (step_) setStep(step_);
      }
    } catch { /* corrupt storage — start fresh */ }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        step, inputMode, researchMode, selectedCaseId, caseText,
        analysis, selectedIds: [...selectedIds], customIssues, queryPicks, searchResponse,
      }));
    } catch { /* storage full — non-fatal */ }
  }, [hydrated, step, inputMode, researchMode, selectedCaseId, caseText, analysis, selectedIds, customIssues, queryPicks, searchResponse]);

  // The user's existing cases, from the agentic document service.
  useEffect(() => {
    documentApi.getCases()
      .then((r) => {
        const list = r?.cases ?? r?.data ?? (Array.isArray(r) ? r : []);
        setCases(Array.isArray(list) ? list : []);
      })
      .catch(() => setCases([]))
      .finally(() => setCasesLoading(false));
  }, []);

  // Research history — every past search stored in the citationTest DB.
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  // Silent refresh keeps the sidebar in sync after analyze/run/back-to-input;
  // a transient failure keeps the previous list instead of blanking it.
  const refreshHistory = useCallback((initial = false) => {
    if (initial) setHistoryLoading(true);
    judgementApi.listSessions()
      .then((rows) => setHistory(rows))
      .catch(() => { if (initial) setHistory([]); })
      .finally(() => { if (initial) setHistoryLoading(false); });
  }, []);
  useEffect(() => { refreshHistory(true); }, [refreshHistory]);
  // Coming back to the input step (after a search, or via "New research")
  // must show research finished this visit — the mount-time list is stale.
  useEffect(() => {
    if (hydrated && step === 'input') refreshHistory();
  }, [hydrated, step, refreshHistory]);

  const openHistory = async (sessionId) => {
    try {
      const saved = await judgementApi.getSession(sessionId);
      setAnalysis({
        sessionId,
        caseContext: saved.caseContext,
        suggestedIssues: saved.suggestedIssues || [],
        caseTitle: saved.caseTitle || null,
        needsClarification: false,
        researchMode: saved.researchMode || 'issues',
        groundsMeta: saved.groundsMeta || null,
      });
      setSelectedIds(new Set((saved.suggestedIssues || []).map((i) => i.id)));
      setCustomIssues([]);
      setQueryPicks({});
      setQueryDrafts({});
      const issuesWithResults = (saved.issues || []).filter((i) => (i.results || []).length > 0);
      if (issuesWithResults.length > 0) {
        // Restore approve/reject pills saved with the session.
        try {
          const statuses = {};
          Object.entries(saved.statuses || {}).forEach(([issueId, byDoc]) =>
            Object.entries(byDoc || {}).forEach(([docId, st]) => { statuses[`${issueId}:${docId}`] = st; }));
          sessionStorage.setItem(`jurinex.reviewStatuses.${sessionId}`, JSON.stringify(statuses));
        } catch { /* non-fatal */ }
        setSearchResponse({ sessionId, issues: saved.issues, forumCourt: saved.forumCourt || null });
        setStep('results');
      } else {
        setSearchResponse(null);
        setStep('issues');
        toast.info('This research was analysed but a search was never run — pick issues and hit Run search.');
      }
    } catch (err) {
      toast.error(err.message || 'Could not open this research');
    }
  };

  // History entries belonging to the currently selected case.
  const caseHistory = useMemo(
    () => history.filter((h) => h.caseId && String(h.caseId) === String(selectedCaseId)),
    [history, selectedCaseId],
  );

  const [deletingId, setDeletingId] = useState(null);
  const deleteHistory = async (entry) => {
    const label = entry.caseTitle || entry.summary || entry.sessionId;
    const result = await Swal.fire({
      title: 'Delete research',
      text: `Delete "${label}" and all its citation reports? This cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#DC2626',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel',
      customClass: { popup: 'rounded-lg', confirmButton: 'rounded-lg', cancelButton: 'rounded-lg' },
    });
    if (!result.isConfirmed) return;
    setDeletingId(entry.sessionId);
    try {
      await judgementApi.deleteSession(entry.sessionId);
      setHistory((prev) => prev.filter((h) => h.sessionId !== entry.sessionId));
      try { sessionStorage.removeItem(`jurinex.reviewStatuses.${entry.sessionId}`); } catch { /* non-fatal */ }
      // If the deleted research is the one currently open, reset to input.
      if (analysis?.sessionId === entry.sessionId) {
        setAnalysis(null);
        setSearchResponse(null);
        setSelectedIds(new Set());
        setCustomIssues([]);
        setStep('input');
      }
      Swal.fire({ title: 'Deleted!', text: 'The research and its reports are gone.', icon: 'success', timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: 'Error!', text: err.message || 'Could not delete this research.', icon: 'error', confirmButtonColor: '#21C1B6' });
    } finally {
      setDeletingId(null);
    }
  };

  // Row is a div (not a button) so the delete control can nest inside it.
  const HistoryRow = ({ entry }) => (
    <div
      onClick={() => openHistory(entry.sessionId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') openHistory(entry.sessionId); }}
      className="w-full text-left rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 hover:border-[#21C1B6]/60 hover:shadow-sm transition-all flex items-center gap-3 cursor-pointer"
    >
      <span className="h-9 w-9 rounded-lg bg-[#F0FDFA] flex items-center justify-center shrink-0">
        <MagnifyingGlassIcon className="text-[#21C1B6]" style={{ height: 18, width: 18 }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#0F172A] truncate">
          {entry.caseTitle || entry.summary || entry.sessionId}
        </span>
        <span className="block text-[11px] text-[#94A3B8] mt-0.5">
          {entry.citationCount > 0 ? (
            <>{entry.issueCount} issue{entry.issueCount === 1 ? '' : 's'} · {entry.citationCount} citation{entry.citationCount === 1 ? '' : 's'} · {String(entry.updatedAt).slice(0, 16)}</>
          ) : (
            <span className="text-[#D97706] font-medium">analysed only — no search run yet · {String(entry.updatedAt).slice(0, 16)}</span>
          )}
        </span>
      </span>
      <span className="text-[11px] font-bold shrink-0" style={{ color: '#1AA49B' }}>
        {entry.citationCount > 0 ? 'Open →' : 'Continue →'}
      </span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); deleteHistory(entry); }}
        disabled={deletingId === entry.sessionId}
        title="Delete this research and its reports"
        className="shrink-0 h-8 w-8 rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors disabled:opacity-50"
      >
        {deletingId === entry.sessionId
          ? <ArrowPathIcon className="animate-spin" style={{ height: 15, width: 15 }} />
          : <TrashIcon style={{ height: 15, width: 15 }} />}
      </button>
    </div>
  );

  const contextLine = useMemo(() => {
    const ctx = analysis?.caseContext;
    if (!ctx) return '';
    const summary = ctx.raw_case_summary || ctx.facts || '';
    return summary.length > 260 ? `${summary.slice(0, 260)}…` : summary;
  }, [analysis]);

  // Case grid + pagination, shared by the "My cases" tab and the optional
  // case picker on the "Paste or upload" tab (fresh research: case documents
  // + the typed description as the objective).
  const CasePicker = () => (
    <div>
      {casesLoading && (
        <div className="flex items-center gap-2 text-sm text-[#64748B] py-6 justify-center">
          <ArrowPathIcon className="h-4 w-4 animate-spin" /> Loading your cases…
        </div>
      )}
      {!casesLoading && cases.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#CBD5E1] bg-white px-4 py-8 text-center text-sm text-[#64748B]">
          No cases found in your Projects. Upload case documents under Projects first,
          or switch to “Paste or upload”.
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {cases.slice((casesPage - 1) * casesPerPage, casesPage * casesPerPage).map((cs) => {
          const active = selectedCaseId === cs.id;
          return (
            <button
              key={cs.id}
              onClick={() => setSelectedCaseId(active ? null : cs.id)}
              className={`text-left rounded-xl border p-4 transition-all ${
                active
                  ? 'border-[#21C1B6] bg-[#F0FDFA] shadow-sm'
                  : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1] hover:shadow-sm'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-white' : 'bg-[#F8FAFC]'}`}>
                  <BriefcaseIcon className={`h-5 w-5 ${active ? 'text-[#21C1B6]' : 'text-[#94A3B8]'}`} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#0F172A] leading-snug truncate">
                    {cs.case_title || cs.name || cs.id}
                  </div>
                  <div className="text-[11px] text-[#94A3B8] mt-1">
                    Issues will be generated from this case's documents, with page references.
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {cases.length > casesPerPage && (
        <div className="mt-4 flex items-center justify-between">
          <div className="text-[11px] text-[#94A3B8]">
            Showing {(casesPage - 1) * casesPerPage + 1} to {Math.min(casesPage * casesPerPage, cases.length)} of {cases.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={casesPage === 1}
              onClick={() => setCasesPage(p => p - 1)}
              className="p-1 rounded-lg border border-[#E2E8F0] disabled:opacity-30"
            >
              <ChevronLeftIcon className="h-4 w-4 text-[#64748B]" />
            </button>
            <button
              disabled={casesPage * casesPerPage >= cases.length}
              onClick={() => setCasesPage(p => p + 1)}
              className="p-1 rounded-lg border border-[#E2E8F0] disabled:opacity-30"
            >
              <ChevronLeftIcon className="h-4 w-4 text-[#64748B] rotate-180" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const runAnalyze = async () => {
    if (inputMode === 'case' && !selectedCaseId) {
      toast.info('Select one of your cases first');
      return;
    }
    if (inputMode === 'case' && freshMode && !caseText.trim()) {
      toast.info('Describe what the client wants — the objective drives a fresh matter\'s grounds');
      return;
    }
    if (inputMode === 'text' && !file) {
      toast.info('Upload a case document first — it is analysed directly');
      return;
    }
    setAnalyzing(true);
    try {
      const data = inputMode === 'case'
        ? (freshMode
          ? await judgementApi.analyzeCaseFresh(selectedCaseId, caseText.trim())
          : await judgementApi.analyzeCase(selectedCaseId, caseText.trim(), researchMode))
        // Upload tab: the document is the case material; the optional
        // description steers which grounds and issues come back.
        : await judgementApi.analyzeUpload(file, caseText.trim(), researchMode);
      setAnalysis(data);
      setSelectedIds(new Set((data.suggestedIssues || []).map((i) => i.id)));
      setCustomIssues([]);
      setQueryPicks({});
      setQueryDrafts({});
      setSearchResponse(null);
      setStep('issues');
      refreshHistory();
      if (data.needsClarification && data.clarificationQuestion) {
        toast.warn(data.clarificationQuestion, { autoClose: 8000 });
      }
    } catch (err) {
      toast.error(err.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const picksFor = (issue) => queryPicks[issue.id] || { selected: issue.queries || [], custom: [] };
  const toggleQuery = (issue, query) => {
    setQueryPicks((prev) => {
      const p = prev[issue.id] || { selected: issue.queries || [], custom: [] };
      const selected = p.selected.includes(query)
        ? p.selected.filter((q) => q !== query)
        : [...p.selected, query];
      return { ...prev, [issue.id]: { ...p, selected } };
    });
  };
  const addOwnQuery = (issue) => {
    const text = (queryDrafts[issue.id] || '').trim();
    if (!text) return;
    setQueryPicks((prev) => {
      const p = prev[issue.id] || { selected: issue.queries || [], custom: [] };
      if (p.custom.includes(text)) return prev;
      return { ...prev, [issue.id]: { ...p, custom: [...p.custom, text] } };
    });
    setQueryDrafts((prev) => ({ ...prev, [issue.id]: '' }));
  };
  const removeOwnQuery = (issue, query) => {
    setQueryPicks((prev) => {
      const p = prev[issue.id] || { selected: issue.queries || [], custom: [] };
      return { ...prev, [issue.id]: { ...p, custom: p.custom.filter((q) => q !== query) } };
    });
  };

  const toggleIssue = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addCustomIssue = () => {
    const text = customDraft.trim();
    if (!text) return;
    setCustomIssues((prev) => [...prev, text]);
    setCustomDraft('');
  };

  const runSearch = async () => {
    if (totalSelected === 0) {
      toast.info('Select at least one issue or add your own');
      return;
    }
    setSearching(true);
    try {
      // Only issues whose queries the user actually touched are overridden;
      // the rest keep their full generated set server-side.
      const queryOverrides = {};
      [...selectedIds].forEach((id) => {
        const issue = suggested.find((i) => i.id === id);
        const p = queryPicks[id];
        if (!issue || !p) return;
        const chosen = [...(p.selected || []), ...(p.custom || [])].filter(Boolean);
        const defaults = issue.queries || [];
        const untouched = (p.custom || []).length === 0
          && chosen.length === defaults.length
          && defaults.every((q) => chosen.includes(q));
        if (!untouched) queryOverrides[String(id)] = chosen;
      });
      const data = await judgementApi.runSearch(analysis.sessionId, {
        issueIds: [...selectedIds],
        customIssues,
        queryOverrides,
      });
      setSearchResponse(data);
      setStep('results');
      refreshHistory();
    } catch (err) {
      toast.error(err.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const resetAll = () => {
    setStep('input');
    setAnalysis(null);
    setSearchResponse(null);
    setSelectedIds(new Set());
    setCustomIssues([]);
    setCaseText('');
    setFile(null);
    setSelectedCaseId(null);
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* non-fatal */ }
  };

  const PageHeader = ({ title, subtitle, right }) => (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3.5">
        <div className="h-11 w-11 rounded-xl bg-[#F0FDFA] flex items-center justify-center shrink-0">
          <SparklesIcon className="h-6 w-6 text-[#21C1B6]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">{title}</h1>
          <p className="text-sm text-[#64748B] mt-0.5">{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );

  // ── Step 1: case input ──────────────────────────────────────────────────
  if (step === 'input') {
    return (
      <div className="min-h-full bg-[#F8FAFC] p-6 md:p-10">
        <div className="max-w-6xl mx-auto">
          <PageHeader
            title="Citation Research"
            subtitle="Pick one of your cases or upload a document — the system finds the legal issues and grounds, then retrieves verified Indian Kanoon precedents for each one."
          />

          <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
            {/* Left column: pick a case (or paste/upload) and analyse it */}
            <div className="min-w-0">
              {/* Source selector: an existing case, or pasted/uploaded input */}
              <div className="flex gap-2">
                {[
                  { key: 'case', label: 'My cases', icon: BriefcaseIcon },
                  { key: 'text', label: 'Upload document', icon: DocumentTextIcon },
                ].map(({ key, label, icon: TabIcon }) => (
                  <button
                    key={key}
                    onClick={() => setInputMode(key)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      inputMode === key
                        ? 'border-[#21C1B6] bg-[#F0FDFA] text-[#21C1B6]'
                        : 'border-[#E2E8F0] bg-white text-[#64748B] hover:text-[#0F172A] hover:border-[#CBD5E1]'
                    }`}
                  >
                    <TabIcon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>

              {inputMode === 'case' && (
                <div className="mt-4">
                  <CasePicker />

                  {/* History for the selected case — its past citation research */}
                  {selectedCaseId && caseHistory.length > 0 && (
                    <div className="mt-5 rounded-xl border border-[#99F6E4] bg-[#F0FDFA]/60 p-3">
                      <div className="text-xs font-bold text-[#0F172A]">
                        Past research for this case ({caseHistory.length})
                      </div>
                      <div className="mt-2 space-y-2">
                        {caseHistory.map((entry) => <HistoryRow key={entry.sessionId} entry={entry} />)}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Fresh-matter toggle: nothing drafted yet — proposed grounds
                  are built from ALL case documents + the typed objective. */}
              {inputMode === 'case' && (
                <label className={`mt-4 flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition-colors ${
                  freshMode ? 'border-[#21C1B6] bg-[#F0FDFA]' : 'border-[#E2E8F0] bg-white hover:border-[#21C1B6]/40'
                }`}>
                  <input
                    type="checkbox"
                    checked={freshMode}
                    onChange={(e) => setFreshMode(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] accent-[#21C1B6]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#0F172A]">
                      Fresh matter — nothing drafted or filed yet
                    </span>
                    <span className="block mt-0.5 text-[12px] text-[#64748B] leading-relaxed">
                      The system reads all of this case's source documents and builds
                      <span className="font-semibold"> proposed grounds</span> from what you
                      want to achieve. Describe your objective below — it is required.
                    </span>
                  </span>
                </label>
              )}

              {/* Upload tab: the document itself is the case material — it is
                  uploaded and analysed directly; the optional description below
                  steers which grounds and issues are extracted. */}
              {inputMode === 'text' && (
                <div className="mt-5">
                  <label className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-9 cursor-pointer text-center transition-colors ${
                    file ? 'border-[#21C1B6] bg-[#F0FDFA]' : 'border-[#CBD5E1] bg-white hover:border-[#21C1B6]/60 hover:bg-[#F0FDFA]/40'
                  }`}>
                    <span className={`h-11 w-11 rounded-xl flex items-center justify-center ${file ? 'bg-white' : 'bg-[#F8FAFC]'}`}>
                      <ArrowUpTrayIcon className={`h-5 w-5 ${file ? 'text-[#21C1B6]' : 'text-[#94A3B8]'}`} />
                    </span>
                    <span className="text-sm font-semibold text-[#0F172A]">
                      {file ? file.name : 'Upload the petition, FIR, plaint or judgment'}
                    </span>
                    <span className="text-[12px] text-[#64748B]">
                      {file
                        ? 'Document ready — it will be analysed directly. Click to replace it.'
                        : 'PDF, DOCX or TXT — the document is analysed directly and its grounds and legal issues are extracted.'}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  {file && (
                    <div className="mt-2 text-right">
                      <button onClick={() => setFile(null)} className="text-xs text-[#94A3B8] hover:text-[#DC2626]">
                        Remove file
                      </button>
                    </div>
                  )}
                </div>
              )}

              <textarea
                value={caseText}
                onChange={(e) => setCaseText(e.target.value)}
                rows={inputMode === 'case' ? (freshMode ? 5 : 3) : 4}
                placeholder={inputMode === 'case'
                  ? (freshMode
                    ? 'Describe what the client wants (required) — e.g. "we act for the accused director; the FIR arises from a supply-contract dispute and we want it quashed" or "we act for the supplier; recover the unpaid invoices with interest"'
                    : 'Optional instruction, e.g. "we act for the workmen; focus on the wage revision demand"')
                  : 'Optional description — e.g. "we act for the accused; seek regular bail" — the analysis of the uploaded document (its grounds and issues) is steered by this'}
                className="mt-4 w-full bg-white border border-[#E2E8F0] text-[#0F172A] text-sm rounded-xl p-4 outline-none focus:border-[#21C1B6]/50 focus:ring-2 focus:ring-[#21C1B6]/10 leading-relaxed shadow-sm placeholder:text-[#94A3B8]"
              />

              {/* One research method: pleaded grounds + spotted issues are
                  extracted together in a single combined pass. */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={runAnalyze}
                  disabled={analyzing}
                  className="ml-auto flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold bg-[#21C1B6] hover:bg-[#1AA49B] text-white shadow-sm disabled:opacity-60 transition-colors"
                >
                  {analyzing ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <SparklesIcon className="h-4 w-4" />}
                  {analyzing ? 'Analysing…' : 'Analyse case'}
                </button>
              </div>
            </div>

            {/* Right column: recent research — every past search, stored in the DB */}
            <aside className="lg:sticky lg:top-6 min-w-0">
              <h2 className="text-sm font-bold text-[#0F172A]">Recent research</h2>
              <p className="text-xs text-[#64748B] mt-1">Reopen a past search with all its citations and decisions.</p>
              {historyLoading && (
                <div className="mt-3 text-xs text-[#94A3B8]">Loading history…</div>
              )}
              {!historyLoading && history.length === 0 && (
                <div className="mt-3 rounded-xl border border-dashed border-[#CBD5E1] bg-white px-4 py-6 text-center text-xs text-[#94A3B8]">
                  No past research yet — your searches will appear here.
                </div>
              )}
              <div className="mt-3 space-y-2 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-1">
                {history.map((entry) => <HistoryRow key={entry.sessionId} entry={entry} />)}
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 2: pick / add issues ───────────────────────────────────────────
  if (step === 'issues') {
    return (
      <div className="min-h-full bg-[#F8FAFC] p-6 md:p-10">
        <div className="max-w-4xl mx-auto pb-24">
          <PageHeader
            title="What should we research?"
            subtitle={isGrounds
              ? 'These are the grounds pleaded in the filing — pick the ones you need judgments for, or add your own.'
              : isCombined
                ? 'Pleaded grounds and system-spotted issues, combined — pick what you need judgments for, or add your own.'
                : 'Pick the issues you need authority for, or describe it yourself.'}
            right={(
              <button
                onClick={runAnalyze}
                disabled={analyzing}
                className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F8FAFC] disabled:opacity-60 shrink-0"
              >
                <ArrowPathIcon className={`h-4 w-4 ${analyzing ? 'animate-spin' : ''}`} />
                Re-analyse
              </button>
            )}
          />

          {contextLine && (
            <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-[#B2EBE8] bg-[#F0FDFA] px-4 py-3">
              <ScaleIcon className="h-4 w-4 text-[#21C1B6] mt-0.5 shrink-0" />
              <p className="text-xs text-[#475569] leading-relaxed">
                <span className="font-semibold text-[#0F172A]">
                  Context{analysis?.caseTitle ? ` — ${analysis.caseTitle}` : ''}:
                </span>{' '}
                {contextLine}
              </p>
            </div>
          )}

          {analysis?.needsClarification && (
            <div className="mt-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-xs text-[#92400E]">
              {analysis.clarificationQuestion} — add detail above via Re-analyse, or type your own issues below and run the search anyway.
            </div>
          )}

          {/* Extraction metadata (grounds + combined + fresh modes) */}
          {(isGrounds || isCombined || isFresh) && groundsMeta && (
            <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-white px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#475569]">
                <span><span className="font-semibold text-[#0F172A]">{groundsMeta.totalGrounds ?? suggested.length}</span> {isFresh ? 'proposed' : 'pleaded'} ground{(groundsMeta.totalGrounds ?? suggested.length) === 1 ? '' : 's'}</span>
                {groundsMeta.spottedIssues != null && (
                  <span><span className="font-semibold text-[#0F172A]">{groundsMeta.spottedIssues}</span> spotted issue{groundsMeta.spottedIssues === 1 ? '' : 's'}</span>
                )}
                {groundsMeta.documentType && <span>Document: <span className="font-semibold text-[#0F172A]">{groundsMeta.documentType}</span></span>}
                {groundsMeta.party && <span>Party: <span className="font-semibold text-[#0F172A]">{groundsMeta.party}</span></span>}
                {groundsMeta.truncatedGrounds > 0 && (
                  <span className="text-[#92400E]">{groundsMeta.truncatedGrounds} further ground{groundsMeta.truncatedGrounds === 1 ? '' : 's'} beyond the cap not shown</span>
                )}
              </div>
              {Array.isArray(groundsMeta.notes) && groundsMeta.notes.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {groundsMeta.notes.map((note, ni) => (
                    <li key={ni} className="text-[11px] text-[#92400E]">⚠ {note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-7 flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#0F172A]">
              {isGrounds ? 'Grounds of the case' : isCombined ? 'Grounds & issues' : isFresh ? 'Proposed grounds for this matter' : 'Legal issues'} <span className="ml-2 font-medium text-[#94A3B8]">{selectedIds.size} of {suggested.length} selected</span>
            </h2>
            {selectedIds.size > 0 && (
              <button onClick={() => setSelectedIds(new Set())} className="text-xs font-medium text-[#21C1B6] hover:text-[#1AA49B]">
                Clear all
              </button>
            )}
          </div>

          {/* Only the cards scroll — the add-your-own box and Run search stay in view. */}
          <div className="mt-3 max-h-[48vh] overflow-y-auto pr-1.5">
            <div className="grid md:grid-cols-2 gap-3">
            {suggested.length === 0 && (
              <div className="text-xs text-[#94A3B8] italic col-span-2">
                {isGrounds ? 'No pleaded grounds were found — add your own below.'
                  : isCombined ? 'No grounds or issues were found — add your own below.'
                    : isFresh ? 'No grounds could be proposed — describe your objective more precisely and re-analyse.'
                      : 'No issues were suggested — add your own below.'}
              </div>
            )}
            {suggested.map((issue) => {
              const active = selectedIds.has(issue.id);
              // Pleaded grounds keep their verbatim label + title heading;
              // issues show the plain "Whether …?" question as the heading
              // with no title/explanation clutter (user's preferred style).
              const isPleaded = isGrounds || !!issue.ground_label;
              const groundHeading = isPleaded
                ? `${issue.ground_label || `Ground ${issue.id}`}${issue.title ? `: ${issue.title}` : ''}`
                : issue.issue;
              return (
                <div
                  key={issue.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleIssue(issue.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) toggleIssue(issue.id); }}
                  className={`text-left rounded-xl border p-4 transition-all cursor-pointer ${
                    active
                      ? 'border-[#21C1B6] bg-[#F0FDFA] shadow-sm'
                      : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1] hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
                      active ? 'bg-[#21C1B6] border-[#21C1B6]' : 'border-[#CBD5E1] bg-white'
                    }`}>
                      {active && <CheckIcon className="h-3.5 w-3.5 text-white" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-[15px] font-semibold text-[#0F172A] leading-snug block font-serif">
                        {groundHeading}
                      </span>
                      {isPleaded && issue.confidence && (
                        <span className={`mt-1.5 inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide ${CONFIDENCE_STYLES[issue.confidence] || CONFIDENCE_STYLES.medium}`}>
                          {issue.confidence} confidence
                        </span>
                      )}
                      {isPleaded && issue.explanation && (
                        <span className="mt-1.5 block text-[12px] text-[#64748B] leading-relaxed">
                          {issue.explanation}
                        </span>
                      )}
                      {isPleaded && Array.isArray(issue.legal_framework) && issue.legal_framework.length > 0 && (
                        <span className="mt-2 flex flex-wrap gap-1.5">
                          {issue.legal_framework.map((law, li) => (
                            <span key={li} className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0]">
                              {law}
                            </span>
                          ))}
                        </span>
                      )}
                      {isPleaded && Array.isArray(issue.case_law_cited) && issue.case_law_cited.length > 0 && (
                        <span className="mt-1.5 block text-[11px] text-[#64748B]">
                          <span className="font-semibold">Case law cited:</span>{' '}
                          <span className="italic">{issue.case_law_cited.join('; ')}</span>
                        </span>
                      )}
                      {Array.isArray(issue.queries) && issue.queries.length > 0 && (
                        <span className="mt-2.5 block space-y-1.5">
                          {/* System queries — checkbox picks which ones the search uses */}
                          {issue.queries.map((q, qi) => {
                            const checked = picksFor(issue).selected.includes(q);
                            return (
                              <span key={qi} className="flex items-start gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); toggleQuery(issue, q); }}
                                  title={checked ? 'Exclude this query from the search' : 'Include this query in the search'}
                                  className={`mt-0.5 h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center transition-colors ${
                                    checked ? 'bg-[#21C1B6] border-[#21C1B6]' : 'border-[#CBD5E1] bg-white hover:border-[#21C1B6]'
                                  }`}
                                >
                                  {checked && <CheckIcon className="h-2.5 w-2.5 text-white" />}
                                </button>
                                <span className={`text-[12px] leading-snug ${checked ? 'text-[#0D9488]' : 'text-[#94A3B8] line-through'}`}>
                                  {q}
                                </span>
                              </span>
                            );
                          })}
                          {/* The user's own queries — searched exactly like system anchors */}
                          {picksFor(issue).custom.map((q) => (
                            <span key={`own-${q}`} className="flex items-start gap-2">
                              <span className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border bg-[#21C1B6] border-[#21C1B6] flex items-center justify-center">
                                <CheckIcon className="h-2.5 w-2.5 text-white" />
                              </span>
                              <span className="flex-1 min-w-0 text-[12px] leading-snug text-[#0D9488] font-medium">{q}</span>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeOwnQuery(issue, q); }}
                                title="Remove your query"
                                className="shrink-0 text-[#94A3B8] hover:text-[#DC2626]"
                              >
                                <XMarkIcon className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          ))}
                          {/* + add your own query for THIS issue */}
                          <span className="flex items-center gap-1.5 pt-0.5" onClick={(e) => e.stopPropagation()}>
                            <PlusIcon className="h-3.5 w-3.5 shrink-0 text-[#21C1B6]" />
                            <input
                              value={queryDrafts[issue.id] || ''}
                              onChange={(e) => setQueryDrafts((prev) => ({ ...prev, [issue.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwnQuery(issue); } }}
                              placeholder='Add your own query, e.g. "mala fide intention" quash FIR'
                              className="flex-1 min-w-0 bg-transparent border-b border-dashed border-[#CBD5E1] focus:border-[#21C1B6] text-[12px] text-[#0F172A] outline-none py-0.5 placeholder:text-[#B6C2D2]"
                            />
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); addOwnQuery(issue); }}
                              className="shrink-0 text-[11px] font-semibold text-[#21C1B6] hover:text-[#1AA49B]"
                            >
                              Add
                            </button>
                          </span>
                        </span>
                      )}
                      {(issue.source || issue.ground_ref) && (
                        <span className="mt-2.5 flex items-center gap-1.5 text-[11px] text-[#64748B]">
                          <DocumentTextIcon className="h-3.5 w-3.5 shrink-0 text-[#94A3B8]" />
                          <span className="truncate">
                            {[issue.ground_ref, issue.source].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          <div className="mt-9">
            <h2 className="text-sm font-bold text-[#0F172A]">Search in your own words</h2>
            <p className="text-xs text-[#64748B] mt-1">Add a proposition or question in plain language. Each one is searched separately.</p>
            <div className="mt-3 rounded-xl border border-[#E2E8F0] bg-white p-3 shadow-sm focus-within:border-[#21C1B6]/50 focus-within:ring-2 focus-within:ring-[#21C1B6]/10">
              <textarea
                value={customDraft}
                onChange={(e) => setCustomDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addCustomIssue(); }
                }}
                rows={2}
                placeholder="e.g. Whether bail may be granted pending appeal under Article 136"
                className="w-full bg-transparent text-sm text-[#0F172A] outline-none resize-none leading-relaxed placeholder:text-[#94A3B8]"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-[#94A3B8]">Enter to add</span>
                <button
                  onClick={addCustomIssue}
                  className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-white hover:bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0]"
                >
                  <PlusIcon className="h-3.5 w-3.5" /> Add
                </button>
              </div>
            </div>
            {customIssues.length > 0 && (
              <div className="mt-3 grid gap-2">
                {customIssues.map((text, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-3 rounded-xl border border-[#21C1B6] bg-[#F0FDFA] px-4 py-3">
                    <span className="text-sm font-medium text-[#0F172A] leading-snug font-serif">{text}</span>
                    <button
                      onClick={() => setCustomIssues((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-[#94A3B8] hover:text-[#21C1B6] shrink-0"
                    >
                      <XMarkIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={`fixed bottom-0 right-0 border-t border-[#E2E8F0] bg-white/95 backdrop-blur px-6 py-3 shadow-[0_-2px_10px_rgba(15,23,42,0.04)] transition-all duration-300 z-40 ${
            isSidebarHidden ? 'left-0' : (isSidebarCollapsed ? 'lg:left-20' : 'lg:left-72')
          } left-0`}>
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
              <button onClick={resetAll} className="flex items-center gap-1 text-xs font-medium text-[#64748B] hover:text-[#0F172A]">
                <ChevronLeftIcon className="h-4 w-4" /> Start over
              </button>
              <div className="flex items-center gap-4">
                <span className="text-xs text-[#64748B]">Searching {totalSelected} {isGrounds ? 'ground' : 'issue'}{totalSelected === 1 ? '' : 's'}</span>
                <button
                  onClick={runSearch}
                  disabled={searching || totalSelected === 0}
                  className="flex items-center gap-2 px-7 py-2.5 rounded-lg text-sm font-semibold bg-[#21C1B6] hover:bg-[#1AA49B] text-white shadow-sm disabled:opacity-60 transition-colors"
                >
                  {searching ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : <MagnifyingGlassIcon className="h-4 w-4" />}
                  {searching ? 'Searching…' : 'Run search'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 3: citation review (list + Report/Document detail) ─────────────
  return (
    <CitationReviewResults
      searchResponse={searchResponse}
      caseContext={analysis?.caseContext}
      caseTitle={analysis?.caseTitle}
      researchMode={analysis?.researchMode || 'issues'}
      onEditIssues={() => setStep('issues')}
      onReset={resetAll}
    />
  );
}
