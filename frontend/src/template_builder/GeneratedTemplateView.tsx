import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTemplateBuilderStore } from './templateBuilderStore';
import { customTemplateApi } from '../template_drafting_component/user_custom_template/api';

async function createDraftFromTemplate(templateId: string, title: string): Promise<string> {
  const { AGENT_DRAFT_TEMPLATE_API } = await import('../config/apiConfig.js');
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token') ||
    '';
  const res = await fetch(`${AGENT_DRAFT_TEMPLATE_API}/api/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ template_id: templateId, title }),
  });
  if (!res.ok) throw new Error(`Failed to create draft (${res.status})`);
  const data = await res.json();
  const draftId = data?.draft?.draft_id ?? data?.draft_id;
  if (!draftId) throw new Error('Draft created but no draft ID returned');
  return draftId;
}

function decodeHtmlEntities(text: string): string {
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return doc.documentElement.textContent ?? text;
  } catch {
    return text;
  }
}

interface RenderedLine {
  type: 'heading' | 'text' | 'blank';
  content: string;
  level: number;
}

function parseLinesForRender(text: string): RenderedLine[] {
  return decodeHtmlEntities(text).split('\n').map((line) => {
    const stripped = line.trim();
    if (!stripped) return { type: 'blank', content: '', level: 0 };

    const mdMatch = stripped.match(/^(#{1,3})\s+(.+)$/);
    if (mdMatch) {
      const level = mdMatch[1].length === 1 ? 1 : 2;
      return { type: 'heading', content: mdMatch[2].replace(/\*\*/g, '').trim(), level };
    }

    const boldMatch = stripped.match(/^\*\*([^*]{4,})\*\*:?$/);
    if (boldMatch && !/__/.test(stripped)) {
      return { type: 'heading', content: boldMatch[1].trim(), level: 1 };
    }

    const numberedMain = stripped.match(/^(\d+)\.\s+([A-Z][A-Z0-9\s\/&,\-\(\)]{3,})$/);
    if (numberedMain) {
      return { type: 'heading', content: `${numberedMain[1]}. ${numberedMain[2]}`, level: 1 };
    }

    if (/^\d+\.\d+\.?\s+[A-Z]/.test(stripped)) {
      return { type: 'heading', content: stripped, level: 2 };
    }

    if (
      stripped.length >= 5 &&
      !/[a-z]/.test(stripped) &&
      !/__/.test(stripped) &&
      /^[A-Z][A-Z0-9\s\/&,\-\.\(\)]{4,}$/.test(stripped)
    ) {
      return { type: 'heading', content: stripped.replace(/:$/, ''), level: 1 };
    }

    return { type: 'text', content: line, level: 0 };
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderInlineHtml(raw: string): string {
  return escapeHtml(raw).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function estimateLineCost(line: RenderedLine): number {
  if (line.type === 'blank') return 0.5;
  if (line.type === 'heading' && line.level === 1) return 3;
  if (line.type === 'heading' && line.level === 2) return 2;
  return Math.max(1, Math.ceil(line.content.trim().length / 95));
}

function renderedLineToHtml(line: RenderedLine): string {
  if (line.type === 'blank') return '<div style="height:8px"></div>';
  if (line.type === 'heading' && line.level === 1) {
    return `<div style="font-weight:bold;text-align:center;text-transform:uppercase;font-size:12pt;margin-top:14pt;margin-bottom:4pt;letter-spacing:0.02em">${renderInlineHtml(line.content)}</div>`;
  }
  if (line.type === 'heading' && line.level === 2) {
    return `<div style="font-weight:bold;font-size:12pt;margin-top:8pt;margin-bottom:2pt">${renderInlineHtml(line.content)}</div>`;
  }
  return `<div style="font-size:12pt;line-height:1.6;margin-bottom:3pt;text-align:justify">${renderInlineHtml(line.content)}</div>`;
}

const HighlightedLine: React.FC<{ text: string }> = ({ text }) => {
  const TOKEN_RE = /\*\*([^*]+)\*\*|__([A-Za-z][A-Za-z0-9_]*)__/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) parts.push(<strong key={match.index}>{match[1]}</strong>);
    else parts.push(<span key={match.index}>{match[0]}</span>);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
};

const SavedScreen: React.FC<{
  templateId: string;
  templateName: string;
  onReset: () => void;
}> = ({ templateId, templateName, onReset }) => {
  const navigate = useNavigate();
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const handleStartDraft = async () => {
    setDraftLoading(true);
    setDraftError(null);
    try {
      const draftId = await createDraftFromTemplate(templateId, `${templateName} - Draft`);
      navigate(`/draft-form/${draftId}`);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'Failed to create draft');
      setDraftLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] py-16 px-8 text-center">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
        <span className="text-4xl">✓</span>
      </div>
      <h2 className="text-2xl font-bold text-gray-800 mb-2">Template Saved!</h2>
      <p className="text-gray-600 mb-1">
        <strong>"{templateName}"</strong> has been sent through the template analyzer and saved to your library.
      </p>
      <p className="text-xs text-gray-400 mb-6 font-mono">ID: {templateId}</p>
      {draftError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{draftError}</p>}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={handleStartDraft}
          disabled={draftLoading}
          className={`px-8 py-3 rounded-xl font-bold text-base transition-all shadow-md ${draftLoading ? 'bg-gray-200 text-gray-400 cursor-wait' : 'text-white hover:shadow-lg'}`}
          style={draftLoading ? {} : { background: 'linear-gradient(135deg, #21C1B6 0%, #1AA49B 100%)' }}
        >
          {draftLoading ? 'Opening draft...' : 'Start Drafting with This Template'}
        </button>
        <button
          onClick={() => navigate('/draft-selection/templates')}
          className="px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl font-semibold text-sm transition-all"
        >
          My Templates
        </button>
        <button
          onClick={onReset}
          className="px-5 py-2.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 rounded-xl font-semibold text-sm transition-all"
        >
          Build Another Template
        </button>
      </div>
    </div>
  );
};

export const GeneratedTemplateView: React.FC = () => {
  const navigate = useNavigate();
  const {
    generatedTemplateText,
    generationMetadata,
    phase,
    savedTemplateId,
    savedTemplateName,
    setSaveResult,
    reset,
  } = useTemplateBuilderStore();

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pageHeaderLeft = generationMetadata?.templateName || 'Generated Template';
  const pageHeaderRight = generationMetadata?.jurisdiction || 'India';
  const pageFooterLeft = generationMetadata?.language || 'English';

  const lines = useMemo(() => parseLinesForRender(generatedTemplateText), [generatedTemplateText]);
  const pages = useMemo(() => {
    const result: RenderedLine[][] = [];
    const pageBudget = 28;
    let currentPage: RenderedLine[] = [];
    let currentBudget = 0;

    for (const line of lines) {
      const cost = estimateLineCost(line);
      if (currentBudget + cost > pageBudget && currentPage.length > 0) {
        result.push(currentPage);
        currentPage = [];
        currentBudget = 0;
      }
      currentPage.push(line);
      currentBudget += cost;
    }

    if (currentPage.length > 0) result.push(currentPage);
    return result;
  }, [lines]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!generatedTemplateText || isSaving) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const templateName = generationMetadata?.templateName || generationMetadata?.documentType || 'Generated Template';
      const formData = new FormData();
      const textBlob = new Blob([generatedTemplateText], { type: 'text/plain;charset=utf-8' });
      const safeFileName = `${templateName.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'generated_template'}.txt`;

      formData.append('name', templateName);
      formData.append('category', generationMetadata?.category || 'General');
      formData.append('subcategory', 'AI Generated');
      formData.append('description', `AI-generated template. Jurisdiction: ${generationMetadata?.jurisdiction || 'India'}. Language: ${generationMetadata?.language || 'English'}.`);
      formData.append('file', textBlob, safeFileName);

      const result = await customTemplateApi.uploadTemplate(formData);
      setSaveResult(result.template_id, templateName);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setIsSaving(false);
    }
  }, [generatedTemplateText, generationMetadata, isSaving, setSaveResult]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedTemplateText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [generatedTemplateText]);

  const handleDownload = useCallback(() => {
    const name = generationMetadata?.templateName || 'template';
    const bodyHtml = pages
      .map((pageLines, index) => {
        const contentHtml = pageLines.map((line) => renderedLineToHtml(line)).join('\n');
        return `
<div class="doc-page">
  <div class="doc-header">
    <div>${escapeHtml(pageHeaderLeft)}</div>
    <div>${escapeHtml(pageHeaderRight)}</div>
  </div>
  <div class="doc-body">${contentHtml}</div>
  <div class="doc-footer">
    <div>${escapeHtml(pageFooterLeft)}</div>
    <div>Page ${index + 1} of ${pages.length}</div>
  </div>
</div>`;
      })
      .join('\n');

    const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <style>
    @page { margin: 1in; size: A4; }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      color: #000000;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
    .doc-page {
      min-height: 1000px;
      page-break-after: always;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
    }
    .doc-page:last-child { page-break-after: auto; }
    .doc-header, .doc-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9pt;
      color: #444;
    }
    .doc-header {
      border-bottom: 1px solid #cfcfcf;
      padding-bottom: 8pt;
      margin-bottom: 14pt;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: bold;
    }
    .doc-footer {
      border-top: 1px solid #cfcfcf;
      padding-top: 8pt;
      margin-top: 14pt;
    }
    .doc-body { flex: 1; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`.trim();

    const blob = new Blob(['\uFEFF' + html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generationMetadata, pageFooterLeft, pageHeaderLeft, pageHeaderRight, pages]);

  if (phase === 'saved' && savedTemplateId) {
    return (
      <SavedScreen
        templateId={savedTemplateId}
        templateName={savedTemplateName || generationMetadata?.templateName || 'Template'}
        onReset={reset}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gray-100">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-10">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="mb-2 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all"
          >
            ← Back
          </button>
          <h2 className="text-base font-bold text-gray-800">{generationMetadata?.templateName || 'Generated Template'}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✓ AI Generated</span>
            {generationMetadata?.category && <span className="text-xs text-gray-400">· {generationMetadata.category}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
          <button onClick={handleDownload} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
            Download .doc
          </button>
          <button onClick={reset} className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all">
            Start Over
          </button>
          <button
            onClick={handleSaveToLibrary}
            disabled={isSaving}
            className={`px-4 py-1.5 text-sm font-bold rounded-lg transition-all shadow-sm ${isSaving ? 'bg-gray-200 text-gray-400 cursor-wait' : 'text-white'}`}
            style={isSaving ? {} : { backgroundColor: '#21C1B6' }}
          >
            {isSaving ? 'Saving...' : 'Save to My Library'}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-xs text-red-700">
          {saveError}
        </div>
      )}

      <div className="bg-white border-b border-gray-200 px-6 py-2.5 shrink-0">
        <span className="text-sm font-medium text-[#21C1B6]">Document Preview</span>
      </div>

      <div className="flex-1 overflow-auto" style={{ background: '#525659', padding: '32px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
          {pages.map((pageLines, pageIdx) => (
            <div key={pageIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ color: '#ccc', fontSize: '11px', marginBottom: '6px', userSelect: 'none' }}>
                Page {pageIdx + 1} of {pages.length}
              </div>
              <div
                style={{
                  width: '794px',
                  height: '1123px',
                  minHeight: '1123px',
                  maxHeight: '1123px',
                  overflow: 'hidden',
                  background: '#ffffff',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  boxSizing: 'border-box',
                  fontFamily: '"Times New Roman", Times, serif',
                  fontSize: '12pt',
                  lineHeight: '1.6',
                  color: '#000',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '64px 96px 48px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '9pt',
                    color: '#444',
                    borderBottom: '1px solid #cfcfcf',
                    paddingBottom: '8pt',
                    marginBottom: '14pt',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    fontWeight: 'bold',
                  }}
                >
                  <div>{pageHeaderLeft}</div>
                  <div>{pageHeaderRight}</div>
                </div>

                <div style={{ flex: 1 }}>
                  {pageLines.map((line, i) => {
                    if (line.type === 'blank') return <div key={i} style={{ height: '8px' }} />;
                    if (line.type === 'heading' && line.level === 1) {
                      return (
                        <div key={i} style={{ fontWeight: 'bold', textAlign: 'center', textTransform: 'uppercase', fontSize: '12pt', marginTop: '14pt', marginBottom: '4pt', letterSpacing: '0.02em' }}>
                          <HighlightedLine text={line.content} />
                        </div>
                      );
                    }
                    if (line.type === 'heading' && line.level === 2) {
                      return (
                        <div key={i} style={{ fontWeight: 'bold', fontSize: '12pt', marginTop: '8pt', marginBottom: '2pt' }}>
                          <HighlightedLine text={line.content} />
                        </div>
                      );
                    }
                    return (
                      <div key={i} style={{ fontSize: '12pt', lineHeight: '1.6', marginBottom: '3pt', textAlign: 'justify' }}>
                        <HighlightedLine text={line.content} />
                      </div>
                    );
                  })}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '9pt',
                    color: '#444',
                    borderTop: '1px solid #cfcfcf',
                    paddingTop: '8pt',
                    marginTop: '14pt',
                  }}
                >
                  <div>{pageFooterLeft}</div>
                  <div>Page {pageIdx + 1} of {pages.length}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between sticky bottom-0 z-10 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        <p className="text-xs text-gray-500">
          Preview is document-only. When you save, the generated template is sent to the Template Analyzer Agent for section and field extraction.
        </p>
        <button
          onClick={handleSaveToLibrary}
          disabled={isSaving}
          className={`px-5 py-2 text-sm font-bold rounded-lg transition-all ${isSaving ? 'bg-gray-200 text-gray-400 cursor-wait' : 'text-white shadow-sm'}`}
          style={isSaving ? {} : { backgroundColor: '#21C1B6' }}
        >
          {isSaving ? 'Saving...' : 'Save to My Library'}
        </button>
      </div>
    </div>
  );
};
