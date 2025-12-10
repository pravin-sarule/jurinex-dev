// import React, { useState, useEffect, useRef } from 'react';
// import { Loader2, AlertCircle, RefreshCw, Download } from 'lucide-react';

// const Mindmap = ({ fileId, uploadedDocuments, apiBaseUrl, getAuthToken }) => {
//   const [mindmapData, setMindmapData] = useState(null);
//   const [isLoading, setIsLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const [prompt, setPrompt] = useState('Create unified flowchart');
//   const [flowchartType, setFlowchartType] = useState('process');
//   const [selectedFileIds, setSelectedFileIds] = useState([]);
//   const svgRef = useRef(null);

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
//       setError('Please select at least one file');
//       return;
//     }

//     setIsLoading(true);
//     setError(null);

//     try {
//       const token = getAuthToken();
//       const headers = { 'Content-Type': 'application/json' };
//       if (token) headers['Authorization'] = `Bearer ${token}`;

//       let requestBody;
//       let url;

//       if (selectedFileIds.length === 1) {
//         // Single file API
//         requestBody = {
//           file_id: selectedFileIds[0],
//           prompt: prompt,
//           flowchart_type: flowchartType,
//         };
//         url = `${apiBaseUrl}/visual/generate-flowchart`;
//       } else {
//         // Multi file API
//         requestBody = {
//           file_ids: selectedFileIds,
//           prompt: prompt,
//           flowchart_type: flowchartType,
//         };
//         url = `${apiBaseUrl}/visual/generate-flowchart-multi`;
//       }

//       const response = await fetch(url, {
//         method: 'POST',
//         headers,
//         body: JSON.stringify(requestBody),
//       });

//       if (!response.ok) {
//         const errorData = await response.json().catch(() => ({}));
//         throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
//       }

//       const data = await response.json();
//       setMindmapData(data);
//     } catch (err) {
//       console.error('Error generating mindmap:', err);
//       setError(err.message || 'Failed to generate mindmap');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   const renderMindmap = () => {
//     if (!mindmapData || !svgRef.current) return null;

//     const svg = svgRef.current;
//     const width = svg.clientWidth || 800;
//     const height = svg.clientHeight || 600;

//     // Clear previous content
//     svg.innerHTML = '';

//     // Parse the flowchart data (assuming it's in Mermaid or similar format)
//     // For now, we'll create a simple node-based visualization
//     if (mindmapData.flowchart || mindmapData.data) {
//       const flowchartContent = mindmapData.flowchart || mindmapData.data || '';
      
//       // If it's a Mermaid diagram, we can render it
//       if (typeof flowchartContent === 'string' && flowchartContent.includes('graph') || flowchartContent.includes('flowchart')) {
//         // For Mermaid diagrams, we'll use a simple text representation
//         // In production, you'd use a library like mermaid.js
//         const parser = document.createElement('div');
//         parser.innerHTML = flowchartContent;
//         return parser.textContent;
//       }

//       // Create a simple node-based visualization
//       const nodes = mindmapData.nodes || [];
//       const edges = mindmapData.edges || [];

//       if (nodes.length === 0) {
//         // Try to parse from text
//         return renderTextBasedMindmap(flowchartContent, width, height);
//       }

//       return renderNodeBasedMindmap(nodes, edges, width, height);
//     }

//     return null;
//   };

//   const renderTextBasedMindmap = (content, width, height) => {
//     const svg = svgRef.current;
//     if (!svg) return;

//     // Simple text-based mindmap - center node with branches
//     const centerX = width / 2;
//     const centerY = height / 2;
//     const radius = Math.min(width, height) * 0.3;

//     // Center node
//     const centerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
//     centerCircle.setAttribute('cx', centerX);
//     centerCircle.setAttribute('cy', centerY);
//     centerCircle.setAttribute('r', 40);
//     centerCircle.setAttribute('fill', '#21C1B6');
//     centerCircle.setAttribute('stroke', '#1AA49B');
//     centerCircle.setAttribute('stroke-width', '2');
//     svg.appendChild(centerCircle);

//     // Center text
//     const centerText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
//     centerText.setAttribute('x', centerX);
//     centerText.setAttribute('y', centerY);
//     centerText.setAttribute('text-anchor', 'middle');
//     centerText.setAttribute('dominant-baseline', 'middle');
//     centerText.setAttribute('fill', 'white');
//     centerText.setAttribute('font-size', '14');
//     centerText.setAttribute('font-weight', 'bold');
//     centerText.textContent = 'Main Topic';
//     svg.appendChild(centerText);

//     // Create branches (simplified)
//     const branches = content.split('\n').filter(line => line.trim()).slice(0, 6);
//     branches.forEach((branch, index) => {
//       const angle = (index * 2 * Math.PI) / branches.length;
//       const branchX = centerX + radius * Math.cos(angle);
//       const branchY = centerY + radius * Math.sin(angle);

