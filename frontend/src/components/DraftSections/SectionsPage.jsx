import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { UNIVERSAL_SECTIONS, SECTION_CATEGORIES } from '../../config/universalSections';
import SectionCard from './SectionCard';
import { generateSection, refineSection, getAllSections } from '../../services/sectionApi';

/**
 * SectionsPage Component
 * 
 * Step 3 of the draft form: Template Sections
 * Displays all 23 universal sections with generation and refinement capabilities
 */
const SectionsPage = () => {
  const { draftId } = useParams();
  const [generatedSections, setGeneratedSections] = useState({});
  const [criticReviews, setCriticReviews] = useState({});
  const [generatingSection, setGeneratingSection] = useState(null);
  const [refiningSection, setRefiningSection] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // Load existing sections for this draft
  useEffect(() => {
    if (draftId) {
      loadSections();
    }
  }, [draftId]);

  const loadSections = async () => {
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
      console.error('Failed to load sections:', error);
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

  const getFilteredSections = () => {
    if (selectedCategory === 'ALL') {
      return UNIVERSAL_SECTIONS;
    }
    
    const category = Object.values(SECTION_CATEGORIES).find((c) => c.name === selectedCategory);
    if (!category) return UNIVERSAL_SECTIONS;
    
    return UNIVERSAL_SECTIONS.filter((s) => category.sections.includes(s.section_key));
  };

  const getProgressStats = () => {
    const total = UNIVERSAL_SECTIONS.length;
    const generated = Object.keys(generatedSections).length;
    const passed = Object.values(criticReviews).filter((r) => r.critic_status === 'PASS').length;
    
    return { total, generated, passed };
  };

  const { total, generated, passed } = getProgressStats();

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Template Sections</h1>
        <p className="text-gray-600">
          Generate each section of your legal document. Edit prompts to customize the content.
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
            style={{ width: `${(generated / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Category Filter */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex items-center space-x-2 overflow-x-auto">
          <button
            onClick={() => setSelectedCategory('ALL')}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
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
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                selectedCategory === category.name
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {category.name} ({category.sections.length})
            </button>
          ))}
        </div>
      </div>

      {/* Sections List */}
      <div className="space-y-4">
        {getFilteredSections().map((section) => (
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
      {generated === total && (
        <div className="mt-8 bg-green-50 rounded-lg border border-green-200 p-6">
          <h3 className="text-lg font-semibold text-green-900 mb-2">
            🎉 All Sections Generated!
          </h3>
          <p className="text-green-700 mb-4">
            You've generated all {total} sections. Review them and click "Assemble Document" to
            create your final legal document.
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
