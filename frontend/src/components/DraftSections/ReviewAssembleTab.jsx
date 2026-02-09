import React, { useState, useEffect } from 'react';
import { getAllSections } from '../../services/sectionApi';

/**
 * ReviewAssembleTab Component
 * 
 * Tab 3: Review & Assemble
 * - Shows all generated sections
 * - Allows final review
 * - Assembles final document
 */
const ReviewAssembleTab = ({ draftId, draft, onBack }) => {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSections();
  }, [draftId]);

  const loadSections = async () => {
    try {
      const data = await getAllSections(draftId);
      if (data.success) {
        setSections(data.sections);
      }
    } catch (error) {
      console.error('Failed to load sections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAssemble = () => {
    // TODO: Implement assembler
    alert('Assembler integration coming soon!');
  };

  if (loading) {
    return <div className="text-center py-12">Loading sections...</div>;
  }

  return (
    <div>
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-green-900 mb-2">
          📄 Review All Sections
        </h3>
        <p className="text-green-800 text-sm mb-4">
          Review all generated sections below. Once satisfied, click "Assemble Final Document" to
          create your complete legal document.
        </p>
        <div className="text-sm text-green-700">
          {sections.length} / 23 sections generated
        </div>
      </div>

      {/* Sections Preview */}
      <div className="space-y-6 mb-6">
        {sections.map((section) => (
          <div key={section.section_key} className="bg-white border border-gray-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 capitalize">
              {section.section_key.replace(/_/g, ' ')}
            </h3>
            <div
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: section.content_html }}
            />
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-200">
        <button
          onClick={onBack}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
        >
          ← Back: Generate Sections
        </button>

        <button
          onClick={handleAssemble}
          disabled={sections.length < 23}
          className="px-6 py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-lg hover:from-green-700 hover:to-blue-700 disabled:opacity-50"
        >
          📄 Assemble Final Document
        </button>
      </div>
    </div>
  );
};

export default ReviewAssembleTab;
