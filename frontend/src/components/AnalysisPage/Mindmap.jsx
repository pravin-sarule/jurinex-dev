import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertCircle, RefreshCw, Download, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

const Mindmap = ({ fileId, uploadedDocuments, apiBaseUrl, getAuthToken }) => {
  const [mindmapData, setMindmapData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [prompt, setPrompt] = useState('Create unified flowchart');
  const [flowchartType, setFlowchartType] = useState('process');
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMinimap, setShowMinimap] = useState(false);
  const svgRef = useRef(null);
  const fullscreenSvgRef = useRef(null);
  const containerRef = useRef(null);

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

  const checkFileStatus = async (fileId) => {
    try {
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const response = await fetch(`${apiBaseUrl}/files/status/${fileId}`, {
        method: 'GET',
        headers,
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.status === 'processed' || data.status === 'completed';
      }
      return false;
    } catch (error) {
      console.warn('Could not check file status:', error);
      return true;
    }
  };

  const makeRequestWithRetry = async (url, headers, requestBody, maxRetries = 2, retryDelay = 1000) => {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = retryDelay * Math.pow(2, attempt - 1);
          console.log(`Retrying mindmap generation (attempt ${attempt + 1}/${maxRetries + 1}) after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          if (response.status === 500 && attempt < maxRetries) {
            lastError = new Error(`Server error (500). Retrying...`);
            console.warn(`Server error on attempt ${attempt + 1}, will retry...`);
            continue;
          }
          
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data;
      } catch (err) {
        lastError = err;
        if (err.message && !err.message.includes('500') && !err.message.includes('Server error')) {
          throw err;
        }
        if (attempt < maxRetries) {
          continue;
        }
      }
    }
    
    throw lastError || new Error('Failed to generate mindmap after retries');
  };

  const generateMindmap = async () => {
    if (selectedFileIds.length === 0) {
      setError('Please select at least one file');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (selectedFileIds.length === 1) {
        const isProcessed = await checkFileStatus(selectedFileIds[0]);
        if (!isProcessed) {
          setError('File is still processing. Please wait until processing is complete.');
          setIsLoading(false);
          return;
        }
      }

      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let requestBody;
      let url;

      if (selectedFileIds.length === 1) {
        requestBody = {
          file_id: selectedFileIds[0],
          prompt: prompt,
          flowchart_type: flowchartType,
        };
        url = `${apiBaseUrl}/visual/generate-flowchart`;
      } else {
        requestBody = {
          file_ids: selectedFileIds,
          prompt: prompt,
          flowchart_type: flowchartType,
        };
        url = `${apiBaseUrl}/visual/generate-flowchart-multi`;
      }

      const data = await makeRequestWithRetry(url, headers, requestBody);
      
      setMindmapData(data);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } catch (err) {
      console.error('Error generating mindmap:', err);
      setError(err.message || 'Failed to generate mindmap');
    } finally {
      setIsLoading(false);
    }
  };

  const measureText = (text, fontSize = 14, fontWeight = 'normal') => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    return context.measureText(text).width;
  };

  const wrapText = (text, maxWidth, fontSize = 14) => {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach((word, index) => {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = measureText(testLine, fontSize);

      if (width <= maxWidth - 20) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }
    });

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.length > 0 ? lines : [text];
  };

  const parseMermaidFlowchart = (content) => {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    let nodeIdCounter = 0;

    const lines = content.split('\n');

    lines.forEach((line) => {
      line = line.trim();

      if (!line || line.startsWith('%%') || line.startsWith('graph') || line.startsWith('flowchart')) {
        return;
      }

      const nodePattern = /(\w+)([\[\(\{][\[\(\{]?|>)([^\]\)\}]+)([\]\)\}][\]\)\}]?)/g;
      let match;

      while ((match = nodePattern.exec(line)) !== null) {
        const [, id, , label] = match;
        if (!nodeMap.has(id)) {
          const nodeData = {
            id,
            label: label.trim(),
            index: nodeIdCounter++,
            originalLine: line
          };
          nodeMap.set(id, nodeData);
          nodes.push(nodeData);
        }
      }

      const edgePattern = /(\w+)\s*(-+\.?-+>?|=+>|<-+)\s*(\w+)/g;
      
      while ((match = edgePattern.exec(line)) !== null) {
        const [, from, arrow, to] = match;
        
        if (!nodeMap.has(from)) {
          nodeMap.set(from, { id: from, label: from, index: nodeIdCounter++ });
          nodes.push(nodeMap.get(from));
        }
        if (!nodeMap.has(to)) {
          nodeMap.set(to, { id: to, label: to, index: nodeIdCounter++ });
          nodes.push(nodeMap.get(to));
        }

        edges.push({ 
          from, 
          to,
          type: arrow.includes('=') ? 'thick' : 'normal',
          dashed: arrow.includes('.') 
        });
      }

      if (line.startsWith('subgraph')) {
        const subgraphMatch = line.match(/subgraph\s+(.+)/);
        if (subgraphMatch) {
          const label = subgraphMatch[1].trim();
          const subgraphId = `subgraph_${nodeIdCounter}`;
          nodeMap.set(subgraphId, {
            id: subgraphId,
            label: label,
            index: nodeIdCounter++,
            isSubgraph: true
          });
          nodes.push(nodeMap.get(subgraphId));
        }
      }
    });

    return { nodes, edges };
  };

  const calculateNodePositions = (nodes, edges, canvasWidth = 2400, canvasHeight = 1600) => {
    if (nodes.length === 0) return { nodes, edges, width: canvasWidth, height: canvasHeight };

    const adjList = new Map();
    const reverseAdjList = new Map();
    nodes.forEach(node => {
      adjList.set(node.id, []);
      reverseAdjList.set(node.id, []);
    });

    edges.forEach(edge => {
      if (adjList.has(edge.from)) {
        adjList.get(edge.from).push(edge.to);
      }
      if (reverseAdjList.has(edge.to)) {
        reverseAdjList.get(edge.to).push(edge.from);
      }
    });

    const rootNodes = nodes.filter(node => 
      reverseAdjList.get(node.id).length === 0
    );

    if (rootNodes.length === 0 && nodes.length > 0) {
      const nodesByOutDegree = [...nodes].sort((a, b) => 
        adjList.get(b.id).length - adjList.get(a.id).length
      );
      rootNodes.push(nodesByOutDegree[0]);
    }

    const levels = new Map();
    const queue = rootNodes.map(node => ({ id: node.id, level: 0 }));
    const visited = new Set();

    while (queue.length > 0) {
      const { id, level } = queue.shift();
      
      if (visited.has(id)) {
        if (level < levels.get(id)) {
          levels.set(id, level);
        }
        continue;
      }
      
      visited.add(id);
      levels.set(id, level);

      const children = adjList.get(id) || [];
      children.forEach(childId => {
        if (!visited.has(childId)) {
          queue.push({ id: childId, level: level + 1 });
        }
      });
    }

    nodes.forEach(node => {
      if (!levels.has(node.id)) {
        levels.set(node.id, 0);
      }
    });

    const levelGroups = new Map();
    nodes.forEach(node => {
      const level = levels.get(node.id);
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level).push(node);
    });

    const maxLevel = Math.max(...Array.from(levels.values()), 0);
    const numLevels = maxLevel + 1;

    const verticalSpacing = Math.max(150, canvasHeight / (numLevels + 1));
    const horizontalPadding = 100;

    const positionedNodes = nodes.map(node => {
      const level = levels.get(node.id);
      const nodesInLevel = levelGroups.get(level);
      const indexInLevel = nodesInLevel.indexOf(node);

      const lines = wrapText(node.label, 200, 14);
      const textWidth = Math.max(...lines.map(line => measureText(line, 14)));
      const nodeWidth = Math.max(textWidth + 40, 140);
      const nodeHeight = Math.max(lines.length * 20 + 30, 60);

      const totalLevelWidth = canvasWidth - (2 * horizontalPadding);
      const levelNodeSpacing = totalLevelWidth / (nodesInLevel.length + 1);

      return {
        ...node,
        x: horizontalPadding + levelNodeSpacing * (indexInLevel + 1),
        y: 80 + verticalSpacing * level,
        width: nodeWidth,
        height: nodeHeight,
        level,
        lines
      };
    });

    const maxX = Math.max(...positionedNodes.map(n => n.x + n.width / 2));
    const maxY = Math.max(...positionedNodes.map(n => n.y + n.height / 2));
    const actualWidth = Math.max(maxX + horizontalPadding, canvasWidth);
    const actualHeight = Math.max(maxY + 100, canvasHeight);

    return { 
      nodes: positionedNodes, 
      edges,
      width: actualWidth,
      height: actualHeight
    };
  };

  const createMultilineText = (svg, lines, x, y, fontSize = 14, fill = 'white', fontWeight = '500') => {
    const lineHeight = 20;
    const totalHeight = lines.length * lineHeight;
    const startY = y - (totalHeight / 2) + (lineHeight / 2);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

    lines.forEach((line, index) => {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x);
      text.setAttribute('y', startY + (index * lineHeight));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('fill', fill);
      text.setAttribute('font-size', fontSize);
      text.setAttribute('font-weight', fontWeight);
      text.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
      text.textContent = line;
      g.appendChild(text);
    });

    svg.appendChild(g);
  };

  const renderFlowchart = (targetSvgRef = svgRef, isFullscreenMode = false) => {
    if (!mindmapData || !targetSvgRef.current) return;

    const svg = targetSvgRef.current;
    svg.innerHTML = '';

    let flowchartContent = mindmapData.flowchart || 
                          mindmapData.data || 
                          mindmapData.mermaid_code || 
                          mindmapData.content ||
                          '';

    if (typeof flowchartContent === 'object' && !Array.isArray(flowchartContent)) {
      flowchartContent = JSON.stringify(flowchartContent, null, 2);
    }

    let parsedData = { nodes: [], edges: [] };

    if (mindmapData.nodes && Array.isArray(mindmapData.nodes)) {
      parsedData.nodes = mindmapData.nodes;
      parsedData.edges = mindmapData.edges || [];
    } 
    else if (typeof flowchartContent === 'string' && flowchartContent.trim()) {
      parsedData = parseMermaidFlowchart(flowchartContent);
    }

    if (parsedData.nodes.length === 0 && typeof flowchartContent === 'string') {
      const lines = flowchartContent
        .split('\n')
        .filter(line => line.trim() && !line.startsWith('graph') && !line.startsWith('flowchart'))
        .slice(0, 20);

      parsedData.nodes = lines.map((line, index) => ({
        id: `node_${index}`,
        label: line.trim(),
        index
      }));

      for (let i = 0; i < parsedData.nodes.length - 1; i++) {
        parsedData.edges.push({
          from: parsedData.nodes[i].id,
          to: parsedData.nodes[i + 1].id
        });
      }
    }

    if (parsedData.nodes.length === 0) {
      renderEmptyState(svg);
      return;
    }

    const { nodes, edges, width, height } = calculateNodePositions(
      parsedData.nodes, 
      parsedData.edges,
      2400,
      1600
    );

    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.setAttribute('id', 'nodeGradient');
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '0%');
    gradient.setAttribute('y2', '100%');

    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#22D3C5');
    gradient.appendChild(stop1);

    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#1AA49B');
    gradient.appendChild(stop2);

    defs.appendChild(gradient);

    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '12');
    marker.setAttribute('markerHeight', '12');
    marker.setAttribute('refX', '11');
    marker.setAttribute('refY', '6');
    marker.setAttribute('orient', 'auto');
    
    const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    arrowPath.setAttribute('d', 'M 0 0 L 12 6 L 0 12 z');
    arrowPath.setAttribute('fill', '#64748B');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);

    const dashedMarker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    dashedMarker.setAttribute('id', 'arrowhead-dashed');
    dashedMarker.setAttribute('markerWidth', '12');
    dashedMarker.setAttribute('markerHeight', '12');
    dashedMarker.setAttribute('refX', '11');
    dashedMarker.setAttribute('refY', '6');
    dashedMarker.setAttribute('orient', 'auto');
    
    const dashedArrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    dashedArrowPath.setAttribute('d', 'M 0 0 L 12 6 L 0 12 z');
    dashedArrowPath.setAttribute('fill', '#94A3B8');
    dashedMarker.appendChild(dashedArrowPath);
    defs.appendChild(dashedMarker);

    svg.appendChild(defs);

    edges.forEach((edge) => {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);

      if (fromNode && toNode) {
        const dx = toNode.x - fromNode.x;
        const dy = toNode.y - fromNode.y;
        const angle = Math.atan2(dy, dx);

        const startX = fromNode.x + (fromNode.width / 2) * Math.cos(angle);
        const startY = fromNode.y + (fromNode.height / 2) * Math.sin(angle);

        const endX = toNode.x - (toNode.width / 2) * Math.cos(angle);
        const endY = toNode.y - (toNode.height / 2) * Math.sin(angle);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        const controlPointOffset = 50;
        const pathData = `M ${startX} ${startY} Q ${(startX + endX) / 2} ${(startY + endY) / 2 - controlPointOffset} ${endX} ${endY}`;
        
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', edge.dashed ? '#94A3B8' : '#64748B');
        path.setAttribute('stroke-width', edge.type === 'thick' ? '3' : '2');
        path.setAttribute('fill', 'none');
        path.setAttribute('marker-end', edge.dashed ? 'url(#arrowhead-dashed)' : 'url(#arrowhead)');
        
        if (edge.dashed) {
          path.setAttribute('stroke-dasharray', '5,5');
        }

        svg.appendChild(path);
      }
    });

    nodes.forEach((node) => {
      const { x, y, width, height, lines, label } = node;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.style.cursor = 'pointer';

      const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      shadow.setAttribute('x', x - width / 2 + 2);
      shadow.setAttribute('y', y - height / 2 + 2);
      shadow.setAttribute('width', width);
      shadow.setAttribute('height', height);
      shadow.setAttribute('rx', '12');
      shadow.setAttribute('fill', 'rgba(0, 0, 0, 0.1)');
      g.appendChild(shadow);

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x - width / 2);
      rect.setAttribute('y', y - height / 2);
      rect.setAttribute('width', width);
      rect.setAttribute('height', height);
      rect.setAttribute('rx', '12');
      rect.setAttribute('fill', 'url(#nodeGradient)');
      rect.setAttribute('stroke', '#0F766E');
      rect.setAttribute('stroke-width', '2');
      g.appendChild(rect);

      const highlightRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      highlightRect.setAttribute('x', x - width / 2);
      highlightRect.setAttribute('y', y - height / 2);
      highlightRect.setAttribute('width', width);
      highlightRect.setAttribute('height', height);
      highlightRect.setAttribute('rx', '12');
      highlightRect.setAttribute('fill', 'none');
      highlightRect.setAttribute('stroke', 'rgba(255, 255, 255, 0.3)');
      highlightRect.setAttribute('stroke-width', '1');
      g.appendChild(highlightRect);

      g.addEventListener('mouseenter', () => {
        rect.setAttribute('fill', '#1AA49B');
        g.style.transform = 'scale(1.02)';
        g.style.transformOrigin = `${x}px ${y}px`;
      });

      g.addEventListener('mouseleave', () => {
        rect.setAttribute('fill', 'url(#nodeGradient)');
        g.style.transform = 'scale(1)';
      });

      svg.appendChild(g);

      const textLines = lines || wrapText(label || node.id, width - 20, 14);
      createMultilineText(svg, textLines, x, y, 14, 'white', '500');
    });
  };

  const renderEmptyState = (svg) => {
    svg.setAttribute('viewBox', '0 0 800 600');
    svg.setAttribute('width', '800');
    svg.setAttribute('height', '600');

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '400');
    text.setAttribute('y', '300');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#9CA3AF');
    text.setAttribute('font-size', '18');
    text.setAttribute('font-family', '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
    text.textContent = 'No content to display';
    svg.appendChild(text);
  };

  useEffect(() => {
    if (mindmapData) {
      renderFlowchart();
    }
  }, [mindmapData]);

  useEffect(() => {
    if (isFullscreen && mindmapData && fullscreenSvgRef.current) {
      renderFlowchart(fullscreenSvgRef, true);
      
      setTimeout(() => {
        if (fullscreenSvgRef.current && containerRef.current) {
          const svgWidth = parseInt(fullscreenSvgRef.current.getAttribute('width')) || 2400;
          const svgHeight = parseInt(fullscreenSvgRef.current.getAttribute('height')) || 1600;
          const containerWidth = window.innerWidth - 80;
          const containerHeight = window.innerHeight - 200;
          
          const scaleX = containerWidth / svgWidth;
          const scaleY = containerHeight / svgHeight;
          const autoZoom = Math.min(scaleX, scaleY, 1);
          
          setZoom(autoZoom);
          setPan({ x: 40, y: 40 });
        }
      }, 100);
    }
  }, [isFullscreen, mindmapData]);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 0.2, 3));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 0.2, 0.3));
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const renderMinimap = () => {
    if (!fullscreenSvgRef.current) return null;
    
    const svgWidth = parseInt(fullscreenSvgRef.current.getAttribute('width')) || 2400;
    const svgHeight = parseInt(fullscreenSvgRef.current.getAttribute('height')) || 1600;
    const minimapScale = 0.1;
    
    return (
      <div className="absolute bottom-20 right-4 bg-white rounded-lg shadow-2xl border-2 border-gray-300 overflow-hidden">
        <div 
          className="bg-gray-100 p-2 border-b border-gray-300 flex items-center justify-between"
          style={{ width: `${svgWidth * minimapScale}px` }}
        >
          <span className="text-xs font-medium text-gray-700">Overview</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMinimap(false);
            }}
            className="text-gray-500 hover:text-gray-700"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div style={{ 
          width: `${svgWidth * minimapScale}px`, 
          height: `${svgHeight * minimapScale}px`,
          background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)'
        }}>
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            style={{ 
              width: '100%', 
              height: '100%',
              opacity: 0.8
            }}
            dangerouslySetInnerHTML={{ 
              __html: fullscreenSvgRef.current?.innerHTML || '' 
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              border: '2px solid #21C1B6',
              background: 'rgba(33, 193, 182, 0.1)',
              pointerEvents: 'none',
              transform: `translate(${-pan.x * minimapScale}px, ${-pan.y * minimapScale}px)`,
              width: `${(window.innerWidth / zoom) * minimapScale}px`,
              height: `${(window.innerHeight / zoom) * minimapScale}px`,
            }}
          />
        </div>
      </div>
    );
  };

  const handleMouseDown = (e) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDownload = () => {
    if (!svgRef.current) return;

    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `mindmap_${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <span className="text-[#21C1B6] mr-2">◉</span>
            Mindmap Generator
          </h2>
          <div className="flex items-center space-x-2">
            {mindmapData && (
              <>
                <button
                  onClick={handleZoomOut}
                  className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-[#21C1B6] transition-colors"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4 text-gray-600" />
                </button>
                <span className="text-sm text-gray-600 font-medium min-w-[60px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-[#21C1B6] transition-colors"
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4 text-gray-600" />
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-[#21C1B6] transition-colors"
                  title="Fullscreen View"
                >
                  <Maximize2 className="h-4 w-4 text-gray-600" />
                </button>
                <button
                  onClick={handleDownload}
                  className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-[#21C1B6] transition-colors"
                  title="Download SVG"
                >
                  <Download className="h-4 w-4 text-gray-600" />
                </button>
              </>
            )}
            <button
              onClick={generateMindmap}
              disabled={isLoading || selectedFileIds.length === 0}
              className="px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2 transition-colors shadow-sm"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Generating...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  <span>Generate</span>
                </>
              )}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent"
              placeholder="Enter prompt for mindmap generation"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Flowchart Type</label>
            <select
              value={flowchartType}
              onChange={(e) => setFlowchartType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6] focus:border-transparent"
            >
              <option value="process">Process Flow</option>
              <option value="decision">Decision Tree</option>
              <option value="flow">Data Flow</option>
              <option value="hierarchy">Hierarchy</option>
            </select>
          </div>

          {uploadedDocuments && uploadedDocuments.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select Files ({selectedFileIds.length} of {uploadedDocuments.length})
              </label>
              <div className="max-h-32 overflow-y-auto space-y-1 border border-gray-200 rounded-lg p-2 bg-white">
                {uploadedDocuments.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFileIds.includes(doc.id)}
                      onChange={() => handleFileToggle(doc.id)}
                      className="rounded border-gray-300 text-[#21C1B6] focus:ring-[#21C1B6]"
                    />
                    <span className="text-sm text-gray-700 truncate flex-1">{doc.fileName}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div 
        className="flex-1 overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100" 
        ref={containerRef}
      >
        {error && (
          <div className="m-4 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg flex items-start space-x-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <p className="text-sm text-red-700 mt-1">{error}</p>
            </div>
          </div>
        )}

        {mindmapData ? (
          <div 
            className="h-full w-full overflow-auto"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <div 
              style={{ 
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                transition: isDragging ? 'none' : 'transform 0.1s ease',
                display: 'inline-block',
                minWidth: '100%',
                minHeight: '100%'
              }}
            >
              <svg
                ref={svgRef}
                style={{ 
                  display: 'block',
                  margin: '0 auto'
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center p-8">
              <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-[#21C1B6] to-[#1AA49B] flex items-center justify-center">
                <svg
                  className="w-12 h-12 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Create Your Mindmap</h3>
              <p className="text-gray-600 mb-4 max-w-md">
                Select one or more files and click Generate to create an interactive mindmap visualization
              </p>
              <div className="flex items-center justify-center space-x-4 text-sm text-gray-500">
                <div className="flex items-center">
                  <span className="w-2 h-2 bg-[#21C1B6] rounded-full mr-2"></span>
                  Auto Layout
                </div>
                <div className="flex items-center">
                  <span className="w-2 h-2 bg-[#21C1B6] rounded-full mr-2"></span>
                  Smart Text Wrapping
                </div>
                <div className="flex items-center">
                  <span className="w-2 h-2 bg-[#21C1B6] rounded-full mr-2"></span>
                  Zoom & Pan
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {mindmapData && (mindmapData.flowchart || mindmapData.mermaid_code) && (
        <details className="border-t border-gray-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            View Raw Flowchart Code
          </summary>
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
            <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto font-mono bg-white p-3 rounded border border-gray-200 max-h-64 overflow-y-auto">
              {mindmapData.flowchart || mindmapData.mermaid_code}
            </pre>
          </div>
        </details>
      )}

      {isFullscreen && (
        <div 
          className="fixed inset-0 z-50 bg-black bg-opacity-90 flex flex-col"
          onClick={toggleFullscreen}
        >
          <div className="flex items-center justify-between p-4 bg-gray-900 bg-opacity-80 backdrop-blur">
            <div className="flex items-center space-x-4">
              <h3 className="text-white font-semibold text-lg">Mindmap - Fullscreen View</h3>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleZoomOut();
                  }}
                  className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4 text-white" />
                </button>
                <span className="text-white text-sm font-medium min-w-[60px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleZoomIn();
                  }}
                  className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                  title="Zoom In"
                >
                  <ZoomIn className="h-4 w-4 text-white" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleResetView();
                  }}
                  className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
                  title="Reset View"
                >
                  <RefreshCw className="h-4 w-4 text-white" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMinimap(!showMinimap);
                  }}
                  className={`p-2 rounded-lg transition-colors ${showMinimap ? 'bg-[#21C1B6]' : 'bg-gray-800 hover:bg-gray-700'}`}
                  title="Toggle Overview Map"
                >
                  <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </button>
              </div>
            </div>
            <button
              onClick={toggleFullscreen}
              className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
              title="Close Fullscreen"
            >
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div 
            className="flex-1 overflow-auto relative"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <div 
              style={{ 
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                transition: isDragging ? 'none' : 'transform 0.1s ease',
                display: 'inline-block',
                minWidth: '100%',
                minHeight: '100%',
                padding: '40px'
              }}
            >
              <svg
                ref={fullscreenSvgRef}
                style={{ 
                  display: 'block',
                  margin: '0 auto',
                  filter: 'drop-shadow(0 10px 30px rgba(0, 0, 0, 0.3))'
                }}
              />
            </div>

            {showMinimap && renderMinimap()}
          </div>

          <div className="p-3 bg-gray-900 bg-opacity-80 backdrop-blur text-center">
            <p className="text-gray-400 text-sm">
              <span className="inline-flex items-center mx-2">
                <span className="w-2 h-2 bg-[#21C1B6] rounded-full mr-1"></span>
                Drag to pan
              </span>
              <span className="inline-flex items-center mx-2">
                <span className="w-2 h-2 bg-[#21C1B6] rounded-full mr-1"></span>
                Use controls to zoom
              </span>
              <span className="inline-flex items-center mx-2">
                <span className="w-2 h-2 bg-[#21C1B6] rounded-full mr-1"></span>
                Click outside to close
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Mindmap;