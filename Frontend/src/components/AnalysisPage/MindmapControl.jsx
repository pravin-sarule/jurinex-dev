// import React, { useState, useEffect } from 'react';
// import { Loader2, RefreshCw, AlertCircle } from 'lucide-react';
// import { mindmapService } from '../../services/mindmapService';

// const MindmapControls = ({
//   fileId,
//   uploadedDocuments,
//   apiBaseUrl,
//   getAuthToken,
//   sessionId,
//   onMindmapGenerated,
//   mindmapData,
//   isLoading,
//   error,
// }) => {
//   const [prompt, setPrompt] = useState('');
//   const [selectedFileIds, setSelectedFileIds] = useState([]);

//   useEffect(() => {
//     if (fileId) {
//       setSelectedFileIds([fileId]);
//     }
//   }, [fileId]);

//   const handleFileToggle = (fileId) => {
//     setSelectedFileIds((prev) =>
//       prev.includes(fileId)
//         ? prev.filter((id) => id !== fileId)
//         : [...prev, fileId]
//     );
//   };

//   const generateMindmap = async () => {
//     if (selectedFileIds.length === 0) {
//       onMindmapGenerated(null, 'Please select at least one file', false);
//       return;
//     }

//     onMindmapGenerated(null, null, true); // Set loading, clear error

//     try {
//       let data;
      
//       if (selectedFileIds.length === 1) {
//         // Single file
//         data = await mindmapService.generateMindmap(
//           selectedFileIds[0],
//           sessionId || null,
//           prompt || null
//         );
//       } else {
//         // Multiple files
//         data = await mindmapService.generateMindmapMulti(
//           selectedFileIds,
//           sessionId || null,
//           prompt || null
//         );
//       }

//       console.log('Mindmap API response:', data);
      
//       // New API format: { success, mindmap_id, data: { id, label, isCollapsed, children: [...] } }
//       if (data && data.success && data.data) {
//         // Pass the full response including mindmap_id for later retrieval
//         onMindmapGenerated(data, null, false);
//       } else if (data && data.data) {
//         // Fallback: accept if data field exists (backward compatibility)
//         onMindmapGenerated(data, null, false);
//       } else {
//         console.error('Invalid response format:', data);
//         throw new Error('Invalid response format: missing mindmap data');
//       }
//     } catch (err) {
//       console.error('Error generating mindmap:', err);
//       const errorMessage = err.response?.data?.error || err.message || 'Failed to generate mindmap';
//       onMindmapGenerated(null, errorMessage, false);
//     }
//   };

//   return (
//     <div className="p-3 border-b border-gray-200 bg-white">
//       <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center">
//         <span>Mindmap Generator</span>
//       </h3>

//       {error && (
//         <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2">
//           <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
//           <span className="text-xs text-red-700">{error}</span>
//         </div>
//       )}

//       <div className="space-y-3">
//         <div>
//           <label className="block text-xs font-medium text-gray-700 mb-1">Prompt</label>
//           <input
//             type="text"
//             value={prompt}
//             onChange={(e) => setPrompt(e.target.value)}
//             className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] text-black"
//             placeholder="Enter prompt for mindmap"
//           />
//         </div>

//         {uploadedDocuments && uploadedDocuments.length > 0 && (
//           <div>
//             <label className="block text-xs font-medium text-gray-700 mb-1.5">Select Files</label>
//             <div className="max-h-32 overflow-y-auto space-y-1.5 border border-gray-200 rounded-lg p-2 bg-gray-50">
//               {uploadedDocuments.map((doc) => (
//                 <label
//                   key={doc.id}
//                   className="flex items-center space-x-2 cursor-pointer hover:bg-white p-1.5 rounded text-xs"
//                 >
//                   <input
//                     type="checkbox"
//                     checked={selectedFileIds.includes(doc.id)}
//                     onChange={() => handleFileToggle(doc.id)}
//                     className="rounded border-gray-300 text-[#21C1B6] focus:ring-[#21C1B6]"
//                   />
//                   <span className="text-xs text-gray-700 truncate">{doc.fileName}</span>
//                 </label>
//               ))}
//             </div>
//           </div>
//         )}

