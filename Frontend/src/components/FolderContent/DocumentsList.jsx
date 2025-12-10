// import React, { useState, useEffect } from 'react';
// import DocumentCard from './DocumentCard';
// import UploadDocumentModal from './UploadDocumentModal';
// import documentApi from '../../services/documentApi';

// const DocumentsList = () => {
//   const [documents, setDocuments] = useState([]);
//   const [documentStatuses, setDocumentStatuses] = useState({});
//   const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

//   // Example: Simulate document processing status updates
//   useEffect(() => {
//     // This would typically come from your backend via WebSocket or polling
//     const interval = setInterval(() => {
//       setDocumentStatuses(prevStatuses => {
//         const newStatuses = { ...prevStatuses };
        
//         // Update each document's status
//         documents.forEach(doc => {
//           const currentStatus = newStatuses[doc.id];
//           if (currentStatus && currentStatus.status !== 'completed') {
//             // Simulate progress through stages
//             const newProgress = Math.min(currentStatus.progress + 5, 100);
            
//             let newStatus = currentStatus.status;
//             if (newProgress >= 100) {
//               newStatus = 'completed';
//             } else if (newProgress >= 75) {
//               newStatus = 'storing_to_database';
//             } else if (newProgress >= 50) {
//               newStatus = 'chunking_content';
//             } else if (newProgress >= 20) {
//               newStatus = 'text_extraction';
//             } else {
//               newStatus = 'uploading';
//             }
            
//             newStatuses[doc.id] = {
//               status: newStatus,
//               progress: newProgress,
//               message: `Processing ${doc.name}`
//             };
//           }
//         });
        
//         return newStatuses;
//       });
//     }, 1000);

//     return () => clearInterval(interval);
//   }, [documents]);

//   const handleUpload = (files) => {
//     // Create document objects from files
//     const newDocuments = files.map((file, index) => ({
//       id: `doc-${Date.now()}-${index}`,
//       name: file.name,
//       size: file.size,
//       created_at: new Date().toISOString(),
//       status: 'uploading'
//     }));

//     setDocuments(prev => [...prev, ...newDocuments]);

//     // Initialize status for each document
//     const newStatuses = {};
//     newDocuments.forEach(doc => {
//       newStatuses[doc.id] = {
//         status: 'uploading',
//         progress: 0,
//         message: 'Starting upload...'
//       };
//     });
//     setDocumentStatuses(prev => ({ ...prev, ...newStatuses }));

//     // Here you would typically upload to your backend
//     console.log('Uploading files:', files);
//   };

//   const handleDocumentClick = (document) => {
//     console.log('Document clicked:', document);
//     // Handle document click (e.g., open preview, show details)
//   };

//   const handleDeleteDocument = async (fileId) => {
//     try {
//       await documentApi.deleteFile(fileId);
//       setDocuments(prevDocuments => prevDocuments.filter(doc => doc.id !== fileId));
//       setDocumentStatuses(prevStatuses => {
//         const newStatuses = { ...prevStatuses };
//         delete newStatuses[fileId];
//         return newStatuses;
//       });
//       console.log(`Document with ID ${fileId} deleted successfully.`);
//     } catch (error) {
//       console.error('Error deleting document:', error);
//       // Optionally, show an error message to the user
//     }
//   };

//   return (
//     <div className="min-h-screen bg-gray-50 p-6">
//       <div className="max-w-6xl mx-auto">
//         <div className="flex justify-between items-center mb-6">
//           <h1 className="text-2xl font-bold text-gray-800">Documents</h1>
//           <button
//             onClick={() => setIsUploadModalOpen(true)}
//             className="px-4 py-2 text-white rounded-md hover:opacity-90 transition-opacity duration-200"
//             style={{ backgroundColor: '#21C1B6' }}
//           >
//             Upload Documents
//           </button>
//         </div>

//         {documents.length === 0 ? (
//           <div className="bg-white rounded-lg shadow p-12 text-center">
//             <svg
//               className="mx-auto h-12 w-12 text-gray-400 mb-4"
//               fill="none"
//               viewBox="0 0 24 24"
//               stroke="currentColor"
//             >
//               <path
//                 strokeLinecap="round"
//                 strokeLinejoin="round"
//                 strokeWidth={2}
//                 d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
//               />
//             </svg>
//             <p className="text-gray-500 mb-4">No documents uploaded yet</p>
//             <button
//               onClick={() => setIsUploadModalOpen(true)}
//               className="px-6 py-2 text-white rounded-md hover:opacity-90 transition-opacity duration-200"
//               style={{ backgroundColor: '#21C1B6' }}
//             >
//               Upload Your First Document
//             </button>
//           </div>
//         ) : (
//           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
//             {documents.map(document => (
//               <DocumentCard
//                 key={document.id}
//                 document={document}
//                 individualStatus={documentStatuses[document.id]}
//                 onDocumentClick={handleDocumentClick}
//                 onDelete={handleDeleteDocument}
//               />
//             ))}
//           </div>
//         )}
//       </div>

