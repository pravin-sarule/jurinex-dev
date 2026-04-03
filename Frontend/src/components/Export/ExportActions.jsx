import React from 'react';
import {
  ArrowDownTrayIcon,
  EyeIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';
import './export.css';

export default function ExportActions({
  draftId,
  draftStatus,
  onExport,
  onPreview,
  onFinalize,
  exporting = false,
}) {
  const isFinalized = draftStatus === 'finalized';

  return (
    <div className="export-actions">
      <button
        type="button"
        className="export-actions__btn export-actions__btn--export"
        onClick={onExport}
        disabled={!draftId || exporting}
        aria-label="Export to DOCX"
      >
        {exporting ? (
          <>
            <div className="export-actions__spinner" aria-hidden />
            <span>Exporting...</span>
          </>
        ) : (
          <>
            <ArrowDownTrayIcon className="w-5 h-5" aria-hidden />
            <span>Export to DOCX</span>
          </>
        )}
      </button>

      <button
        type="button"
        className="export-actions__btn export-actions__btn--preview"
        onClick={onPreview}
        disabled={!draftId}
        aria-label="Preview document"
      >
        <EyeIcon className="w-5 h-5" aria-hidden />
        <span>Preview</span>
      </button>

      <button
        type="button"
        className="export-actions__btn export-actions__btn--finalize"
        onClick={onFinalize}
        disabled={!draftId || isFinalized}
        aria-label={isFinalized ? 'Finalized' : 'Finalize draft'}
      >
        <LockClosedIcon className="w-5 h-5" aria-hidden />
        <span>{isFinalized ? 'Finalized' : 'Finalize Draft'}</span>
      </button>
    </div>
  );
}
