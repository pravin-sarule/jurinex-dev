import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const PAGE_HEIGHT_MM = '297mm';
const PAGE_WIDTH_MM = '210mm';
const CONTENT_PADDING = '2.54cm';
import { ArrowLeftIcon, ArrowDownTrayIcon, EyeIcon, ShareIcon } from '@heroicons/react/24/outline';
import { draftApi } from '../services';
import { toast } from 'react-toastify';
import { LoadingSpinner } from '../components/common';
import ShareModal from '../../components/ShareModal';
import googleDriveApi from '../../services/googleDriveApi';

interface AssembledPreviewPageProps {
    draftIdProp?: string;
    onBack?: () => void;
    onToggleEditor?: (active: boolean) => void;
    addActivity?: (agent: string, action: string, status?: 'in-progress' | 'completed' | 'pending') => void;
}

export const AssembledPreviewPage: React.FC<AssembledPreviewPageProps> = ({ draftIdProp, onBack, onToggleEditor, addActivity }) => {
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
    const [sectionHeights, setSectionHeights] = useState<number[]>([]);
    const [pageHeightPx, setPageHeightPx] = useState(1122);
    const measureRef = useRef<HTMLDivElement>(null);
    const pageRulerRef = useRef<HTMLDivElement>(null);
    const hasOpenedGoogleDocsRef = useRef(false);

    const sections = documentHtml
        ? documentHtml.split(/<!--\s*SECTION_BREAK\s*-->/).filter((h: string) => h.trim().length > 0)
        : [];

    useEffect(() => {
        if (!documentHtml || sections.length === 0) {
            setSectionHeights([]);
            return;
        }
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const run = () => {
            if (!measureRef.current || !pageRulerRef.current) return;
            const ph = pageRulerRef.current.offsetHeight;
            if (ph > 0) setPageHeightPx(ph);
            const sectionDivs = measureRef.current.querySelectorAll('.a4-measure-section');
            const heights = Array.from(sectionDivs).map((el) => (el as HTMLElement).offsetHeight);
            if (heights.length === sections.length) setSectionHeights(heights);
        };
        const rafId = requestAnimationFrame(() => {
            run();
            timeoutId = setTimeout(run, 200);
        });
        return () => {
            cancelAnimationFrame(rafId);
            if (timeoutId !== undefined) clearTimeout(timeoutId);
        };
    }, [documentHtml, sections.length]);

    // Sync with parent layout
    useEffect(() => {
        if (onToggleEditor) {
            onToggleEditor(showGoogleDocs);
        }
    }, [showGoogleDocs, onToggleEditor]);

    // Reset "already opened" when draft changes so a new assembly opens in Google Docs
    useEffect(() => {
        hasOpenedGoogleDocsRef.current = false;
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
        const loadAssembledDoc = async () => {
            if (!draftId) return;

            try {
                setLoading(true);

                // Get prompts to know which sections to assemble
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

                    // Handle Google Docs metadata
                    const rawInfo = {
                        ...(response.metadata || {}),
                        ...(response.google_docs || {})
                    };

                    if (rawInfo.iframeUrl || rawInfo.iframe_url || rawInfo.googleFileId || rawInfo.google_file_id) {
                        const fid = rawInfo.google_file_id ?? rawInfo.googleFileId;
                        const iframeUrl = rawInfo.iframe_url || rawInfo.iframeUrl;
                        const normalizedInfo = {
                            ...rawInfo,
                            iframe_url: iframeUrl || (fid ? `https://docs.google.com/document/d/${fid}/edit` : undefined),
                            google_file_id: fid,
                            // Priority: 1. drafting-service ID (integer), 2. agent-draft UUID
                            draft_id: rawInfo.draft?.id || rawInfo.draft_id || rawInfo.draftId
                        };
                        setGoogleDocsInfo(normalizedInfo);

                        // When assembly is done, show the document directly in the Google Docs iframe
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
    }, [draftId, navigate, draftIdProp]);


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
        } catch (error) {
            console.error('Download failed:', error);
            toast.error('Failed to download DOCX');
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
        <div className="h-full bg-white flex flex-col print-root relative overflow-hidden">
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
                    .assembled-doc-container .assembled-doc-content { margin-top: 0 !important; }
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
                .print-container.screen-only { display: flex; }
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
                }
                .assembled-doc-container .assembled-doc-content { box-sizing: border-box; }
                .assembled-doc-container .assembled-doc-content { position: relative; z-index: 1; }
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
                    background: #dadce0 !important;
                    overflow: hidden !important;
                    page-break-after: always;
                }
            `}</style>

            {/* Header - Only show if Google Docs editor is NOT active */}
            {!showGoogleDocs && (
                <div className="bg-white border-b border-gray-200 sticky top-0 z-10 no-print flex-shrink-0">
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

                        <div className="flex items-center gap-3">
                            {(googleDocsInfo?.iframe_url || googleDocsInfo?.google_file_id) && (
                                <>
                                    <button
                                        onClick={() => {
                                            const fid = googleDocsInfo?.google_file_id;
                                            if (fid) window.open(`https://docs.google.com/document/d/${fid}/edit`, '_blank');
                                        }}
                                        className="px-4 py-1.5 text-xs font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm flex items-center gap-2 transition-all"
                                        title="Open in Google Docs (new tab)"
                                    >
                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                                        </svg>
                                        Open in Google Docs
                                    </button>
                                    <button
                                        onClick={() => setShowGoogleDocs(true)}
                                        className="px-4 py-1.5 text-xs font-bold bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] shadow-sm flex items-center gap-2 transition-all"
                                    >
                                        <EyeIcon className="w-4 h-4" />
                                        Embed Editor
                                    </button>
                                </>
                            )}
                            <button
                                onClick={handleDownloadDocx}
                                disabled={isDownloading}
                                className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-bold text-white bg-[#21C1B6] rounded-lg hover:bg-[#1AA49B]"
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" />
                                {isDownloading ? 'Downloading...' : 'Download DOCX'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Document Content */}
            <div className={`w-full flex-1 relative ${!showGoogleDocs ? 'overflow-y-auto custom-scrollbar flex flex-col items-center p-6' : 'overflow-hidden bg-white'}`}>
                {showGoogleDocs && googleDocsInfo?.iframe_url ? (
                    <div className="w-full h-full animate-fadeIn relative flex flex-col bg-[#F8F9FA]">
                        {/* Unified Floating Editor Control Bar - Bottom Center */}
                        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-white/95 backdrop-blur-md border border-gray-200 px-6 py-2.5 rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.15)] transition-all hover:scale-[1.02] group">
                            <button
                                onClick={onBack}
                                className="flex items-center gap-2 text-gray-600 hover:text-red-600 font-bold text-xs transition-colors whitespace-nowrap"
                                title="Exit to Drafting Steps"
                            >
                                <ArrowLeftIcon className="w-4 h-4" />
                                Exit Steps
                            </button>

                            <div className="w-px h-4 bg-gray-200" />

                            <button
                                onClick={() => setShowGoogleDocs(false)}
                                className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-bold text-xs transition-colors whitespace-nowrap"
                                title="Switch to Static Preview"
                            >
                                <EyeIcon className="w-4 h-4" />
                                Static Preview
                            </button>

                            <div className="w-px h-4 bg-gray-200" />

                            <button
                                onClick={handleShare}
                                className="flex items-center gap-2 text-green-700 hover:text-green-900 font-bold text-xs transition-colors whitespace-nowrap"
                                title="Open in Google Docs to share with others"
                            >
                                <ShareIcon className="w-4 h-4" />
                                Share & Collaborate
                            </button>

                            <div className="w-px h-4 bg-gray-200" />

                            <div className="flex items-center gap-2 px-1">
                                <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
                                <span className="text-green-600 font-black text-[10px] tracking-wider whitespace-nowrap">LIVE SYNC</span>
                            </div>
                        </div>

                        <iframe
                            src={googleDocsInfo.iframe_url}
                            className="w-full h-full border-none shadow-inner"
                            title="Google Docs Editor"
                            allow="autoplay; clipboard-write; encrypted-media"
                        />
                    </div>
                ) : (
                    <>
                        {/* Hidden: measure section heights for pagination (same layout as real content) */}
                        <div
                            ref={measureRef}
                            aria-hidden
                            style={{
                                position: 'absolute',
                                left: -99999,
                                top: 0,
                                visibility: 'hidden',
                                pointerEvents: 'none',
                                width: '210mm',
                            }}
                        >
                            <div ref={pageRulerRef} style={{ height: PAGE_HEIGHT_MM, width: '210mm' }} />
                            {sections.map((html, i) => (
                                <div
                                    key={i}
                                    className="a4-measure-section"
                                    style={{
                                        width: PAGE_WIDTH_MM,
                                        padding: CONTENT_PADDING,
                                        boxSizing: 'border-box',
                                        fontFamily: '"Times New Roman", Times, serif',
                                        fontSize: '12pt',
                                        lineHeight: 1.5,
                                    }}
                                    dangerouslySetInnerHTML={{ __html: html }}
                                />
                            ))}
                        </div>

                        {/* Screen: paginated A4 pages (text constrained inside each page) */}
                        <div className="print-container screen-only w-full max-w-5xl bg-[#dadce0] rounded-lg py-6 px-4" style={{ minHeight: '100%' }}>
                            {sections.map((html, sectionIndex) => {
                                const h = sectionHeights[sectionIndex];
                                const numPages = h !== undefined ? Math.max(1, Math.ceil(h / pageHeightPx)) : 1;
                                return Array.from({ length: numPages }, (_, pageIndex) => {
                                    const offsetPx = pageIndex * pageHeightPx;
                                    return (
                                        <div
                                            key={`${sectionIndex}-${pageIndex}`}
                                            className="assembled-doc-container w-full mx-auto rounded-sm"
                                            style={{ height: PAGE_HEIGHT_MM }}
                                            title={`A4 page ${pageIndex + 1}`}
                                        >
                                            <div
                                                className="assembled-doc-content"
                                                style={{
                                                    marginTop: -offsetPx,
                                                    boxSizing: 'border-box',
                                                }}
                                                dangerouslySetInnerHTML={{ __html: html }}
                                            />
                                        </div>
                                    );
                                });
                            })}
                        </div>

                        {/* Print only: single-flow content (no duplicate, browser handles page breaks) */}
                        <div className="print-container print-only-flow w-full max-w-5xl bg-[#dadce0] rounded-lg py-6 px-4" style={{ minHeight: '100%' }}>
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
