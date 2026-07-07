// DraftingModal — the "Drafting Mode" workflow launched from the chat input.
//
// Steps:
//   1. Upload a template  → backend analyzes layout asynchronously (polled)
//   2. Upload supporting documents (facts source; cached server-side if large)
//   3. Pick the Gemini model + optional instructions → Generate
//   4. DraftStreamingViewer renders the section-by-section SSE stream
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, FileText, FileUp, Loader2,
  Play, Square, Trash2, X, Layers, BookOpen,
} from 'lucide-react';
import {
  createDraftingSession,
  uploadDraftTemplate,
  uploadSupportingDocuments,
  waitForTemplateAnalysis,
  streamDraftGeneration,
} from '../../services/draftingModeApi';
import DraftStreamParser from './draftStreamParser';
import DraftStreamingViewer from './DraftStreamingViewer';

const MODEL_OPTIONS = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', hint: 'Highest quality — best for complex legal drafts' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', hint: 'Fast and capable — good default' },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', hint: 'Fastest — simple documents' },
];

const ACCEPT = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.tiff';
const MAX_TEMPLATE_MB = 20;
const MAX_DOC_MB = 50;
const MAX_DOCS = 50;

const fmtSize = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

const DraftingModal = ({ open, onClose }) => {
  // Workflow state
  const [phase, setPhase] = useState('setup'); // setup | generating | finished
  const [sessionId, setSessionId] = useState(null);
  const [error, setError] = useState(null);

  // Step 1 — template
  const [templateFile, setTemplateFile] = useState(null);
  const [analysisState, setAnalysisState] = useState('idle'); // idle | uploading | analyzing | ready | failed
  const [structure, setStructure] = useState(null);

  // Step 2 — supporting docs
  const [docs, setDocs] = useState([]); // {name,size} confirmed on server
  const [docsUploading, setDocsUploading] = useState(false);

  // Step 3 — generation settings
  const [model, setModel] = useState(MODEL_OPTIONS[0].id);
  const [instructions, setInstructions] = useState('');

  // Streaming state — text lives in refs; React state only tracks section metadata.
  const [sections, setSections] = useState([]);
  const [streamingSectionId, setStreamingSectionId] = useState(null);
  const [progress, setProgress] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [savedToHistory, setSavedToHistory] = useState(false);
  const [version, setVersion] = useState(0);
  const textStoreRef = useRef(new Map());
  const abortRef = useRef(null);

  const templateInputRef = useRef(null);
  const docsInputRef = useRef(null);

  // Reset everything when the modal is (re)opened.
  useEffect(() => {
    if (!open) return;
    setPhase('setup'); setSessionId(null); setError(null);
    setTemplateFile(null); setAnalysisState('idle'); setStructure(null);
    setDocs([]); setDocsUploading(false);
    setSections([]); setStreamingSectionId(null); setProgress(null);
    setStatusMessage(''); setInstructions(''); setSavedToHistory(false);
    textStoreRef.current = new Map();
    return () => abortRef.current?.abort();
  }, [open]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const res = await createDraftingSession(model);
    setSessionId(res.session_id);
    return res.session_id;
  }, [sessionId, model]);

  // ── Step 1: template upload + async analysis polling ────────────────────
  const handleTemplateSelected = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    if (file.size > MAX_TEMPLATE_MB * 1024 * 1024) {
      setError(`Template exceeds the ${MAX_TEMPLATE_MB} MB limit.`);
      return;
    }
    setTemplateFile(file);
    setStructure(null);
    setAnalysisState('uploading');
    try {
      const sid = await ensureSession();
      await uploadDraftTemplate(sid, file);
      setAnalysisState('analyzing');
      const session = await waitForTemplateAnalysis(sid);
      setStructure(session.template_structure);
      setAnalysisState('ready');
    } catch (err) {
      setAnalysisState('failed');
      setError(err.message || 'Template analysis failed.');
    }
  }, [ensureSession]);

  // ── Step 2: supporting docs ──────────────────────────────────────────────
  const handleDocsSelected = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (docs.length + files.length > MAX_DOCS) {
      setError(`At most ${MAX_DOCS} supporting documents per draft (${docs.length} already added).`);
      return;
    }
    const oversized = files.find((f) => f.size > MAX_DOC_MB * 1024 * 1024);
    if (oversized) {
      setError(`"${oversized.name}" exceeds the ${MAX_DOC_MB} MB per-document limit.`);
      return;
    }
    setError(null);
    setDocsUploading(true);
    try {
      const sid = await ensureSession();
      const res = await uploadSupportingDocuments(sid, files);
      setDocs((prev) => [...prev, ...(res.added || [])]);
    } catch (err) {
      setError(err.message || 'Supporting document upload failed.');
    } finally {
      setDocsUploading(false);
    }
  }, [ensureSession]);

  // ── Step 3/4: generation ─────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!sessionId || analysisState !== 'ready' || !structure) return;
    setError(null);
    setSavedToHistory(false);
    setPhase('generating');

    // Seed section cards from the analyzed structure so the user sees the
    // full outline (with queued states) before the first token arrives.
    const seeded = (structure.sections || []).map((s) => ({
      sectionId: s.section_id,
      index: s.index,
      heading: s.heading,
      headingLevel: s.heading_level,
      // Typography captured from the template — drives the page view + .docx.
      headingFormat: s.heading_format,
      bodyFormat: s.body_format,
      containsTable: s.contains_table,
      status: 'pending',
      error: null,
    }));
    setSections(seeded);
    textStoreRef.current = new Map();
    setProgress({ completed: 0, total: seeded.length });
    setStatusMessage('Starting generation…');

    const parser = new DraftStreamParser({
      onStatus: (evt) => setStatusMessage(evt.message || ''),
      onSectionStart: ({ sectionId }) => {
        setStreamingSectionId(sectionId);
        setSections((prev) => prev.map((s) =>
          s.sectionId === sectionId ? { ...s, status: 'streaming' } : s));
      },
      onSectionText: (sectionId, fullText) => {
        // No React state here — the live card reads this map on rAF ticks.
        textStoreRef.current.set(sectionId, fullText);
      },
      onSectionEnd: ({ sectionId, completed, total }) => {
        setStreamingSectionId(null);
        setVersion((v) => v + 1); // freeze the finished card
        setSections((prev) => prev.map((s) =>
          s.sectionId === sectionId ? { ...s, status: 'done' } : s));
        if (typeof completed === 'number') setProgress({ completed, total });
      },
      onSectionError: (evt) => {
        setStreamingSectionId(null);
        setSections((prev) => prev.map((s) =>
          s.sectionId === evt.section_id ? { ...s, status: 'error', error: evt.message } : s));
      },
      onSectionReplace: (evt) => {
        // Expansion / grounding-repair rewrote a section: refresh its card.
        textStoreRef.current.set(evt.section_id, evt.text || '');
        setVersion((v) => v + 1);
      },
      onGroundingReport: (evt) => {
        const n = evt.violations?.length || 0;
        if (n > 0) setStatusMessage(`Zero-hallucination audit: fixing ${n} unsupported item(s)…`);
      },
      onChatSaved: () => {
        // Backend also stored the compiled draft as a chat-history turn.
        setSavedToHistory(true);
      },
      onDone: (evt) => {
        setStatusMessage(
          evt.status === 'completed'
            ? `Draft complete — ${evt.sections_completed}/${evt.sections_total} sections.`
            : `Finished with issues — ${evt.sections_completed}/${evt.sections_total} sections succeeded.`,
        );
      },
      onError: (evt) => setError(evt.message || 'Generation error.'),
    });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamDraftGeneration(
        sessionId,
        { llmName: model, userInstructions: instructions.trim() || undefined },
        (evt) => parser.handleEvent(evt),
        controller.signal,
      );
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Draft stream failed.');
    } finally {
      setStreamingSectionId(null);
      setVersion((v) => v + 1);
      setPhase('finished');
    }
  }, [sessionId, analysisState, structure, model, instructions]);

  const handleStop = useCallback(() => abortRef.current?.abort(), []);

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    onClose?.();
  }, [onClose]);

  if (!open) return null;

  const canGenerate = analysisState === 'ready' && !!structure && phase === 'setup';

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden"
        style={{ height: phase === 'setup' ? 'auto' : '86vh', maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-[#f0fdfa] flex items-center justify-center">
            <Layers className="h-4 w-4 text-[#21C1B6]" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-gray-800">Drafting Mode</h2>
            <p className="text-[11px] text-gray-500">Template-driven, fact-grounded document drafting</p>
          </div>
          {phase === 'generating' && (
            <button type="button" onClick={handleStop}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100">
              <Square className="h-3 w-3" /> Stop
            </button>
          )}
          <button type="button" onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100 flex-shrink-0">
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        {phase === 'setup' ? (
          <div className="px-5 py-4 space-y-4 overflow-y-auto">
            {/* ── Step 1: Template ── */}
            <div>
              <p className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[#21C1B6]" /> 1 · Template document
              </p>
              <input ref={templateInputRef} type="file" accept={ACCEPT} className="hidden"
                onChange={(e) => { handleTemplateSelected(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button"
                onClick={() => templateInputRef.current?.click()}
                disabled={analysisState === 'uploading' || analysisState === 'analyzing'}
                className={`w-full rounded-xl border-2 border-dashed px-4 py-4 text-left transition-colors ${
                  analysisState === 'ready' ? 'border-green-200 bg-green-50/50' : 'border-gray-200 hover:border-[#21C1B6] hover:bg-[#f0fdfa]/40'
                }`}>
                {!templateFile ? (
                  <span className="flex items-center gap-2 text-xs text-gray-500">
                    <FileUp className="h-4 w-4" /> Upload the template (PDF, DOCX, TXT — max {MAX_TEMPLATE_MB} MB)
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-xs">
                    {(analysisState === 'uploading' || analysisState === 'analyzing') && (
                      <Loader2 className="h-4 w-4 text-[#21C1B6] animate-spin flex-shrink-0" />
                    )}
                    {analysisState === 'ready' && <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />}
                    {analysisState === 'failed' && <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                    <span className="font-semibold text-gray-800 truncate">{templateFile.name}</span>
                    <span className="text-gray-400 flex-shrink-0">{fmtSize(templateFile.size)}</span>
                    <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0">
                      {analysisState === 'uploading' && 'Uploading…'}
                      {analysisState === 'analyzing' && 'Analyzing layout & placeholders…'}
                      {analysisState === 'ready' && `${structure?.sections?.length || 0} sections detected`}
                      {analysisState === 'failed' && 'Analysis failed — click to retry'}
                    </span>
                  </span>
                )}
              </button>
              {analysisState === 'ready' && structure && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <p className="text-[11px] font-semibold text-gray-700">
                    {structure.document_title} <span className="text-gray-400 font-normal">· {structure.document_type}</span>
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">
                    {(structure.sections || []).slice(0, 8).map((s) => s.heading).join(' · ')}
                    {(structure.sections || []).length > 8 ? ' · …' : ''}
                  </p>
                </div>
              )}
            </div>

            {/* ── Step 2: Supporting documents ── */}
            <div>
              <p className="text-xs font-bold text-gray-700 mb-1.5 flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 text-[#21C1B6]" /> 2 · Supporting documents
                <span className="font-normal text-gray-400">(facts source — optional but recommended)</span>
              </p>
              <input ref={docsInputRef} type="file" accept={ACCEPT} multiple className="hidden"
                onChange={(e) => { handleDocsSelected(e.target.files); e.target.value = ''; }} />
              <button type="button" onClick={() => docsInputRef.current?.click()} disabled={docsUploading}
                className="w-full rounded-xl border-2 border-dashed border-gray-200 hover:border-[#21C1B6] hover:bg-[#f0fdfa]/40 px-4 py-3 text-left">
                <span className="flex items-center gap-2 text-xs text-gray-500">
                  {docsUploading ? <Loader2 className="h-4 w-4 animate-spin text-[#21C1B6]" /> : <FileUp className="h-4 w-4" />}
                  {docsUploading
                    ? 'Uploading…'
                    : `Add case files, agreements, evidence… (up to ${MAX_DOCS} documents, ${MAX_DOC_MB} MB each)`}
                </span>
              </button>
              {docs.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {docs.map((d) => (
                    <li key={d.doc_id} className="flex items-center gap-2 text-[11px] text-gray-600 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
                      <FileText className="h-3 w-3 text-gray-400 flex-shrink-0" />
                      <span className="truncate flex-1">{d.name}</span>
                      <span className="text-gray-400 flex-shrink-0">{fmtSize(d.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {docs.length === 0 && (
                <p className="mt-1.5 text-[10px] text-amber-600">
                  Without supporting documents, every placeholder is left as “[DATA NOT PROVIDED]” — nothing is invented.
                </p>
              )}
            </div>

            {/* ── Step 3: Engine + instructions ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-bold text-gray-700 mb-1.5">3 · Drafting engine</p>
                <select value={model} onChange={(e) => setModel(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2.5 bg-white outline-none focus:border-[#21C1B6]">
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-gray-400">
                  {MODEL_OPTIONS.find((m) => m.id === model)?.hint}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-700 mb-1.5">Instructions <span className="font-normal text-gray-400">(optional)</span></p>
                <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)}
                  rows={2} placeholder="e.g. Party 1 is the lessor; keep amounts in INR words + figures"
                  className="w-full text-xs border border-gray-200 rounded-xl px-3 py-2 outline-none focus:border-[#21C1B6] resize-none" />
              </div>
            </div>

            {/* Generate */}
            <div className="flex justify-end pt-1 pb-1">
              <button type="button" onClick={handleGenerate} disabled={!canGenerate}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                  canGenerate ? 'bg-[#21C1B6] text-white hover:bg-[#1aa89e]' : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }`}>
                <Play className="h-4 w-4" /> Generate Draft
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <DraftStreamingViewer
              sections={sections}
              streamingSectionId={streamingSectionId}
              textStoreRef={textStoreRef}
              version={version}
              documentTitle={structure?.document_title}
              progress={progress}
              statusMessage={statusMessage}
              finished={phase === 'finished'}
              structure={structure}
            />
            {phase === 'finished' && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-white flex-shrink-0">
                <button type="button"
                  onClick={() => { setPhase('setup'); }}
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-800">
                  <Trash2 className="h-3.5 w-3.5" /> New draft settings
                </button>
                {savedToHistory && (
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Saved to chat history
                  </span>
                )}
                <button type="button" onClick={handleClose}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-gray-800 hover:bg-gray-700">
                  Done
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DraftingModal;
