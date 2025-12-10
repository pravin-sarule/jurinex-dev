// import React, { useEffect } from 'react';
// import { Network, ChevronRight } from 'lucide-react';
// import MindmapControls from './MindmapControl';

// const MindmapContainer = ({
//   fileId,
//   sessionId,
//   uploadedDocuments,
//   apiBaseUrl,
//   getAuthToken,
//   showMindmap,
//   setShowMindmap,
//   selectedMindmapMessageId,
//   setSelectedMindmapMessageId,
//   mindmapData,
//   setMindmapData,
//   isGeneratingMindmap,
//   setIsGeneratingMindmap,
//   mindmapError,
//   setMindmapError,
//   onMindmapItemClick,
// }) => {

//   // Load mindmaps for a session - uses the full mindmap endpoint for complete structure
//   const loadMindmapsForSession = async (fileId, sessionId) => {
//     if (!sessionId) {
//       console.log('[MindmapContainer] No sessionId provided, skipping mindmap load');
//       return;
//     }

//     try {
//       const { mindmapService } = await import('../../services/mindmapService');
      
//       console.log('[MindmapContainer] 🔄 Loading mindmap for session:', sessionId, 'fileId:', fileId);
      
//       // First, try to get the full mindmap by session
//       let response = null;
//       try {
//         response = await mindmapService.getMindmapBySession(sessionId);
//         console.log('[MindmapContainer] Mindmap API response (getMindmapBySession):', response);
//       } catch (error) {
//         console.log('[MindmapContainer] getMindmapBySession failed, trying metadata endpoint:', error.message);
//         // Fallback: try metadata endpoint and then fetch by ID
//         try {
//           const metadataResponse = await mindmapService.getMindmapsMetadataBySession(sessionId);
//           console.log('[MindmapContainer] Metadata response:', metadataResponse);
          
//           if (metadataResponse && metadataResponse.success && metadataResponse.mindmaps && metadataResponse.mindmaps.length > 0) {
//             const latestMindmap = metadataResponse.mindmaps[0];
//             const mindmapId = latestMindmap.id || latestMindmap.mindmap_id;
//             if (mindmapId) {
//               console.log('[MindmapContainer] Fetching full mindmap by ID:', mindmapId);
//               response = await mindmapService.getMindmap(mindmapId);
//               console.log('[MindmapContainer] Full mindmap by ID response:', response);
//             }
//           }
//         } catch (metadataError) {
//           console.error('[MindmapContainer] Error with metadata fallback:', metadataError);
//         }
//       }
      
//       if (!response) {
//         console.log('[MindmapContainer] No response received from any endpoint');
//         setMindmapData(null);
//         setShowMindmap(false);
//         setSelectedMindmapMessageId(null);
//         return;
//       }
      
//       console.log('[MindmapContainer] Processing mindmap response:', {
//         hasResponse: !!response,
//         success: response?.success,
//         hasData: !!response?.data,
//         responseKeys: response ? Object.keys(response) : []
//       });
      
//       // Handle different response formats - be more lenient to catch all possible formats
//       if (response) {
//         // Format 1: { success: true, data: { id, label, children } }
//         if (response.data && (response.data.id || response.data.label !== undefined || response.data.children)) {
//           setMindmapData(response);
//           setShowMindmap(true);
//           setSelectedMindmapMessageId('mindmap');
//           console.log('[MindmapContainer] ✅ Format 1: Loaded mindmap (data field with id/label/children)');
//           return;
//         }
        
//         // Format 2: Response itself is the mindmap data
//         if (response.id || response.mindmap_id || response.mindmap_data || response.mindmap_json) {
//           setMindmapData(response);
//           setShowMindmap(true);
//           setSelectedMindmapMessageId('mindmap');
//           console.log('[MindmapContainer] ✅ Format 2: Loaded mindmap (direct mindmap data)');
//           return;
//         }
        
