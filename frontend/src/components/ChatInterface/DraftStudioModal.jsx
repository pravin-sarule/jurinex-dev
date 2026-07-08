import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, FileText, Loader2, CheckCircle2, Download, ArrowLeft, Sparkles, AlertTriangle, Copy, Printer, Code, Check } from 'lucide-react';
import DraftDocumentView from './DraftDocumentView';
import { downloadAsPdf, downloadAsWord, downloadAsHtml, printResponse, getCleanText } from '../../utils/responseExportUtils';

/**
 * Draft Studio — a dedicated popup for draft-from-template generation.
 *
 * It runs its OWN streaming request (isolated from the chat flow), shows each
 * template section as it is drafted (section-by-section), and — once generation
 * finishes — a "Create Final Draft" button merges the sections into the final,
 * court-styled document with a .docx download. All rendering goes through the
 * dedicated DraftDocumentView engine, so the chat renderer's bugs never touch it.
 */
export default function DraftStudioModal({
  open,
  onClose,
  baseUrl,
  folderName,
  question,
  template,        // { gcsPath, mimetype, filename }
  draftModel,      // '' | 'claude-opus-4-8' | 'claude-sonnet-5' | 'gemini-3.1-pro-preview'
  sessionId,
  authToken,
  onSaved,
}) {
  const [sections, setSections] = useState([]);       // array indexed by section index
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('generating'); // 'generating' | 'ready' | 'error'
  const [statusText, setStatusText] = useState('Starting…');
  const [finalAnswer, setFinalAnswer] = useState('');
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadName, setDownloadName] = useState('draft.docx');
  const [phase, setPhase] = useState('sections');     // 'sections' | 'final'
  const [errorText, setErrorText] = useState('');
  const [copied, setCopied] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const abortRef = useRef(null);
  const chunkBufRef = useRef('');
  const finalRef = useRef(null);                       // rendered final draft (for export)

  const engineLabel =
    draftModel === 'claude-opus-4-8' ? 'Claude Opus'
      : draftModel === 'claude-sonnet-5' ? 'Claude Sonnet'
        : 'Gemini';

  const runGeneration = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const resp = await fetch(`${baseUrl}/${encodeURIComponent(folderName)}/intelligent-chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authToken ? `Bearer ${authToken}` : '',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          question: question || 'Draft the document from the supporting files.',
          session_id: sessionId || undefined,
          llm_name: 'gemini',
          draft_mode: true,
          template_gcs_path: template?.gcsPath,
          template_mimetype: template?.mimetype,
          ...(draftModel ? { draft_model: draftModel } : {}),
        }),
        signal: controller.signal,
      });
      if (!resp.ok || !resp.body) {
        setStatus('error');
        setErrorText(`The draft service returned ${resp.status}. Please try again.`);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          let evt;
          try { evt = JSON.parse(payload); } catch { continue; }
          handleEvent(evt);
        }
      }
      // stream ended without a done event → finalize from what we have
      setStatus((s) => (s === 'error' ? s : 'ready'));
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setStatus('error');
        setErrorText('The connection was interrupted while drafting. Please try again.');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, folderName, question, sessionId, template, draftModel, authToken]);

  const handleEvent = (evt) => {
    const type = evt?.type;
    if (type === 'draft_section') {
      if (typeof evt.total === 'number') setTotal(evt.total);
      setSections((prev) => {
        const next = prev.slice();
        next[evt.index] = { index: evt.index, heading: evt.heading || `Section ${evt.index + 1}`, markdown: evt.markdown || '' };
        return next;
      });
    } else if (type === 'thinking') {
      const t = String(evt.text || '').trim();
      if (t) setStatusText(t.split('\n').filter(Boolean).slice(-1)[0] || t);
    } else if (type === 'chunk') {
      chunkBufRef.current += evt.text || '';
    } else if (type === 'done') {
      const ans = evt.answer || chunkBufRef.current || '';
      if (ans) setFinalAnswer(ans);
      if (evt.draft_download_url) setDownloadUrl(evt.draft_download_url);
      if (evt.draft_filename) setDownloadName(evt.draft_filename);
      setStatus('ready');
      setStatusText('Draft ready.');
      // Tell the parent the draft is persisted (so it can refresh the chat history);
      // pass the resolved session id in case the backend created a new session.
      if (typeof onSaved === 'function') onSaved(evt.session_id || sessionId || null);
    } else if (type === 'error') {
      setStatus('error');
      setErrorText(evt.message || 'The draft could not be generated.');
    }
  };

  useEffect(() => {
    runGeneration();
    return () => {
      try { abortRef.current?.abort(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!open) return null;

  const filled = sections.filter(Boolean);
  const doneCount = filled.length;
  const pct = total > 0 ? Math.min(100, Math.round((doneCount / total) * 100)) : (status === 'ready' ? 100 : 8);
  const mergedFromSections = filled.map((s) => s.markdown).join('\n\n');
  const finalDoc = finalAnswer || mergedFromSections;
  const canCreate = status === 'ready' || (total > 0 && doneCount >= total);

  // ── export options (Copy / PDF / Word / HTML / Print) — operate on the rendered draft ──
  const baseName = (
    (template?.filename ? template.filename.replace(/\.[^.]+$/, '') : (folderName || 'draft')) + '_draft'
  ).replace(/[^A-Za-z0-9._-]+/g, '_');
  const flashExportError = (e) => {
    setExportMsg(e?.message || 'Export failed. Please try again.');
    setTimeout(() => setExportMsg(''), 4500);
  };
  const runExport = async (fn) => { try { await fn(); } catch (e) { flashExportError(e); } };
  const onCopy = async () => {
    try {
      const text = getCleanText(finalRef.current, finalDoc).trim();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { flashExportError(e); }
  };
  const onWord = () => {
    // Prefer the backend court-styled .docx (Times New Roman, A4, 1" margins) when available;
    // otherwise fall back to a client-side Word export of the rendered draft.
    if (downloadUrl) {
      const a = document.createElement('a');
      a.href = downloadUrl; a.download = downloadName || `${baseName}.docx`;
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } else {
      runExport(() => downloadAsWord(finalRef.current, `${baseName}.doc`));
    }
  };
  const exportTools = [
    { key: 'copy', label: copied ? 'Copied!' : 'Copy', icon: copied ? Check : Copy, onClick: onCopy },
    { key: 'pdf', label: 'PDF', icon: Download, onClick: () => runExport(() => downloadAsPdf(finalRef.current, `${baseName}.pdf`)) },
    { key: 'word', label: 'Word', icon: FileText, onClick: onWord },
    { key: 'html', label: 'HTML', icon: Code, onClick: () => runExport(() => downloadAsHtml(finalRef.current, `${baseName}.html`)) },
    { key: 'print', label: 'Print', icon: Printer, onClick: () => runExport(() => printResponse(finalRef.current)) },
  ];

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,24,39,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        width: 'min(980px, 96vw)', maxHeight: '92vh', background: '#ffffff', borderRadius: '16px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px',
          borderBottom: '1px solid #ececec', background: 'linear-gradient(90deg,#f0fdfa,#ffffff)',
        }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: '#0d9488', display: 'grid', placeItems: 'center', flex: 'none' }}>
            <FileText size={18} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Draft Studio</div>
            <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {template?.filename ? `${template.filename} · ` : ''}{engineLabel} · section-by-section
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 6, borderRadius: 8, color: '#64748b' }}>
            <X size={20} />
          </button>
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, background: '#eef2f1' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: status === 'error' ? '#dc2626' : '#14b8a6', transition: 'width .4s ease' }} />
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1, background: '#fafafa' }}>
          {phase === 'sections' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13, color: '#475569' }}>
                {status === 'error' ? (
                  <AlertTriangle size={16} color="#dc2626" />
                ) : status === 'ready' ? (
                  <CheckCircle2 size={16} color="#0d9488" />
                ) : (
                  <Loader2 size={16} className="animate-spin" color="#14b8a6" />
                )}
                <span style={{ whiteSpace: 'pre-wrap' }}>
                  {status === 'error' ? errorText
                    : status === 'ready' ? `All ${total || doneCount} sections drafted — ready to create the final document.`
                      : total > 0 ? `Drafting section ${Math.min(doneCount + 1, total)} of ${total} — ${statusText}`
                        : statusText}
                </span>
              </div>

              {filled.length === 0 && status !== 'error' && (
                <div style={{ padding: '28px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
                  Analyzing the template and extracting the case facts…
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filled.map((s) => (
                  <div key={s.index} style={{
                    border: '1px solid #e6e6e6', borderRadius: 12, background: '#fff', overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                      background: '#f6faf9', borderBottom: '1px solid #eef2f1',
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, color: '#0d9488', background: '#ccfbf1',
                        borderRadius: 6, padding: '2px 8px', flex: 'none',
                      }}>{s.index + 1}</span>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {s.heading}
                      </span>
                    </div>
                    <div style={{ padding: '10px 16px' }}>
                      <DraftDocumentView raw={s.markdown} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div ref={finalRef} style={{
              background: '#fff', border: '1px solid #e6e6e6', borderRadius: 12,
              padding: '32px 40px', boxShadow: 'inset 0 0 0 1px #fafafa',
            }}>
              <DraftDocumentView raw={finalDoc} />
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '14px 20px', borderTop: '1px solid #ececec', background: '#fff',
        }}>
          {phase === 'sections' ? (
            <>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                {doneCount}{total ? ` / ${total}` : ''} sections
              </span>
              <button
                onClick={() => setPhase('final')}
                disabled={!canCreate}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, border: 'none',
                  background: canCreate ? '#0d9488' : '#cbd5e1', color: '#fff', fontWeight: 600,
                  fontSize: 14, padding: '10px 20px', borderRadius: 10, cursor: canCreate ? 'pointer' : 'not-allowed',
                }}
              >
                <Sparkles size={16} /> Create Final Draft
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, width: '100%' }}>
              <button
                onClick={() => setPhase('sections')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #d4d4d8', background: '#fff', color: '#475569', fontSize: 13, padding: '9px 14px', borderRadius: 10, cursor: 'pointer' }}
              >
                <ArrowLeft size={15} /> Back to sections
              </button>

              {/* Export toolbar — Copy / PDF / Word / HTML / Print (mirrors the chat toolbar) */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {exportTools.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      onClick={t.onClick}
                      title={t.label}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        border: '1px solid #e2e8f0', background: '#fff', color: '#475569',
                        fontSize: 12, fontWeight: 600, padding: '8px 12px', borderRadius: 9, cursor: 'pointer',
                      }}
                    >
                      <Icon size={13} /> {t.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                {exportMsg && <span style={{ fontSize: 11, color: '#dc2626' }}>{exportMsg}</span>}
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    download={downloadName}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Court-formatted Word (.docx) — Times New Roman, A4, 1 inch margins"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0d9488', color: '#fff', fontWeight: 600, fontSize: 13, padding: '9px 16px', borderRadius: 10, textDecoration: 'none' }}
                  >
                    <Download size={15} /> Download .docx
                  </a>
                )}
                <button
                  onClick={onClose}
                  style={{ border: '1px solid #d4d4d8', background: '#fff', color: '#475569', fontSize: 13, padding: '9px 16px', borderRadius: 10, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
