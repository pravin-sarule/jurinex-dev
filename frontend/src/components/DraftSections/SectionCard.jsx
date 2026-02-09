import React, { useState } from 'react';
import { PencilIcon, CheckIcon, XMarkIcon, SparklesIcon } from '@heroicons/react/24/outline';

/**
 * SectionCard Component
 * 
 * Displays a single section with:
 * - Section name and icon
 * - Editable prompt (user can customize before generation)
 * - Generate/Refine buttons
 * - Generated content preview
 * - Critic validation badge
 * - Version history
 */
const SectionCard = ({
  section,
  generatedVersion,
  criticReview,
  onGenerate,
  onRefine,
  isGenerating,
  isRefining,
}) => {
  const [prompt, setPrompt] = useState(section.default_prompt);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [ragQuery, setRagQuery] = useState('');
  const [showRefineModal, setShowRefineModal] = useState(false);
  const [refinementFeedback, setRefinementFeedback] = useState('');

  const hasContent = generatedVersion && generatedVersion.content_html;

  const handleSavePrompt = () => {
    setIsEditingPrompt(false);
  };

  const handleCancelPrompt = () => {
    setPrompt(section.default_prompt);
    setIsEditingPrompt(false);
  };

  const handleGenerate = () => {
    onGenerate(section.section_key, prompt, ragQuery);
  };

  const handleRefineSubmit = () => {
    onRefine(section.section_key, refinementFeedback, ragQuery);
    setShowRefineModal(false);
    setRefinementFeedback('');
  };

  const getCriticBadge = () => {
    if (!criticReview) return null;

    const { critic_status, critic_score } = criticReview;
    const bgColor = critic_status === 'PASS' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';

    return (
      <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${bgColor}`}>
        {critic_status === 'PASS' ? '✅' : '❌'} {critic_status} ({critic_score}/100)
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-4">
      {/* Section Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <span className="text-3xl">{section.icon}</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{section.section_name}</h3>
            <p className="text-sm text-gray-500">
              {section.is_required ? 'Required' : 'Optional'} • Section {section.sort_order}
            </p>
          </div>
        </div>
        {hasContent && getCriticBadge()}
      </div>

      {/* Prompt Editor */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">Generation Prompt</label>
          {!isEditingPrompt ? (
            <button
              onClick={() => setIsEditingPrompt(true)}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center space-x-1"
            >
              <PencilIcon className="w-4 h-4" />
              <span>Edit Prompt</span>
            </button>
          ) : (
            <div className="flex space-x-2">
              <button
                onClick={handleSavePrompt}
                className="text-sm text-green-600 hover:text-green-700 flex items-center space-x-1"
              >
                <CheckIcon className="w-4 h-4" />
                <span>Save</span>
              </button>
              <button
                onClick={handleCancelPrompt}
                className="text-sm text-gray-600 hover:text-gray-700 flex items-center space-x-1"
              >
                <XMarkIcon className="w-4 h-4" />
                <span>Cancel</span>
              </button>
            </div>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!isEditingPrompt}
          rows={3}
          className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
            isEditingPrompt ? 'bg-white' : 'bg-gray-50'
          }`}
        />
      </div>

      {/* RAG Query (Optional) */}
      {!hasContent && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            RAG Query (Optional)
            <span className="text-gray-500 font-normal ml-2">
              - Specific query to retrieve relevant context
            </span>
          </label>
          <input
            type="text"
            value={ragQuery}
            onChange={(e) => setRagQuery(e.target.value)}
            placeholder={`e.g., "What are the ${section.section_name.toLowerCase()} terms?"`}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      )}

      {/* Generated Content or Generate Button */}
      {!hasContent ? (
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <SparklesIcon className="w-5 h-5" />
          <span>{isGenerating ? 'Generating...' : 'Generate Section'}</span>
        </button>
      ) : (
        <>
          {/* Content Preview */}
          <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                Generated Content (v{generatedVersion.version_number})
              </span>
              <span className="text-xs text-gray-500">
                {new Date(generatedVersion.created_at).toLocaleString()}
              </span>
            </div>
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: generatedVersion.content_html }}
            />
          </div>

          {/* Critic Feedback (if FAIL) */}
          {criticReview && criticReview.critic_status === 'FAIL' && (
            <div className="mb-4 p-4 bg-red-50 rounded-lg border border-red-200">
              <h4 className="text-sm font-semibold text-red-800 mb-2">Validation Issues</h4>
              <p className="text-sm text-red-700 mb-2">{criticReview.critic_feedback}</p>
              {criticReview.issues && criticReview.issues.length > 0 && (
                <ul className="list-disc list-inside text-sm text-red-700">
                  {criticReview.issues.map((issue, idx) => (
                    <li key={idx}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Refine Button */}
          <button
            onClick={() => setShowRefineModal(true)}
            disabled={isRefining}
            className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-white border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            <PencilIcon className="w-5 h-5" />
            <span>{isRefining ? 'Refining...' : 'Refine Section'}</span>
          </button>
        </>
      )}

      {/* Refine Modal */}
      {showRefineModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Refine {section.section_name}
            </h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                What would you like to improve?
              </label>
              <textarea
                value={refinementFeedback}
                onChange={(e) => setRefinementFeedback(e.target.value)}
                rows={4}
                placeholder="e.g., Add more specific legal citations, make it more formal, include additional clauses about..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Updated RAG Query (Optional)
              </label>
              <input
                type="text"
                value={ragQuery}
                onChange={(e) => setRagQuery(e.target.value)}
                placeholder="Query for additional context"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleRefineSubmit}
                disabled={!refinementFeedback.trim()}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Refine Section
              </button>
              <button
                onClick={() => setShowRefineModal(false)}
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SectionCard;