//       <UploadDocumentModal
//         isOpen={isUploadModalOpen}
//         onClose={() => setIsUploadModalOpen(false)}
//         onUpload={handleUpload}
//       />
//     </div>
//   );
// };

// export default DocumentsList;


import React, { useState, useEffect } from 'react';
import DocumentCard from './DocumentCard';
import UploadDocumentModal from './UploadDocumentModal';
import documentApi from '../../services/documentApi';
import { toast } from 'react-toastify';

const DocumentsList = () => {
  const [documents, setDocuments] = useState([]);
  const [documentStatuses, setDocumentStatuses] = useState({});
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Example: Simulate document processing status updates
  useEffect(() => {
    // This would typically come from your backend via WebSocket or polling
    const interval = setInterval(() => {
      setDocumentStatuses(prevStatuses => {
        const newStatuses = { ...prevStatuses };
        
        // Update each document's status
        documents.forEach(doc => {
          const currentStatus = newStatuses[doc.id];
          if (currentStatus && currentStatus.status !== 'completed') {
            // Simulate progress through stages
            const newProgress = Math.min(currentStatus.progress + 5, 100);
            
            let newStatus = currentStatus.status;
            if (newProgress >= 100) {
              newStatus = 'completed';
            } else if (newProgress >= 75) {
              newStatus = 'storing_to_database';
            } else if (newProgress >= 50) {
              newStatus = 'chunking_content';
            } else if (newProgress >= 20) {
              newStatus = 'text_extraction';
            } else {
              newStatus = 'uploading';
            }
            
            newStatuses[doc.id] = {
              status: newStatus,
              progress: newProgress,
              message: `Processing ${doc.name}`
            };
          }
        });
        
        return newStatuses;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [documents]);

  const handleUpload = (files) => {
    // Check file size limit (100 MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB in bytes
    const oversizedFiles = Array.from(files).filter(file => file.size > MAX_FILE_SIZE);
    
    if (oversizedFiles.length > 0) {
      toast.error('File size limit exceeded. You can upload only up to 100 MB.', {
        autoClose: 5000
      });
      return;
    }
    
    // Create document objects from files
    const newDocuments = files.map((file, index) => ({
      id: `doc-${Date.now()}-${index}`,
      name: file.name,
      size: file.size,
      created_at: new Date().toISOString(),
      status: 'uploading'
    }));

    setDocuments(prev => [...prev, ...newDocuments]);

    // Initialize status for each document
    const newStatuses = {};
    newDocuments.forEach(doc => {
      newStatuses[doc.id] = {
        status: 'uploading',
        progress: 0,
        message: 'Starting upload...'
      };
    });
    setDocumentStatuses(prev => ({ ...prev, ...newStatuses }));

    // Here you would typically upload to your backend
    console.log('Uploading files:', files);
  };

  const handleDocumentClick = (document) => {
    console.log('Document clicked:', document);
    // Handle document click (e.g., open preview, show details)
  };

  const handleDeleteDocument = async (fileId) => {
    try {
      await documentApi.deleteFile(fileId);
      setDocuments(prevDocuments => prevDocuments.filter(doc => doc.id !== fileId));
      setDocumentStatuses(prevStatuses => {
        const newStatuses = { ...prevStatuses };
        delete newStatuses[fileId];
        return newStatuses;
      });
      console.log(`Document with ID ${fileId} deleted successfully.`);
    } catch (error) {
      console.error('Error deleting document:', error);
      // Optionally, show an error message to the user
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-start mb-6 gap-3">
          <h1 className="text-2xl font-bold text-gray-800 min-w-0 flex-1 break-words pr-2">Documents</h1>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="px-4 py-2 text-white rounded-md hover:opacity-90 transition-opacity duration-200 flex-shrink-0"
            style={{ backgroundColor: '#21C1B6' }}
          >
            Upload Documents
          </button>
        </div>

        {documents.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-gray-500 mb-4">No documents uploaded yet</p>
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="px-6 py-2 text-white rounded-md hover:opacity-90 transition-opacity duration-200"
              style={{ backgroundColor: '#21C1B6' }}
            >
              Upload Your First Document
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map(document => (
              <DocumentCard
                key={document.id}
                document={document}
                individualStatus={documentStatuses[document.id]}
                onDocumentClick={handleDocumentClick}
                onDelete={handleDeleteDocument}
              />
            ))}
          </div>
        )}
      </div>

      <UploadDocumentModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUpload={handleUpload}
      />
    </div>
  );
};

export default DocumentsList;