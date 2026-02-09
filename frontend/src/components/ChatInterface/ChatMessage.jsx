import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { convertJsonToPlainText } from '../../utils/jsonToPlainText';
import { renderSecretPromptResponse, isStructuredJsonResponse } from '../../utils/renderSecretPromptResponse';
import '../../styles/ChatInterface.css';

const ChatMessage = ({ message }) => {
  const rawResponse = message.response || message.message || JSON.stringify(message);
  const isStructured = isStructuredJsonResponse(rawResponse);
  
  const responseContent = isStructured
    ? renderSecretPromptResponse(rawResponse)
    : convertJsonToPlainText(rawResponse);
  
  // Check if content contains HTML (Word document style)
  const containsHTML = responseContent.includes('<div style=') || 
                       responseContent.includes('<h1 style=') || 
                       responseContent.includes('<h2 style=') ||
                       responseContent.includes('<table style=') ||
                       responseContent.includes('<p style=');
  
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
        <div className={`flex-1 ${containsHTML ? 'word-document-style' : 'prose prose-sm prose-gray max-w-none'}`}>
          {containsHTML ? (
            <div 
              dangerouslySetInnerHTML={{ __html: responseContent }}
              style={{ 
                fontFamily: "'Times New Roman', serif",
                lineHeight: '1.6',
                color: '#1a1a1a'
              }}
            />
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, rehypeSanitize]}
              components={{
              h1: ({node, ...props}) => <h1 className="text-xl font-bold mb-4 mt-4 text-gray-900 border-b border-gray-300 pb-2" {...props} />,
              h2: ({node, ...props}) => <h2 className="text-lg font-bold mb-3 mt-3 text-gray-900" {...props} />,
              h3: ({node, ...props}) => <h3 className="text-base font-bold mb-2 mt-2 text-gray-900" {...props} />,
              h4: ({node, ...props}) => <h4 className="text-sm font-bold mb-2 mt-2 text-gray-900" {...props} />,
              h5: ({node, ...props}) => <h5 className="text-sm font-bold mb-2 mt-2 text-gray-900" {...props} />,
              h6: ({node, ...props}) => <h6 className="text-sm font-bold mb-2 mt-2 text-gray-900" {...props} />,
              p: ({node, ...props}) => <p className="mb-3 leading-relaxed text-gray-800" {...props} />,
              strong: ({node, ...props}) => <strong className="font-bold text-gray-900" {...props} />,
              em: ({node, ...props}) => <em className="italic text-gray-800" {...props} />,
              ul: ({node, ...props}) => <ul className="list-disc pl-5 mb-3 text-gray-800" {...props} />,
              ol: ({node, ...props}) => <ol className="list-decimal pl-5 mb-3 text-gray-800" {...props} />,
              li: ({node, ...props}) => <li className="mb-1 leading-relaxed text-gray-800" {...props} />,
              a: ({node, ...props}) => <a className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
              blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-700 my-3 bg-gray-50 py-2" {...props} />,
              code: ({node, inline, ...props}) => {
                const className = inline 
                  ? "bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-red-600" 
                  : "block bg-gray-900 text-gray-100 p-3 rounded-md text-xs font-mono overflow-x-auto my-3";
                return <code className={className} {...props} />;
              },
              pre: ({node, ...props}) => <pre className="bg-gray-900 rounded-md overflow-hidden my-3" {...props} />,
              table: ({node, ...props}) => (
                <div className="overflow-x-auto my-4">
                  <table className="min-w-full border-collapse border border-gray-300" {...props} />
                </div>
              ),
              thead: ({node, ...props}) => <thead className="bg-gray-100" {...props} />,
              th: ({node, ...props}) => <th className="border border-gray-300 px-3 py-2 text-left font-bold text-gray-900 text-sm" {...props} />,
              tbody: ({node, ...props}) => <tbody {...props} />,
              td: ({node, ...props}) => <td className="border border-gray-300 px-3 py-2 text-gray-800 text-sm" {...props} />,
              tr: ({node, ...props}) => <tr className="hover:bg-gray-50" {...props} />,
              hr: ({node, ...props}) => <hr className="my-4 border-gray-300" {...props} />,
              }}
            >
              {responseContent}
            </ReactMarkdown>
          )}
        </div>
      </div>
      
      {message.timestamp && (
        <div className="text-right text-xs text-gray-500 mt-3 pt-2 border-t border-gray-100">
          {new Date(message.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default ChatMessage;