//       // Line
//       const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
//       line.setAttribute('x1', centerX);
//       line.setAttribute('y1', centerY);
//       line.setAttribute('x2', branchX);
//       line.setAttribute('y2', branchY);
//       line.setAttribute('stroke', '#21C1B6');
//       line.setAttribute('stroke-width', '2');
//       svg.appendChild(line);

//       // Branch node
//       const branchCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
//       branchCircle.setAttribute('cx', branchX);
//       branchCircle.setAttribute('cy', branchY);
//       branchCircle.setAttribute('r', 30);
//       branchCircle.setAttribute('fill', 'white');
//       branchCircle.setAttribute('stroke', '#21C1B6');
//       branchCircle.setAttribute('stroke-width', '2');
//       svg.appendChild(branchCircle);

//       // Branch text
//       const branchText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
//       branchText.setAttribute('x', branchX);
//       branchText.setAttribute('y', branchY);
//       branchText.setAttribute('text-anchor', 'middle');
//       branchText.setAttribute('dominant-baseline', 'middle');
//       branchText.setAttribute('fill', '#1AA49B');
//       branchText.setAttribute('font-size', '12');
//       branchText.textContent = branch.substring(0, 15);
//       svg.appendChild(branchText);
//     });
//   };

//   const renderNodeBasedMindmap = (nodes, edges, width, height) => {
//     const svg = svgRef.current;
//     if (!svg) return;

//     // Render nodes and edges
//     nodes.forEach((node) => {
//       const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
//       circle.setAttribute('cx', node.x || width / 2);
//       circle.setAttribute('cy', node.y || height / 2);
//       circle.setAttribute('r', node.radius || 30);
//       circle.setAttribute('fill', node.color || '#21C1B6');
//       circle.setAttribute('stroke', '#1AA49B');
//       circle.setAttribute('stroke-width', '2');
//       svg.appendChild(circle);

//       const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
//       text.setAttribute('x', node.x || width / 2);
//       text.setAttribute('y', (node.y || height / 2) + 5);
//       text.setAttribute('text-anchor', 'middle');
//       text.setAttribute('fill', 'white');
//       text.setAttribute('font-size', '12');
//       text.textContent = node.label || node.id;
//       svg.appendChild(text);
//     });

//     edges.forEach((edge) => {
//       const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
//       const fromNode = nodes.find((n) => n.id === edge.from);
//       const toNode = nodes.find((n) => n.id === edge.to);
//       if (fromNode && toNode) {
//         line.setAttribute('x1', fromNode.x || width / 2);
//         line.setAttribute('y1', fromNode.y || height / 2);
//         line.setAttribute('x2', toNode.x || width / 2);
//         line.setAttribute('y2', toNode.y || height / 2);
//         line.setAttribute('stroke', '#21C1B6');
//         line.setAttribute('stroke-width', '2');
//         svg.appendChild(line);
//       }
//     });
//   };

//   useEffect(() => {
//     if (mindmapData && svgRef.current) {
//       renderMindmap();
//     }
//   }, [mindmapData]);

//   return (
//     <div className="h-full flex flex-col bg-white">
//       <div className="p-4 border-b border-gray-200 bg-gray-50">
//         <div className="flex items-center justify-between mb-4">
//           <h2 className="text-lg font-semibold text-gray-900">Mindmap Generator</h2>
//           <div className="flex items-center space-x-2">
//             <button
//               onClick={generateMindmap}
//               disabled={isLoading || selectedFileIds.length === 0}
//               className="px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2"
//             >
//               {isLoading ? (
//                 <>
//                   <Loader2 className="h-4 w-4 animate-spin" />
//                   <span>Generating...</span>
//                 </>
//               ) : (
//                 <>
//                   <RefreshCw className="h-4 w-4" />
//                   <span>Generate</span>
//                 </>
//               )}
//             </button>
//           </div>
//         </div>

//         <div className="space-y-3">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
//             <input
//               type="text"
//               value={prompt}
//               onChange={(e) => setPrompt(e.target.value)}
//               className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
//               placeholder="Enter prompt for mindmap generation"
//             />
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-1">Flowchart Type</label>
//             <select
//               value={flowchartType}
//               onChange={(e) => setFlowchartType(e.target.value)}
//               className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
//             >
//               <option value="process">Process</option>
//               <option value="decision">Decision</option>
//               <option value="flow">Flow</option>
//               <option value="hierarchy">Hierarchy</option>
//             </select>
//           </div>

