import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { OcrJson } from '../../types/ocr';
import useOcrDocumentViewer from '../../hooks/useOcrDocumentViewer';
import ocrApi from '../../services/ocrApi';
import OcrToolbar from './OcrToolbar';
import OcrStats from './OcrStats';
import PdfPanel from './PdfPanel';
import OcrPanel from './OcrPanel';
import { PDF_VIEWER_PAGE_HEIGHT } from './constants';

interface OcrDocumentModalProps {
  document: {
    id: string;
    name?: string;
    mimetype?: string;
    status?: string;
    viewUrl?: string | null;
    previewUrl?: string | null;
    caseId?: string | null;
    filePath?: string | null;
  };
  onClose: () => void;
}

const OcrDocumentModal: React.FC<OcrDocumentModalProps> = ({
  document,
  onClose,
}) => {
  // Debug log for received props
  React.useEffect(() => {
    console.log('[OCR PREVIEW] OcrDocumentModal received document props:', {
      id: document?.id,
      name: document?.name,
      caseId: document?.caseId,
      hasFilePath: !!document?.filePath,
    });
  }, [document]);

  const [isFullSize, setIsFullSize] = useState(false);

  const leftScrollerRef = useRef<HTMLDivElement | null>(null);
  const rightScrollerRef = useRef<HTMLDivElement | null>(null);
  const syncingFromLeftRef = useRef(false);
  const syncingFromRightRef = useRef(false);
  const scrollRefsReadyFiredRef = useRef(false);
  const lastScrollSyncedPageRef = useRef(1);
  const lastScrollTopForPageRef = useRef(0);
  const [scrollRefsReady, setScrollRefsReady] = useState(0);
  const pageChangeSourceRef = useRef<'scroll' | 'toolbar' | 'other'>('other');

  const {
    overview,
    pdfUrl,
    ocrData,
    metadata,
    loading,
    error,
    currentPage,
    setCurrentPage,
    zoom,
    setZoom,
    isOcrVisible,
    setIsOcrVisible,
    displayMode,
    setDisplayMode,
    hasOcrData,
    ocrProgress,
    isPollingOcr,
    reload,
    confidenceFilter,
    setConfidenceFilter,
  } = useOcrDocumentViewer(document?.id);

  const modalRoot =
    typeof window !== 'undefined' && window.document?.body
      ? window.document.body
      : null;

  const totalPagesFromOcr: number =
    (ocrData as OcrJson | null)?.pageCount ??
    (overview?.page_count ?? 0) ??
    (ocrData as OcrJson | null)?.pages?.length ??
    0;

  const handleClose = () => {
    console.log('[OCR PREVIEW] Close button clicked, closing modal');
    // Clear any ongoing polling
    if ((window as any).__ocrPollingInterval) {
      console.log('[OCR PREVIEW] Clearing OCR polling interval on modal close');
      clearInterval((window as any).__ocrPollingInterval);
      delete (window as any).__ocrPollingInterval;
    }
    onClose();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      console.log('[OCR PREVIEW] Modal backdrop clicked, closing modal');
      // Clear any ongoing polling
      if ((window as any).__ocrPollingInterval) {
        console.log('[OCR PREVIEW] Clearing OCR polling interval on modal close');
        clearInterval((window as any).__ocrPollingInterval);
        delete (window as any).__ocrPollingInterval;
      }
      onClose();
    }
  };

  const pdfUrlResolved =
    pdfUrl || document.previewUrl || document.viewUrl || null;

  // Debug log for PDF URL resolution
  React.useEffect(() => {
    if (pdfUrlResolved) {
      console.log('[OCR PREVIEW] Loading original PDF into left panel');
      console.log('[OCR PREVIEW] pdfUrlResolved:', pdfUrlResolved?.substring(0, 100) + '...');
    }
    if (ocrData) {
      console.log('[OCR PREVIEW] Loading OCR JSON into right panel');
      console.log('[OCR PREVIEW] OCR loaded successfully');
    }
  }, [pdfUrlResolved, ocrData]);
  
  // Log when PDF URL changes to pass to PdfPanel
  React.useEffect(() => {
    console.log('[OCR PREVIEW] PDF URL changed, passing to PdfPanel:', {
      pdfUrl: pdfUrlResolved,
      hasUrl: !!pdfUrlResolved,
      urlType: typeof pdfUrlResolved,
      urlLength: pdfUrlResolved?.length || 0
    });
  }, [pdfUrlResolved]);
  
  // Listen for OCR completion events
  React.useEffect(() => {
    const handleOcrCompleted = (event: CustomEvent) => {
      console.log('[OCR PREVIEW] OCR completion event received in modal:', event.detail);
      // The hook will handle reloading data automatically
    };
    
    window.addEventListener('ocr-completed', handleOcrCompleted as EventListener);
    
    return () => {
      window.removeEventListener('ocr-completed', handleOcrCompleted as EventListener);
    };
  }, []);
  
  // Cleanup polling interval on unmount
  React.useEffect(() => {
    return () => {
      console.log('[OCR PREVIEW] Clearing OCR polling interval');
      if ((window as any).__ocrPollingInterval) {
        clearInterval((window as any).__ocrPollingInterval);
        delete (window as any).__ocrPollingInterval;
      }
    };
  }, []);

  // Scroll sync: mirror scroll position and only update currentPage when page actually changed (avoids jump-to-1)
  useEffect(() => {
    const leftEl = leftScrollerRef.current;
    const rightEl = rightScrollerRef.current;
    if (!leftEl || !rightEl || !isOcrVisible) return;
    let leftRafId = 0;
    let rightRafId = 0;
    const PAGE_HEIGHT = PDF_VIEWER_PAGE_HEIGHT;
    const MIN_SCROLL_DELTA = 80; // only update page when scrolled at least this much
    const JUMP_BACK_THRESHOLD = PAGE_HEIGHT * 1.5; // don't set currentPage to 1 if we were past this (spurious reset)
    const onLeftScroll = () => {
      if (syncingFromRightRef.current) return;
      const left = leftScrollerRef.current;
      const right = rightScrollerRef.current;
      if (!left || !right) return;
      if (leftRafId) cancelAnimationFrame(leftRafId);
      leftRafId = requestAnimationFrame(() => {
        leftRafId = 0;
        syncingFromLeftRef.current = true;
        const topInner = left.scrollTop;
        right.scrollTop = topInner;
        const page = Math.max(1, Math.floor(topInner / PAGE_HEIGHT) + 1);
        const delta = Math.abs(topInner - lastScrollTopForPageRef.current);
        const spuriousJumpTo1 = page === 1 && lastScrollTopForPageRef.current > JUMP_BACK_THRESHOLD;
        if (spuriousJumpTo1) {
          // Sync scroll only; don't update page or refs so next real scroll can correct
        } else if (delta >= MIN_SCROLL_DELTA && page !== lastScrollSyncedPageRef.current) {
          lastScrollTopForPageRef.current = topInner;
          lastScrollSyncedPageRef.current = page;
          pageChangeSourceRef.current = 'scroll';
          setCurrentPage(page);
        } else {
          lastScrollTopForPageRef.current = topInner;
          lastScrollSyncedPageRef.current = page;
        }
        requestAnimationFrame(() => {
          syncingFromLeftRef.current = false;
        });
      });
    };
    const onRightScroll = () => {
      if (syncingFromLeftRef.current) return;
      const left = leftScrollerRef.current;
      const right = rightScrollerRef.current;
      if (!left || !right) return;
      if (rightRafId) cancelAnimationFrame(rightRafId);
      rightRafId = requestAnimationFrame(() => {
        rightRafId = 0;
        syncingFromRightRef.current = true;
        const topInner = right.scrollTop;
        left.scrollTop = topInner;
        const page = Math.max(1, Math.floor(topInner / PAGE_HEIGHT) + 1);
        const delta = Math.abs(topInner - lastScrollTopForPageRef.current);
        const spuriousJumpTo1 = page === 1 && lastScrollTopForPageRef.current > JUMP_BACK_THRESHOLD;
        if (spuriousJumpTo1) {
          // Sync scroll only; don't update page or refs so next real scroll can correct
        } else if (delta >= MIN_SCROLL_DELTA && page !== lastScrollSyncedPageRef.current) {
          lastScrollTopForPageRef.current = topInner;
          lastScrollSyncedPageRef.current = page;
          pageChangeSourceRef.current = 'scroll';
          setCurrentPage(page);
        } else {
          lastScrollTopForPageRef.current = topInner;
          lastScrollSyncedPageRef.current = page;
        }
        requestAnimationFrame(() => {
          syncingFromRightRef.current = false;
        });
      });
    };
    leftEl.addEventListener('scroll', onLeftScroll, { passive: true });
    rightEl.addEventListener('scroll', onRightScroll, { passive: true });
    return () => {
      if (leftRafId) cancelAnimationFrame(leftRafId);
      if (rightRafId) cancelAnimationFrame(rightRafId);
      leftEl.removeEventListener('scroll', onLeftScroll);
      rightEl.removeEventListener('scroll', onRightScroll);
    };
  }, [isOcrVisible, setCurrentPage, scrollRefsReady]);

  // Reset scroll refs when document or OCR visibility changes so we can re-attach once both panels are mounted
  useEffect(() => {
    console.log('[OCR SCROLL] Reset effect: document?.id=', document?.id, 'isOcrVisible=', isOcrVisible);
    leftScrollerRef.current = null;
    rightScrollerRef.current = null;
    scrollRefsReadyFiredRef.current = false;
    lastScrollSyncedPageRef.current = currentPage;
    lastScrollTopForPageRef.current = (currentPage - 1) * PDF_VIEWER_PAGE_HEIGHT;
    setScrollRefsReady(0);
  }, [document?.id, isOcrVisible]);

  const onLeftScrollerRef = useCallback((el: HTMLDivElement | null) => {
    leftScrollerRef.current = el;
    if (el && rightScrollerRef.current && !scrollRefsReadyFiredRef.current) {
      scrollRefsReadyFiredRef.current = true;
      setScrollRefsReady(1);
    }
  }, []);
  const onRightScrollerRef = useCallback((el: HTMLDivElement | null) => {
    rightScrollerRef.current = el;
    if (el && leftScrollerRef.current && !scrollRefsReadyFiredRef.current) {
      scrollRefsReadyFiredRef.current = true;
      setScrollRefsReady(1);
    }
  }, []);

  const setCurrentPageFromToolbar = useCallback(
    (page: number) => {
      pageChangeSourceRef.current = 'toolbar';
      console.log('[OCR SCROLL] toolbar setCurrentPage(', page, ')');
      setCurrentPage(page);
    },
    [setCurrentPage],
  );

  // When currentPage changes (e.g. toolbar page dropdown), scroll both panels to that page if they're not already there.
  // Guards: (1) never scroll to page 1 when both panels are already scrolled down; (2) if panels disagree by >1 page, don't scroll (let sync fix it).
  useEffect(() => {
    const left = leftScrollerRef.current;
    const right = rightScrollerRef.current;
    if (!left || !right) return;
    if (pageChangeSourceRef.current !== 'toolbar') {
      return;
    }
    const expectedTop = (currentPage - 1) * PDF_VIEWER_PAGE_HEIGHT;
    const tolerance = 20;
    const leftOff = Math.abs(left.scrollTop - expectedTop) > tolerance;
    const rightOff = Math.abs(right.scrollTop - expectedTop) > tolerance;
    const minScrollTop = Math.min(left.scrollTop, right.scrollTop);
    const maxScrollTop = Math.max(left.scrollTop, right.scrollTop);
    const impliedPage = Math.floor(minScrollTop / PDF_VIEWER_PAGE_HEIGHT) + 1;
    const panelsOutOfSync = maxScrollTop - minScrollTop > PDF_VIEWER_PAGE_HEIGHT;

    console.log('[OCR SCROLL] scroll-to-page effect: currentPage=', currentPage, 'left.scrollTop=', left.scrollTop, 'right.scrollTop=', right.scrollTop, 'expectedTop=', expectedTop, 'impliedPage=', impliedPage, 'panelsOutOfSync=', panelsOutOfSync);

    if (!leftOff && !rightOff) return;
    if (panelsOutOfSync) {
      console.log('[OCR SCROLL] scroll-to-page SKIP: panels out of sync (one may have reset), not forcing scroll');
      return;
    }
    lastScrollSyncedPageRef.current = currentPage;
    lastScrollTopForPageRef.current = expectedTop;
    syncingFromLeftRef.current = true;
    syncingFromRightRef.current = true;
    console.log('[OCR SCROLL] scroll-to-page APPLY: scrolling both to', expectedTop);
    left.scrollTop = expectedTop;
    right.scrollTop = expectedTop;
    requestAnimationFrame(() => {
      syncingFromLeftRef.current = false;
      syncingFromRightRef.current = false;
    });
  }, [currentPage]);

  const content = (
    <div
      className={`fixed inset-0 bg-black/70 z-[1000] flex items-center justify-center ${
        isFullSize ? 'p-0' : 'p-4'
      }`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-white flex flex-col overflow-hidden ${
          isFullSize ? '' : 'rounded-2xl shadow-2xl'
        }`}
        style={
          isFullSize
            ? {
                width: '92vw',
                height: '98vh',
              }
            : {
                width: '100%',
                maxWidth: '80rem',
                height: '90vh',
                maxHeight: '95vh',
              }
        }
      >
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">
              Document preview
            </p>
            <h2 className="text-lg font-semibold text-gray-900 truncate max-w-[70vw]">
              {document?.name || 'Untitled document'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#21C1B6] rounded-full p-1"
            aria-label="Close preview"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <OcrToolbar
          ocrToolbarStats={
            isOcrVisible && ocrData?.pages?.length ? (
              <OcrStats
                variant="compact"
                ocrData={ocrData}
                metadata={metadata}
                currentPage={currentPage}
              />
            ) : undefined
          }
          currentPage={currentPage}
          totalPages={totalPagesFromOcr || (overview?.page_count ?? 0)}
          onPageChange={setCurrentPageFromToolbar}
          zoom={zoom}
          onZoomChange={setZoom}
          isFullSize={isFullSize}
          onToggleFullSize={() => setIsFullSize((prev) => !prev)}
          onDownloadOriginalPdf={() => {
            if (!document?.id) {
              alert('Missing document id for download.');
              return;
            }
            const url = ocrApi.getOriginalPdfDownloadUrl(document.id);
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
          onDownloadOcrPlainPdf={() => {
            if (!document?.id) {
              alert('Missing document id for download.');
              return;
            }
            const url = ocrApi.getOcrPlainPdfDownloadUrl(document.id);
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
          onDownloadOcrWithBoxesPdf={() => {
            if (!document?.id) {
              alert('Missing document id for download.');
              return;
            }
            const url = ocrApi.getOcrBoxesPdfDownloadUrl(document.id);
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
          onDownloadOcrBoxesMediumPdf={() => {
            if (!document?.id) {
              alert('Missing document id for download.');
              return;
            }
            const url = ocrApi.getOcrBoxesPdfDownloadUrl(document.id, 'medium');
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
          onDownloadOcrBoxesLowPdf={() => {
            if (!document?.id) {
              alert('Missing document id for download.');
              return;
            }
            const url = ocrApi.getOcrBoxesPdfDownloadUrl(document.id, 'low');
            window.open(url, '_blank', 'noopener,noreferrer');
          }}
          isOcrVisible={isOcrVisible}
          onToggleOcr={() => setIsOcrVisible(!isOcrVisible)}
          displayMode={displayMode}
          onDisplayModeChange={setDisplayMode}
          confidenceFilter={confidenceFilter}
          onConfidenceFilterChange={setConfidenceFilter}
        />

        <div className="flex-1 min-h-0 flex gap-3 px-4 py-3 bg-gray-50">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
              <div className="flex flex-col items-center gap-2 text-gray-700">
                <div className="h-8 w-8 rounded-full border-4 border-gray-200 border-t-[#21C1B6] animate-spin" />
                <p className="text-sm font-medium">Loading OCR document…</p>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
              <p className="text-red-500 mb-3 text-sm font-medium">
                {error || 'Unable to load OCR document'}
              </p>
              <button
                className="mt-1 inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium text-white"
                style={{ backgroundColor: '#21C1B6' }}
                onClick={handleClose}
              >
                Close
              </button>
            </div>
          )}

          {!error && (
            <>
              <div
                className={`${
                  isOcrVisible ? 'basis-1/2' : 'basis-full'
                } flex-1 flex flex-col min-w-0 min-h-0`}
              >
                <PdfPanel
                  pdfUrl={pdfUrlResolved}
                  pageCount={totalPagesFromOcr}
                  currentPage={currentPage}
                  zoom={zoom}
                  onPageCount={() => {}}
                  onScrollerRef={onLeftScrollerRef}
                />
              </div>

              {isOcrVisible && (
                <div className="basis-1/2 flex-1 flex flex-col min-w-0 min-h-0">
                  {overview?.viewer_status === 'processing_ocr' || isPollingOcr ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 space-y-3">
                      <div>
                        <p className="text-sm text-gray-700 mb-1">
                          OCR is processing...
                        </p>
                        <p className="text-xs text-gray-500">
                          This may take a few minutes. The viewer will automatically update when complete.
                        </p>
                      </div>
                      <div className="flex flex-col items-center space-y-2">
                        <div className="h-6 w-6 rounded-full border-2 border-gray-200 border-t-[#21C1B6] animate-spin" />
                        <p className="text-xs text-gray-600">
                          Processing OCR…
                          {typeof ocrProgress === 'number'
                            ? ` ${ocrProgress.toFixed(1)}%`
                            : ''}
                        </p>
                      </div>
                    </div>
                  ) : hasOcrData === false ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 space-y-3">
                      <div>
                        <p className="text-sm text-gray-700 mb-1">
                          OCR reconstruction not available
                        </p>
                        <p className="text-xs text-gray-500 max-w-md">
                          OCR is generated once during case upload and document processing.
                          This file does not have stored OCR JSON available for the
                          reconstructed view.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <OcrPanel
                      ocrData={ocrData}
                      metadata={metadata}
                      currentPage={currentPage}
                      displayMode={displayMode}
                      zoom={zoom}
                      confidenceFilter={confidenceFilter}
                      onScrollerRef={onRightScrollerRef}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (modalRoot) {
    return createPortal(content, modalRoot);
  }

  return content;
};

export default OcrDocumentModal;