//         // Format 3: Check if data field exists but might be nested differently
//         if (response.data) {
//           // Try to use response.data directly if it looks like mindmap data
//           const dataToCheck = response.data;
//           if (typeof dataToCheck === 'object' && (dataToCheck.id || dataToCheck.label || dataToCheck.children || dataToCheck.title)) {
//             setMindmapData(response);
//             setShowMindmap(true);
//             setSelectedMindmapMessageId('mindmap');
//             console.log('[MindmapContainer] ✅ Format 3: Loaded mindmap (data field with mindmap-like structure)');
//             return;
//           }
//         }
        
//         // Format 4: If we got metadata list, fetch the full mindmap by ID
//         if (response.mindmaps && Array.isArray(response.mindmaps) && response.mindmaps.length > 0) {
//           console.log('[MindmapContainer] Format 4: Got metadata list, fetching full mindmap by ID');
//           const latestMindmap = response.mindmaps[0];
//           const mindmapId = latestMindmap.id || latestMindmap.mindmap_id;
//           if (mindmapId) {
//             try {
//               const fullMindmap = await mindmapService.getMindmap(mindmapId);
//               console.log('[MindmapContainer] Full mindmap by ID response:', fullMindmap);
//               if (fullMindmap && (fullMindmap.data || fullMindmap.id || fullMindmap.mindmap_id)) {
//                 setMindmapData(fullMindmap);
//                 setShowMindmap(true);
//                 setSelectedMindmapMessageId('mindmap');
//                 console.log('[MindmapContainer] ✅ Format 4: Successfully loaded full mindmap by ID:', mindmapId);
//                 return;
//               }
//             } catch (err) {
//               console.error('[MindmapContainer] Error fetching full mindmap by ID:', err);
//             }
//           }
//         }
        
//         // Format 5: Check if response has success: true but data might be in different field
//         if (response.success === true) {
//           // Try any field that might contain the mindmap
//           const possibleFields = ['data', 'mindmap', 'mindmap_data', 'result', 'content'];
//           for (const field of possibleFields) {
//             if (response[field] && typeof response[field] === 'object') {
//               const fieldData = response[field];
//               if (fieldData.id || fieldData.label || fieldData.children || fieldData.title) {
//                 setMindmapData(response);
//                 setShowMindmap(true);
//                 setSelectedMindmapMessageId('mindmap');
//                 console.log(`[MindmapContainer] ✅ Format 5: Loaded mindmap from field: ${field}`);
//                 return;
//               }
//             }
//           }
//         }
        
//         // Final fallback: If response exists and is an object, try to use it anyway
//         // Sometimes the API might return the data in an unexpected format
//         if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
//           console.log('[MindmapContainer] ⚠️ Trying fallback: Using response as-is even if format is unexpected');
//           setMindmapData(response);
//           setShowMindmap(true);
//           setSelectedMindmapMessageId('mindmap');
//           console.log('[MindmapContainer] ✅ Fallback: Set mindmap data (will let MindmapViewer handle parsing)');
//           return;
//         }
        
//         // Log detailed info about what we received
//         console.warn('[MindmapContainer] ⚠️ Response received but format not recognized. Full response:', JSON.stringify(response, null, 2));
//         console.warn('[MindmapContainer] Response analysis:', {
//           type: typeof response,
//           isArray: Array.isArray(response),
//           hasSuccess: response.success !== undefined,
//           successValue: response.success,
//           hasData: !!response.data,
//           dataType: response.data ? typeof response.data : 'none',
//           hasDataId: !!(response.data && response.data.id),
//           hasDataLabel: !!(response.data && response.data.label),
//           hasDataChildren: !!(response.data && response.data.children),
//           responseKeys: Object.keys(response),
//           dataKeys: response.data && typeof response.data === 'object' ? Object.keys(response.data) : []
//         });
//       } else {
//         console.log('[MindmapContainer] Response is null or undefined');
//       }
      
