import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { UNIVERSAL_SECTIONS } from '../../config/universalSections';
import EditPromptsTab from './EditPromptsTab';
import GenerateSectionsTab from './GenerateSectionsTab';
import ReviewAssembleTab from './ReviewAssembleTab';
import { getDraft } from '../../services/draftFormApi';

/**
 * SectionTabs Component
 * 
 * 3-tab interface for section management:
 * Tab 1: Edit Prompts - Customize prompts for each section
 * Tab 2: Generate Sections - Generate content for each section
 * Tab 3: Review & Assemble - Review all sections and create final document
 */
const SectionTabs = () => {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('edit-prompts');
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDraft();
  }, [draftId]);

  const loadDraft = async () => {
    try {
      const data = await getDraft(draftId);
      setDraft(data.draft);
    } catch (error) {
      console.error('Failed to load draft:', error);
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    {
      id: 'edit-prompts',
      name: 'Edit Prompts',
      icon: '✏️',
      description: 'Customize generation prompts',
    },
    {
      id: 'generate-sections',
      name: 'Generate Sections',
      icon: '✨',
      description: 'Generate section content',
    },
    {
      id: 'review-assemble',
      name: 'Review & Assemble',
      icon: '📄',
      description: 'Review and create final document',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading draft...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/drafts')}
          className="text-blue-600 hover:text-blue-700 mb-4 flex items-center space-x-2"
        >
          <span>←</span>
          <span>Back to Drafts</span>
        </button>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {draft?.draft_title || 'Draft Document'}
        </h1>
        <p className="text-gray-600">
          Step 3 of 3: Generate document sections with AI
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        <div className="border-b border-gray-200">
          <nav className="flex -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-4 px-6 text-center border-b-2 font-medium text-sm transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-center space-x-2">
                  <span className="text-xl">{tab.icon}</span>
                  <span>{tab.name}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1">{tab.description}</div>
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'edit-prompts' && (
            <EditPromptsTab
              draftId={draftId}
              draft={draft}
              onNext={() => setActiveTab('generate-sections')}
            />
          )}
          {activeTab === 'generate-sections' && (
            <GenerateSectionsTab
              draftId={draftId}
              draft={draft}
              onNext={() => setActiveTab('review-assemble')}
              onBack={() => setActiveTab('edit-prompts')}
            />
          )}
          {activeTab === 'review-assemble' && (
            <ReviewAssembleTab
              draftId={draftId}
              draft={draft}
              onBack={() => setActiveTab('generate-sections')}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default SectionTabs;
