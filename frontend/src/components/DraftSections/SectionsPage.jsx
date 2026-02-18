import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import SectionCard from './SectionCard';
import { generateSection, refineSection, getAllSections } from '../../services/sectionApi';
import { draftApi } from '../../template_drafting_component/services';

/**
 * SectionsPage Component
 *
 * Loads sections from dt_draft_section_prompts only (configured by users in Configure Sections).
 * No universal catalog: display and generation use only what the user selected/configured.
 */
const SectionsPage = () => {
  const { draftId } = useParams();
  const [draftSections, setDraftSections] = useState([]);
  const [generatedSections, setGeneratedSections] = useState({});
  const [criticReviews, setCriticReviews] = useState({});
  const [generatingSection, setGeneratingSection] = useState(null);
  const [refiningSection, setRefiningSection] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load ONLY the sections that user configured in Configure Sections step
  useEffect(() => {
    const loadConfiguredSections = async () => {
      if (!draftId) return;

      try {
        setLoading(true);
        console.log('[SectionsPage] Loading configured sections for draft:', draftId);

        // Fetch sections from dt_draft_section_prompts table
        // This contains ONLY the sections user configured in Configure Sections step
        const sectionPrompts = await draftApi.getSectionPrompts(draftId);

        console.log('[SectionsPage] Raw section prompts from API:', sectionPrompts);

        if (!Array.isArray(sectionPrompts)) {
          console.warn('[SectionsPage] Section prompts is not an array:', sectionPrompts);
          setDraftSections([]);
          return;
        }

        // Filter out deleted sections and map to our section structure
        const configuredSections = sectionPrompts
          .filter(prompt => !prompt.is_deleted) // Only active sections
          .map((prompt, index) => ({
            section_key: prompt.section_id,
            section_name: prompt.section_name || 'Untitled Section',
            default_prompt: prompt.custom_prompt || '',
            section_purpose: prompt.section_type || '',
            detail_level: prompt.detail_level || 'concise',
            language: prompt.language || 'en',
            sort_order: prompt.sort_order ?? index,
            is_required: true
          }))
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

        console.log('[SectionsPage] Configured sections:', configuredSections.length, configuredSections);
        setDraftSections(configuredSections);

      } catch (error) {
        console.error('[SectionsPage] Failed to load configured sections:', error);
        setDraftSections([]);
      } finally {
        setLoading(false);
      }
    };

    loadConfiguredSections();
  }, [draftId]);

  // Load existing generated sections for this draft
  useEffect(() => {
    if (draftId) {
      loadGeneratedSections();
    }
  }, [draftId]);

  const loadGeneratedSections = async () => {
    try {
      const data = await getAllSections(draftId);
      if (data.success) {
        const sectionsMap = {};
        const reviewsMap = {};

        data.sections.forEach((section) => {
          sectionsMap[section.section_key] = section;
          // Get latest review from generation metadata
          if (section.generation_metadata?.critic) {
            reviewsMap[section.section_key] = section.generation_metadata.critic;
          }
        });

        setGeneratedSections(sectionsMap);
        setCriticReviews(reviewsMap);
      }
    } catch (error) {
      console.error('[SectionsPage] Failed to load generated sections:', error);
    }
  };

  const handleGenerate = async (sectionKey, prompt, ragQuery) => {
    setGeneratingSection(sectionKey);
    try {
      console.log(`[SectionsPage] Generating section: ${sectionKey}`);
      const data = await generateSection(draftId, sectionKey, prompt, ragQuery);

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

        console.log(`[SectionsPage] Section generated: ${sectionKey}, status: ${data.critic_review?.status}`);
      }
    } catch (error) {
      console.error(`Failed to generate section ${sectionKey}:`, error);
      alert(`Failed to generate section: ${error.message}`);
    } finally {
      setGeneratingSection(null);
    }
  };

  const handleRefine = async (sectionKey, feedback, ragQuery) => {
    setRefiningSection(sectionKey);
    try {
      console.log(`[SectionsPage] Refining section: ${sectionKey}`);
      const data = await refineSection(draftId, sectionKey, feedback, ragQuery);

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

        console.log(`[SectionsPage] Section refined: ${sectionKey}, version: v${data.version.version_number}`);
      }
    } catch (error) {
      console.error(`Failed to refine section ${sectionKey}:`, error);
      alert(`Failed to refine section: ${error.message}`);
    } finally {
      setRefiningSection(null);
    }
  };

  const getProgressStats = () => {
    const total = draftSections.length;
    const generated = Object.keys(generatedSections).length;
    const passed = Object.values(criticReviews).filter((r) => r.critic_status === 'PASS').length;

    return { total, generated, passed };
  };

  const { total, generated, passed } = getProgressStats();

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your configured sections...</p>
        </div>
      </div>
    );
  }

  if (draftSections.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="text-center">
          <p className="text-gray-600 mb-4">No sections configured for this draft.</p>
          <p className="text-sm text-gray-500">
            Please go back to the "Configure Sections" step to select which sections you want to generate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Draft Sections</h1>
        <p className="text-gray-600">
          Generate each section of your legal document. These are the sections you configured in the previous step.
        </p>
      </div>

      {/* Progress Bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Generation Progress</h2>
          <div className="text-sm text-gray-600">
            {generated}/{total} sections generated • {passed} passed validation
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-gradient-to-r from-blue-600 to-purple-600 h-3 rounded-full transition-all duration-300"
            style={{ width: `${total > 0 ? (generated / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Sections List */}
      <div className="space-y-4">
        {draftSections.map((section, index) => (
          <SectionCard
            key={section.section_key}
            section={section}
            generatedVersion={generatedSections[section.section_key]}
            criticReview={criticReviews[section.section_key]}
            onGenerate={handleGenerate}
            onRefine={handleRefine}
            isGenerating={generatingSection === section.section_key}
            isRefining={refiningSection === section.section_key}
          />
        ))}
      </div>

      {/* Next Steps */}
      {generated === total && total > 0 && (
        <div className="mt-8 bg-green-50 rounded-lg border border-green-200 p-6">
          <h3 className="text-lg font-semibold text-green-900 mb-2">
            🎉 All Sections Generated!
          </h3>
          <p className="text-green-700 mb-4">
            You've generated all {total} sections. Review them and proceed to assemble your final document.
          </p>
          <button className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium">
            Assemble Final Document
          </button>
        </div>
      )}
    </div>
  );
};

export default SectionsPage;
