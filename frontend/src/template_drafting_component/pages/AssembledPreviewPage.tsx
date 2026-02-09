import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
}

export const AssembledPreviewPage: React.FC<AssembledPreviewPageProps> = ({ draftIdProp, onBack, onToggleEditor }) => {
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

    // Sync with parent layout
    useEffect(() => {
        if (onToggleEditor) {
            onToggleEditor(showGoogleDocs);
        }
    }, [showGoogleDocs, onToggleEditor]);

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

                const response: any = await draftApi.assemble(draftId, activeSectionIds);

                if (response.success) {
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
                        const normalizedInfo = {
                            ...rawInfo,
                            iframe_url: rawInfo.iframe_url || rawInfo.iframeUrl,
                            google_file_id: rawInfo.google_file_id || rawInfo.googleFileId,
                            // Priority: 1. drafting-service ID (integer), 2. agent-draft UUID
                            draft_id: rawInfo.draft?.id || rawInfo.draft_id || rawInfo.draftId
                        };
                        setGoogleDocsInfo(normalizedInfo);

                        // If we have an iframe URL, show it by default
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
            const token = localStorage.getItem('token');
            const response = await fetch(`http://localhost:8000/api/drafts/${draftId}/export/docx`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    html_content: documentHtml,
                    css_content: templateCss
                })
            });

            if (!response.ok) throw new Error('Export failed');

            const blob = await response.blob();
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
                    @page { margin: 1.5cm; size: A4; }
                    body { background: white !important; margin: 0 !important; }
                    .print-container { display: block !important; width: 100% !important; background: white !important; }
                    .assembled-doc-container { box-shadow: none !important; margin: 0 !important; width: 100% !important; page-break-after: always; }
                }
                .print-container { display: flex; flex-direction: column; align-items: center; padding-bottom: 2rem; }
                .assembled-doc-container {
                    background: white;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    margin-bottom: 24px;
                    padding: 2.54cm;
                    width: 210mm;
                    min-height: 297mm;
                    font-family: "Times New Roman", Times, serif;
                }
                .page-break { display: none; }
                .document-section { margin-bottom: 30px; }
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
                                <button
                                    onClick={() => setShowGoogleDocs(true)}
                                    className="px-4 py-2 text-sm font-bold bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] shadow-sm flex items-center gap-2 transition-all"
                                >
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
                                    </svg>
                                    Edit in Google Docs
                                </button>
                            )}
                            <button
                                onClick={handleDownloadDocx}
                                disabled={isDownloading}
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-[#21C1B6] rounded-lg hover:bg-[#1AA49B]"
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" />
                                {isDownloading ? 'Downloading...' : 'Download DOCX'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Document Content */}
            <div className={`w-full flex-1 relative ${!showGoogleDocs ? 'overflow-y-auto custom-scrollbar flex flex-col items-center bg-gray-50 p-8' : 'overflow-hidden bg-white'}`}>
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
                    <div className="print-container w-full max-w-5xl">
                        {documentHtml.split(/<!--\s*SECTION_BREAK\s*-->/)
                            .filter(h => h.trim().length > 0)
                            .map((html, index) => (
                                <div key={index} className="assembled-doc-container w-full mx-auto bg-white shadow-xl rounded-sm">
                                    <div dangerouslySetInnerHTML={{ __html: html }} />
                                </div>
                            ))}
                    </div>
                )}
            </div>

            {/* Floating Hint when in static view */}
            {googleDocsInfo?.iframe_url && !showGoogleDocs && (
                <div className="fixed bottom-8 right-8 bg-white border border-blue-100 shadow-2xl px-5 py-3 rounded-2xl flex items-center gap-4 animate-bounce z-50">
                    <div className="text-blue-600 font-bold text-xs">Want to edit?</div>
                    <button
                        onClick={() => setShowGoogleDocs(true)}
                        className="bg-blue-600 text-white px-4 py-1.5 rounded-full text-xs font-bold hover:bg-blue-700 transition-all shadow-md"
                    >
                        Switch to Google Docs
                    </button>
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
