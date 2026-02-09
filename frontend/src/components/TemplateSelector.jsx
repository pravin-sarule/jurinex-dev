import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import Templates from './Templates';
import ApiService from "../services/api";

const TemplateSelector = ({ onSelectTemplate, selectedTemplateId, showToast }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);


  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getDraftingTemplates();
      setTemplates(Array.isArray(data) ? data : []);
      showToast('Templates loaded successfully', 'success');
    } catch (error) {
      console.error('API Error fetching templates:', error);
      showToast(error.message || 'Error loading templates', 'error');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-gray-800 mb-3">Available Templates</h3>
      {loading ? (
        <div className="flex items-center justify-center py-4 col-span-2">
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
        </div>
      ) : templates.length > 0 ? (
        <Templates templates={templates} onSelectTemplate={onSelectTemplate} selectedTemplateId={selectedTemplateId} />
      ) : (
        <p className="text-sm text-gray-500 text-center py-4 col-span-2">
          No templates available
        </p>
      )}
    </div>
  );
};

export default TemplateSelector;