//           {uploadedDocuments && uploadedDocuments.length > 0 && (
//             <div>
//               <label className="block text-sm font-medium text-gray-700 mb-2">Select Files</label>
//               <div className="max-h-32 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2">
//                 {uploadedDocuments.map((doc) => (
//                   <label
//                     key={doc.id}
//                     className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
//                   >
//                     <input
//                       type="checkbox"
//                       checked={selectedFileIds.includes(doc.id)}
//                       onChange={() => handleFileToggle(doc.id)}
//                       className="rounded border-gray-300 text-[#21C1B6] focus:ring-[#21C1B6]"
//                     />
//                     <span className="text-sm text-gray-700">{doc.fileName}</span>
//                   </label>
//                 ))}
//               </div>
//             </div>
//           )}
//         </div>
//       </div>

//       <div className="flex-1 overflow-auto p-4 bg-gray-50">
//         {error && (
//           <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2">
//             <AlertCircle className="h-5 w-5 text-red-500" />
//             <span className="text-sm text-red-700">{error}</span>
//           </div>
//         )}

//         {mindmapData ? (
//           <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 h-full">
//             <svg
//               ref={svgRef}
//               width="100%"
//               height="100%"
//               viewBox="0 0 800 600"
//               className="w-full h-full min-h-[500px]"
//               style={{ border: '1px solid #e5e7eb', borderRadius: '8px' }}
//             >
//               {/* SVG content will be rendered here */}
//             </svg>
//             {mindmapData.flowchart && typeof mindmapData.flowchart === 'string' && (
//               <div className="mt-4 p-3 bg-gray-50 rounded-lg">
//                 <pre className="text-xs text-gray-700 whitespace-pre-wrap">{mindmapData.flowchart}</pre>
//               </div>
//             )}
//           </div>
//         ) : (
//           <div className="flex items-center justify-center h-full text-gray-500">
//             <div className="text-center">
//               <p className="text-lg mb-2">No mindmap generated yet</p>
//               <p className="text-sm">Select files and click Generate to create a mindmap</p>
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default Mindmap;

// import React, { useState, useEffect, useRef } from 'react';
// import { Loader2, AlertCircle, RefreshCw, Download, ZoomIn, ZoomOut } from 'lucide-react';

// const Mindmap = ({ fileId, uploadedDocuments, apiBaseUrl, getAuthToken }) => {
//   const [mindmapData, setMindmapData] = useState(null);
//   const [isLoading, setIsLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const [prompt, setPrompt] = useState('Create unified flowchart');
//   const [flowchartType, setFlowchartType] = useState('process');
//   const [selectedFileIds, setSelectedFileIds] = useState([]);
//   const [zoom, setZoom] = useState(1);
//   const svgRef = useRef(null);
//   const containerRef = useRef(null);

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
//       setError('Please select at least one file');
//       return;
//     }

//     setIsLoading(true);
//     setError(null);

//     try {
//       const token = getAuthToken();
//       const headers = { 'Content-Type': 'application/json' };
//       if (token) headers['Authorization'] = `Bearer ${token}`;

//       let requestBody;
//       let url;

//       if (selectedFileIds.length === 1) {
//         requestBody = {
//           file_id: selectedFileIds[0],
//           prompt: prompt,
//           flowchart_type: flowchartType,
//         };
//         url = `${apiBaseUrl}/visual/generate-flowchart`;
//       } else {
//         requestBody = {
//           file_ids: selectedFileIds,
//           prompt: prompt,
//           flowchart_type: flowchartType,
//         };
//         url = `${apiBaseUrl}/visual/generate-flowchart-multi`;
//       }

//       const response = await fetch(url, {
//         method: 'POST',
//         headers,
//         body: JSON.stringify(requestBody),
//       });

//       if (!response.ok) {
//         const errorData = await response.json().catch(() => ({}));
//         throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
//       }

//       const data = await response.json();
//       setMindmapData(data);
//       setZoom(1); // Reset zoom
//     } catch (err) {
//       console.error('Error generating mindmap:', err);
//       setError(err.message || 'Failed to generate mindmap');
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Wrap text to fit within a given width
//   const wrapText = (text, maxWidth, fontSize = 12) => {
//     const words = text.split(' ');
//     const lines = [];
//     let currentLine = '';

//     // Approximate character width (adjust based on font)
//     const charWidth = fontSize * 0.6;
//     const maxCharsPerLine = Math.floor(maxWidth / charWidth);

//     words.forEach((word) => {
//       const testLine = currentLine ? `${currentLine} ${word}` : word;
//       if (testLine.length <= maxCharsPerLine) {
//         currentLine = testLine;
//       } else {
//         if (currentLine) lines.push(currentLine);
//         currentLine = word;
//       }
//     });

//     if (currentLine) lines.push(currentLine);
//     return lines;
//   };

//   // Create text element with wrapping
//   const createWrappedText = (svg, text, x, y, maxWidth, fontSize = 12, fill = 'white', fontWeight = 'normal') => {
//     const lines = wrapText(text, maxWidth, fontSize);
//     const lineHeight = fontSize * 1.2;
//     const totalHeight = lines.length * lineHeight;
//     const startY = y - (totalHeight / 2) + (lineHeight / 2);

