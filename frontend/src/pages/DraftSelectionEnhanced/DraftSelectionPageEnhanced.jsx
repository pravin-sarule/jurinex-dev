import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeftIcon, ChevronRightIcon, DocumentTextIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import DraftSelectionCard from '../../components/DraftComponents/DraftSelectionCard';
import WordLogo from '../../assets/Wordlogo.svg.png';
import ZohoLogo from '../../assets/zoho-logo-web.png';
import draftApi from '../../services/draftApi';
import { toast } from 'react-toastify';
import { TemplateWizardGallery } from '../../components/TemplateWizard';
import { createDraft, listDrafts, deleteDraft } from '../../services/draftFormApi';
import './styles/enhanced-draft-selection.css';

const DRAFTS_PER_PAGE = 5;

const DraftSelectionPageEnhanced = () => {
  const navigate = useNavigate();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [recentDrafts, setRecentDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(true);
  const [deletingDraftId, setDeletingDraftId] = useState(null);
  const [draftsPage, setDraftsPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoadingDrafts(true);
        const res = await listDrafts(null, 20, 0);
        if (!cancelled && res?.success && Array.isArray(res.drafts)) {
          setRecentDrafts(res.drafts);
        }
      } catch {
        if (!cancelled) setRecentDrafts([]);
      } finally {
        if (!cancelled) setLoadingDrafts(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const draftOptions = [
    {
      id: 'google-docs',
      title: 'Google Docs',
      description: 'Create and edit documents with Google Docs integration. Collaborate in real-time with cloud storage.',
      icon: 'google',
      iconBgColor: '#4285F4',
      route: '/drafts?platform=google-docs',
      disabled: false
    },
    {
      id: 'microsoft-word',
      title: 'Microsoft Word',
      description: 'Use Microsoft Word for professional document drafting. Full Office 365 integration available.',
      icon: 'microsoft',
      iconBgColor: '#2B579A',
      logo: WordLogo,
      route: '/drafting?platform=microsoft-word',
      disabled: false
    },
    {
      id: 'template-based',
      title: 'Zoho Office',
      description: 'Start with pre-built legal templates and customize them to your needs.',
      icon: 'template',
      iconBgColor: '#9C27B0',
      logo: ZohoLogo,
      logoSize: 'large',
      route: '/draft/zoho-office',
      disabled: false
    }
  ];

  const handleMicrosoftWordClick = async () => {
    try {
      setIsConnecting(true);
      
      const connectionStatus = await draftApi.getMicrosoftStatus();
      
      if (connectionStatus.isConnected) {
        navigate('/draft/microsoft-word');
      } else {
        await draftApi.signInWithMicrosoft();
      }
    } catch (error) {
      console.error('Error connecting to Microsoft Word:', error);
      toast.error('Failed to connect to Microsoft Office. Please try again.');
      setIsConnecting(false);
    }
  };

  const handleCardClick = (option) => {
    if (option.id === 'microsoft-word') {
      handleMicrosoftWordClick();
    } else {
      navigate(option.route);
    }
  };

  const handleDeleteDraft = async (e, draftId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    try {
      setDeletingDraftId(draftId);
      await deleteDraft(draftId);
      setRecentDrafts((prev) => prev.filter((d) => d.draft_id !== draftId));
      setDraftsPage((p) => {
        const nextCount = recentDrafts.length - 1;
        const totalPages = Math.max(1, Math.ceil(nextCount / DRAFTS_PER_PAGE));
        return p > totalPages ? totalPages : p;
      });
      toast.success('Draft deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete draft');
    } finally {
      setDeletingDraftId(null);
    }
  };

  const draftsPagination = useMemo(() => {
    const total = recentDrafts.length;
    const totalPages = Math.max(1, Math.ceil(total / DRAFTS_PER_PAGE));
    const page = Math.min(Math.max(1, draftsPage), totalPages);
    const start = (page - 1) * DRAFTS_PER_PAGE;
    const paginatedDrafts = recentDrafts.slice(start, start + DRAFTS_PER_PAGE);
    return { paginatedDrafts, page, totalPages, total };
  }, [recentDrafts, draftsPage]);

  const handleTemplateClick = async (template) => {
    const templateId = template.id ?? template.template_id;
    const templateName = template.name ?? template.title;
    if (!templateId) return;
    try {
      setIsCreatingDraft(true);
      // Always create a new draft from the gallery so the user gets a clean form (no case, no field values).
      // Use "Recent drafts" to continue an existing draft.
      const res = await createDraft(templateId, templateName ? `${templateName} - Draft` : '');
      const draftId = res?.draft?.draft_id;
      if (draftId) {
        navigate(`/draft-form/${draftId}`);
      } else {
        toast.error('Draft created but no draft ID returned.');
      }
    } catch (error) {
      console.error('Error opening template:', error);
      toast.error(error.message || 'Failed to open template. Please try again.');
    } finally {
      setIsCreatingDraft(false);
    }
  };

  // Default view: cards + template gallery
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Document Drafting
          </h1>
          <p className="text-gray-600 text-sm">
            Select the platform you prefer to create and manage your legal documents
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
          {draftOptions.map((option) => (
            <DraftSelectionCard
              key={option.id}
              title={option.title}
              description={option.description}
              icon={option.icon}
              iconBgColor={option.iconBgColor}
              logo={option.logo}
              logoSize={option.logoSize}
              onClick={() => handleCardClick(option)}
              disabled={option.disabled || (option.id === 'microsoft-word' && isConnecting)}
            />
          ))}
        </div>

        {/* Template Gallery – fetches from agent-draft API and shows preview images */}
        <div className="mb-10 p-6 sm:p-8 rounded-2xl bg-white border border-gray-200/80 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Template Gallery
              </h2>
              <p className="text-gray-600 text-sm mt-1">
                Browse and select from our collection of legal document templates
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/draft-selection/templates')}
              className="inline-flex items-center text-sm font-medium text-[#21C1B6] hover:text-[#1AA49B] focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#21C1B6] rounded-md transition-colors"
            >
              See all
            </button>
          </div>
          <TemplateWizardGallery onTemplateClick={handleTemplateClick} />
        </div>

        {/* Recent drafts – latest drafts (reuse instead of creating new every time) */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Recent drafts
          </h2>
          <p className="text-gray-600 text-sm mb-4">
            Your recent drafts. Open any to continue editing. Choosing a template above starts a new, clean draft.
          </p>
          {loadingDrafts ? (
            <div className="flex items-center gap-2 text-gray-500 py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-[#21C1B6] border-t-transparent" />
              <span>Loading recent drafts…</span>
            </div>
          ) : recentDrafts.length === 0 ? (
            <p className="text-gray-500 py-4">No drafts yet. Select a template above to start; edits are stored automatically.</p>
          ) : (
            <>
              <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white overflow-hidden">
                {draftsPagination.paginatedDrafts.map((d) => (
                  <li key={d.draft_id} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/draft-form/${d.draft_id}`)}
                      className="flex items-center gap-3 flex-1 min-w-0 p-4 text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[#21C1B6]/10 flex items-center justify-center">
                        <DocumentTextIcon className="w-5 h-5 text-[#21C1B6]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 truncate">
                          {d.draft_title || d.template_name || 'Untitled draft'}
                        </p>
                        <p className="text-sm text-gray-500 truncate">{d.template_name}</p>
                      </div>
                      {d.updated_at && (
                        <p className="text-sm text-gray-400 flex-shrink-0">
                          Updated {new Date(d.updated_at).toLocaleDateString()}
                        </p>
                      )}
                      <PencilSquareIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteDraft(e, d.draft_id)}
                      disabled={deletingDraftId === d.draft_id}
                      className="flex-shrink-0 p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                      title="Delete draft"
                      aria-label="Delete draft"
                    >
                      {deletingDraftId === d.draft_id ? (
                        <span className="inline-block w-5 h-5 border-2 border-[#21C1B6] border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <TrashIcon className="w-5 h-5" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {draftsPagination.totalPages > 1 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-gray-500">
                    Showing {((draftsPagination.page - 1) * DRAFTS_PER_PAGE) + 1}–{Math.min(draftsPagination.page * DRAFTS_PER_PAGE, draftsPagination.total)} of {draftsPagination.total} drafts
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDraftsPage((p) => Math.max(1, p - 1))}
                      disabled={draftsPagination.page <= 1}
                      className="inline-flex items-center gap-1.5 py-2 px-3 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#21C1B6]"
                      aria-label="Previous page"
                    >
                      <ChevronLeftIcon className="w-4 h-4" />
                      Previous
                    </button>
                    <span className="text-sm text-gray-600 font-medium px-2">
                      Page {draftsPagination.page} of {draftsPagination.totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setDraftsPage((p) => Math.min(draftsPagination.totalPages, p + 1))}
                      disabled={draftsPagination.page >= draftsPagination.totalPages}
                      className="inline-flex items-center gap-1.5 py-2 px-3 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#21C1B6]"
                      aria-label="Next page"
                    >
                      Next
                      <ChevronRightIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        
        {(isConnecting || isCreatingDraft) && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-8 text-center max-w-md">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#21C1B6] mx-auto mb-4"></div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {isCreatingDraft ? 'Opening template...' : 'Connecting to Microsoft Word'}
              </h3>
              <p className="text-gray-600">
                {isCreatingDraft ? 'Creating your draft and loading the form.' : 'Please wait while we redirect you to Microsoft Office...'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DraftSelectionPageEnhanced;
