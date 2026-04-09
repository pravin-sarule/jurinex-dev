import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import documentApi from '../../services/documentApi';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'wave', 'flac', 'ogg', 'opus', 'webm', 'mp4', 'm4a', 'aac', 'amr'];
const AUDIO_MIME_PREFIXES = ['audio/', 'video/mp4'];

const detectFileType = (url = '', mime = '') => {
  const normalizedMime = mime?.toLowerCase() || '';
  if (normalizedMime.includes('pdf')) return 'pdf';
  if (normalizedMime.startsWith('text/')) return 'text';
  if (normalizedMime.includes('json')) return 'text';
  if (AUDIO_MIME_PREFIXES.some((prefix) => normalizedMime.startsWith(prefix))) return 'audio';

  const extension = url.split('?')[0].split('.').pop()?.toLowerCase();
  if (extension) {
    if (IMAGE_EXTENSIONS.includes(extension)) return 'image';
    if (AUDIO_EXTENSIONS.includes(extension)) return 'audio';
    if (extension === 'pdf') return 'pdf';
    if (['txt', 'md', 'json', 'csv', 'log'].includes(extension)) return 'text';
  }

  return 'other';
};

const extractTextContent = (payload) => {
  if (!payload) return null;

  if (Array.isArray(payload.chunks) && payload.chunks.length) {
    const chunkText = payload.chunks
      .map((chunk) => chunk.content || chunk.text || '')
      .map((text) => text.trim())
      .filter(Boolean)
      .join('\n\n');
    if (chunkText) return chunkText;
  }

  return (
    [
      payload.full_text_content,
      payload.summary ? `SUMMARY\n\n${payload.summary}` : null,
      payload.text,
      payload.content,
    ].find((value) => typeof value === 'string' && value.trim()) || null
  );
};

const paginateText = (text) => {
  if (!text) return [];

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const pages = [];
  let currentBlocks = [];
  let currentWeight = 0;
  const maxWeight = 2500;

  blocks.forEach((block) => {
    const isHeading = /^#{1,6}\s/.test(block) || /^[A-Z][A-Z\s\d.,:&/-]{8,}$/.test(block);
    const weight = Math.max(180, block.length + (isHeading ? 220 : 0));

    if (currentBlocks.length && currentWeight + weight > maxWeight) {
      pages.push(currentBlocks.join('\n\n'));
      currentBlocks = [];
      currentWeight = 0;
    }

    currentBlocks.push(block);
    currentWeight += weight;
  });

  if (currentBlocks.length) {
    pages.push(currentBlocks.join('\n\n'));
  }

  return pages;
};

