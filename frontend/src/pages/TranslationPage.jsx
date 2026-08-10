import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowsRightLeftIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  DocumentArrowUpIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
  GlobeAltIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import {
  getTranslationStrategies,
  translateDocument,
  getDocumentTranslationStatus,
  documentTranslationDownloadUrl,
} from '../services/translationApi';

// Codes verified against the Z.AI agent — of the Indian languages only Hindi is
// supported (mr/bn/gu/ta/te/kn/ml/pa/ur are rejected by the provider). The live
// list from /api/v1/translation/strategies overrides this fallback.
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'id', label: 'Indonesian' },
];

const JOB_POLL_MS = 2500;

const JOB_PHASE_LABELS = {
  queued: 'Queued…',
  extracting: 'Extracting text (OCR)…',
  translating: 'Translating…',
  rebuilding: 'Rebuilding document…',
  completed: 'Completed',
  error: 'Failed',
};

const SELECT_CLASS =
  'w-full appearance-none rounded-xl border border-gray-200 bg-white px-4 py-3 pr-9 text-sm font-medium text-gray-800 shadow-sm transition-colors hover:border-gray-300 focus:border-[#21C1B6] focus:outline-none focus:ring-2 focus:ring-[#21C1B6]/25';

const PRIMARY_BTN =
  'rounded-xl bg-gradient-to-r from-[#21C1B6] to-[#12a095] px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#21C1B6]/25 transition-all hover:shadow-[#21C1B6]/40 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';

const FieldSelect = ({ label, value, onChange, children, className = '' }) => (
  <div className={`flex flex-col gap-1.5 ${className}`}>
    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
      {label}
    </label>
    <div className="relative">
      <select value={value} onChange={onChange} className={SELECT_CLASS}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </div>
  </div>
);