//       // No mindmap for this session - this is normal, not an error
//       console.log('[MindmapContainer] No mindmap found for session:', sessionId, 'Response:', response);
//       setMindmapData(null);
//       setShowMindmap(false);
//       setSelectedMindmapMessageId(null);
//     } catch (error) {
//       console.error('[MindmapContainer] Error loading mindmaps for session:', error);
//       console.error('[MindmapContainer] Error details:', {
//         message: error.message,
//         response: error.response?.data,
//         status: error.response?.status
//       });
//       // Don't show error to user, just log it - gracefully handle missing mindmaps
//       setMindmapData(null);
//       setShowMindmap(false);
//       setSelectedMindmapMessageId(null);
//     }
//   };

//   // Auto-load mindmap when sessionId changes (for past chats)
//   // This ensures mindmaps load automatically when opening past chat sessions from any source
//   useEffect(() => {
//     if (sessionId && fileId) {
//       console.log('[MindmapContainer] 🔄 useEffect triggered - SessionId or fileId changed, auto-loading mindmap:', { 
//         sessionId, 
//         fileId
//       });
      
//       // Load mindmap when we have both sessionId and fileId
//       // Use a delay to ensure state is fully updated, especially after fetchChatHistory
//       const timer = setTimeout(() => {
//         console.log('[MindmapContainer] ⏰ Timer fired, calling loadMindmapsForSession');
//         loadMindmapsForSession(fileId, sessionId);
//       }, 500); // Delay to ensure fetchChatHistory completes first
      
//       return () => {
//         console.log('[MindmapContainer] 🧹 Cleaning up mindmap load timer');
//         clearTimeout(timer);
//       };
//     } else {
//       console.log('[MindmapContainer] ⏸️ Skipping mindmap load - missing sessionId or fileId:', { sessionId, fileId });
//     }
//   }, [sessionId, fileId]);

//   // Handle mindmap generation callback
//   const handleMindmapGenerated = (data, error, loading) => {
//     if (loading !== undefined) {
//       setIsGeneratingMindmap(loading);
//     }
//     if (data !== undefined) {
//       setMindmapData(data);
//       if (data) {
//         setShowMindmap(true);
//         setSelectedMindmapMessageId('mindmap');
//       }
//     }
//     if (error !== undefined) {
//       setMindmapError(error);
//     }
//   };

//   // Handle mindmap item click
//   const handleMindmapItemClick = () => {
//     setShowMindmap(true);
//     setSelectedMindmapMessageId('mindmap');
//     if (onMindmapItemClick) {
//       onMindmapItemClick();
//     }
//   };

//   return (
//     <>
//       {/* Mindmap Controls */}
//       {showMindmap && (
//         <MindmapControls
//           fileId={fileId}
//           uploadedDocuments={uploadedDocuments}
//           apiBaseUrl={apiBaseUrl}
//           getAuthToken={getAuthToken}
//           sessionId={sessionId}
//           onMindmapGenerated={handleMindmapGenerated}
//           mindmapData={mindmapData}
//           isLoading={isGeneratingMindmap}
//           error={mindmapError}
//         />
//       )}

//       {/* Mindmap Item in Messages List */}
//       <div
//         onClick={handleMindmapItemClick}
//         className={`p-2 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
//           showMindmap && selectedMindmapMessageId === 'mindmap'
//             ? 'bg-[#E0F7F6] border-[#21C1B6] shadow-sm'
//             : 'bg-white border-gray-200 hover:bg-gray-50'
//         }`}
//       >
//         <div className="flex items-start justify-between">
//           <div className="flex-1 min-w-0">
//             <div className="flex items-center space-x-2 mb-0.5">
//               <Network className="h-3 w-3 text-[#21C1B6] flex-shrink-0" />
//               <p className="text-xs font-medium text-gray-900">Generate Mind Map</p>
//             </div>
//             <p className="text-xs text-gray-500">Visualize document relationships</p>
//           </div>
//           {showMindmap && selectedMindmapMessageId === 'mindmap' && (
//             <ChevronRight className="h-3 w-3 text-[#21C1B6] flex-shrink-0 ml-1.5" />
//           )}
//         </div>
//       </div>
//     </>
//   );
// };

// export default MindmapContainer;