//     lines.forEach((line, index) => {
//       const textElement = document.createElementNS('http://www.w3.org/2000/svg', 'text');
//       textElement.setAttribute('x', x);
//       textElement.setAttribute('y', startY + (index * lineHeight));
//       textElement.setAttribute('text-anchor', 'middle');
//       textElement.setAttribute('dominant-baseline', 'middle');
//       textElement.setAttribute('fill', fill);
//       textElement.setAttribute('font-size', fontSize);
//       textElement.setAttribute('font-weight', fontWeight);
//       textElement.textContent = line;
//       svg.appendChild(textElement);
//     });

//     return lines.length;
//   };

//   // Parse Mermaid-style flowchart
//   const parseMermaidFlowchart = (content) => {
//     const nodes = [];
//     const edges = [];
//     const lines = content.split('\n').filter(line => line.trim());

//     let nodeIdCounter = 0;
//     const nodeMap = new Map();

//     lines.forEach((line) => {
//       line = line.trim();
      
//       // Skip graph/flowchart declarations
//       if (line.startsWith('graph') || line.startsWith('flowchart')) return;

//       // Parse node definitions: A[Label] or A(Label) or A{Label}
//       const nodeMatch = line.match(/(\w+)[\[\(\{]([^\]\)\}]+)[\]\)\}]/g);
//       if (nodeMatch) {
//         nodeMatch.forEach((match) => {
//           const parts = match.match(/(\w+)[\[\(\{]([^\]\)\}]+)[\]\)\}]/);
//           if (parts) {
//             const [, id, label] = parts;
//             if (!nodeMap.has(id)) {
//               nodeMap.set(id, {
//                 id,
//                 label: label.trim(),
//                 index: nodeIdCounter++
//               });
//               nodes.push(nodeMap.get(id));
//             }
//           }
//         });
//       }

//       // Parse edges: A --> B or A -> B or A --- B
//       const edgeMatch = line.match(/(\w+)\s*[-=]+>?\s*(\w+)/);
//       if (edgeMatch) {
//         const [, from, to] = edgeMatch;
//         edges.push({ from, to });
//       }
//     });

//     return { nodes, edges };
//   };

//   // Auto-layout algorithm (hierarchical)
//   const calculateNodePositions = (nodes, edges, width, height) => {
//     if (nodes.length === 0) return { nodes, edges };

//     // Build adjacency list
//     const adjList = new Map();
//     nodes.forEach(node => adjList.set(node.id, []));
//     edges.forEach(edge => {
//       if (adjList.has(edge.from)) {
//         adjList.get(edge.from).push(edge.to);
//       }
//     });

//     // Find root nodes (nodes with no incoming edges)
//     const incomingCount = new Map();
//     nodes.forEach(node => incomingCount.set(node.id, 0));
//     edges.forEach(edge => {
//       incomingCount.set(edge.to, (incomingCount.get(edge.to) || 0) + 1);
//     });

//     const rootNodes = nodes.filter(node => incomingCount.get(node.id) === 0);
//     if (rootNodes.length === 0 && nodes.length > 0) {
//       rootNodes.push(nodes[0]); // Fallback to first node
//     }

//     // BFS to assign levels
//     const levels = new Map();
//     const queue = rootNodes.map(node => ({ id: node.id, level: 0 }));
//     const visited = new Set();

//     while (queue.length > 0) {
//       const { id, level } = queue.shift();
//       if (visited.has(id)) continue;
//       visited.add(id);
//       levels.set(id, level);

//       const children = adjList.get(id) || [];
//       children.forEach(childId => {
//         if (!visited.has(childId)) {
//           queue.push({ id: childId, level: level + 1 });
//         }
//       });
//     }

//     // Nodes not reached from roots
//     nodes.forEach(node => {
//       if (!levels.has(node.id)) {
//         levels.set(node.id, 0);
//       }
//     });

//     // Group nodes by level
//     const levelGroups = new Map();
//     nodes.forEach(node => {
//       const level = levels.get(node.id);
//       if (!levelGroups.has(level)) {
//         levelGroups.set(level, []);
//       }
//       levelGroups.get(level).push(node);
//     });

//     // Calculate positions
//     const maxLevel = Math.max(...Array.from(levels.values()));
//     const levelHeight = height / (maxLevel + 2);
//     const margin = 100;

//     const positionedNodes = nodes.map(node => {
//       const level = levels.get(node.id);
//       const nodesInLevel = levelGroups.get(level);
//       const indexInLevel = nodesInLevel.indexOf(node);
//       const levelWidth = width - (2 * margin);
//       const nodeSpacing = levelWidth / (nodesInLevel.length + 1);

//       return {
//         ...node,
//         x: margin + nodeSpacing * (indexInLevel + 1),
//         y: margin + levelHeight * (level + 1),
//         level
//       };
//     });

