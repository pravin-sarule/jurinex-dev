import { useCallback, useEffect, useState } from 'react';
import ocrApi from '../services/ocrApi';
import type { OcrDocumentOverview, OcrJson, OcrMetadata } from '../types/ocr';

export type OcrDisplayMode = 'words' | 'lines' | 'paragraphs';
export type OcrConfidenceFilter = 'none' | 'all' | 'high' | 'medium' | 'low';

const useOcrDocumentViewer = (documentId?: string | null) => {
  const [overview, setOverview] = useState<OcrDocumentOverview | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [ocrData, setOcrData] = useState<OcrJson | null>(null);
  const [metadata, setMetadata] = useState<OcrMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [isOcrVisible, setIsOcrVisible] = useState(true);
  const [displayMode, setDisplayMode] = useState<OcrDisplayMode>('words');
  const [confidenceFilter, setConfidenceFilter] = useState<OcrConfidenceFilter>('none');
  const [hasOcrData, setHasOcrData] = useState<boolean | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [isPollingOcr, setIsPollingOcr] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);

  const reload = useCallback(() => {
    setReloadVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!documentId) {
      setOverview(null);
      setPdfUrl(null);
      setOcrData(null);
      setMetadata(null);
      setHasOcrData(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setHasOcrData(null);
      try {
        const overviewData = await ocrApi.getOcrDocument(documentId);
        if (cancelled) return;
        setOverview(overviewData);
        setPdfUrl(overviewData.pdf_signed_url || null);
        setOcrProgress(typeof overviewData.progress_percentage === 'number' ? overviewData.progress_percentage : null);

        if (overviewData.ocr_available) {
          const [json, meta] = await Promise.all([
            ocrApi.fetchOcrJson(documentId),
            ocrApi.fetchMetadataJson(documentId),
          ]);
          if (cancelled) return;
          setOcrData(json);
          setMetadata(meta);
          setHasOcrData(Boolean(json?.pages?.length));
          setOcrProgress(100);
        } else {
          setOcrData(null);
          setMetadata(null);
          setHasOcrData(false);
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Unable to load OCR document');
        setOcrData(null);
        setMetadata(null);
        setHasOcrData(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    const handleCompleted = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (!detail?.documentId || detail.documentId === documentId) reload();
    };
    window.addEventListener('ocr-completed', handleCompleted as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener('ocr-completed', handleCompleted as EventListener);
    };
  }, [documentId, reloadVersion, reload]);

  useEffect(() => {
    if (!documentId || overview?.viewer_status !== 'processing_ocr') {
      setIsPollingOcr(false);
      return;
    }

    let cancelled = false;
    setIsPollingOcr(true);
    const interval = window.setInterval(async () => {
      try {
        const status = await ocrApi.getOcrStatus(documentId);
        if (cancelled) return;
        setOcrProgress(typeof status.progress_percentage === 'number' ? status.progress_percentage : null);
        if (status.ocr_available || status.viewer_status === 'ready') {
          window.clearInterval(interval);
          setIsPollingOcr(false);
          reload();
        }
      } catch {
        if (!cancelled) setIsPollingOcr(false);
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      setIsPollingOcr(false);
    };
  }, [documentId, overview?.viewer_status, reload]);

  return {
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
  };
};

export default useOcrDocumentViewer;
