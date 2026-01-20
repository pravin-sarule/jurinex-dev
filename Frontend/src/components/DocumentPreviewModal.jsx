import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import documentApi from "../services/documentApi";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

const detectFileType = (url = "", mime = "") => {
  const normalizedMime = mime?.toLowerCase() || "";
  if (normalizedMime.includes("pdf")) return "pdf";
  if (normalizedMime.startsWith("text/")) return "text";
  if (normalizedMime.includes("json")) return "text";
  if (normalizedMime.includes("html")) return "other";

  const extension = url.split(".").pop()?.toLowerCase();
  if (extension) {
    if (IMAGE_EXTENSIONS.includes(extension)) return "image";
    if (extension === "pdf") return "pdf";
    if (["txt", "md", "json", "csv", "log"].includes(extension)) return "text";
  }

  return "other";
};

const extractTextContent = (payload) => {
  if (!payload) return null;

  if (Array.isArray(payload.chunks) && payload.chunks.length) {
    const chunkText = payload.chunks
      .map((chunk) => chunk.content || chunk.text || "")
      .map((text) => text.trim())
      .filter(Boolean)
      .join("\n\n---\n\n");
    if (chunkText) return chunkText;
  }

  const textFields = [
    payload.full_text_content,
    payload.summary ? `=== DOCUMENT SUMMARY ===\n\n${payload.summary}` : null,
    payload.text,
    payload.content,
  ];

  return (
    textFields.find(
      (value) => typeof value === "string" && value.trim().length > 0
    ) || null
  );
};

const DocumentPreviewModal = ({ document: file, onClose }) => {
  const [fileUrl, setFileUrl] = useState(null);
  const [fileType, setFileType] = useState(null);
  const [textContent, setTextContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sidebarOffset, setSidebarOffset] = useState(0);
  const generatedUrlRef = useRef(null);

  useEffect(() => {
    if (!file?.id) return;

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
        const directUrl = file.previewUrl || file.viewUrl;
        if (directUrl) {
          if (!isMounted) return;
          setFileUrl(directUrl);
          setFileType(detectFileType(directUrl, file.mimetype));
          return;
        }

        const response = await documentApi.getDocumentContent(file.id);
        if (!isMounted) return;

        const text = extractTextContent(response);
        if (text) {
          setTextContent(text);
          setFileType("text");
          return;
        }

        const remoteUrl =
          response?.previewUrl || response?.viewUrl || response?.url;
        if (remoteUrl) {
          setFileUrl(remoteUrl);
          setFileType(detectFileType(remoteUrl, response?.mimeType || file.mimetype));
          return;
        }

        if (
          response?.content &&
          typeof response.content !== "string" &&
          (response.mimeType || file.mimetype)
        ) {
          const blob = new Blob([response.content], {
            type: response.mimeType || file.mimetype || "application/octet-stream",
          });
          const objectUrl = URL.createObjectURL(blob);
          generatedUrlRef.current = objectUrl;
          setFileUrl(objectUrl);
          setFileType(detectFileType("", response.mimeType || file.mimetype));
          return;
        }

        throw new Error("No preview available for this document type.");
      } catch (err) {
        if (!isMounted) return;
        console.error("Error loading document preview:", err);
        setError(err.message || "Failed to load document content.");
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

  if (!file) return null;

  const modalRoot =
    typeof window !== "undefined" && window.document?.body
      ? window.document.body
      : null;

  useEffect(() => {
    if (typeof window === "undefined") return () => undefined;

    const updateSidebarOffset = () => {
      const sidebarEl = document.querySelector("[data-sidebar-root]");
      if (!sidebarEl) {
        setSidebarOffset(0);
        return;
      }

      const rect = sidebarEl.getBoundingClientRect();
      const style = window.getComputedStyle(sidebarEl);
      const hidden =
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width === 0;

      setSidebarOffset(hidden ? 0 : rect.width);
    };

    updateSidebarOffset();
    window.addEventListener("resize", updateSidebarOffset);

    let resizeObserver;
    const sidebarEl = document.querySelector("[data-sidebar-root]");
    if (sidebarEl && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateSidebarOffset());
      resizeObserver.observe(sidebarEl);
    }

    return () => {
      window.removeEventListener("resize", updateSidebarOffset);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  const handleBackdropClick = (event) => {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-gray-600">
          <div className="animate-spin h-10 w-10 border-4 border-gray-200 border-t-[#21C1B6] rounded-full mb-4"></div>
          <p>Loading document preview...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="text-center p-6">
          <p className="text-red-500 mb-3">{error}</p>
          {(file.viewUrl || file.previewUrl) && (
            <a
              href={file.viewUrl || file.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#21C1B6] hover:underline"
            >
              Open in new tab
            </a>
          )}
        </div>
      );
    }

    if (fileType === "text" && textContent) {
      return (
        <div className="bg-white p-4 rounded border border-gray-200 shadow-inner">
          <pre className="whitespace-pre-wrap font-mono text-sm text-gray-800 leading-relaxed">
            {textContent}
          </pre>
        </div>
      );
    }

    if (fileType === "image" && fileUrl) {
      return (
        <div className="flex items-center justify-center">
          <img
            src={fileUrl}
            alt={file.name}
            className="max-h-[75vh] max-w-full rounded-lg shadow"
            onError={() => setError("Failed to load image")}
          />
        </div>
      );
    }

    if (fileType === "pdf" && fileUrl) {
      return (
        <iframe
          src={fileUrl}
          title={file.name}
          className="w-full h-[75vh] border border-gray-200 rounded"
          onError={() => setError("Failed to load PDF")}
        />
      );
    }

    if (fileUrl) {
      return (
        <div className="text-center p-8 text-gray-600">
          <p className="mb-4">Preview not available for this file type.</p>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center bg-[#21C1B6] hover:bg-[#1AA49B] text-white px-5 py-2 rounded-md transition-colors"
          >
            Open in new tab
          </a>
        </div>
      );
    }

    return (
      <div className="text-center text-gray-500 py-10">
        No preview available for this document.
      </div>
    );
  };

  const modal = (
    <div
      className="fixed inset-y-0 right-0 bg-black/70 z-[1000] flex items-center justify-center p-4"
      style={{ left: sidebarOffset }}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-400">
              Document preview
            </p>
            <h2 className="text-xl font-semibold text-gray-900 truncate max-w-[70vw]">
              {file.name || "Untitled document"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#21C1B6] rounded-full p-1"
            aria-label="Close preview"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 bg-gray-50 p-6 overflow-auto">{renderContent()}</div>
      </div>
    </div>
  );

  if (modalRoot) {
    return createPortal(modal, modalRoot);
  }

  return modal;
};

export default DocumentPreviewModal;

