import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTemplateBuilderStore } from './templateBuilderStore';
import { customTemplateApi } from '../template_drafting_component/user_custom_template/api';
import { DRAFTING_SERVICE_URL } from '../config/apiConfig.js';
import draftingApi from '../services/draftingApi';

interface GoogleDocsSession {
  draftId?: string;
  googleFileId?: string;
  editUrl?: string;
  iframeUrl?: string;
  iframeKey?: number;
}

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

function normalizeGoogleDocsSession(raw: Record<string, any> | null | undefined): GoogleDocsSession {
  const info = { ...(raw || {}) };
  const draftId = info?.draft?.id || info?.draft?.draftId || info?.draftId || info?.draft_id;
  const googleFileId = info?.google_file_id || info?.googleFileId || info?.draft?.googleFileId || info?.draft?.google_file_id;
  const baseUrl =
    info?.iframeUrl ||
    info?.iframe_url ||
    info?.draft?.iframeUrl ||
    info?.draft?.iframe_url ||
    info?.webViewLink ||
    info?.web_view_link ||
    (googleFileId ? `https://docs.google.com/document/d/${googleFileId}/edit` : undefined);

  let iframeUrl = baseUrl;
  if (iframeUrl) {
    iframeUrl = iframeUrl.includes('embedded=true')
      ? iframeUrl
      : `${iframeUrl}${iframeUrl.includes('?') ? '&' : '?'}embedded=true`;
    iframeUrl = `${iframeUrl}${iframeUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
  }

  return {
    draftId: draftId ? String(draftId) : undefined,
    googleFileId: googleFileId ? String(googleFileId) : undefined,
    editUrl: googleFileId ? `https://docs.google.com/document/d/${googleFileId}/edit` : undefined,
    iframeUrl,
    iframeKey: Date.now(),
  };
}

