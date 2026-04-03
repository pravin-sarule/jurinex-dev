//     // TODO: Call API to save star state if needed





























          

























  
























import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { FileManagerContext } from "../context/FileManagerContext";
import documentApi from "../services/documentApi";
import {
  ArrowLeft,
  Star,
  MoreVertical,
  Trash2,
} from "lucide-react";
import FolderContent from "../components/FolderContent/FolderContent";
import DocumentPreviewModal from "../components/DocumentPreviewModal";
import ChatInterface from "../components/ChatInterface/ChatInterface";

const FolderDetailPage = () => {
  const { folderName } = useParams();
  const navigate = useNavigate();
  const {
    setSelectedFolder,
    selectedFolder,
    loadFoldersAndFiles,
    hasAiResponse,
  } = useContext(FileManagerContext);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [isStarred, setIsStarred] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (folderName) {
      setSelectedFolder(folderName);
    }

    return () => {
      setSelectedFolder(null);
    };
  }, [folderName, setSelectedFolder]);

  useEffect(() => {
    loadFoldersAndFiles();
  }, [loadFoldersAndFiles]);

  const handleDocumentClick = (doc) => {
    setSelectedDocument(doc);
  };

  const handleClosePreview = () => {
    setSelectedDocument(null);
  };

  const handleToggleStar = () => {
    setIsStarred((prev) => !prev);
  };

  const handleDeleteFolder = async () => {
    const name = folderName || selectedFolder;
    if (!name) return;
    if (!window.confirm(`Delete case "${name}" and all its documents? This cannot be undone.`)) return;
    setIsDeleting(true);
    setShowMoreMenu(false);
    try {
      await documentApi.deleteFolderWithContents(name);
      navigate('/documents');
    } catch (err) {
      console.error('Failed to delete folder:', err);
      alert(`Failed to delete: ${err.response?.data?.error || err.message}`);
      setIsDeleting(false);
    }
  };

  return (
    <div className="h-screen bg-[#FDFCFB] text-gray-800 overflow-hidden scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent" style={{marginLeft: '0px', marginRight: '0px'}}>
      <div className="h-full flex flex-col mx-auto">
        <div className="flex-shrink-0 p-0">
          <button
            onClick={() => navigate("/documents")}
            className="flex items-center text-gray-600 hover:text-gray-800 transition-colors duration-200"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            <span className="text-sm">All projects</span>
          </button>
          {showMoreMenu && (
            <div className="absolute top-8 right-0 bg-white border border-gray-200 rounded-md shadow-lg p-2 z-50 min-w-[160px]">
              <button
                className="w-full text-left px-4 py-2 hover:bg-red-50 text-sm text-red-600 flex items-center gap-2 rounded"
                onClick={handleDeleteFolder}
                disabled={isDeleting}
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? 'Deleting...' : 'Delete Case'}
              </button>
            </div>
          )}
        </div>
        <div className="flex-shrink-0 flex justify-between items-start p-0 gap-3">
          <h1 className="text-xl font-bold min-w-0 flex-1 break-words pr-2">
            {selectedFolder || "Document Upload"}
          </h1>
          <div className="flex items-center space-x-2 flex-shrink-0">
            <button onClick={() => setShowMoreMenu((prev) => !prev)}>
              <MoreVertical className="w-4 h-4 text-gray-600" />
            </button>
            <button onClick={handleToggleStar}>
              <Star
                className={`w-4 h-4 ${
                  isStarred ? "text-yellow-400 fill-yellow-400" : "text-gray-400"
                }`}
              />
            </button>
          </div>
        </div>
        <div className={`flex-1 flex ${!hasAiResponse ? 'space-x-2' : ''} overflow-hidden`}>
          <div className={`${hasAiResponse ? 'w-full h-full' : 'flex-1 h-full'} flex flex-col scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent`}>
            <ChatInterface />
          </div>
          {!hasAiResponse && (
            <div className="w-1/3 flex flex-col h-full overflow-hidden scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
              <div className="bg-white p-2 rounded border border-gray-200 flex-1 flex flex-col overflow-hidden">
                <div className="flex justify-between items-center mb-1 flex-shrink-0">
                  <h3 className="text-sm font-semibold">Files</h3>
                </div>
                {selectedDocument ? (
                  <DocumentPreviewModal
                    document={selectedDocument}
                    onClose={handleClosePreview}
                  />
                ) : (
                  <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
                    <FolderContent onDocumentClick={handleDocumentClick} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default FolderDetailPage;