//     return { nodes: positionedNodes, edges };
//   };

//   // Render flowchart from parsed data
//   const renderFlowchart = () => {
//     if (!mindmapData || !svgRef.current) return;

//     const svg = svgRef.current;
//     const width = 1200;
//     const height = 800;

//     // Clear previous content
//     svg.innerHTML = '';

//     let flowchartContent = mindmapData.flowchart || mindmapData.data || mindmapData.mermaid_code || '';
    
//     // Handle different response formats
//     if (typeof flowchartContent === 'object') {
//       flowchartContent = JSON.stringify(flowchartContent, null, 2);
//     }

//     let parsedData = { nodes: [], edges: [] };

//     // Try to parse as Mermaid
//     if (typeof flowchartContent === 'string' && 
//         (flowchartContent.includes('graph') || 
//          flowchartContent.includes('flowchart') ||
//          flowchartContent.includes('-->'))) {
//       parsedData = parseMermaidFlowchart(flowchartContent);
//     }
    
//     // Check if API returned structured data
//     if (mindmapData.nodes && Array.isArray(mindmapData.nodes)) {
//       parsedData.nodes = mindmapData.nodes;
//     }
//     if (mindmapData.edges && Array.isArray(mindmapData.edges)) {
//       parsedData.edges = mindmapData.edges;
//     }

//     // If still no nodes, try to extract from text
//     if (parsedData.nodes.length === 0 && typeof flowchartContent === 'string') {
//       const lines = flowchartContent.split('\n').filter(line => line.trim());
//       parsedData.nodes = lines.slice(0, 10).map((line, index) => ({
//         id: `node${index}`,
//         label: line.trim().substring(0, 50),
//         index
//       }));
//     }

//     if (parsedData.nodes.length === 0) {
//       // Show empty state
//       const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
//       text.setAttribute('x', width / 2);
//       text.setAttribute('y', height / 2);
//       text.setAttribute('text-anchor', 'middle');
//       text.setAttribute('fill', '#9CA3AF');
//       text.setAttribute('font-size', '16');
//       text.textContent = 'No flowchart data to display';
//       svg.appendChild(text);
//       return;
//     }

//     // Calculate positions
//     const { nodes, edges } = calculateNodePositions(parsedData.nodes, parsedData.edges, width, height);

//     // Define arrow marker
//     const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
//     const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
//     marker.setAttribute('id', 'arrowhead');
//     marker.setAttribute('markerWidth', '10');
//     marker.setAttribute('markerHeight', '10');
//     marker.setAttribute('refX', '9');
//     marker.setAttribute('refY', '3');
//     marker.setAttribute('orient', 'auto');
//     const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
//     polygon.setAttribute('points', '0 0, 10 3, 0 6');
//     polygon.setAttribute('fill', '#21C1B6');
//     marker.appendChild(polygon);
//     defs.appendChild(marker);
//     svg.appendChild(defs);

//     // Draw edges first (so they appear behind nodes)
//     edges.forEach((edge) => {
//       const fromNode = nodes.find(n => n.id === edge.from);
//       const toNode = nodes.find(n => n.id === edge.to);
      
//       if (fromNode && toNode) {
//         const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
//         line.setAttribute('x1', fromNode.x);
//         line.setAttribute('y1', fromNode.y);
//         line.setAttribute('x2', toNode.x);
//         line.setAttribute('y2', toNode.y);
//         line.setAttribute('stroke', '#21C1B6');
//         line.setAttribute('stroke-width', '2');
//         line.setAttribute('marker-end', 'url(#arrowhead)');
//         svg.appendChild(line);
//       }
//     });

//     // Draw nodes
//     nodes.forEach((node) => {
//       const nodeWidth = 140;
//       const nodeHeight = 60;
//       const x = node.x;
//       const y = node.y;

//       // Node background (rounded rectangle)
//       const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
//       rect.setAttribute('x', x - nodeWidth / 2);
//       rect.setAttribute('y', y - nodeHeight / 2);
//       rect.setAttribute('width', nodeWidth);
//       rect.setAttribute('height', nodeHeight);
//       rect.setAttribute('rx', '8');
//       rect.setAttribute('ry', '8');
//       rect.setAttribute('fill', '#21C1B6');
//       rect.setAttribute('stroke', '#1AA49B');
//       rect.setAttribute('stroke-width', '2');
//       rect.style.cursor = 'pointer';
      
//       // Add hover effect
//       rect.addEventListener('mouseenter', () => {
//         rect.setAttribute('fill', '#1AA49B');
//       });
//       rect.addEventListener('mouseleave', () => {
//         rect.setAttribute('fill', '#21C1B6');
//       });
      
//       svg.appendChild(rect);

//       // Node text with wrapping
//       const label = node.label || node.id || '';
//       createWrappedText(svg, label, x, y, nodeWidth - 16, 12, 'white', 'normal');
//     });