async function openGeneratedTemplateInGoogleDocs(fileName: string, html: string): Promise<GoogleDocsSession> {
  const token =
    localStorage.getItem('token') ||
    localStorage.getItem('access_token') ||
    localStorage.getItem('auth_token') ||
    '';

  const formData = new FormData();
  const htmlBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
  formData.append('file', htmlBlob, `${fileName}.html`);
  formData.append('title', fileName);

  const res = await fetch(`${DRAFTING_SERVICE_URL}/api/drafts/upload`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Failed to open in Google Docs (${res.status})`);
  }

  const session = normalizeGoogleDocsSession(data);

  if (!session.draftId && !session.googleFileId) {
    throw new Error('Google Docs file was created but no draft or file ID was returned.');
  }

  return session;
}

function renderInlineHtml(raw: string): string {
  return escapeHtml(raw).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

async function buildLibraryUploadFromGoogleDocs(
  session: GoogleDocsSession,
  templateName: string,
  category: string,
  description: string,
): Promise<FormData> {
  if (!session.draftId) {
    throw new Error('Edited Google Docs draft is missing a draft ID.');
  }

  await draftingApi.syncToGCS(session.draftId, 'docx');
  const gcsUrlResponse = await draftingApi.getGCSUrl(session.draftId, 2);
  const signedUrl = gcsUrlResponse?.signedUrl;

  if (!signedUrl) {
    throw new Error('Failed to get the latest edited Google Docs file.');
  }

  const fileResponse = await fetch(signedUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download edited Google Docs file (${fileResponse.status}).`);
  }

  const fileBlob = await fileResponse.blob();
  const safeFileName = `${templateName.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'generated_template'}.docx`;
  const formData = new FormData();
  formData.append('name', templateName);
  formData.append('category', category || 'General');
  formData.append('subcategory', 'AI Generated');
  formData.append('description', description);
  formData.append(
    'file',
    new File([fileBlob], safeFileName, {
      type: fileBlob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    safeFileName,
  );

  return formData;
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
  const [isOpeningGoogleDocs, setIsOpeningGoogleDocs] = useState(false);
  const [googleDocsOpenError, setGoogleDocsOpenError] = useState<string | null>(null);
  const [googleDocsSession, setGoogleDocsSession] = useState<GoogleDocsSession | null>(null);
  const [iframeFailed, setIframeFailed] = useState(false);

  const autoOpenedRef = useRef(false);

  const lines = useMemo(() => parseLinesForRender(generatedTemplateText), [generatedTemplateText]);
  const pages = useMemo(() => {
    const result: RenderedLine[][] = [];
    const pageBudget = 24; // Fewer lines per page after court margins increase
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

  // Export as a single flowing document — Google Docs handles its own pagination.
  // Never inject "Page X of Y" as body text; never use CSS page-break hacks with flex containers.
  const exportHtml = useMemo(() => {
    const name = generationMetadata?.templateName || 'template';
    const bodyHtml = lines.map((line) => renderedLineToHtml(line)).join('\n');

    return `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(name)}</title>
  <!--[if gte mso 9]><xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml><![endif]-->
  <style>
    @page { margin: 1in 1in 1in 1.5in; size: A4; }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 12pt;
      color: #000000;
      line-height: 1.6;
      margin: 0;
      padding: 0;
      background: #ffffff;
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`.trim();
  }, [generationMetadata, lines]);

  // Auto-open in Google Docs as soon as the template is ready
  useEffect(() => {
    if (autoOpenedRef.current || !exportHtml || googleDocsSession) return;
    autoOpenedRef.current = true;
    const name = generationMetadata?.templateName || 'Generated Template';
    setIsOpeningGoogleDocs(true);
    setGoogleDocsOpenError(null);
    setIframeFailed(false);
    openGeneratedTemplateInGoogleDocs(name, exportHtml)
      .then((result) => setGoogleDocsSession(result))
      .catch((err) => setGoogleDocsOpenError(err instanceof Error ? err.message : 'Failed to open in Google Docs'))
      .finally(() => setIsOpeningGoogleDocs(false));
  }, [exportHtml]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveToLibrary = useCallback(async () => {
    if (!generatedTemplateText || isSaving) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const templateName = generationMetadata?.templateName || generationMetadata?.documentType || 'Generated Template';
      const category = generationMetadata?.category || 'General';
      const description = `AI-generated template. Jurisdiction: ${generationMetadata?.jurisdiction || 'India'}. Language: ${generationMetadata?.language || 'English'}.`;
      let formData: FormData;

      if (googleDocsSession?.draftId) {
        formData = await buildLibraryUploadFromGoogleDocs(googleDocsSession, templateName, category, description);
      } else {
        formData = new FormData();
        const textBlob = new Blob([generatedTemplateText], { type: 'text/plain;charset=utf-8' });
        const safeFileName = `${templateName.replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'generated_template'}.txt`;

        formData.append('name', templateName);
        formData.append('category', category);
        formData.append('subcategory', 'AI Generated');
        formData.append('description', description);
        formData.append('file', textBlob, safeFileName);
      }

      const result = await customTemplateApi.uploadTemplate(formData);
      setSaveResult(result.template_id, templateName);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setIsSaving(false);
    }
  }, [generatedTemplateText, generationMetadata, googleDocsSession, isSaving, setSaveResult]);

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
    const blob = new Blob(['\uFEFF' + exportHtml], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportHtml, generationMetadata]);

  const handleOpenInGoogleDocs = useCallback(async () => {
    const name = generationMetadata?.templateName || 'Generated Template';
    if (isOpeningGoogleDocs) return;
    setIsOpeningGoogleDocs(true);
    setGoogleDocsOpenError(null);
    setIframeFailed(false);
    try {
      const result = await openGeneratedTemplateInGoogleDocs(name, exportHtml);
      setGoogleDocsSession(result);
    } catch (err) {
      setGoogleDocsOpenError(err instanceof Error ? err.message : 'Failed to open in Google Docs');
    } finally {
      setIsOpeningGoogleDocs(false);
    }
  }, [exportHtml, generationMetadata, isOpeningGoogleDocs]);

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
          {isOpeningGoogleDocs && (
            <span className="text-xs text-gray-400 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#21C1B6' }} />
              Opening in Google Docs...
            </span>
          )}
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
            {isSaving ? 'Saving...' : 'Add to Library'}
          </button>
        </div>
      </div>

      {saveError && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-xs text-red-700">
          {saveError}
        </div>
      )}
      {googleDocsOpenError && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-700 flex items-center justify-between">
          <span>{googleDocsOpenError}</span>
          <button
            onClick={handleOpenInGoogleDocs}
            disabled={isOpeningGoogleDocs}
            className="ml-4 px-3 py-1 text-xs font-medium bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-all disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      <div className="bg-white border-b border-gray-200 px-6 py-2.5 shrink-0">
        <span className="text-sm font-medium text-[#21C1B6]">
          {googleDocsSession?.iframeUrl && !iframeFailed ? 'Google Docs Editor' : 'Document Preview'}
        </span>
      </div>

      <div className="flex-1 overflow-auto" style={{ background: '#525659', padding: '32px 0' }}>
        {googleDocsSession?.iframeUrl && !iframeFailed ? (
          <div className="h-full px-6 pb-6">
            <div className="bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.2)] overflow-hidden h-full min-h-[720px] flex flex-col">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
                <div>
                  <div className="text-sm font-semibold text-gray-800">Editing In Google Docs</div>
                  <div className="text-xs text-gray-500">This editor is opened inside the same template generation screen.</div>
                </div>
                <div className="flex items-center gap-2">
                  {googleDocsSession.editUrl && (
                    <button
                      onClick={() => window.open(googleDocsSession.editUrl, '_blank', 'noopener,noreferrer')}
                      className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all"
                    >
                      Open in New Tab
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setGoogleDocsSession(null);
                      setIframeFailed(false);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-all"
                  >
                    Back to Preview
                  </button>
                </div>
              </div>
              <iframe
                key={googleDocsSession.iframeKey ?? googleDocsSession.googleFileId}
                src={googleDocsSession.iframeUrl}
                className="flex-1 w-full border-0 bg-white"
                title="Google Docs Editor"
                allow="clipboard-read; clipboard-write; autoplay; popups; popups-to-escape-sandbox"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation"
                onError={() => setIframeFailed(true)}
                onLoad={() => setIframeFailed(false)}
              />
            </div>
          </div>
        ) : (
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
                    // Court-standard: 1.5in left (binding), 1in top/right/bottom
                    padding: '96px 96px 96px 144px',
                  }}
                >
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
                    <div>Page {pageIdx + 1} of {pages.length}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white border-t border-gray-200 px-6 py-4 flex items-center justify-between sticky bottom-0 z-10 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        <p className="text-xs text-gray-500">
           {googleDocsSession?.draftId
             ? 'Library save will use your latest Google Docs edits and send that edited file to the Template Analyzer Agent.'
             : 'Preview is document-only. When you save, the generated template is sent to the Template Analyzer Agent for section and field extraction.'}
        </p>
        <button
          onClick={handleSaveToLibrary}
          disabled={isSaving}
          className={`px-5 py-2 text-sm font-bold rounded-lg transition-all ${isSaving ? 'bg-gray-200 text-gray-400 cursor-wait' : 'text-white shadow-sm'}`}
          style={isSaving ? {} : { backgroundColor: '#21C1B6' }}
        >
          {isSaving ? 'Saving...' : 'Add to Library'}
        </button>
      </div>
    </div>
  );
};
