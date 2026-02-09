import React, { useState, useRef, useCallback } from 'react';
import { XMarkIcon, DocumentArrowUpIcon } from '@heroicons/react/24/outline';
import { formatFileSize, validateFileSize, isAllowedEvidenceFile } from '../../utils/fileHelpers';
import './evidence.css';

const MAX_SIZE_MB = 20;
const ALLOWED_TYPES = 'PDF, DOCX, TXT, Images (Max 20MB)';

export default function EvidenceUploadModal({ isOpen, onClose, onUpload, draftId }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const reset = useCallback(() => {
    setSelectedFile(null);
    setUploadProgress(0);
    setUploading(false);
    setExtracting(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleFileSelect = useCallback((file) => {
    if (!file) return;
    setError(null);
    if (!isAllowedEvidenceFile(file)) {
      setError(`Unsupported file type. Supported: ${ALLOWED_TYPES}`);
      return;
    }
    const { valid, error: sizeError } = validateFileSize(file);
    if (!valid) {
      setError(sizeError);
      return;
    }
    setSelectedFile(file);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragActive(false);
  }, []);

  const handleInputChange = useCallback(
    (e) => {
      const file = e.target?.files?.[0];
      if (file) handleFileSelect(file);
      e.target.value = '';
    },
    [handleFileSelect]
  );

  const clearFile = useCallback(() => {
    setSelectedFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleUploadClick = useCallback(async () => {
    if (!selectedFile || !onUpload) return;

    setUploading(true);
    setUploadProgress(10);
    setError(null);

    try {
      setUploadProgress(30);
      await onUpload(selectedFile);
      setUploadProgress(100);
      reset();
      onClose();
    } catch (err) {
      console.error('Evidence upload error:', err);
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }, [selectedFile, onUpload, onClose, reset]);

  if (!isOpen) return null;

  return (
    <div
      className="evidence-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="evidence-modal-title"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="evidence-modal" onClick={(e) => e.stopPropagation()}>
        <div className="evidence-modal__header">
          <h2 id="evidence-modal-title" className="evidence-modal__title">
            Upload Evidence Document
          </h2>
          <button
            type="button"
            className="evidence-modal__close"
            onClick={handleClose}
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="evidence-modal__body">
          <div
            className={`evidence-dropzone ${dragActive ? 'evidence-dropzone--active' : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.doc,.txt,.png,.jpg,.jpeg,.gif,.webp"
              onChange={handleInputChange}
              className="sr-only"
              aria-label="Choose file"
            />
            {!selectedFile ? (
              <>
                <DocumentArrowUpIcon className="evidence-dropzone__icon" aria-hidden />
                <p className="evidence-dropzone__text">
                  Drag and drop your file here, or click to browse
                </p>
                <p className="evidence-dropzone__hint">Supported: {ALLOWED_TYPES}</p>
                <span className="evidence-dropzone__browse">Browse Files</span>
              </>
            ) : (
              <div className="evidence-preview">
                <span className="evidence-preview__name">{selectedFile.name}</span>
                <span className="evidence-preview__size">
                  {formatFileSize(selectedFile.size)}
                </span>
                <button
                  type="button"
                  className="evidence-preview__remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 mb-4" role="alert">
              {error}
            </p>
          )}

          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="evidence-progress">
              <div className="evidence-progress__bar">
                <div
                  className="evidence-progress__fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="evidence-progress__text">{uploadProgress}%</p>
            </div>
          )}

          {extracting && (
            <div className="evidence-status">
              <div className="evidence-status__spinner" aria-hidden />
              <span>Extracting text from document...</span>
            </div>
          )}
        </div>

        <div className="evidence-modal__actions">
          <button
            type="button"
            className="evidence-modal__btn evidence-modal__btn--cancel"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="evidence-modal__btn evidence-modal__btn--upload"
            onClick={handleUploadClick}
            disabled={!selectedFile || uploading}
          >
            {uploading ? 'Uploading...' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