//     // Update viewBox to fit content
//     svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
//   };

//   useEffect(() => {
//     if (mindmapData) {
//       renderFlowchart();
//     }
//   }, [mindmapData]);

//   const handleZoomIn = () => {
//     setZoom(prev => Math.min(prev + 0.2, 3));
//   };

//   const handleZoomOut = () => {
//     setZoom(prev => Math.max(prev - 0.2, 0.5));
//   };

//   const handleDownload = () => {
//     if (!svgRef.current) return;

//     const svgData = new XMLSerializer().serializeToString(svgRef.current);
//     const blob = new Blob([svgData], { type: 'image/svg+xml' });
//     const url = URL.createObjectURL(blob);
//     const link = document.createElement('a');
//     link.href = url;
//     link.download = 'mindmap.svg';
//     link.click();
//     URL.revokeObjectURL(url);
//   };

//   return (
//     <div className="h-full flex flex-col bg-white">
//       {/* Header */}
//       <div className="p-4 border-b border-gray-200 bg-gray-50">
//         <div className="flex items-center justify-between mb-4">
//           <h2 className="text-lg font-semibold text-gray-900">Mindmap Generator</h2>
//           <div className="flex items-center space-x-2">
//             {mindmapData && (
//               <>
//                 <button
//                   onClick={handleZoomOut}
//                   className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
//                   title="Zoom Out"
//                 >
//                   <ZoomOut className="h-4 w-4" />
//                 </button>
//                 <button
//                   onClick={handleZoomIn}
//                   className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
//                   title="Zoom In"
//                 >
//                   <ZoomIn className="h-4 w-4" />
//                 </button>
//                 <button
//                   onClick={handleDownload}
//                   className="p-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
//                   title="Download SVG"
//                 >
//                   <Download className="h-4 w-4" />
//                 </button>
//               </>
//             )}
//             <button
//               onClick={generateMindmap}
//               disabled={isLoading || selectedFileIds.length === 0}
//               className="px-4 py-2 bg-[#21C1B6] text-white rounded-lg hover:bg-[#1AA49B] disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2"
//             >
//               {isLoading ? (
//                 <>
//                   <Loader2 className="h-4 w-4 animate-spin" />
//                   <span>Generating...</span>
//                 </>
//               ) : (
//                 <>
//                   <RefreshCw className="h-4 w-4" />
//                   <span>Generate</span>
//                 </>
//               )}
//             </button>
//           </div>
//         </div>

//         <div className="space-y-3">
//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
//             <input
//               type="text"
//               value={prompt}
//               onChange={(e) => setPrompt(e.target.value)}
//               className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
//               placeholder="Enter prompt for mindmap generation"
//             />
//           </div>

//           <div>
//             <label className="block text-sm font-medium text-gray-700 mb-1">Flowchart Type</label>
//             <select
//               value={flowchartType}
//               onChange={(e) => setFlowchartType(e.target.value)}
//               className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#21C1B6]"
//             >
//               <option value="process">Process</option>
//               <option value="decision">Decision</option>
//               <option value="flow">Flow</option>
//               <option value="hierarchy">Hierarchy</option>
//             </select>
//           </div>

//           {uploadedDocuments && uploadedDocuments.length > 0 && (
//             <div>
//               <label className="block text-sm font-medium text-gray-700 mb-2">
//                 Select Files ({selectedFileIds.length} selected)
//               </label>
//               <div className="max-h-32 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2 bg-white">
//                 {uploadedDocuments.map((doc) => (
//                   <label
//                     key={doc.id}
//                     className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
//                   >
//                     <input
//                       type="checkbox"
//                       checked={selectedFileIds.includes(doc.id)}
//                       onChange={() => handleFileToggle(doc.id)}
//                       className="rounded border-gray-300 text-[#21C1B6] focus:ring-[#21C1B6]"
//                     />
//                     <span className="text-sm text-gray-700 truncate">{doc.fileName}</span>
//                   </label>
//                 ))}
//               </div>
//             </div>
//           )}
//         </div>
//       </div>

//       {/* Content Area */}
//       <div className="flex-1 overflow-auto p-4 bg-gray-50" ref={containerRef}>
//         {error && (
//           <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center space-x-2">
//             <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
//             <span className="text-sm text-red-700">{error}</span>
//           </div>
//         )}

//         {mindmapData ? (
//           <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
//             <div 
//               className="overflow-auto" 
//               style={{ 
//                 width: '100%', 
//                 height: '600px',
//                 display: 'flex',
//                 justifyContent: 'center',
//                 alignItems: 'center'
//               }}
//             >
//               <svg
//                 ref={svgRef}
//                 style={{ 
//                   transform: `scale(${zoom})`,
//                   transformOrigin: 'center center',
//                   transition: 'transform 0.2s ease'
//                 }}
//                 className="max-w-full"
//               />
//             </div>
            
