import React, { useState, useEffect } from 'react';
import { UNIVERSAL_SECTIONS, SECTION_CATEGORIES } from '../../config/universalSections';
import { saveSectionPrompts, getSectionPrompts } from '../../services/sectionApi';
import { CheckIcon, PencilIcon } from '@heroicons/react/24/outline';

/**
 * EditPromptsTab Component
 * 
 * Tab 1: Edit Prompts
 * - Shows all 23 sections
 * - User can edit prompt for each section
 * - Saves edited prompts to DB (draft metadata)
 * - Shows which prompts are customized
 */
const EditPromptsTab = ({ draftId, draft, onNext }) => {
  const [prompts, setPrompts] = useState({});
  const [editingSection, setEditingSection] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  useEffect(() => {
    loadSavedPrompts();
  }, [draftId]);

  const loadSavedPrompts = async () => {
    try {
      const data = await getSectionPrompts(draftId);
      if (data.success && data.prompts) {
        setPrompts(data.prompts);
      } else {
        // Initialize with default prompts
        const defaultPrompts = {};
        UNIVERSAL_SECTIONS.forEach((section) => {
          defaultPrompts[section.section_key] = section.default_prompt;
        });
        setPrompts(defaultPrompts);
      }
    } catch (error) {
      console.error('Failed to load prompts:', error);
      // Initialize with defaults on error
      const defaultPrompts = {};
      UNIVERSAL_SECTIONS.forEach((section) => {
        defaultPrompts[section.section_key] = section.default_prompt;
      });
      setPrompts(defaultPrompts);
    }
  };

  const handlePromptChange = (sectionKey, newPrompt) => {
    setPrompts((prev) => ({
      ...prev,
      [sectionKey]: newPrompt,
    }));
  };

  const handleSavePrompts = async () => {
    setSaving(true);
    try {
      await saveSectionPrompts(draftId, prompts);
      console.log('[EditPromptsTab] Prompts saved successfully');
      alert('Prompts saved successfully!');
    } catch (error) {
      console.error('Failed to save prompts:', error);
      alert('Failed to save prompts. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isPromptCustomized = (sectionKey) => {
    const section = UNIVERSAL_SECTIONS.find((s) => s.section_key === sectionKey);
    return prompts[sectionKey] !== section?.default_prompt;
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

  const getCustomizedCount = () => {
    return Object.keys(prompts).filter((key) => isPromptCustomized(key)).length;
  };

  return (
    <div>
      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">
          ✏️ Customize Generation Prompts
        </h3>
        <p className="text-blue-800 text-sm">
          Review and edit the prompts for each section. These prompts will be used to generate
          section content with AI. You can customize them to match your specific requirements.
        </p>
        <div className="mt-3 flex items-center space-x-4 text-sm text-blue-700">
          <div>📝 {getCustomizedCount()} / {UNIVERSAL_SECTIONS.length} prompts customized</div>
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
          All Sections ({UNIVERSAL_SECTIONS.length})
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
        {getFilteredSections().map((section) => (
          <div
            key={section.section_key}
            className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{section.icon}</span>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {section.section_name}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {section.is_required ? 'Required' : 'Optional'} • Section {section.sort_order}
                  </p>
                </div>
              </div>
              {isPromptCustomized(section.section_key) && (
                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  <PencilIcon className="w-3 h-3 mr-1" />
                  Customized
                </span>
              )}
            </div>

            <div className="relative">
              <textarea
                value={prompts[section.section_key] || section.default_prompt}
                onChange={(e) => handlePromptChange(section.section_key, e.target.value)}
                onFocus={() => setEditingSection(section.section_key)}
                onBlur={() => setEditingSection(null)}
                rows={editingSection === section.section_key ? 6 : 3}
                className={`w-full px-3 py-2 border rounded-lg text-sm transition-all ${
                  editingSection === section.section_key
                    ? 'border-blue-500 ring-2 ring-blue-200 bg-white'
                    : 'border-gray-300 bg-gray-50 hover:bg-white'
                }`}
                placeholder="Enter generation prompt for this section..."
              />
              {editingSection === section.section_key && (
                <div className="absolute bottom-2 right-2 text-xs text-gray-500">
                  Editing...
                </div>
              )}
            </div>

            {isPromptCustomized(section.section_key) && (
              <button
                onClick={() =>
                  handlePromptChange(section.section_key, section.default_prompt)
                }
                className="mt-2 text-sm text-blue-600 hover:text-blue-700"
              >
                Reset to default
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-6 border-t border-gray-200">
        <button
          onClick={handleSavePrompts}
          disabled={saving}
          className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <CheckIcon className="w-5 h-5" />
          <span>{saving ? 'Saving...' : 'Save All Prompts'}</span>
        </button>

        <button
          onClick={onNext}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Next: Generate Sections →
        </button>
      </div>
    </div>
  );
};

export default EditPromptsTab;