import React, { useEffect, useState } from 'react';
import { Network, ChevronRight } from 'lucide-react';
import MindmapControls from './MindmapControl';

const MindmapContainer = ({
  fileId,
  sessionId,
  uploadedDocuments,
  apiBaseUrl,
  getAuthToken,
  showMindmap,
  setShowMindmap,
  selectedMindmapMessageId,
  setSelectedMindmapMessageId,
  mindmapData,
  setMindmapData,
  isGeneratingMindmap,
  setIsGeneratingMindmap,
  mindmapError,
  setMindmapError,
  onMindmapItemClick,
}) => {
  const [isClosing, setIsClosing] = useState(false);
  const [showMindmapControls, setShowMindmapControls] = useState(true);

  // Load mindmaps for a session - uses the full mindmap endpoint for complete structure
  const loadMindmapsForSession = async (fileId, sessionId) => {
    if (!sessionId) {
      console.log('[MindmapContainer] No sessionId provided, skipping mindmap load');
      return;
    }

    try {
      const { mindmapService } = await import('../../services/mindmapService');
      
      console.log('[MindmapContainer] 🔄 Loading mindmap for session:', sessionId, 'fileId:', fileId);
      
      // First, try to get the full mindmap by session
      let response = null;
      try {
        response = await mindmapService.getMindmapBySession(sessionId);
        console.log('[MindmapContainer] Mindmap API response (getMindmapBySession):', response);
      } catch (error) {
        console.log('[MindmapContainer] getMindmapBySession failed, trying metadata endpoint:', error.message);
        // Fallback: try metadata endpoint and then fetch by ID
        try {
          const metadataResponse = await mindmapService.getMindmapsMetadataBySession(sessionId);
          console.log('[MindmapContainer] Metadata response:', metadataResponse);
          
          if (metadataResponse && metadataResponse.success && metadataResponse.mindmaps && metadataResponse.mindmaps.length > 0) {
            const latestMindmap = metadataResponse.mindmaps[0];
            const mindmapId = latestMindmap.id || latestMindmap.mindmap_id;
            if (mindmapId) {
              console.log('[MindmapContainer] Fetching full mindmap by ID:', mindmapId);
              response = await mindmapService.getMindmap(mindmapId);
              console.log('[MindmapContainer] Full mindmap by ID response:', response);
            }
          }
        } catch (metadataError) {
          console.error('[MindmapContainer] Error with metadata fallback:', metadataError);
        }
      }
      
      if (!response) {
        console.log('[MindmapContainer] No response received from any endpoint');
        setMindmapData(null);
        setShowMindmap(false);
        setSelectedMindmapMessageId(null);
        return;
      }
      
      console.log('[MindmapContainer] Processing mindmap response:', {
        hasResponse: !!response,
        success: response?.success,
        hasData: !!response?.data,
        responseKeys: response ? Object.keys(response) : []
      });
      
      // Handle different response formats - be more lenient to catch all possible formats
      if (response) {
        // Format 1: { success: true, data: { id, label, children } }
        if (response.data && (response.data.id || response.data.label !== undefined || response.data.children)) {
          setMindmapData(response);
          setShowMindmap(true);
          setSelectedMindmapMessageId('mindmap');
          console.log('[MindmapContainer] ✅ Format 1: Loaded mindmap (data field with id/label/children)');
          return;
        }
        
        // Format 2: Response itself is the mindmap data
        if (response.id || response.mindmap_id || response.mindmap_data || response.mindmap_json) {
          setMindmapData(response);
          setShowMindmap(true);
          setSelectedMindmapMessageId('mindmap');
          console.log('[MindmapContainer] ✅ Format 2: Loaded mindmap (direct mindmap data)');
          return;
        }
        
        // Format 3: Check if data field exists but might be nested differently
        if (response.data) {
          // Try to use response.data directly if it looks like mindmap data
          const dataToCheck = response.data;
          if (typeof dataToCheck === 'object' && (dataToCheck.id || dataToCheck.label || dataToCheck.children || dataToCheck.title)) {
            setMindmapData(response);
            setShowMindmap(true);
            setSelectedMindmapMessageId('mindmap');
            console.log('[MindmapContainer] ✅ Format 3: Loaded mindmap (data field with mindmap-like structure)');
            return;
          }
        }
        
        // Format 4: If we got metadata list, fetch the full mindmap by ID
        if (response.mindmaps && Array.isArray(response.mindmaps) && response.mindmaps.length > 0) {
          console.log('[MindmapContainer] Format 4: Got metadata list, fetching full mindmap by ID');
          const latestMindmap = response.mindmaps[0];
          const mindmapId = latestMindmap.id || latestMindmap.mindmap_id;
          if (mindmapId) {
            try {
              const fullMindmap = await mindmapService.getMindmap(mindmapId);
              console.log('[MindmapContainer] Full mindmap by ID response:', fullMindmap);
              if (fullMindmap && (fullMindmap.data || fullMindmap.id || fullMindmap.mindmap_id)) {
                setMindmapData(fullMindmap);
                setShowMindmap(true);
                setSelectedMindmapMessageId('mindmap');
                console.log('[MindmapContainer] ✅ Format 4: Successfully loaded full mindmap by ID:', mindmapId);
                return;
              }
            } catch (err) {
              console.error('[MindmapContainer] Error fetching full mindmap by ID:', err);
            }
          }
        }
        
        // Format 5: Check if response has success: true but data might be in different field
        if (response.success === true) {
          // Try any field that might contain the mindmap
          const possibleFields = ['data', 'mindmap', 'mindmap_data', 'result', 'content'];
          for (const field of possibleFields) {
            if (response[field] && typeof response[field] === 'object') {
              const fieldData = response[field];
              if (fieldData.id || fieldData.label || fieldData.children || fieldData.title) {
                setMindmapData(response);
                setShowMindmap(true);
                setSelectedMindmapMessageId('mindmap');
                console.log(`[MindmapContainer] ✅ Format 5: Loaded mindmap from field: ${field}`);
                return;
              }
            }
          }
        }
        
        // Final fallback: If response exists and is an object, try to use it anyway
        // Sometimes the API might return the data in an unexpected format
        if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
          console.log('[MindmapContainer] ⚠️ Trying fallback: Using response as-is even if format is unexpected');
          setMindmapData(response);
          setShowMindmap(true);
          setSelectedMindmapMessageId('mindmap');
          console.log('[MindmapContainer] ✅ Fallback: Set mindmap data (will let MindmapViewer handle parsing)');
          return;
        }
        
        // Log detailed info about what we received
        console.warn('[MindmapContainer] ⚠️ Response received but format not recognized. Full response:', JSON.stringify(response, null, 2));
        console.warn('[MindmapContainer] Response analysis:', {
          type: typeof response,
          isArray: Array.isArray(response),
          hasSuccess: response.success !== undefined,
          successValue: response.success,
          hasData: !!response.data,
          dataType: response.data ? typeof response.data : 'none',
          hasDataId: !!(response.data && response.data.id),
          hasDataLabel: !!(response.data && response.data.label),
          hasDataChildren: !!(response.data && response.data.children),
          responseKeys: Object.keys(response),
          dataKeys: response.data && typeof response.data === 'object' ? Object.keys(response.data) : []
        });
      } else {
        console.log('[MindmapContainer] Response is null or undefined');
      }
      
      // No mindmap for this session - this is normal, not an error
      console.log('[MindmapContainer] No mindmap found for session:', sessionId, 'Response:', response);
      setMindmapData(null);
      setShowMindmap(false);
      setSelectedMindmapMessageId(null);
    } catch (error) {
      console.error('[MindmapContainer] Error loading mindmaps for session:', error);
      console.error('[MindmapContainer] Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      // Don't show error to user, just log it - gracefully handle missing mindmaps
      setMindmapData(null);
      setShowMindmap(false);
      setSelectedMindmapMessageId(null);
    }
  };

  // Auto-load mindmap when sessionId changes (for past chats)
  // This ensures mindmaps load automatically when opening past chat sessions from any source
  useEffect(() => {
    if (sessionId && fileId) {
      console.log('[MindmapContainer] 🔄 useEffect triggered - SessionId or fileId changed, auto-loading mindmap:', { 
        sessionId, 
        fileId
      });
      
      // Load mindmap when we have both sessionId and fileId
      // Use a delay to ensure state is fully updated, especially after fetchChatHistory
      const timer = setTimeout(() => {
        console.log('[MindmapContainer] ⏰ Timer fired, calling loadMindmapsForSession');
        loadMindmapsForSession(fileId, sessionId);
      }, 500); // Delay to ensure fetchChatHistory completes first
      
      return () => {
        console.log('[MindmapContainer] 🧹 Cleaning up mindmap load timer');
        clearTimeout(timer);
      };
    } else {
      console.log('[MindmapContainer] ⏸️ Skipping mindmap load - missing sessionId or fileId:', { sessionId, fileId });
    }
  }, [sessionId, fileId]);

  // Handle mindmap generation callback
  const handleMindmapGenerated = (data, error, loading) => {
    if (loading !== undefined) {
      setIsGeneratingMindmap(loading);
    }
    if (data !== undefined) {
      setMindmapData(data);
      if (data) {
        setShowMindmap(true);
        setSelectedMindmapMessageId('mindmap');
      }
    }
    if (error !== undefined) {
      setMindmapError(error);
    }
  };

  // Handle mindmap item click
  const handleMindmapItemClick = () => {
    setShowMindmap(true);
    setSelectedMindmapMessageId('mindmap');
    setIsClosing(false); // Reset closing state when opening
    setShowMindmapControls(true); // Reopen controls panel if it was closed
    if (onMindmapItemClick) {
      onMindmapItemClick();
    }
  };

  // Handle closing controls panel only (keep mindmap viewer visible)
  const handleCloseMindmapControls = () => {
    setIsClosing(true);
    // Wait for animation to complete before actually closing
    setTimeout(() => {
      setShowMindmapControls(false);
      setIsClosing(false);
    }, 250); // Match animation duration (0.25s)
  };

  // Reset closing state when showMindmap changes to true
  useEffect(() => {
    if (showMindmap) {
      setIsClosing(false);
      // Show controls when mindmap is shown
      setShowMindmapControls(true);
    }
  }, [showMindmap]);

  return (
    <>
      {/* Mindmap Controls */}
      {showMindmap && showMindmapControls && (
        <div className={isClosing ? 'mindmap-generator-closing' : ''}>
          <MindmapControls
            fileId={fileId}
            uploadedDocuments={uploadedDocuments}
            apiBaseUrl={apiBaseUrl}
            getAuthToken={getAuthToken}
            sessionId={sessionId}
            onMindmapGenerated={handleMindmapGenerated}
            mindmapData={mindmapData}
            isLoading={isGeneratingMindmap}
            error={mindmapError}
            setShowMindmap={handleCloseMindmapControls}
          />
        </div>
      )}

      {/* Mindmap Item in Messages List */}
      <div
        onClick={handleMindmapItemClick}
        className={`p-2 rounded-lg border cursor-pointer transition-all duration-200 hover:shadow-md ${
          showMindmap && selectedMindmapMessageId === 'mindmap'
            ? 'bg-[#E0F7F6] border-[#21C1B6] shadow-sm'
            : 'bg-white border-gray-200 hover:bg-gray-50'
        }`}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2 mb-0.5">
              <Network className="h-3 w-3 text-[#21C1B6] flex-shrink-0" />
              <p className="text-xs font-medium text-gray-900">Generate Mind Map</p>
            </div>
            <p className="text-xs text-gray-500">Visualize document relationships</p>
          </div>
          {showMindmap && selectedMindmapMessageId === 'mindmap' && (
            <ChevronRight className="h-3 w-3 text-[#21C1B6] flex-shrink-0 ml-1.5" />
          )}
        </div>
      </div>
    </>
  );
};

export default MindmapContainer;


