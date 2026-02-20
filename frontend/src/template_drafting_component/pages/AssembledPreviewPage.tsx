import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { ArrowLeftIcon, ArrowDownTrayIcon, EyeIcon, ShareIcon } from '@heroicons/react/24/outline';
import { draftApi } from '../services';
import { toast } from 'react-toastify';
import { LoadingSpinner } from '../components/common';
import ShareModal from '../../components/ShareModal';
import googleDriveApi from '../../services/googleDriveApi';

export interface AssembleResponse {
    success: boolean;
    final_document: string;
    template_css?: string;
    google_docs?: { googleFileId?: string; google_file_id?: string; iframeUrl?: string; iframe_url?: string; updated?: boolean };
    metadata?: Record<string, any>;
}

interface AssembledPreviewPageProps {
    draftIdProp?: string;
    onBack?: () => void;
    onToggleEditor?: (active: boolean) => void;
    addActivity?: (agent: string, action: string, status?: 'in-progress' | 'completed' | 'pending') => void;
    /** When coming from Assemble click, pass the response so we show the exact same content + Google Doc without re-calling assemble. */
    initialAssembleResult?: AssembleResponse | null;
}

export const AssembledPreviewPage: React.FC<AssembledPreviewPageProps> = ({ draftIdProp, onBack, onToggleEditor, addActivity, initialAssembleResult }) => {
    const params = useParams<{ draftId: string }>();
    const draftId = draftIdProp || params.draftId;
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);
    const [documentHtml, setDocumentHtml] = useState<string>('');
    const [templateCss, setTemplateCss] = useState<string>('');
    const [googleDocsInfo, setGoogleDocsInfo] = useState<any>(null);
    const [showGoogleDocs, setShowGoogleDocs] = useState(false);
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);
    const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(null);
    const hasOpenedGoogleDocsRef = useRef(false);

    const sections = documentHtml
        ? documentHtml.split(/<!--\s*SECTION_BREAK\s*-->/).filter((h: string) => h.trim().length > 0)
        : [];

    // Sync with parent layout
    useEffect(() => {
        if (onToggleEditor) {
            onToggleEditor(showGoogleDocs);
        }
    }, [showGoogleDocs, onToggleEditor]);

    // Reset state when draft changes so we don't show previous draft's content
    useEffect(() => {
        hasOpenedGoogleDocsRef.current = false;
        setDocumentHtml('');
        setTemplateCss('');
        setGoogleDocsInfo(null);
        setShowGoogleDocs(false);
        setLoading(true);
    }, [draftId]);

    // Open in new tab only when we have a synced file but no iframe (so we show iframe by default when available)
    useEffect(() => {
        const fid = googleDocsInfo?.google_file_id;
        const hasIframe = !!googleDocsInfo?.iframe_url;
        if (!fid || hasOpenedGoogleDocsRef.current || loading || hasIframe) return;
        hasOpenedGoogleDocsRef.current = true;
        window.open(`https://docs.google.com/document/d/${fid}/edit`, '_blank', 'noopener,noreferrer');
    }, [googleDocsInfo?.google_file_id, googleDocsInfo?.iframe_url, loading]);

    useEffect(() => {
        // Use the exact result from Assemble click so preview and Google Docs iframe match what was just assembled (no second API call)
        if (initialAssembleResult?.success && initialAssembleResult.final_document) {
            setDocumentHtml(initialAssembleResult.final_document);
            setTemplateCss(initialAssembleResult.template_css || '');
            const rawInfo = {
                ...(initialAssembleResult.metadata || {}),
                ...(initialAssembleResult.google_docs || {})
            };
            const fid = rawInfo.google_file_id ?? rawInfo.googleFileId;
            if (fid || rawInfo.iframe_url || rawInfo.iframeUrl) {
                let baseUrl = rawInfo.iframe_url || rawInfo.iframeUrl || (fid ? `https://docs.google.com/document/d/${fid}/edit` : '');
                if (baseUrl && !baseUrl.includes('embedded=true')) {
                    baseUrl += baseUrl.includes('?') ? '&embedded=true' : '?embedded=true';
                }
                const iframeUrl = baseUrl ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}cb=${Date.now()}` : undefined;
                setGoogleDocsInfo({
                    ...rawInfo,
                    iframe_url: iframeUrl,
                    google_file_id: fid,
                    iframeKey: Date.now()
                });
                setShowGoogleDocs(true);
            }
            setLoading(false);
            return;
        }

        const loadAssembledDoc = async () => {
            if (!draftId) return;

            try {
                setLoading(true);

                const prompts = await draftApi.getSectionPrompts(draftId);
                const activeSectionIds = prompts
                    .filter((p: any) => !p.is_deleted)
                    .map((p: any) => p.section_id);

                if (activeSectionIds.length === 0) {
                    toast.error('No sections found to assemble');
                    if (!draftIdProp) {
                        navigate(`/template-drafting/drafts/${draftId}/sections`);
                    }
                    return;
                }

                if (addActivity) {
                    addActivity('Assembler Agent', 'Compiling individual sections into final document format...', 'in-progress');
                }

                const response: any = await draftApi.assemble(draftId, activeSectionIds);

                if (response.success) {
                    if (addActivity) {
                        addActivity('Assembler Agent', 'Final document successfully assembled and prepared for preview.', 'completed');
                    }
                    setDocumentHtml(response.final_document);
                    if (response.template_css) {
                        setTemplateCss(response.template_css);
                    }

                    const rawInfo = {
                        ...(response.metadata || {}),
                        ...(response.google_docs || {})
                    };

                    if (rawInfo.iframeUrl || rawInfo.iframe_url || rawInfo.googleFileId || rawInfo.google_file_id) {
                        const fid = rawInfo.google_file_id ?? rawInfo.googleFileId;
                        let baseUrl = rawInfo.iframe_url || rawInfo.iframeUrl || (fid ? `https://docs.google.com/document/d/${fid}/edit` : '');
                        if (baseUrl && !baseUrl.includes('embedded=true')) {
                            baseUrl += baseUrl.includes('?') ? '&embedded=true' : '?embedded=true';
                        }
                        const iframeUrl = baseUrl ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}cb=${Date.now()}` : undefined;
                        const normalizedInfo = {
                            ...rawInfo,
                            iframe_url: iframeUrl,
                            google_file_id: fid,
                            draft_id: rawInfo.draft?.id || rawInfo.draft_id || rawInfo.draftId,
                            iframeKey: rawInfo.updated ? Date.now() : (rawInfo.iframeKey ?? Date.now())
                        };
                        setGoogleDocsInfo(normalizedInfo);
                        if (normalizedInfo.iframe_url) {
                            setShowGoogleDocs(true);
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to load assembled document:', error);
                toast.error('Failed to load preview');
            } finally {
                setLoading(false);
            }
        };

        loadAssembledDoc();
    }, [draftId, navigate, draftIdProp, initialAssembleResult]);


    const handleDownloadDocx = async () => {
        if (!draftId || isDownloading) return;

        try {
            setIsDownloading(true);
            const blob = await draftApi.exportDocx(draftId, documentHtml, templateCss);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Draft_${draftId}.docx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success('DOCX downloaded successfully');
        } catch (error: unknown) {
            console.error('Download failed:', error);
            const message = error instanceof Error ? error.message : 'Failed to download DOCX';
            toast.error(message);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleShare = async () => {
        if (!googleDocsInfo?.google_file_id) {
            toast.error('Sharing is not available for this document.');
            return;
        }

        try {
            // Check connection status
            const status = await googleDriveApi.getConnectionStatus();
            if (!status.connected) {
                if (window.confirm('Google Drive is not connected. Connect now to enable sharing?')) {
                    const authRes = await googleDriveApi.initiateAuth();
                    if (authRes.authUrl) {
                        // Redirect to authorize, then user will be sent back
                        window.location.href = authRes.authUrl;
                        return;
                    }
                }
                return;
            }

            const tokenData = await googleDriveApi.getAccessToken();
            // Handle both camelCase and snake_case from backend
            const token = tokenData.accessToken || tokenData.access_token;

            if (token) {
                setGoogleAccessToken(token);
                setIsShareModalOpen(true);
            } else {
                toast.error('Failed to get Google access token.');
            }
        } catch (error) {
            console.error('Error opening share modal:', error);
            toast.error('Could not open sharing settings.');
        }
    };

    if (loading) {
        return (
            <div className="h-full bg-white flex flex-col items-center justify-center p-12">
                <LoadingSpinner message="Assembling final document..." />
            </div>
        );
    }

    return (
        <div className="h-full min-h-0 bg-white flex flex-col print-root relative overflow-hidden">
            {/* Inject template CSS */}
            {templateCss && <style dangerouslySetInnerHTML={{ __html: templateCss }} />}

            <style>{`
                @media print {
                    body > *:not(.print-root) { display: none !important; }
                    nav, sidebar, footer, .no-print { display: none !important; }
                    @page { margin: 2.54cm; size: A4 210mm 297mm; }
                    body { background: white !important; margin: 0 !important; }
                    .print-container.screen-only { display: none !important; }
                    .print-container.print-only-flow { display: block !important; width: 100% !important; background: white !important; padding: 0 !important; }
                    .assembled-doc-container { box-shadow: none !important; margin: 0 !important; margin-bottom: 0 !important; width: 210mm !important; min-height: 297mm !important; height: auto !important; overflow: visible !important; page-break-after: always; }
                    .assembled-doc-container .assembled-doc-content { margin-top: 0 !important; transform: none !important; }
                    .assembled-doc-container .assembled-doc-clip { height: auto !important; overflow: visible !important; }
                    .assembled-doc-container .document-section { page-break-inside: auto; }
                }
                .print-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding-bottom: 2rem;
                    padding-top: 1rem;
                }
                .print-container.print-only-flow { display: none; }
                .print-container.screen-only { display: flex; flex-direction: column; }
                .assembled-doc-container {
                    background: white;
                    background-image: none !important;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06);
                    margin-bottom: 28px;
                    padding: 2.54cm;
                    width: 210mm;
                    min-height: 297mm;
                    height: 297mm;
                    max-height: 297mm;
                    overflow: hidden;
                    box-sizing: border-box;
                    font-family: "Times New Roman", Times, serif;
                    font-size: 12pt;
                    line-height: 1.5;
                    page-break-after: always;
                    position: relative;
                    isolation: isolate;
                }
                .screen-only .assembled-doc-container { page-break-after: avoid !important; page-break-inside: avoid !important; }
                .assembled-doc-container-flow {
                    overflow: visible !important;
                    max-height: none !important;
                    height: auto !important;
                    min-height: auto !important;
                    page-break-after: avoid !important;
                }
                .screen-only .assembled-doc-container .page-break,
                .screen-only .assembled-doc-container [class*="page-break"] {
                    display: none !important;
                }
                .assembled-doc-container .assembled-doc-clip {
                    overflow: hidden;
                    width: 100%;
                    position: relative;
                }
                .assembled-doc-container .assembled-doc-content { box-sizing: border-box; position: relative; }
                .assembled-doc-container table { position: relative !important; }
                .assembled-doc-container td, .assembled-doc-container th { position: relative !important; vertical-align: top !important; }
                .assembled-doc-container .document-section { margin-bottom: 30px; page-break-inside: auto; }
                .document-section { margin-bottom: 30px; }
                .assembled-doc-container .page-break,
                .assembled-doc-container [class*="page-break"] {
                    display: block !important;
                    height: 20px !important;
                    min-height: 20px !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    border: none !important;
                    background: white !important;
                    overflow: hidden !important;
                    page-break-after: always;
                }
            `}</style>

            {/* Header with four-button bar: Exit Steps | Static Preview | Share & Collaborate | LIVE SYNC */}
            <header className="bg-white border-b border-gray-200 sticky top-0 z-10 no-print flex-shrink-0">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        {(onBack || !draftIdProp) && (
                            <button
                                onClick={onBack ? onBack : () => navigate(`/template-drafting/drafts/${draftId}/sections`)}
                                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                            >
                                <ArrowLeftIcon className="w-5 h-5 text-gray-600" />
                            </button>
                        )}
                        <div>
                            <h1 className="text-lg font-bold text-gray-900">Final Document Preview</h1>
                            <p className="text-xs text-gray-500">Review your assembled draft before finalizing</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Four-button bar only when in Google Docs embed view (hidden on static preview) */}
                        {showGoogleDocs && (
                            <div className="flex items-center gap-0 bg-white border border-gray-200 rounded-xl px-5 py-2.5 shadow-sm">
                                <button
                                    onClick={onBack}
                                    className="flex items-center gap-2 text-gray-500 hover:text-red-600 font-semibold text-xs transition-colors whitespace-nowrap"
                                    title="Exit to Drafting Steps"
                                >
                                    <ArrowLeftIcon className="w-4 h-4" />
                                    Exit Steps
                                </button>
                                <div className="w-px h-4 bg-gray-200 mx-2" />
                                <button
                                    onClick={() => setShowGoogleDocs(false)}
                                    className="flex items-center gap-2 text-blue-600 font-semibold text-xs transition-colors whitespace-nowrap"
                                    title="Static preview of the document"
                                >
                                    <EyeIcon className="w-4 h-4" />
                                    Static Preview
                                </button>
                            </div>
                        )}
                        {!showGoogleDocs && (googleDocsInfo?.iframe_url || googleDocsInfo?.google_file_id) && (
                            <button
                                onClick={() => setShowGoogleDocs(true)}
                                className="px-3 py-2 text-xs font-semibold text-gray-600 hover:text-blue-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                                title="Open embedded Google Docs editor"
                            >
                                Embed Editor
                            </button>
                        )}
                        <button
                            onClick={handleDownloadDocx}
                            disabled={isDownloading}
                            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-[#21C1B6] rounded-lg hover:bg-[#1AA49B] transition-colors"
                        >
                            <ArrowDownTrayIcon className="w-4 h-4" />
                            {isDownloading ? 'Downloading...' : 'Download DOCX'}
                        </button>
                    </div>
                </div>
            </header>

            {/* Document Content - min-h-0 allows flex child to shrink so iframe gets proper height */}
            <div className={`w-full flex-1 min-h-0 relative ${!showGoogleDocs ? 'overflow-y-auto custom-scrollbar flex flex-col items-center p-6 bg-white' : 'overflow-hidden bg-white flex flex-col'}`}>
                {showGoogleDocs && googleDocsInfo?.iframe_url ? (
                    <div className="w-full flex-1 min-h-[400px] animate-fadeIn relative flex flex-col bg-[#F8F9FA]">
                        <iframe
                            key={googleDocsInfo.iframeKey ?? googleDocsInfo.google_file_id}
                            src={googleDocsInfo.iframe_url}
                            className="flex-1 w-full min-h-[400px] border-none shadow-inner"
                            title="Google Docs Editor"
                            allow="autoplay; clipboard-write; encrypted-media"
                        />
                    </div>
                ) : (
                    <>
                        {/* Screen: flowing layout - all content visible, scrollable (no clipping) */}
                        <div className="print-container screen-only w-full max-w-5xl bg-white rounded-lg py-6 px-4" style={{ minHeight: '100%' }}>
                            {sections.map((html, index) => (
                                <div
                                    key={index}
                                    className="assembled-doc-container assembled-doc-container-flow w-full mx-auto rounded-sm"
                                    style={{ height: 'auto', overflow: 'visible' }}
                                    title="Section"
                                >
                                    <div
                                        className="assembled-doc-content"
                                        style={{ boxSizing: 'border-box' }}
                                        dangerouslySetInnerHTML={{ __html: html }}
                                    />
                                </div>
                            ))}
                        </div>

                        {/* Print only: single-flow content (no duplicate, browser handles page breaks) */}
                        <div className="print-container print-only-flow w-full max-w-5xl bg-white rounded-lg py-6 px-4" style={{ minHeight: '100%' }}>
                            {sections.map((html, index) => (
                                <div
                                    key={index}
                                    className="assembled-doc-container w-full mx-auto rounded-sm"
                                    style={{ minHeight: '297mm', height: 'auto', overflow: 'visible' }}
                                    title="A4 page"
                                >
                                    <div className="assembled-doc-content" dangerouslySetInnerHTML={{ __html: html }} />
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            {/* Hint when Google Docs sync failed - only static preview available */}
            {documentHtml && !googleDocsInfo?.iframe_url && !googleDocsInfo?.google_file_id && (
                <div className="fixed bottom-8 right-8 bg-amber-50 border border-amber-200 shadow-lg px-5 py-3 rounded-xl max-w-sm z-50">
                    <p className="text-amber-800 text-sm font-medium">Static preview only. Google Docs embed unavailable.</p>
                    <p className="text-amber-600 text-xs mt-1">Ensure drafting-service is deployed and DRAFTING_SERVICE_URL is set in agent-draft-service.</p>
                </div>
            )}
            {/* Floating Hint when in static view and we have Google Docs */}
            {(googleDocsInfo?.iframe_url || googleDocsInfo?.google_file_id) && !showGoogleDocs && (
                <div className="fixed bottom-8 right-8 bg-white border border-blue-100 shadow-2xl px-5 py-3 rounded-2xl flex flex-wrap items-center gap-3 z-50">
                    <div className="text-blue-600 font-bold text-xs">Open in Google Docs</div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                const fid = googleDocsInfo?.google_file_id;
                                if (fid) window.open(`https://docs.google.com/document/d/${fid}/edit`, '_blank', 'noopener,noreferrer');
                            }}
                            className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold hover:bg-blue-700 transition-all shadow-md"
                        >
                            Open in new tab
                        </button>
                        {googleDocsInfo?.iframe_url && (
                            <button
                                onClick={() => setShowGoogleDocs(true)}
                                className="bg-gray-100 text-gray-700 px-4 py-1.5 rounded-full text-xs font-bold hover:bg-gray-200 transition-all"
                            >
                                Embed here
                            </button>
                        )}
                    </div>
                </div>
            )}
            {/* Share Modal Integration - Stays in the same tab */}
            {isShareModalOpen && googleAccessToken && (
                <ShareModal
                    isOpen={isShareModalOpen}
                    onClose={() => setIsShareModalOpen(false)}
                    draftId={googleDocsInfo?.draft_id || googleDocsInfo?.draftId || draftId || ''}
                    googleFileId={googleDocsInfo.google_file_id}
                    documentTitle="Assembled Draft"
                    accessToken={googleAccessToken}
                />
            )}
        </div>
    );
};
