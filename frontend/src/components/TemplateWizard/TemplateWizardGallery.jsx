import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { DocumentTextIcon } from '@heroicons/react/24/solid';
import { fetchTemplates } from './templateWizardApi';
import TemplateWizardCard from './TemplateWizardCard';
import TemplatePreviewPopup from './TemplatePreviewPopup';
import './TemplateWizardGallery.css';

/**
 * Template Gallery: horizontal cards (uniform size, name below, no category).
 * Each card has a preview icon on the right; clicking it opens preview in a popup.
 * Clicking the card uses the template (opens draft).
 */
const TemplateWizardGallery = ({ onTemplateClick }) => {
  const [templates, setTemplates] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(null);
  const scrollContainerRef = useRef(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetchTemplates({
          category: '',
          is_active: true,
          limit: 50,
          offset: 0,
          include_preview_url: true,
        });
        if (!cancelled && res?.success && Array.isArray(res.templates)) {
          setTemplates(res.templates);
        } else if (!cancelled) {
          setTemplates([]);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load templates');
          setTemplates([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const checkScrollButtons = () => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setShowLeftArrow(scrollLeft > 0);
    setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
  };

  useEffect(() => {
    checkScrollButtons();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', checkScrollButtons);
      window.addEventListener('resize', checkScrollButtons);
      return () => {
        container.removeEventListener('scroll', checkScrollButtons);
        window.removeEventListener('resize', checkScrollButtons);
      };
    }
  }, [templates]);

  const scroll = (direction) => {
    if (!scrollContainerRef.current) return;
    const scrollAmount = 200;
    const currentScroll = scrollContainerRef.current.scrollLeft;
    scrollContainerRef.current.scrollTo({
      left: currentScroll + (direction === 'right' ? scrollAmount : -scrollAmount),
      behavior: 'smooth',
    });
  };

  const handleCardClick = (template) => {
    const normalized = {
      ...template,
      id: template.template_id || template.id,
    };
    onTemplateClick?.(normalized);
  };

  const handlePreviewClick = (template) => {
    setPreviewTemplate(template);
  };

  if (isLoading) {
    return (
      <div className="template-wizard-gallery template-wizard-gallery--loading">
        <div className="template-wizard-gallery__scroll">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="template-wizard-gallery__skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="template-wizard-gallery template-wizard-gallery__empty">
        <DocumentTextIcon className="template-wizard-gallery__empty-icon" />
        <p className="text-gray-600">{error}</p>
      </div>
    );
  }

  if (!templates.length) {
    return (
      <div className="template-wizard-gallery template-wizard-gallery__empty">
        <DocumentTextIcon className="template-wizard-gallery__empty-icon" />
        <p className="text-gray-600">No templates available at the moment.</p>
      </div>
    );
  }

  return (
    <>
      <div className="template-wizard-gallery template-wizard-gallery--has-items">
        {showLeftArrow && (
          <button
            type="button"
            onClick={() => scroll('left')}
            className="template-wizard-gallery__arrow template-wizard-gallery__arrow--left"
            aria-label="Scroll left"
          >
            <ChevronLeftIcon className="w-6 h-6 text-gray-700" />
          </button>
        )}

        <div
          ref={scrollContainerRef}
          className="template-wizard-gallery__scroll template-wizard-gallery__scroll--hide-bar"
        >
          {templates.map((template) => (
            <TemplateWizardCard
              key={template.template_id || template.id}
              template={template}
              onClick={handleCardClick}
              onPreviewClick={handlePreviewClick}
            />
          ))}
        </div>

        {showRightArrow && (
          <button
            type="button"
            onClick={() => scroll('right')}
            className="template-wizard-gallery__arrow template-wizard-gallery__arrow--right"
            aria-label="Scroll right"
          >
            <ChevronRightIcon className="w-6 h-6 text-gray-700" />
          </button>
        )}
      </div>

      {/* Preview popup — only when user clicks the preview icon on a card */}
      <TemplatePreviewPopup
        template={previewTemplate}
        onClose={() => setPreviewTemplate(null)}
      />
    </>
  );
};

export default TemplateWizardGallery;