const TranslationPage = () => {
  const [languages, setLanguages] = useState(LANGUAGES);
  const [configured, setConfigured] = useState(true);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('en');
  const strategy = 'general';
  const [docFile, setDocFile] = useState(null);
  const [outputFormat, setOutputFormat] = useState('pdf');
  const [docJob, setDocJob] = useState(null);
  const [docError, setDocError] = useState('');
  const [docSubmitting, setDocSubmitting] = useState(false);
  const fileInputRef = useRef(null);
  const pollRef = useRef(null);

  const docJobActive =
    docJob && !['completed', 'error'].includes(docJob.status);

  useEffect(() => {
    // Poll the active document job until it finishes.
    if (!docJob?.job_id || !docJobActive) return undefined;
    pollRef.current = setInterval(async () => {
      try {
        const state = await getDocumentTranslationStatus(docJob.job_id);
        setDocJob(state);
        if (state.status === 'error') setDocError(state.error || 'Translation failed.');
      } catch (err) {
        if (err?.response?.status === 404) {
          setDocError('The translation job expired. Please upload the document again.');
          setDocJob(null);
        }
      }
    }, JOB_POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [docJob?.job_id, docJob?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDocx = (name) => /\.docx?$/i.test(name || '');

  const handleFilePicked = (file) => {
    if (!file) return;
    if (!/\.(pdf|docx?)$/i.test(file.name)) {
      setDocError('Only PDF and DOCX files are supported.');
      return;
    }
    setDocError('');
    setDocJob(null);
    setDocFile(file);
    if (isDocx(file.name)) setOutputFormat('docx'); // DOCX in → DOCX out only
  };

  const handleTranslateDocument = async () => {
    if (!docFile || docSubmitting || docJobActive) return;
    setDocSubmitting(true);
    setDocError('');
    setDocJob(null);
    try {
      const job = await translateDocument({
        file: docFile,
        targetLang,
        sourceLang,
        strategy,
        outputFormat: isDocx(docFile.name) ? 'docx' : outputFormat,
        suggestion: '',
      });
      setDocJob(job);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setDocError(typeof detail === 'string' ? detail : 'Could not start the document translation.');
    } finally {
      setDocSubmitting(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    getTranslationStrategies()
      .then((data) => {
        if (!mounted) return;
        setConfigured(data?.configured !== false);
        if (Array.isArray(data?.languages) && data.languages.length) {
          setLanguages(data.languages.map((l) => ({ code: l.code, label: l.label })));
        }
      })
      .catch(() => {
        // Leave defaults; the translate call surfaces real errors.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSwap = () => {
    if (sourceLang === 'auto') return;
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-8">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#21C1B6] to-[#0e8f86] shadow-lg shadow-[#21C1B6]/30">
          <GlobeAltIcon className="h-8 w-8 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Translation</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            AI document translation with professional strategies
          </p>
        </div>
      </div>

      {!configured && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <span>
            Translation is not configured on the server (missing API key). Contact your
            administrator.
          </span>
        </div>
      )}

      {/* Workspace */}
      <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-200/60">
        {/* Toolbar */}
        <div className="border-b border-gray-100 bg-gray-50/70 px-6 pb-6 pt-5 sm:px-10 sm:pb-7 sm:pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <FieldSelect
              label="From"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              className="w-56 grow sm:grow-0"
            >
              <option value="auto">Auto detect</option>
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </FieldSelect>

            <button
              type="button"
              onClick={handleSwap}
              disabled={sourceLang === 'auto'}
              title={sourceLang === 'auto' ? 'Pick a source language to swap' : 'Swap languages'}
              className="flex h-[46px] w-[46px] items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm transition-all hover:border-[#21C1B6]/50 hover:text-[#21C1B6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowsRightLeftIcon className="h-5 w-5" />
            </button>

            <FieldSelect
              label="To"
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              className="w-56 grow sm:grow-0"
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </FieldSelect>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 sm:p-10">
          <>
              {/* File picker */}
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleFilePicked(e.dataTransfer.files?.[0]);
                }}
                className={`group flex min-h-[22rem] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-16 text-center transition-all ${
                  docFile
                    ? 'border-[#21C1B6]/50 bg-[#21C1B6]/[0.04]'
                    : 'border-gray-200 bg-gray-50/50 hover:border-[#21C1B6]/60 hover:bg-[#21C1B6]/[0.04]'
                }`}
              >
                {docFile ? (
                  <>
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#21C1B6]/15">
                      <DocumentTextIcon className="h-7 w-7 text-[#21C1B6]" />
                    </div>
                    <span className="flex items-center gap-2 text-[15px] font-semibold text-gray-800">
                      {docFile.name}
                      <span className="rounded-md bg-[#21C1B6]/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0e8f86]">
                        {isDocx(docFile.name) ? 'DOCX' : 'PDF'}
                      </span>
                    </span>
                    <span className="text-xs text-gray-500">
                      {(docFile.size / (1024 * 1024)).toFixed(2)} MB — click to choose a different
                      file
                    </span>
                  </>
                ) : (
                  <>
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-gray-100 transition-transform group-hover:scale-105">
                      <DocumentArrowUpIcon className="h-7 w-7 text-[#21C1B6]" />
                    </div>
                    <div>
                      <div className="text-[15px] font-semibold text-gray-800">
                        Drop your document here
                      </div>
                      <div className="mt-0.5 text-sm text-gray-500">
                        or <span className="font-semibold text-[#21C1B6]">browse files</span>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
                      {['PDF', 'DOCX', 'Automatic OCR', 'Up to 50 MB'].map((chip) => (
                        <span
                          key={chip}
                          className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-gray-500 ring-1 ring-gray-200"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc"
                  className="hidden"
                  onChange={(e) => {
                    handleFilePicked(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>

              {/* Output format (PDF uploads only) */}
              {docFile && !isDocx(docFile.name) && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                    Output format
                  </span>
                  <div className="inline-flex rounded-full bg-gray-100 p-1">
                    {[
                      { id: 'pdf', label: 'PDF · same layout' },
                      { id: 'docx', label: 'Word · editable' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setOutputFormat(f.id)}
                        className={`rounded-full px-3.5 py-1 text-xs font-semibold transition-all ${
                          outputFormat === f.id
                            ? 'bg-white text-[#21C1B6] shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-gray-400">
                    {outputFormat === 'pdf'
                      ? 'Keeps the original pages, stamps and layout.'
                      : 'Restructured, editable court-style document.'}
                  </span>
                </div>
              )}
              {docFile && isDocx(docFile.name) && (
                <p className="mt-3 text-xs text-gray-500">
                  DOCX files are translated in place — formatting, headings and tables are
                  preserved.
                </p>
              )}

              {/* Progress */}
              {docJob && (
                <div className="mt-6">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-600">
                      {JOB_PHASE_LABELS[docJob.status] || docJob.status}
                    </span>
                    <span className="text-gray-400">
                      {docJob.segments_total > 0 && docJob.status === 'translating'
                        ? `${docJob.segments_done}/${docJob.segments_total} segments · `
                        : ''}
                      {Math.round(docJob.progress)}%
                    </span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        docJob.status === 'error'
                          ? 'bg-red-400'
                          : 'bg-gradient-to-r from-[#21C1B6] to-[#12a095]'
                      }`}
                      style={{ width: `${Math.max(3, docJob.progress)}%` }}
                    />
                  </div>
                </div>
              )}

              {docError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {docError}
                </div>
              )}

              {docJob?.status === 'completed' && (
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <CheckCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0" />
                  <span>
                    Translation complete
                    {docJob.page_count > 0
                      ? ` — ${docJob.page_count} page${docJob.page_count > 1 ? 's' : ''}`
                      : ''}
                    . Your document is ready to download.
                  </span>
                </div>
              )}

              {docJob?.status === 'completed' && docJob?.segments_failed > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {docJob.segments_failed} section{docJob.segments_failed > 1 ? 's' : ''} could not
                  be translated (translation service was busy) and remain in the original language.
                  Try translating the document again.
                </div>
              )}

              {/* Actions */}
              <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
                {docJob?.status === 'completed' && docJob?.download_ready && (
                  <a
                    href={documentTranslationDownloadUrl(docJob.job_id)}
                    className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#21C1B6] to-[#12a095] px-4 py-1.5 text-xs font-semibold text-white shadow-md shadow-[#21C1B6]/25 transition-all hover:shadow-[#21C1B6]/40 hover:brightness-105"
                  >
                    <ArrowDownTrayIcon className="h-3.5 w-3.5" />
                    Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleTranslateDocument}
                  disabled={!docFile || docSubmitting || docJobActive || !configured}
                  className={
                    docJob?.status === 'completed'
                      ? 'rounded-xl border border-[#21C1B6] px-6 py-2.5 text-sm font-semibold text-[#21C1B6] transition-colors hover:bg-[#21C1B6]/10 disabled:cursor-not-allowed disabled:opacity-50'
                      : PRIMARY_BTN
                  }
                >
                  {docJobActive || docSubmitting
                    ? 'Translating…'
                    : docJob?.status === 'completed'
                    ? 'Translate again'
                    : 'Translate document'}
                </button>
              </div>
          </>
        </div>
      </div>
    </div>
  );
};

export default TranslationPage;
