import React, { useState, useEffect } from 'react';
import { FileText, X, ExternalLink } from 'lucide-react';
import apiService from '../../services/api';

const API_BASE_URL = import.meta.env.VITE_APP_API_URL || import.meta.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const CitationsPanel = ({ citations = [], fileId, folderName, onClose, onCitationClick }) => {
  const [expandedCitations, setExpandedCitations] = useState({});
  const [loadingCitations, setLoadingCitations] = useState({});

  // Format page label
  const formatPageLabel = (citation) => {
    if (citation.pageStart && citation.pageEnd && citation.pageStart !== citation.pageEnd) {
      return `Pages ${citation.pageStart}-${citation.pageEnd}`;
    } else if (citation.page || citation.pageStart) {
      return `Page ${citation.page || citation.pageStart}`;
    }
    return null;
  };

  // Format source display
  const formatSource = (citation) => {
    const pageLabel = formatPageLabel(citation);
    if (pageLabel) {
      return `${citation.filename} - ${pageLabel}`;
    }
    return citation.filename || 'Unknown Document';
  };

  // Handle citation click
  const handleCitationClick = (citation) => {
    if (onCitationClick) {
      onCitationClick(citation);
    } else {
      // Default behavior: open document at page
      if (citation.viewUrl) {
        window.open(citation.viewUrl, '_blank');
      } else if (citation.fileId) {
        const page = citation.page || citation.pageStart || 1;
        const url = `${API_BASE_URL}/api/files/${citation.fileId}/view#page=${page}`;
        window.open(url, '_blank');
      }
    }
  };

  // Truncate text snippet
  const truncateText = (text, maxLength = 150) => {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  };

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200 shadow-xl rounded-l-2xl" style={{ width: '380px', maxWidth: '380px' }}>
      {/* Header */}
      <div className="px-4 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900">Sources</h2>
        <button
          type="button"
          className="text-gray-400 hover:text-gray-500 p-1 rounded-md hover:bg-gray-100 transition-colors"
          onClick={onClose}
          aria-label="Close sources panel"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Citations List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: 'thin' }}>
              {!citations || citations.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500 text-sm">No sources found for this response.</p>
                </div>
              ) : (
                citations.map((citation, idx) => {
                  const pageLabel = formatPageLabel(citation);
                  const source = formatSource(citation);
                  const textSnippet = truncateText(citation.text);

                  return (
                    <div
                      key={idx}
                      className="citation-item bg-white rounded-lg shadow-sm border border-gray-200 p-4"
                    >
                      {/* PDF Icon and Header */}
                      <div className="flex items-center mb-2">
                        <FileText className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="filename text-sm font-medium text-gray-800 truncate block">
                            {citation.filename || 'Unknown Document'}
                          </span>
                          {pageLabel && (
                            <span className="page-badge text-xs text-gray-500">
                              • {pageLabel}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Text Snippet */}
                      {textSnippet && (
                        <p className="citation-text text-sm text-gray-600 mb-3">
                          {textSnippet}
                        </p>
                      )}

                      {/* View Link */}
                      <button
                        onClick={() => handleCitationClick(citation)}
                        className="view-link inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View on {pageLabel || 'Document'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
    </div>
  );
};

export default CitationsPanel;

