import React, { useState, useRef } from 'react';
import FormattedAssistantContent from './FormattedAssistantContent';
import { Copy, Download, FileText, Printer, Code } from 'lucide-react';
import { getCleanText, downloadAsPdf, downloadAsHtml, printResponse } from '../../utils/responseExportUtils';
import BrandingDownloadModal from '../BrandingDownload/BrandingDownloadModal';
import '../../styles/ChatInterface.css';

const ChatMessage = ({ message }) => {
  const rawResponse = message.response || message.message || JSON.stringify(message);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);
  const [showWordModal, setShowWordModal] = useState(false);
  const contentRef = useRef(null);

  const handleCopy = async () => {
    try {
      const text = getCleanText(contentRef.current, rawResponse);
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDownloadPdf = () => setShowPdfModal(true);
  const handleDownloadWord = () => setShowWordModal(true);

  return (
    <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="mb-4 pb-3 border-b border-gray-200">
        <div className="flex items-start gap-2">
          <div className="font-semibold text-blue-600 text-sm whitespace-nowrap">You:</div>
          <div className="text-gray-800 flex-1">{message.question || 'N/A'}</div>
        </div>
      </div>

      <div className="flex items-start gap-2">
        <div className="font-semibold text-green-600 text-sm whitespace-nowrap">AI:</div>
        <div className="flex-1">
          <div
            ref={contentRef}
            className="prose prose-sm prose-gray max-w-none"
            style={{ fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif", fontSize: '15px', lineHeight: '1.75' }}
          >
            <FormattedAssistantContent raw={rawResponse} />
          </div>

          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100">
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-md transition-colors cursor-pointer"
              title="Copy response"
            >
              <Copy size={12} />
              {copySuccess ? 'Copied!' : 'Copy'}
            </button>
            <button
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-md transition-colors cursor-pointer"
              title="Download as PDF"
            >
              <Download size={12} />
              PDF
            </button>
            <button
              onClick={handleDownloadWord}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-md transition-colors cursor-pointer"
              title="Download as Word"
            >
              <FileText size={12} />
              Word
            </button>
            <button
              onClick={() => downloadAsHtml(contentRef.current, `AI_Response_${new Date().toISOString().slice(0, 10)}.html`)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-md transition-colors cursor-pointer"
              title="Download as HTML"
            >
              <Code size={12} />
              HTML
            </button>
            <button
              onClick={() => printResponse(contentRef.current)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 border border-gray-200 hover:border-gray-300 rounded-md transition-colors cursor-pointer"
              title="Print response"
            >
              <Printer size={12} />
              Print
            </button>
          </div>
        </div>
      </div>

      {message.timestamp && (
        <div className="text-right text-xs text-gray-500 mt-3 pt-2 border-t border-gray-100">
          {new Date(message.timestamp).toLocaleString()}
        </div>
      )}

      <BrandingDownloadModal
        isOpen={showPdfModal}
        onClose={() => setShowPdfModal(false)}
        contentRef={contentRef}
        filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.pdf`}
        format="pdf"
        module="chat-message"
      />
      <BrandingDownloadModal
        isOpen={showWordModal}
        onClose={() => setShowWordModal(false)}
        contentRef={contentRef}
        filename={`AI_Response_${new Date().toISOString().slice(0, 10)}.docx`}
        format="word"
        module="chat-message"
      />
    </div>
  );
};

export default ChatMessage;