//             {/* Show raw data if available */}
//             {(mindmapData.flowchart || mindmapData.mermaid_code) && typeof (mindmapData.flowchart || mindmapData.mermaid_code) === 'string' && (
//               <details className="mt-4">
//                 <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
//                   View Raw Flowchart Data
//                 </summary>
//                 <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
//                   <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto">
//                     {mindmapData.flowchart || mindmapData.mermaid_code}
//                   </pre>
//                 </div>
//               </details>
//             )}
//           </div>
//         ) : (
//           <div className="flex items-center justify-center h-full text-gray-500">
//             <div className="text-center">
//               <svg
//                 className="mx-auto h-12 w-12 text-gray-400 mb-4"
//                 fill="none"
//                 viewBox="0 0 24 24"
//                 stroke="currentColor"
//               >
//                 <path
//                   strokeLinecap="round"
//                   strokeLinejoin="round"
//                   strokeWidth={2}
//                   d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
//                 />
//               </svg>
//               <p className="text-lg font-medium mb-2">No mindmap generated yet</p>
//               <p className="text-sm text-gray-400">Select files and click Generate to create a mindmap</p>
//             </div>
//           </div>
//         )}
//       </div>
//     </div>
//   );
// };

// export default Mindmap;



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

  // Helper function to check if file is processed
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
      return true; // Assume processed if check fails
    }
  };

  // Helper function to make API request with retry logic
  const makeRequestWithRetry = async (url, headers, requestBody, maxRetries = 2, retryDelay = 1000) => {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Wait before retrying (exponential backoff)
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
          // If it's a 500 error and we have retries left, retry
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
        // If it's not a 500 error or we're out of retries, throw immediately
        if (err.message && !err.message.includes('500') && !err.message.includes('Server error')) {
          throw err;
        }
        // For 500 errors, continue to retry
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
      // Check if files are processed before generating (for single file)
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

      // Use retry logic for the request
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

  // Measure text width accurately
  const measureText = (text, fontSize = 14, fontWeight = 'normal') => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    context.font = `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    return context.measureText(text).width;
  };

  // Smart text wrapping with actual measurement
  const wrapText = (text, maxWidth, fontSize = 14) => {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach((word, index) => {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = measureText(testLine, fontSize);

      if (width <= maxWidth - 20) { // 20px padding
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

  // Parse Mermaid flowchart with comprehensive support
  const parseMermaidFlowchart = (content) => {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();
    let nodeIdCounter = 0;

    const lines = content.split('\n');

    lines.forEach((line) => {
      line = line.trim();

      // Skip comments and empty lines
      if (!line || line.startsWith('%%') || line.startsWith('graph') || line.startsWith('flowchart')) {
        return;
      }

      // Match various node patterns:
      // A[Text], A(Text), A{Text}, A((Text)), A>Text], A[[Text]]
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

      // Match edges with various arrow types
      // --> <- --- ==> <-- -.-> -.- etc.
      const edgePattern = /(\w+)\s*(-+\.?-+>?|=+>|<-+)\s*(\w+)/g;
      
      while ((match = edgePattern.exec(line)) !== null) {
        const [, from, arrow, to] = match;
        
        // Make sure both nodes exist
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

      // Handle subgraph definitions
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

  // Advanced hierarchical layout algorithm
  const calculateNodePositions = (nodes, edges, canvasWidth = 2400, canvasHeight = 1600) => {
    if (nodes.length === 0) return { nodes, edges, width: canvasWidth, height: canvasHeight };

    // Build adjacency lists
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

    // Find root nodes (no incoming edges)
    const rootNodes = nodes.filter(node => 
      reverseAdjList.get(node.id).length === 0
    );

    // If no clear roots, use nodes with most outgoing edges
    if (rootNodes.length === 0 && nodes.length > 0) {
      const nodesByOutDegree = [...nodes].sort((a, b) => 
        adjList.get(b.id).length - adjList.get(a.id).length
      );
      rootNodes.push(nodesByOutDegree[0]);
    }

    // BFS to assign levels
    const levels = new Map();
    const queue = rootNodes.map(node => ({ id: node.id, level: 0 }));
    const visited = new Set();

    while (queue.length > 0) {
      const { id, level } = queue.shift();
      
      if (visited.has(id)) {
        // Update level if we found a shorter path
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

    // Handle disconnected nodes
    nodes.forEach(node => {
      if (!levels.has(node.id)) {
        levels.set(node.id, 0);
      }
    });

    // Group nodes by level
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

    // Calculate dynamic spacing
    const verticalSpacing = Math.max(150, canvasHeight / (numLevels + 1));
    const horizontalPadding = 100;

    // Calculate node dimensions based on text
    const positionedNodes = nodes.map(node => {
      const level = levels.get(node.id);
      const nodesInLevel = levelGroups.get(level);
      const indexInLevel = nodesInLevel.indexOf(node);

      // Calculate node size based on text
      const lines = wrapText(node.label, 200, 14);
      const textWidth = Math.max(...lines.map(line => measureText(line, 14)));
      const nodeWidth = Math.max(textWidth + 40, 140); // min 140px
      const nodeHeight = Math.max(lines.length * 20 + 30, 60); // min 60px

      // Calculate horizontal spacing for this level
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

    // Calculate actual canvas size needed
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

  // Create multiline text in SVG
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

  // Render the complete flowchart
  const renderFlowchart = (targetSvgRef = svgRef, isFullscreenMode = false) => {
    if (!mindmapData || !targetSvgRef.current) return;

    const svg = targetSvgRef.current;
    svg.innerHTML = '';

    // Extract flowchart content
    let flowchartContent = mindmapData.flowchart || 
                          mindmapData.data || 
                          mindmapData.mermaid_code || 
                          mindmapData.content ||
                          '';

    if (typeof flowchartContent === 'object' && !Array.isArray(flowchartContent)) {
      flowchartContent = JSON.stringify(flowchartContent, null, 2);
    }

    let parsedData = { nodes: [], edges: [] };

    // Check for structured data first
    if (mindmapData.nodes && Array.isArray(mindmapData.nodes)) {
      parsedData.nodes = mindmapData.nodes;
      parsedData.edges = mindmapData.edges || [];
    } 
    // Parse Mermaid format
    else if (typeof flowchartContent === 'string' && flowchartContent.trim()) {
      parsedData = parseMermaidFlowchart(flowchartContent);
    }

    // Fallback: create nodes from lines
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

      // Create sequential edges
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

    // Calculate layout
    const { nodes, edges, width, height } = calculateNodePositions(
      parsedData.nodes, 
      parsedData.edges,
      2400,
      1600
    );

    // Set viewBox
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    // Create definitions for gradients and markers
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Gradient for nodes
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

    // Arrow marker
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

    // Dashed arrow marker
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

    // Draw edges
    edges.forEach((edge) => {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);

      if (fromNode && toNode) {
        // Calculate edge start and end points (from edge of rectangles)
        const dx = toNode.x - fromNode.x;
        const dy = toNode.y - fromNode.y;
        const angle = Math.atan2(dy, dx);

        // Start point (edge of source node)
        const startX = fromNode.x + (fromNode.width / 2) * Math.cos(angle);
        const startY = fromNode.y + (fromNode.height / 2) * Math.sin(angle);

        // End point (edge of target node)
        const endX = toNode.x - (toNode.width / 2) * Math.cos(angle);
        const endY = toNode.y - (toNode.height / 2) * Math.sin(angle);

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        // Use curved paths for better aesthetics
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

    // Draw nodes
    nodes.forEach((node) => {
      const { x, y, width, height, lines, label } = node;

      // Node group
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.style.cursor = 'pointer';

      // Shadow
      const shadow = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      shadow.setAttribute('x', x - width / 2 + 2);
      shadow.setAttribute('y', y - height / 2 + 2);
      shadow.setAttribute('width', width);
      shadow.setAttribute('height', height);
      shadow.setAttribute('rx', '12');
      shadow.setAttribute('fill', 'rgba(0, 0, 0, 0.1)');
      g.appendChild(shadow);

      // Node rectangle
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

      // Highlight border
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

      // Add hover effect
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

      // Text
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
      
      // Auto-fit to screen in fullscreen mode
      setTimeout(() => {
        if (fullscreenSvgRef.current && containerRef.current) {
          const svgWidth = parseInt(fullscreenSvgRef.current.getAttribute('width')) || 2400;
          const svgHeight = parseInt(fullscreenSvgRef.current.getAttribute('height')) || 1600;
          const containerWidth = window.innerWidth - 80; // padding
          const containerHeight = window.innerHeight - 200; // header + footer
          
          const scaleX = containerWidth / svgWidth;
          const scaleY = containerHeight / svgHeight;
          const autoZoom = Math.min(scaleX, scaleY, 1);
          
          setZoom(autoZoom);
          setPan({ x: 40, y: 40 });
        }
      }, 100);
    }
  }, [isFullscreen, mindmapData]);

  // Zoom and pan handlers
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
    const minimapScale = 0.1; // 10% of original size
    
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
          {/* Viewport indicator */}
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
    if (e.button === 0) { // Left click only
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
      {/* Header */}
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

      {/* Content Area */}
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

      {/* Footer with raw data view */}
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

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div 
          className="fixed inset-0 z-50 bg-black bg-opacity-90 flex flex-col"
          onClick={toggleFullscreen}
        >
          {/* Fullscreen Header */}
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

          {/* Fullscreen Content */}
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

            {/* Minimap Overview */}
            {showMinimap && renderMinimap()}
          </div>

          {/* Fullscreen Footer Instructions */}
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