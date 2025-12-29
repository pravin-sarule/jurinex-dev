import React, { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, FolderOpen, Calendar, FileEdit, Trash2 } from 'lucide-react';
import { FileManagerContext } from '../context/FileManagerContext';
import CreateFolderModal from '../components/FolderBrowser/CreateFolderModal';
import CaseCreationFlow from './CreateCase/CaseCreationFlow';
import { CONTENT_SERVICE_DIRECT } from '../config/apiConfig';

const getUserIdFromToken = () => {
  try {
    const token = localStorage.getItem('token') || 
                  localStorage.getItem('authToken') || 
                  localStorage.getItem('access_token') || 
                  localStorage.getItem('jwt');
    if (!token) return null;
    
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4);
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded);
    
    const userId = parsed.id || parsed.userId || parsed.user_id || parsed.sub;
    const userIdInt = parseInt(userId, 10);
    return isNaN(userIdInt) || userIdInt <= 0 ? null : userIdInt;
  } catch (error) {
    console.error('Error extracting user ID:', error);
    return null;
  }
};

const DocumentUploadPage = () => {
  const { folders, loadFoldersAndFiles, createFolder, loading, error } = useContext(FileManagerContext);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('activity');
  const [filterBy, setFilterBy] = useState('all');
  const [showCaseFlow, setShowCaseFlow] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [caseData, setCaseData] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [draftData, setDraftData] = useState(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [openDraftDirectly, setOpenDraftDirectly] = useState(false);
  const foldersPerPage = 6;
  const navigate = useNavigate();

  useEffect(() => {
    loadFoldersAndFiles();
    loadDraft();
  }, [loadFoldersAndFiles]);

  const loadDraft = async () => {
    const userId = getUserIdFromToken();
    if (!userId) return;

    setLoadingDraft(true);
    try {
      const token = localStorage.getItem('token') || 
                    localStorage.getItem('authToken') || 
                    localStorage.getItem('access_token') || 
                    localStorage.getItem('jwt');
      
      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/case-draft/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 404) {
        setDraftData(null);
        return;
      }

      if (response.ok) {
        const result = await response.json();
        const parsedDraft = {
          ...result,
          draft_data: typeof result.draft_data === 'string' 
            ? JSON.parse(result.draft_data) 
            : result.draft_data
        };
        setDraftData(parsedDraft);
      }
    } catch (error) {
      console.error('Error loading draft:', error);
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleStartCaseFlow = () => {
    setOpenDraftDirectly(false);
    setShowCaseFlow(true);
  };

  const handleDraftClick = () => {
    setOpenDraftDirectly(true);
    setShowCaseFlow(true);
  };

  const handleDeleteDraft = async (e) => {
    e.stopPropagation();
    
    const confirmDelete = window.confirm('Are you sure you want to delete this draft? This action cannot be undone.');
    if (!confirmDelete) return;

    try {
      const token = localStorage.getItem('token') || 
                    localStorage.getItem('authToken') || 
                    localStorage.getItem('access_token') || 
                    localStorage.getItem('jwt_token');
      if (!token) {
        console.error('No auth token found');
        return;
      }

      const userId = getUserIdFromToken();
      if (!userId) {
        console.error('Could not extract user ID from token');
        return;
      }

      const response = await fetch(`${CONTENT_SERVICE_DIRECT}/case-draft/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        console.log('✅ Draft deleted successfully');
        loadDraft();
      } else {
        console.error('Failed to delete draft:', response.statusText);
        alert('Failed to delete draft. Please try again.');
      }
    } catch (error) {
      console.error('Error deleting draft:', error);
      alert('An error occurred while deleting the draft.');
    }
  };

  // const handleCaseFlowComplete = (data) => {
  //   setCaseData(data);
  //   setShowCaseFlow(false);
  //   setIsCreatingFolder(true);
  //   loadDraft();
  // };
 
 
  const handleCaseFlowComplete = (data) => {
    // Generate case name from petitioners vs respondents
    let caseName = data.caseTitle;
    
    if (!caseName || caseName === "Untitled Case") {
      const petitionerNames = data.petitioners && data.petitioners.length > 0
        ? data.petitioners.map(p => p.fullName).filter(Boolean)
        : [];
      
      const respondentNames = data.respondents && data.respondents.length > 0
        ? data.respondents.map(r => r.fullName).filter(Boolean)
        : [];
  
      if (petitionerNames.length > 0 && respondentNames.length > 0) {
        const petitionerPart = petitionerNames.length === 1
          ? petitionerNames[0]
          : `${petitionerNames[0]} & ${petitionerNames.length - 1} Other${petitionerNames.length - 1 > 1 ? 's' : ''}`;
        
        const respondentPart = respondentNames.length === 1
          ? respondentNames[0]
          : `${respondentNames[0]} & ${respondentNames.length - 1 > 1 ? 's' : ''}`;
        
        caseName = `${petitionerPart} vs ${respondentPart}`;
      } else if (petitionerNames.length > 0) {
        caseName = `${petitionerNames[0]} (Petitioner)`;
      } else if (respondentNames.length > 0) {
        caseName = `${respondentNames[0]} (Respondent)`;
      } else {
        caseName = "Untitled Case";
      }
    }
    
    setCaseData({ ...data, caseTitle: caseName });
    setShowCaseFlow(false);
    setIsCreatingFolder(true);
    loadDraft();
  };

  const handleCreateFolder = async (folderName) => {
    await createFolder(folderName);
    setIsCreatingFolder(false);
    setCaseData(null);
    navigate(`/documents/${folderName}`);
  };

  const handleProjectClick = (folderName) => navigate(`/documents/${folderName}`);

  const sorted = [...folders].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  const filtered = sorted.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  
  const shouldShowDraft = filterBy === 'all' || filterBy === 'drafts';
  const shouldShowProjects = filterBy === 'all' || filterBy === 'projects';
  const projectsToShow = shouldShowProjects ? filtered : [];

  const totalPages = Math.ceil(projectsToShow.length / foldersPerPage);
  const indexOfLastFolder = currentPage * foldersPerPage;
  const indexOfFirstFolder = indexOfLastFolder - foldersPerPage;
  const currentFolders = projectsToShow.slice(indexOfFirstFolder, indexOfLastFolder);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (showCaseFlow) {
    return (
      <CaseCreationFlow
        onComplete={handleCaseFlowComplete}
        onCancel={() => {
          setShowCaseFlow(false);
          setOpenDraftDirectly(false);
          loadDraft();
        }}
        skipDraftPrompt={openDraftDirectly}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Projects</h1>
            <p className="text-gray-600 text-sm">Manage and organize your case files</p>
          </div>
          <button
            onClick={handleStartCaseFlow}
            className="flex items-center gap-2 text-white font-semibold px-4 py-2 rounded-lg shadow-lg transition-all duration-200 hover:shadow-xl transform hover:-translate-y-0.5"
            style={{ backgroundColor: '#21C1B6' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
          >
            <Plus className="w-4 h-4" />
            Create New Case
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-8">
          <div className="flex flex-col md:flex-row gap-4">

            <div className="relative flex-grow">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent bg-gray-50 transition-all text-black"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-700 font-medium text-sm whitespace-nowrap">Filter by</span>
              <select
                value={filterBy}
                onChange={(e) => {
                  setFilterBy(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent cursor-pointer transition-all text-black"
              >
                <option value="all">All</option>
                <option value="drafts">Drafts</option>
                <option value="projects">Projects</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-700 font-medium text-sm whitespace-nowrap">Sort by</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent cursor-pointer transition-all text-black"
              >
                <option value="activity">Recent Activity</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-3">
              <FolderOpen className="w-8 h-8 text-gray-400 animate-pulse" />
            </div>
            <p className="text-gray-600 font-medium">Loading projects...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-50 rounded-full mb-3">
              <FolderOpen className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Error Loading Projects</h3>
            <p className="text-red-600">{error}</p>
          </div>
        ) : (!shouldShowDraft || !draftData || !draftData.draft_data) && projectsToShow.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-3">
              <FolderOpen className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {filterBy === 'drafts' ? 'No drafts found' : filterBy === 'projects' ? 'No projects found' : 'No items found'}
            </h3>
            <p className="text-gray-600 mb-4">
              {searchQuery ? 'Try adjusting your search terms' : 'Get started by creating your first case'}
            </p>
            {!searchQuery && (
              <button
                onClick={handleStartCaseFlow}
                className="inline-flex items-center gap-2 text-white font-semibold px-4 py-2 rounded-lg shadow-md transition-all duration-200"
                style={{ backgroundColor: '#21C1B6' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#1AA49B')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#21C1B6')}
              >
                <Plus className="w-4 h-4" />
                Create Your First Case
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shouldShowDraft && draftData && draftData.draft_data && (
                <div
                  key="draft-folder"
                  className="group bg-gradient-to-br from-teal-50 to-cyan-50 border-2 border-[#21C1B6] rounded-lg p-4 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer transform hover:-translate-y-1 relative"
                  onClick={handleDraftClick}
                >
                  <div className="absolute top-2 right-2 flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[#21C1B6] text-white">
                      Draft
                    </span>
                    <button
                      onClick={handleDeleteDraft}
                      className="p-1.5 rounded-md bg-red-100 text-red-600 hover:bg-red-200 hover:text-red-700 transition-all duration-200 opacity-0 group-hover:opacity-100"
                      title="Delete draft"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-md transition-all duration-200"
                      style={{ backgroundColor: '#E6F9F7' }}
                    >
                      <FileEdit
                        className="w-5 h-5 transition-all duration-200"
                        style={{ color: '#21C1B6' }}
                      />
                    </div>
                  </div>

                  <h3 className="text-base font-semibold text-gray-900 mb-2 group-hover:text-[#21C1B6] transition-colors break-words">
                    {draftData.draft_data.caseTitle || 'Untitled Case Draft'}
                  </h3>

                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <Calendar className="w-3 h-3" />
                    <span>
                      Updated{' '}
                      {draftData.updated_at
                        ? new Date(draftData.updated_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : '—'}
                    </span>
                  </div>
                </div>
              )}
              
              {currentFolders.map((folder) => (
                <div
                  key={folder.id}
                  className="group bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer transform hover:-translate-y-1"
                  onClick={() => handleProjectClick(folder.name)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className="flex items-center justify-center w-10 h-10 rounded-md transition-all duration-200"
                      style={{ backgroundColor: '#E6F9F7' }}
                    >
                      <FolderOpen
                        className="w-5 h-5 transition-all duration-200"
                        style={{ color: '#21C1B6' }}
                      />
                    </div>
                  </div>

                  <h3 className="text-base font-semibold text-gray-900 mb-2 group-hover:text-[#21C1B6] transition-colors break-words">
                    {folder.name}
                  </h3>

                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Calendar className="w-3 h-3" />
                    <span>
                      Updated{' '}
                      {folder.created_at
                        ? new Date(folder.created_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-2 mt-6">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-sm rounded-md border border-gray-300 bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Previous
                </button>
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => handlePageChange(page)}
                    className={`px-3 py-1 text-sm rounded-md border border-gray-300 ${
                      currentPage === page
                        ? 'bg-[#21C1B6] text-white'
                        : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {page}
                  </button>
                ))}
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 text-sm rounded-md border border-gray-300 bg-gray-50 text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {filtered.length > 0 && (
          <div className="mt-6 text-center text-gray-600 text-sm">
            Showing {indexOfFirstFolder + 1}–{Math.min(indexOfLastFolder, filtered.length)} of {filtered.length} project
            {filtered.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      <CreateFolderModal
        isOpen={isCreatingFolder}
        onClose={() => {
          setIsCreatingFolder(false);
          setCaseData(null);
        }}
        onCreate={handleCreateFolder}
        initialName={caseData?.caseTitle || ''}
      />
    </div>
  );
};

export default DocumentUploadPage;
