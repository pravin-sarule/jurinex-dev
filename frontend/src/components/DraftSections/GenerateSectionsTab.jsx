import React, { useState, useEffect } from 'react';
import { UNIVERSAL_SECTIONS, SECTION_CATEGORIES } from '../../config/universalSections';
import {
  generateSection,
  refineSection,
  getAllSections,
  getSectionPrompts,
} from '../../services/sectionApi';
import { getTemplateUrl } from '../../services/draftFormApi';
import { SparklesIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';

/**
 * GenerateSectionsTab Component
 * 
 * Tab 2: Generate Sections
 * - Shows all 23 sections with generate buttons
 * - Each section generates content based on:
 *   - Saved prompt from Tab 1
 *   - Template URL (from template_html)
 *   - RAG context (from uploaded files/case)
 * - Shows Critic validation status
 * - Allows refinement
 */
const GenerateSectionsTab = ({ draftId, draft, onNext, onBack }) => {
  const [prompts, setPrompts] = useState({});
  const [generatedSections, setGeneratedSections] = useState({});
  const [criticReviews, setCriticReviews] = useState({});
  const [generatingSection, setGeneratingSection] = useState(null);
  const [templateUrl, setTemplateUrl] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [showRefineModal, setShowRefineModal] = useState(null);
  const [refinementFeedback, setRefinementFeedback] = useState('');

  useEffect(() => {
    loadData();
  }, [draftId]);

  const loadData = async () => {
    try {
      // Load saved prompts
      const promptsData = await getSectionPrompts(draftId);
      if (promptsData.success && promptsData.prompts) {
        setPrompts(promptsData.prompts);
      }

      // Load existing sections
      const sectionsData = await getAllSections(draftId);
      if (sectionsData.success) {
        const sectionsMap = {};
        const reviewsMap = {};

        sectionsData.sections.forEach((section) => {
          sectionsMap[section.section_key] = section;
          if (section.generation_metadata?.critic) {
            reviewsMap[section.section_key] = section.generation_metadata.critic;
          }
        });

        setGeneratedSections(sectionsMap);
        setCriticReviews(reviewsMap);
      }

      // Load template URL
      if (draft?.template_id) {
        const urlData = await getTemplateUrl(draft.template_id);
        if (urlData.success && urlData.template_url) {
          setTemplateUrl(urlData.template_url);
          console.log('[GenerateSectionsTab] Template URL loaded:', urlData.template_url);
        }
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const handleGenerate = async (sectionKey) => {
    setGeneratingSection(sectionKey);
    try {
      const section = UNIVERSAL_SECTIONS.find((s) => s.section_key === sectionKey);
      const customPrompt = prompts[sectionKey] || section.default_prompt;

      console.log(`[GenerateSectionsTab] Generating section: ${sectionKey}`);
      console.log(`[GenerateSectionsTab] Using template URL: ${templateUrl}`);

      const data = await generateSection(
        draftId,
        sectionKey,
        customPrompt,
        `Generate ${section.section_name.toLowerCase()} content`,
        templateUrl
      );

      if (data.success) {
        setGeneratedSections((prev) => ({
          ...prev,
          [sectionKey]: data.version,
        }));

        if (data.critic_review) {
          setCriticReviews((prev) => ({
            ...prev,
            [sectionKey]: data.critic_review,
          }));
        }

        console.log(
          `[GenerateSectionsTab] Section generated: ${sectionKey}, status: ${data.critic_review?.status}`
        );
      }
    } catch (error) {
      console.error(`Failed to generate section ${sectionKey}:`, error);
      alert(`Failed to generate section: ${error.message}`);
    } finally {
      setGeneratingSection(null);
    }
  };

  const handleRefine = async (sectionKey) => {
    try {
      console.log(`[GenerateSectionsTab] Refining section: ${sectionKey}`);
      const data = await refineSection(
        draftId,
        sectionKey,
        refinementFeedback,
        null,
        templateUrl
      );

      if (data.success) {
        setGeneratedSections((prev) => ({
          ...prev,
          [sectionKey]: data.version,
        }));

        if (data.critic_review) {
          setCriticReviews((prev) => ({
            ...prev,
            [sectionKey]: data.critic_review,
          }));
        }

        setShowRefineModal(null);
        setRefinementFeedback('');
        console.log(`[GenerateSectionsTab] Section refined: ${sectionKey}, v${data.version.version_number}`);
      }
    } catch (error) {
      console.error(`Failed to refine section ${sectionKey}:`, error);
      alert(`Failed to refine section: ${error.message}`);
    }
  };

  const getFilteredSections = () => {
    if (selectedCategory === 'ALL') {
      return UNIVERSAL_SECTIONS;
    }

    const category = Object.values(SECTION_CATEGORIES).find(
      (c) => c.name === selectedCategory
    );
    if (!category) return UNIVERSAL_SECTIONS;

    return UNIVERSAL_SECTIONS.filter((s) => category.sections.includes(s.section_key));
  };

  const getProgressStats = () => {
    const total = UNIVERSAL_SECTIONS.length;
    const generated = Object.keys(generatedSections).length;
    const passed = Object.values(criticReviews).filter((r) => r.critic_status === 'PASS')
      .length;

    return { total, generated, passed };
  };

  const { total, generated, passed } = getProgressStats();

  const getCriticBadge = (sectionKey) => {
    const review = criticReviews[sectionKey];
    if (!review) return null;

    const { critic_status, critic_score } = review;
    const bgColor =
      critic_status === 'PASS' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
    const Icon = critic_status === 'PASS' ? CheckCircleIcon : XCircleIcon;

    return (
      <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${bgColor}`}>
        <Icon className="w-4 h-4 mr-1" />
        {critic_status} ({critic_score}/100)
      </div>
    );
  };

  return (
    <div>
      {/* Progress Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              ✨ Generate Section Content
            </h3>
            <p className="text-sm text-gray-600">
              Click generate on each section to create AI-powered content
            </p>
          </div>
          {!templateUrl && (
            <div className="text-sm text-orange-600">
              ⚠️ Template URL not loaded
            </div>
          )}
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-700">
            {generated}/{total} sections generated • {passed} passed validation
          </span>
          <span className="text-sm font-medium text-blue-600">
            {Math.round((generated / total) * 100)}% complete
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-gradient-to-r from-blue-600 to-purple-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${(generated / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Category Filter */}
      <div className="flex items-center space-x-2 overflow-x-auto mb-6 pb-2">
        <button
          onClick={() => setSelectedCategory('ALL')}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            selectedCategory === 'ALL'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All Sections ({total})
        </button>
        {Object.entries(SECTION_CATEGORIES).map(([key, category]) => (
          <button
            key={key}
            onClick={() => setSelectedCategory(category.name)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              selectedCategory === category.name
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {category.name} ({category.sections.length})
          </button>
        ))}
      </div>

      {/* Sections List */}
      <div className="space-y-4 mb-6">
        {getFilteredSections().map((section) => {
          const hasContent = generatedSections[section.section_key];
          const isGenerating = generatingSection === section.section_key;

          return (
            <div
              key={section.section_key}
              className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <span className="text-3xl">{section.icon}</span>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {section.section_name}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {section.is_required ? 'Required' : 'Optional'} • Section{' '}
                      {section.sort_order}
                    </p>
                  </div>
                </div>
                {hasContent && getCriticBadge(section.section_key)}
              </div>

              {!hasContent ? (
                <button
                  onClick={() => handleGenerate(section.section_key)}
                  disabled={isGenerating || !templateUrl}
                  className="w-full flex items-center justify-center space-x-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <SparklesIcon className="w-5 h-5" />
                  <span>{isGenerating ? 'Generating...' : 'Generate Section'}</span>
                </button>
              ) : (
                <>
                  <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">
                        Generated Content (v{hasContent.version_number})
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(hasContent.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: hasContent.content_html }}
                    />
                  </div>

                  <button
                    onClick={() => setShowRefineModal(section.section_key)}
                    className="w-full px-6 py-3 bg-white border-2 border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-all"
                  >
                    ✏️ Refine Section
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-200">
        <button
          onClick={onBack}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
        >
          ← Back: Edit Prompts
        </button>

        {generated === total && (
          <button
            onClick={onNext}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
          >
            <span>Next: Review & Assemble</span>
            <span>→</span>
          </button>
        )}
      </div>

      {/* Refine Modal */}
      {showRefineModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Refine {UNIVERSAL_SECTIONS.find((s) => s.section_key === showRefineModal)?.section_name}
            </h3>
            <textarea
              value={refinementFeedback}
              onChange={(e) => setRefinementFeedback(e.target.value)}
              rows={4}
              placeholder="e.g., Add more specific legal citations, make it more formal..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 mb-4"
            />
            <div className="flex space-x-3">
              <button
                onClick={() => handleRefine(showRefineModal)}
                disabled={!refinementFeedback.trim()}
                className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                Refine Section
              </button>
              <button
                onClick={() => {
                  setShowRefineModal(null);
                  setRefinementFeedback('');
                }}
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

export default GenerateSectionsTab;
