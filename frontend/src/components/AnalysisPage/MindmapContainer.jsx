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

  const loadMindmapsForSession = async (fileId, sessionId) => {
    if (!sessionId) {
      console.log('[MindmapContainer] No sessionId provided, skipping mindmap load');
      return;
    }

    try {
      const { mindmapService } = await import('../../services/mindmapService');
      
      console.log('[MindmapContainer] 🔄 Loading mindmap for session:', sessionId, 'fileId:', fileId);
      
      let response = null;
      try {
        response = await mindmapService.getMindmapBySession(sessionId);
        console.log('[MindmapContainer] Mindmap API response (getMindmapBySession):', response);
      } catch (error) {
        console.log('[MindmapContainer] getMindmapBySession failed, trying metadata endpoint:', error.message);
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
      
      if (response) {
        if (response.data && (response.data.id || response.data.label !== undefined || response.data.children)) {
          setMindmapData(response);
          setShowMindmap(true);
          setSelectedMindmapMessageId('mindmap');
          console.log('[MindmapContainer] ✅ Format 1: Loaded mindmap (data field with id/label/children)');
          return;
        }
        
        if (response.id || response.mindmap_id || response.mindmap_data || response.mindmap_json) {
          setMindmapData(response);
          setShowMindmap(true);
          setSelectedMindmapMessageId('mindmap');
          console.log('[MindmapContainer] ✅ Format 2: Loaded mindmap (direct mindmap data)');
          return;
        }
        
        if (response.data) {
          const dataToCheck = response.data;
          if (typeof dataToCheck === 'object' && (dataToCheck.id || dataToCheck.label || dataToCheck.children || dataToCheck.title)) {
            setMindmapData(response);
            setShowMindmap(true);
            setSelectedMindmapMessageId('mindmap');
            console.log('[MindmapContainer] ✅ Format 3: Loaded mindmap (data field with mindmap-like structure)');
            return;
          }
        }
        
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
        
        if (response.success === true) {
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
        
        if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
          console.log('[MindmapContainer] ⚠️ Trying fallback: Using response as-is even if format is unexpected');
          setMindmapData(response);
          setShowMindmap(true);
          setSelectedMindmapMessageId('mindmap');
          console.log('[MindmapContainer] ✅ Fallback: Set mindmap data (will let MindmapViewer handle parsing)');
          return;
        }
        
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
      setMindmapData(null);
      setShowMindmap(false);
      setSelectedMindmapMessageId(null);
    }
  };

  useEffect(() => {
    if (sessionId && fileId) {
      console.log('[MindmapContainer] 🔄 useEffect triggered - SessionId or fileId changed, auto-loading mindmap:', { 
        sessionId, 
        fileId
      });
      
      const timer = setTimeout(() => {
        console.log('[MindmapContainer] ⏰ Timer fired, calling loadMindmapsForSession');
        loadMindmapsForSession(fileId, sessionId);
      }, 500);
      
      return () => {
        console.log('[MindmapContainer] 🧹 Cleaning up mindmap load timer');
        clearTimeout(timer);
      };
    } else {
      console.log('[MindmapContainer] ⏸️ Skipping mindmap load - missing sessionId or fileId:', { sessionId, fileId });
    }
  }, [sessionId, fileId]);

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

  const handleMindmapItemClick = () => {
    setShowMindmap(true);
    setSelectedMindmapMessageId('mindmap');
    setIsClosing(false);
    setShowMindmapControls(true);
    if (onMindmapItemClick) {
      onMindmapItemClick();
    }
  };

  const handleCloseMindmapControls = () => {
    setIsClosing(true);
    setTimeout(() => {
      setShowMindmapControls(false);
      setIsClosing(false);
    }, 250);
  };

  useEffect(() => {
    if (showMindmap) {
      setIsClosing(false);
      setShowMindmapControls(true);
    }
  }, [showMindmap]);

  return (
    <>
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