const InlineDocumentPreview = ({ document: file }) => {
  const [fileUrl, setFileUrl] = useState(null);
  const [fileType, setFileType] = useState(null);
  const [textContent, setTextContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const generatedUrlRef = useRef(null);

  useEffect(() => {
    if (!file?.id) {
      setFileUrl(null);
      setFileType(null);
      setTextContent(null);
      setError(null);
      return;
    }

    let isMounted = true;

    const revokeGeneratedUrl = () => {
      if (generatedUrlRef.current) {
        URL.revokeObjectURL(generatedUrlRef.current);
        generatedUrlRef.current = null;
      }
    };

    const loadPreview = async () => {
      setLoading(true);
      setError(null);
      setFileUrl(null);
      setFileType(null);
      setTextContent(null);
      revokeGeneratedUrl();

      try {
        const directUrl = file.previewUrl || file.viewUrl || file.url;
        if (directUrl) {
          if (!isMounted) return;
          setFileUrl(directUrl);
          setFileType(detectFileType(directUrl, file.type || file.mimetype));
          return;
        }

        try {
          const viewData = await documentApi.getDocumentViewInfo(file.id, 1);
          const url =
            viewData.viewUrlWithPage ||
            viewData.viewUrl ||
            viewData.signedUrl;
          if (url && isMounted) {
            setFileUrl(url);
            setFileType(
              detectFileType(
                url,
                viewData.document?.mimetype || file.type || file.mimetype
              )
            );
            return;
          }
        } catch (viewErr) {
          console.warn('[InlineDocumentPreview] Original file view URL unavailable:', viewErr);
        }

        const response = await documentApi.getDocumentContent(file.id);
        if (!isMounted) return;

        const remoteUrl = response?.previewUrl || response?.viewUrl || response?.url;
        if (remoteUrl) {
          setFileUrl(remoteUrl);
          setFileType(detectFileType(remoteUrl, response?.mimeType || file.type || file.mimetype));
          return;
        }

        const text = extractTextContent(response);
        if (text) {
          setTextContent(text);
          setFileType('text');
        }

        if (
          response?.content &&
          typeof response.content !== 'string' &&
          (response.mimeType || file.type || file.mimetype)
        ) {
          const blob = new Blob([response.content], {
            type: response.mimeType || file.type || file.mimetype || 'application/octet-stream',
          });
          const objectUrl = URL.createObjectURL(blob);
          generatedUrlRef.current = objectUrl;
          setFileUrl(objectUrl);
          setFileType(detectFileType('', response.mimeType || file.type || file.mimetype));
        }
      } catch (err) {
        console.error('Error loading inline document preview:', err);
        if (isMounted) {
          setError(err.message || 'Failed to load document preview.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      isMounted = false;
      revokeGeneratedUrl();
    };
  }, [file]);

  const pages = useMemo(() => paginateText(textContent), [textContent]);

  const renderTextPages = () => {
    if (!pages.length) {
      return (
        <div className="flex items-center justify-center h-full text-gray-500">
          No document content available.
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {pages.map((page, index) => (
          <article
            key={`doc-page-${index + 1}`}
            className="mx-auto w-full max-w-[900px] min-h-[1100px] bg-white shadow-[0_14px_36px_rgba(15,23,42,0.14)] border border-[#d8d3c8] rounded-[6px] px-10 py-8"
          >
            <div className="flex items-center justify-between border-b border-[#d9d4ca] pb-3 text-[11px] text-[#6c6457]">
              <span className="truncate max-w-[70%]">{file?.originalName || file?.name || 'Document preview'}</span>
              <span>Page {index + 1}</span>
            </div>
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-6 text-[#2f3b2f] mt-6">
              {page}
            </pre>
            <div className="mt-10 pt-4 border-t border-[#e4dfd6] text-right text-[11px] text-[#7c7469]">
              Page {index + 1} / {pages.length}
            </div>
          </article>
        ))}
      </div>
    );
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-[#6c6457]">
          <Loader2 className="h-8 w-8 animate-spin mb-3" />
          <p>Loading document preview...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center px-8">
          <FileText className="h-10 w-10 text-[#8b8172] mb-4" />
          <p className="text-sm text-red-600 mb-4">{error}</p>
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#1f6b5f] text-white text-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Open document
            </a>
          )}
        </div>
      );
    }

    if (fileType === 'image' && fileUrl) {
      return (
        <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
          <img src={fileUrl} alt={file?.originalName || file?.name} className="max-w-full rounded-md shadow-xl" />
        </div>
      );
    }

    if (fileType === 'audio' && fileUrl) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 gap-6">
          <div className="w-24 h-24 rounded-full bg-[#21C1B6]/10 flex items-center justify-center">
            <svg className="w-12 h-12 text-[#21C1B6]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <p className="text-[#2b3528] font-medium text-center truncate max-w-[80%]">
            {file?.originalName || file?.name || 'Audio Recording'}
          </p>
          <audio
            controls
            className="w-full max-w-xl rounded-lg shadow-md"
            src={fileUrl}
            preload="metadata"
          >
            Your browser does not support the audio element.
          </audio>
          <p className="text-xs text-[#7c7469]">
            This audio has been transcribed and indexed — you can ask questions about its content in the chat.
          </p>
        </div>
      );
    }

    if ((fileType === 'pdf' || fileUrl) && fileUrl && fileType !== 'text') {
      return (
        <div className="flex-1 p-4">
          <iframe
            src={fileUrl}
            title={file?.originalName || file?.name || 'Document preview'}
            className="w-full h-full rounded-[8px] border border-[#d8d3c8] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.12)]"
          />
        </div>
      );
    }

    return renderTextPages();
  };

  return (
    <section className="h-full min-h-0 flex flex-col bg-[#ece8df]">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#d6d0c4] bg-[#f7f4ee]">
        <div className="min-w-0">
          <p className="text-[12px] uppercase tracking-[0.16em] text-[#7c7469]">{fileType === 'audio' ? 'Audio Recording' : 'Document Preview'}</p>
          <h3 className="text-[18px] font-medium text-[#2b3528] truncate">
            {file?.originalName || file?.name || 'Select a document'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {fileUrl && (
            <>
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#d2ccbf] bg-white text-[#2b3528] text-sm"
              >
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[#d2ccbf] bg-white text-[#2b3528] text-sm"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">{renderContent()}</div>
    </section>
  );
};

export default InlineDocumentPreview;
