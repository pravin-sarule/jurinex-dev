import React, { useEffect, useRef } from 'react';

export interface PdfPanelProps {
  pdfUrl: string | null;
  pageCount: number;
  currentPage: number;
  onPageCount?: (pageCount: number) => void;
  zoom: number;
  onScrollerRef?: (el: HTMLDivElement | null) => void;
}

const PdfPanel: React.FC<PdfPanelProps> = ({
  pdfUrl,
  pageCount,
  currentPage,
  onPageCount,
  zoom,
  onScrollerRef,
}) => {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onScrollerRef?.(scrollerRef.current);
    return () => onScrollerRef?.(null);
  }, [onScrollerRef, pdfUrl]);

  useEffect(() => {
    if (pageCount > 0) onPageCount?.(pageCount);
  }, [pageCount, onPageCount]);

  const pageFragment = currentPage > 1 ? `#page=${currentPage}` : '';
  const resolvedUrl = pdfUrl
    ? pdfUrl.includes('#')
      ? pdfUrl
      : `${pdfUrl}${pageFragment}`
    : null;

  if (!resolvedUrl) {
    return (
      <div className="flex flex-col h-full min-h-0 gap-3">
        <h3 className="text-sm font-semibold text-gray-900 shrink-0">
          Original Document
        </h3>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm bg-gray-50 rounded-lg border border-gray-200">
          Original file preview unavailable
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <h3 className="text-sm font-semibold text-gray-900 shrink-0">
        Original Document ({Math.round(zoom * 100)}%)
      </h3>
      <div
        ref={scrollerRef}
        id="ocr-pdf-panel-scroll"
        className="flex-1 min-h-0 overflow-auto bg-gray-100 rounded-lg border border-gray-200"
      >
        <div
          className="h-full min-h-[720px] bg-gray-100"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
            width: `${100 / zoom}%`,
            height: `${100 / zoom}%`,
          }}
        >
          <iframe
            src={resolvedUrl}
            title="Original document"
            className="w-full h-full min-h-[720px] border-0 bg-white"
          />
        </div>
      </div>
    </div>
  );
};

export default PdfPanel;