//         <button
//           onClick={generateMindmap}
//           disabled={isLoading || selectedFileIds.length === 0}
//           className="w-full px-3 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center space-x-2 text-xs font-medium"
//         >
//           {isLoading ? (
//             <>
//               <Loader2 className="h-3 w-3 animate-spin" />
//               <span>Generating...</span>
//             </>
//           ) : (
//             <>
//               <RefreshCw className="h-3 w-3" />
//               <span>Generate Mindmap</span>
//             </>
//           )}
//         </button>
//       </div>
//     </div>
//   );
// };

// export default MindmapControls;



import React, { useState, useEffect } from 'react';
import { Loader2, RefreshCw, AlertCircle, X } from 'lucide-react';
import { mindmapService } from '../../services/mindmapService';

const MindmapControls = ({
  fileId,
  uploadedDocuments,
  apiBaseUrl,
  getAuthToken,
  sessionId,
  onMindmapGenerated,
  mindmapData,
  isLoading,
  error,
  setShowMindmap,
}) => {
  const [prompt, setPrompt] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState([]);

  useEffect(() => {
    if (fileId) {
      setSelectedFileIds([fileId]);
    }
  }, [fileId]);

  const handleFileToggle = (fileId) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [...prev, fileId]
    );
  };

  const handleClose = () => {
    if (setShowMindmap) {
      setShowMindmap();
    }
  };

  const generateMindmap = async () => {
    if (selectedFileIds.length === 0) {
      onMindmapGenerated(null, 'Please select at least one file', false);
      return;
    }

    onMindmapGenerated(null, null, true); // Set loading, clear error

    try {
      let data;
      
      if (selectedFileIds.length === 1) {
        // Single file
        data = await mindmapService.generateMindmap(
          selectedFileIds[0],
          sessionId || null,
          prompt || null
        );
      } else {
        // Multiple files
        data = await mindmapService.generateMindmapMulti(
          selectedFileIds,
          sessionId || null,
          prompt || null
        );
      }

      console.log('Mindmap API response:', data);
      
      // New API format: { success, mindmap_id, data: { id, label, isCollapsed, children: [...] } }
      if (data && data.success && data.data) {
        // Pass the full response including mindmap_id for later retrieval
        onMindmapGenerated(data, null, false);
      } else if (data && data.data) {
        // Fallback: accept if data field exists (backward compatibility)
        onMindmapGenerated(data, null, false);
      } else {
        console.error('Invalid response format:', data);
        throw new Error('Invalid response format: missing mindmap data');
      }
    } catch (err) {
      console.error('Error generating mindmap:', err);
      const errorMessage = err.response?.data?.error || err.message || 'Failed to generate mindmap';
      onMindmapGenerated(null, errorMessage, false);
    }
  };

  return (
    <div className="p-3 border-b border-gray-200 bg-white mindmap-generator-container">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Mindmap Generator
        </h3>
        {setShowMindmap && (
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-opacity duration-200 p-1 rounded hover:bg-gray-100 flex-shrink-0"
            aria-label="Close Mindmap Generator"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2">
          <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
          <span className="text-xs text-red-700">{error}</span>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Prompt</label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] text-black"
            placeholder="Enter prompt for mindmap"
          />
        </div>

        {uploadedDocuments && uploadedDocuments.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Select Files</label>
            <div className="max-h-32 overflow-y-auto space-y-1.5 border border-gray-200 rounded-lg p-2 bg-gray-50">
              {uploadedDocuments.map((doc) => (
                <label
                  key={doc.id}
                  className="flex items-center space-x-2 cursor-pointer hover:bg-white p-1.5 rounded text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedFileIds.includes(doc.id)}
                    onChange={() => handleFileToggle(doc.id)}
                    className="rounded border-gray-300 text-[#21C1B6] focus:ring-[#21C1B6]"
                  />
                  <span className="text-xs text-gray-700 truncate">{doc.fileName}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={generateMindmap}
          disabled={isLoading || selectedFileIds.length === 0}
          className="w-full px-3 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center space-x-2 text-xs font-medium"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Generating...</span>
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3" />
              <span>Generate Mindmap</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default MindmapControls;




