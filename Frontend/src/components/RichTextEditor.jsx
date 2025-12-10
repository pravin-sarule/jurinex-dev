// import React, { useState, useEffect, useRef } from "react";
// import {
//   Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, AlignJustify,
//   List, ListOrdered, Undo, Redo, Strikethrough, ChevronsUpDown, Type,
//   Palette, Highlighter, Link, Image, Table, FileText, Settings, Eye,
//   Download, Share, Save, Plus, ZoomIn, ZoomOut, Copy,
//   Search, Upload, Calendar, Minus, RotateCcw
// } from "lucide-react";

// const RichTextEditor = ({
//   value = "",
//   onChange = () => {},
//   placeholder = "Start typing your document...",
// }) => {
//   const [activeTab, setActiveTab] = useState("Home");
//   const [wordCount, setWordCount] = useState(0);
//   const [charCount, setCharCount] = useState(0);
//   const [pages, setPages] = useState([""]);
//   const [currentPage, setCurrentPage] = useState(1);
//   const [isModified, setIsModified] = useState(false);
//   const [zoom, setZoom] = useState(100);
//   const [showRuler, setShowRuler] = useState(true);
//   const [fontSize, setFontSize] = useState("14px");
//   const [fontFamily, setFontFamily] = useState("Inter");
//   const [textColor, setTextColor] = useState("#000000");
//   const [backgroundColor, setBackgroundColor] = useState("#ffff00");
//   const [showColorPicker, setShowColorPicker] = useState(false);
//   const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  
//   const pageRefs = useRef([]);
//   const containerRef = useRef(null);

//   // Initialize with sample content
//   useEffect(() => {
//     if (!value) {
//       const samplePages = [
//         `<h1>Document Title</h1>
//         <p>This is the first page of your document. You can start typing here and the content will automatically flow to the next page when this page is full.</p>
//         <p>Use React hooks (useState, useEffect)</p>
//         <p>Responsive design with Tailwind CSS</p>
//         <p>Real-time parsing as response streams in</p>
//         <p>Interactive elements (click on left panel item highlights right panel)</p>
//         <p>Mobile-friendly collapsible panels</p>
//         <p>Clean, modern UI similar to Claude</p>`,
        
//         `<h2>RESPONSE STRUCTURE EXPECTED:</h2>
//         <p>The AI responses will be formatted with:</p>
//         <ul>
//           <li>Emoji headers for sections</li>
//           <li><strong>Bold</strong> text for important items</li>
//           <li>Structured risk assessments</li>
//           <li>Clear action items</li>
//           <li>Follow-up questions at end</li>
//         </ul>
//         <p>This content continues on the second page automatically.</p>`,
        
//         `<h2>Third Page Content</h2>
//         <p>This is the third page of the document. Each page maintains its own content and formatting while providing a seamless editing experience.</p>
//         <p>You can navigate between pages and edit content on any page independently.</p>
//         <table style="width: 100%; border-collapse: collapse; margin: 1rem 0;">
//           <thead>
//             <tr>
//               <th style="border: 1px solid #d1d5db; padding: 8px 12px; background-color: #f9fafb; font-weight: 600;">Feature</th>
//               <th style="border: 1px solid #d1d5db; padding: 8px 12px; background-color: #f9fafb; font-weight: 600;">Status</th>
//             </tr>
//           </thead>
//           <tbody>
//             <tr>
//               <td style="border: 1px solid #d1d5db; padding: 8px 12px;">Multi-page support</td>
//               <td style="border: 1px solid #d1d5db; padding: 8px 12px;">✅ Complete</td>
//             </tr>
//             <tr>
//               <td style="border: 1px solid #d1d5db; padding: 8px 12px;">Rich text editing</td>
//               <td style="border: 1px solid #d1d5db; padding: 8px 12px;">✅ Complete</td>
//             </tr>
//           </tbody>
//         </table>`
//       ];
//       setPages(samplePages);
//     }
//   }, []);

//   // Update statistics
//   const updateStats = () => {
//     const allText = pages.join(' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
//     const words = allText ? allText.split(/\s+/).length : 0;
//     setWordCount(words);
//     setCharCount(allText.length);
//     setIsModified(true);
//   };

//   // Handle content changes
//   const handlePageContentChange = (pageIndex, content) => {
//     const newPages = [...pages];
//     newPages[pageIndex] = content;
//     setPages(newPages);
//     onChange(newPages.join('\n<!-- PAGE_BREAK -->\n'));
//     updateStats();
//   };

//   // Format commands
//   const execCommand = (command, value = null) => {
//     document.execCommand(command, false, value);
//     const activePageRef = pageRefs.current[currentPage - 1];
//     if (activePageRef) {
//       activePageRef.focus();
//       const content = activePageRef.innerHTML;
//       handlePageContentChange(currentPage - 1, content);
//     }
//   };

//   // Advanced formatting functions
//   const applyStyle = (property, value) => {
//     const selection = window.getSelection();
//     if (selection.rangeCount === 0) return;

//     const range = selection.getRangeAt(0);
//     if (range.collapsed) return;

//     const span = document.createElement('span');
//     span.style[property] = value;
    
//     try {
//       range.surroundContents(span);
//       selection.removeAllRanges();
//       selection.addRange(range);
//     } catch (e) {
//       const contents = range.extractContents();
//       span.appendChild(contents);
//       range.insertNode(span);
//     }
    
//     const activePageRef = pageRefs.current[currentPage - 1];
//     if (activePageRef) {
//       const content = activePageRef.innerHTML;
//       handlePageContentChange(currentPage - 1, content);
//     }
//   };

//   const insertTable = () => {
//     const tableHTML = `
//       <table style="width: 100%; border-collapse: collapse; margin: 1rem 0;">
//         <thead>
//           <tr>
//             <th style="border: 1px solid #d1d5db; padding: 8px 12px; background-color: #f9fafb; font-weight: 600;">Header 1</th>
//             <th style="border: 1px solid #d1d5db; padding: 8px 12px; background-color: #f9fafb; font-weight: 600;">Header 2</th>
//             <th style="border: 1px solid #d1d5db; padding: 8px 12px; background-color: #f9fafb; font-weight: 600;">Header 3</th>
//           </tr>
//         </thead>
//         <tbody>
//           <tr>
//             <td style="border: 1px solid #d1d5db; padding: 8px 12px;">Cell 1</td>
//             <td style="border: 1px solid #d1d5db; padding: 8px 12px;">Cell 2</td>
//             <td style="border: 1px solid #d1d5db; padding: 8px 12px;">Cell 3</td>
//           </tr>
//         </tbody>
//       </table>
//     `;
//     execCommand('insertHTML', tableHTML);
//   };

//   const insertImage = () => {
//     const url = window.prompt('Enter image URL:');
//     if (url) {
//       const imgHTML = `<img src="${url}" alt="Image" style="max-width: 100%; height: auto; margin: 1rem 0; border-radius: 4px;" />`;
//       execCommand('insertHTML', imgHTML);
//     }
//   };

//   const insertLink = () => {
//     const url = window.prompt('Enter URL:');
//     if (url) {
//       const text = window.getSelection().toString() || url;
//       const linkHTML = `<a href="${url}" style="color: #3b82f6; text-decoration: underline;">${text}</a>`;
//       execCommand('insertHTML', linkHTML);
//     }
//   };

//   const addNewPage = () => {
//     setPages([...pages, ""]);
//   };

//   const deletePage = (pageIndex) => {
//     if (pages.length > 1) {
//       const newPages = pages.filter((_, index) => index !== pageIndex);
//       setPages(newPages);
//       if (currentPage > newPages.length) {
//         setCurrentPage(newPages.length);
//       }
//     }
//   };

//   const handleZoom = (newZoom) => {
//     setZoom(Math.max(25, Math.min(200, newZoom)));
//   };

//   const handleKeyDown = (e, pageIndex) => {
//     if (e.ctrlKey || e.metaKey) {
//       switch (e.key) {
//         case 'b':
//           e.preventDefault();
//           execCommand('bold');
//           break;
//         case 'i':
//           e.preventDefault();
//           execCommand('italic');
//           break;
//         case 'u':
//           e.preventDefault();
//           execCommand('underline');
//           break;
//         case 'z':
//           e.preventDefault();
//           if (e.shiftKey) {
//             execCommand('redo');
//           } else {
//             execCommand('undo');
//           }
//           break;
//       }
//     }
//   };

//   // Auto-save simulation
//   useEffect(() => {
//     if (isModified) {
//       const saveTimer = setTimeout(() => {
//         setIsModified(false);
//       }, 3000);
//       return () => clearTimeout(saveTimer);
//     }
//   }, [isModified]);

//   const ToolbarButton = ({ action, icon: Icon, title, isActive = false, value }) => (
//     <button
//       onClick={() => typeof action === 'function' ? action() : execCommand(action, value)}
//       className={`p-1.5 rounded-md hover:bg-gray-100 transition-all duration-150 ${
//         isActive ? "bg-blue-50 text-blue-600 ring-1 ring-blue-200" : "text-gray-600"
//       }`}
//       title={title}
//     >
//       <Icon className="h-4 w-4" />
//     </button>
//   );

//   const ToolbarSelect = ({ value, onChange, options, title, width = "w-24" }) => (
//     <div className="relative">
//       <select
//         value={value}
//         onChange={(e) => onChange(e.target.value)}
//         className={`${width} text-xs border border-gray-300 rounded-md h-7 pl-2 pr-6 bg-white appearance-none hover:border-gray-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-all`}
//         title={title}
//       >
//         {options.map((option) => (
//           <option key={option.value} value={option.value}>
//             {option.label}
//           </option>
//         ))}
//       </select>
//       <ChevronsUpDown className="absolute top-1/2 right-1 -translate-y-1/2 h-3 w-3 text-gray-400 pointer-events-none" />
//     </div>
//   );

//   const ColorPicker = ({ color, onChange, show, setShow, title, icon: Icon }) => {
//     const colors = [
//       '#000000', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
//       '#FFA500', '#800080', '#FFC0CB', '#A52A2A', '#808080', '#000080', '#008000'
//     ];

//     return (
//       <div className="relative">
//         <button
//           onClick={() => setShow(!show)}
//           className="p-1.5 rounded-md hover:bg-gray-100 transition-all duration-150 text-gray-600 flex items-center"
//           title={title}
//         >
//           <Icon className="h-4 w-4" />
//           <div 
//             className="w-3 h-1 ml-1 border border-gray-300"
//             style={{ backgroundColor: color }}
//           />
//         </button>
//         {show && (
//           <div className="absolute top-8 left-0 z-50 bg-white border border-gray-300 rounded-lg shadow-lg p-2">
//             <div className="grid grid-cols-7 gap-1">
//               {colors.map((c) => (
//                 <button
//                   key={c}
//                   onClick={() => {
//                     onChange(c);
//                     setShow(false);
//                   }}
//                   className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
//                   style={{ backgroundColor: c }}
//                 />
//               ))}
//             </div>
//           </div>
//         )}
//       </div>
//     );
//   };

//   const RibbonTab = ({ name, icon: Icon }) => (
//     <button
//       onClick={() => setActiveTab(name)}
//       className={`flex items-center px-4 py-2 text-sm font-medium transition-all duration-200 ${
//         activeTab === name
//           ? "text-blue-600 border-b-2 border-blue-500 bg-blue-50"
//           : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
//       }`}
//     >
//       {Icon && <Icon className="h-4 w-4 mr-2" />}
//       {name}
//     </button>
//   );

//   const RibbonGroup = ({ children, title }) => (
//     <div className="flex items-center space-x-1 px-3 py-1 border-r border-gray-200 last:border-r-0">
//       {children}
//       {title && <span className="text-xs text-gray-500 ml-2">{title}</span>}
//     </div>
//   );

//   return (
//     <div className="h-screen flex flex-col bg-gradient-to-b from-gray-50 to-gray-100">
//       {/* Top Header */}
//       <div className="bg-white shadow-sm border-b border-gray-200">
//         <div className="flex items-center justify-between px-6 py-2">
//           <div className="flex items-center space-x-4">
//             <h1 className="text-lg font-semibold text-gray-800">Document Editor</h1>
//             <div className="flex items-center space-x-2">
//               <button className="p-2 hover:bg-gray-100 rounded-md" title="Save">
//                 <Save className="h-4 w-4 text-gray-600" />
//               </button>
//               <button className="p-2 hover:bg-gray-100 rounded-md" title="Download">
//                 <Download className="h-4 w-4 text-gray-600" />
//               </button>
//               <button className="p-2 hover:bg-gray-100 rounded-md" title="Share">
//                 <Share className="h-4 w-4 text-gray-600" />
//               </button>
//             </div>
//           </div>
//           <div className="flex items-center space-x-3">
//             <div className="flex items-center space-x-2">
//               <button onClick={() => handleZoom(zoom - 10)} className="p-1 hover:bg-gray-100 rounded">
//                 <ZoomOut className="h-4 w-4" />
//               </button>
//               <span className="text-sm font-mono min-w-12 text-center">{zoom}%</span>
//               <button onClick={() => handleZoom(zoom + 10)} className="p-1 hover:bg-gray-100 rounded">
//                 <ZoomIn className="h-4 w-4" />
//               </button>
//             </div>
//           </div>
//         </div>
//       </div>

//       {/* Ribbon Navigation */}
//       <div className="bg-white border-b border-gray-200">
//         <div className="flex items-center px-6">
//           <RibbonTab name="File" icon={FileText} />
//           <RibbonTab name="Home" icon={Type} />
//           <RibbonTab name="Insert" icon={Plus} />
//           <RibbonTab name="Layout" icon={Settings} />
//           <RibbonTab name="View" icon={Eye} />
//         </div>
//       </div>

//       {/* Ribbon Tools */}
//       <div className="bg-gray-50 border-b border-gray-200 px-6 py-2">
//         <div className="flex items-center space-x-4 overflow-x-auto">
//           {activeTab === "Home" && (
//             <>
//               <RibbonGroup title="Clipboard">
//                 <ToolbarButton action={() => execCommand('copy')} icon={Copy} title="Copy" />
//                 <ToolbarButton action="undo" icon={Undo} title="Undo (Ctrl+Z)" />
//                 <ToolbarButton action="redo" icon={Redo} title="Redo (Ctrl+Shift+Z)" />
//               </RibbonGroup>

//               <RibbonGroup title="Font">
//                 <ToolbarSelect
//                   value={fontFamily}
//                   onChange={(value) => {
//                     setFontFamily(value);
//                     applyStyle('fontFamily', value);
//                   }}
//                   title="Font Family"
//                   width="w-32"
//                   options={[
//                     { value: "Inter", label: "Inter" },
//                     { value: "Arial", label: "Arial" },
//                     { value: "Georgia", label: "Georgia" },
//                     { value: "Times New Roman", label: "Times" },
//                     { value: "Courier New", label: "Courier" },
//                   ]}
//                 />
//                 <ToolbarSelect
//                   value={fontSize}
//                   onChange={(value) => {
//                     setFontSize(value);
//                     applyStyle('fontSize', value);
//                   }}
//                   title="Font Size"
//                   width="w-16"
//                   options={[
//                     { value: "12px", label: "12" },
//                     { value: "14px", label: "14" },
//                     { value: "16px", label: "16" },
//                     { value: "18px", label: "18" },
//                     { value: "20px", label: "20" },
//                     { value: "24px", label: "24" },
//                   ]}
//                 />
//               </RibbonGroup>

//               <RibbonGroup title="Format">
//                 <ToolbarButton action="bold" icon={Bold} title="Bold (Ctrl+B)" />
//                 <ToolbarButton action="italic" icon={Italic} title="Italic (Ctrl+I)" />
//                 <ToolbarButton action="underline" icon={Underline} title="Underline (Ctrl+U)" />
//                 <ToolbarButton action="strikethrough" icon={Strikethrough} title="Strikethrough" />
//                 <ColorPicker
//                   color={textColor}
//                   onChange={(color) => {
//                     setTextColor(color);
//                     applyStyle('color', color);
//                   }}
//                   show={showColorPicker}
//                   setShow={setShowColorPicker}
//                   title="Text Color"
//                   icon={Palette}
//                 />
//               </RibbonGroup>

//               <RibbonGroup title="Alignment">
//                 <ToolbarButton action="justifyLeft" icon={AlignLeft} title="Align Left" />
//                 <ToolbarButton action="justifyCenter" icon={AlignCenter} title="Center" />
//                 <ToolbarButton action="justifyRight" icon={AlignRight} title="Align Right" />
//                 <ToolbarButton action="justifyFull" icon={AlignJustify} title="Justify" />
//               </RibbonGroup>

//               <RibbonGroup title="Lists">
//                 <ToolbarButton action="insertUnorderedList" icon={List} title="Bullet List" />
//                 <ToolbarButton action="insertOrderedList" icon={ListOrdered} title="Numbered List" />
//               </RibbonGroup>
//             </>
//           )}

//           {activeTab === "Insert" && (
//             <>
//               <RibbonGroup title="Pages">
//                 <button
//                   onClick={addNewPage}
//                   className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
//                 >
//                   Add Page
//                 </button>
//               </RibbonGroup>

//               <RibbonGroup title="Tables">
//                 <ToolbarButton action={insertTable} icon={Table} title="Insert Table" />
//               </RibbonGroup>

//               <RibbonGroup title="Media">
//                 <ToolbarButton action={insertImage} icon={Image} title="Insert Image" />
//               </RibbonGroup>

//               <RibbonGroup title="Links">
//                 <ToolbarButton action={insertLink} icon={Link} title="Insert Link" />
//               </RibbonGroup>
//             </>
//           )}

//           {activeTab === "View" && (
//             <>
//               <RibbonGroup title="Show/Hide">
//                 <ToolbarButton 
//                   action={() => setShowRuler(!showRuler)} 
//                   icon={Settings} 
//                   title="Toggle Ruler" 
//                   isActive={showRuler}
//                 />
//               </RibbonGroup>

//               <RibbonGroup title="Zoom">
//                 <button 
//                   onClick={() => handleZoom(75)}
//                   className="px-3 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
//                 >
//                   75%
//                 </button>
//                 <button 
//                   onClick={() => handleZoom(100)}
//                   className="px-3 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
//                 >
//                   100%
//                 </button>
//                 <button 
//                   onClick={() => handleZoom(125)}
//                   className="px-3 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
//                 >
//                   125%
//                 </button>
//               </RibbonGroup>
//             </>
//           )}
//         </div>
//       </div>

//       {/* Ruler */}
//       {showRuler && (
//         <div className="bg-white border-b border-gray-200 h-6 flex items-center justify-center">
//           <div className="w-full max-w-4xl relative">
//             <div className="absolute inset-0 flex items-end">
//               {Array.from({ length: 17 }, (_, i) => (
//                 <div
//                   key={i}
//                   className="flex-1 border-l border-gray-300 h-3 relative"
//                 >
//                   {i % 2 === 0 && (
//                     <span className="absolute -top-4 left-0 text-xs text-gray-500 transform -translate-x-1/2">
//                       {i / 2}
//                     </span>
//                   )}
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>
//       )}

//       {/* Main Editor Area with Multiple Pages */}
//       <main className="flex-1 overflow-y-auto bg-gray-200 py-8" ref={containerRef}>
//         <div className="flex flex-col items-center space-y-8">
//           {pages.map((pageContent, pageIndex) => (
//             <div 
//               key={pageIndex}
//               className="relative group"
//               style={{ 
//                 zoom: `${zoom}%`,
//                 WebkitTransform: `scale(${zoom / 100})`,
//                 transformOrigin: 'top center'
//               }}
//             >
//               {/* Page Controls */}
//               <div className="absolute -top-8 left-0 right-0 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
//                 <span className="text-sm text-gray-500 bg-white px-2 py-1 rounded shadow">
//                   Page {pageIndex + 1}
//                 </span>
//                 {pages.length > 1 && (
//                   <button
//                     onClick={() => deletePage(pageIndex)}
//                     className="text-red-600 hover:text-red-800 bg-white px-2 py-1 rounded shadow text-sm"
//                   >
//                     Delete Page
//                   </button>
//                 )}
//               </div>

//               {/* Document Page */}
//               <div className="document-page">
//                 <div
//                   ref={el => pageRefs.current[pageIndex] = el}
//                   contentEditable
//                   suppressContentEditableWarning={true}
//                   onInput={(e) => handlePageContentChange(pageIndex, e.target.innerHTML)}
//                   onKeyDown={(e) => handleKeyDown(e, pageIndex)}
//                   onFocus={() => setCurrentPage(pageIndex + 1)}
//                   className="editor-content"
//                   style={{
//                     minHeight: '100%',
//                     outline: 'none',
//                     fontFamily: fontFamily,
//                     fontSize: fontSize,
//                     lineHeight: '1.6',
//                     color: '#1f2937'
//                   }}
//                   dangerouslySetInnerHTML={{ __html: pageContent }}
//                   data-placeholder={pageIndex === 0 && !pageContent ? placeholder : ""}
//                 />
//               </div>
//             </div>
//           ))}
//         </div>
//       </main>

//       {/* Status Bar */}
//       <footer className="bg-white border-t border-gray-200 px-6 py-2">
//         <div className="flex items-center justify-between text-sm">
//           <div className="flex items-center space-x-6">
//             <span className="text-gray-600">Page {currentPage} of {pages.length}</span>
//             <span className="text-gray-600">Words: {wordCount.toLocaleString()}</span>
//             <span className="text-gray-600">Characters: {charCount.toLocaleString()}</span>
//           </div>
//           <div className="flex items-center space-x-3">
//             <div className="flex items-center space-x-2">
//               <div
//                 className={`w-2 h-2 rounded-full ${
//                   isModified ? "bg-orange-400" : "bg-green-500"
//                 }`}
//               />
//               <span className="text-gray-600">
//                 {isModified ? "Saving..." : "Saved to cloud"}
//               </span>
//             </div>
//             <span className="text-gray-400">•</span>
//             <span className="text-gray-600">{zoom}% zoom</span>
//           </div>
//         </div>
//       </footer>

//       {/* Enhanced Styling */}
//       <style jsx global>{`
//         /* Document Pages */
//         .document-page {
//           width: 8.5in;
//           height: 11in;
//           background: white;
//           padding: 1in;
//           box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
//           border-radius: 2px;
//           position: relative;
//           overflow: hidden;
//           page-break-after: always;
//         }

//         .document-page:hover {
//           box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
//         }

//         /* Editor Content */
//         .editor-content {
//           height: 100%;
//           font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
//           overflow-y: auto;
//         }

//         .editor-content:empty::before {
//           content: attr(data-placeholder);
//           color: #9ca3af;
//           pointer-events: none;
//           position: absolute;
//           top: 0;
//           left: 0;
//         }

//         .editor-content p {
//           margin: 0 0 1em 0;
//         }

//         .editor-content h1, .editor-content h2, .editor-content h3, 
//         .editor-content h4, .editor-content h5, .editor-content h6 {
//           font-weight: 600;
//           margin: 1.5em 0 0.5em 0;
//           line-height: 1.3;
//         }

//         .editor-content h1 { font-size: 2.25rem; }
//         .editor-content h2 { font-size: 1.875rem; }
//         .editor-content h3 { font-size: 1.5rem; }
//         .editor-content h4 { font-size: 1.25rem; }
//         .editor-content h5 { font-size: 1.125rem; }
//         .editor-content h6 { font-size: 1rem; }

//         .editor-content ul, .editor-content ol {
//           padding-left: 1.5rem;
//           margin: 1em 0;
//         }

//         .editor-content li {
//           margin: 0.25em 0;
//         }

//         .editor-content table {
//           border-collapse: collapse;
//           table-layout: fixed;
//           width: 100%;
//           margin: 1rem 0;
//         }

//         .editor-content td, .editor-content th {
//           min-width: 1em;
//           border: 1px solid #d1d5db;
//           padding: 8px 12px;
//           vertical-align: top;
//           box-sizing: border-box;
//         }

//         .editor-content th {
//           font-weight: 600;
//           background-color: #f9fafb;
//         }

//         .editor-content a {
//           color: #3b82f6;
//           text-decoration: underline;
//           cursor: pointer;
//         }

//         .editor-content img {
//           max-width: 100%;
//           height: auto;
//           border-radius: 4px;
//           margin: 1rem 0;
//         }

//         /* Print styles */
//         @media print {
//           .document-page {
//             width: 100% !important;
//             height: auto !important;
//             min-height: 11in;
//             margin: 0 !important;
//             padding: 0.5in !important;
//             box-shadow: none !important;
//             border: none !important;
//             page-break-after: always;
//           }

//           .document-page:last-child {
//             page-break-after: auto;
//           }
//         }

//         /* Responsive design */
//         @media (max-width: 768px) {
//           .document-page {
//             width: 95vw;
//             height: auto;
//             min-height: 11in;
//             padding: 0.5in;
//           }
//         }

//         /* Focus styles */
//         .document-page:focus-within {
//           box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3), 0 8px 25px rgba(0, 0, 0, 0.15);
//         }

//         /* Selection styles */
//         .editor-content ::selection {
//           background-color: rgba(59, 130, 246, 0.2);
//         }

//         /* Blockquote styles */
//         .editor-content blockquote {
//           border-left: 4px solid #e5e7eb;
//           padding-left: 1rem;
//           margin: 1rem 0;
//           font-style: italic;
//           color: #6b7280;
//         }

//         /* Code styles */
//         .editor-content code {
//           background-color: #f3f4f6;
//           padding: 0.125rem 0.25rem;
//           border-radius: 0.25rem;
//           font-family: 'Courier New', monospace;
//           font-size: 0.875em;
//         }

//         .editor-content pre {
//           background-color: #f3f4f6;
//           padding: 1rem;
//           border-radius: 0.5rem;
//           overflow-x: auto;
//           margin: 1rem 0;
//         }

//         .editor-content pre code {
//           background-color: transparent;
//           padding: 0;
//         }

//         /* Page transition effects */
//         .document-page {
//           transition: all 0.3s ease;
//         }

//         /* Smooth scrolling */
//         html {
//           scroll-behavior: smooth;
//         }

//         /* Page numbering for print */
//         @page {
//           margin: 1in;
//           @bottom-center {
//             content: counter(page);
//           }
//         }
//       `}</style>
//     </div>
//   );
// };

// export default RichTextEditor;


// import React, { useState, useEffect } from "react";
// import { CKEditor } from "@ckeditor/ckeditor5-react";
// import ClassicEditor from "@ckeditor/ckeditor5-build-classic";
// import ApiService from "../services/api";

// const RichTextEditor = ({
//   value = "",
//   onChange = () => {},
//   placeholder = "Start typing your document...",
// }) => {
//   const [editorData, setEditorData] = useState(value);
//   const editorRef = useRef(null);

//   useEffect(() => {
//     const loadContent = async () => {
//       if (value && typeof value === 'string' && value.toLowerCase().endsWith('.docx')) {
//         try {
//           const htmlContent = await ApiService.convertDocxToHtml(value);
//           setEditorData(htmlContent);
//         } catch (error) {
//           console.error("RichTextEditor: Error converting DOCX to HTML:", error);
//           setEditorData(`<p style="color: red;">Error loading document: ${error.message}</p>`);
//         }
//       } else if (value) {
//         setEditorData(value);
//       } else {
//         setEditorData(`<p>${placeholder}</p>`);
//       }
//     };
//     loadContent();
//   }, [value, placeholder]);

//   return (
//     <div className="h-screen flex flex-col bg-gradient-to-b from-gray-50 to-gray-100">
//       <div className="flex-1 overflow-y-auto p-4">
//         <CKEditor
//           editor={ClassicEditor}
//           data={editorData}
//           onReady={(editor) => {
//             editorRef.current = editor;
//           }}
//           onChange={(event, editor) => {
//             const data = editor.getData();
//             setEditorData(data);
//             onChange(data);
//           }}
//           config={{
//             placeholder: placeholder,
//             toolbar: [
//               'heading', '|',
//               'bold', 'italic', 'underline', 'strikethrough', '|',
//               'link', 'bulletedList', 'numberedList', 'blockQuote', '|',
//               'insertTable', 'imageUpload', '|',
//               'undo', 'redo'
//             ],
//             image: {
//               toolbar: [
//                 'imageTextAlternative',
//                 'imageStyle:inline',
//                 'imageStyle:block',
//                 'imageStyle:side'
//               ]
//             },
//             table: {
//               contentToolbar: [
//                 'tableColumn',
//                 'tableRow',
//                 'mergeTableCells'
//               ]
//             }
//           }}
//         />
//       </div>
//     </div>
//   );
// };

// export default RichTextEditor;

import React, { useState, useEffect } from "react";
// Import the CKEditor component
import { CKEditor } from "@ckeditor/ckeditor5-react";
// IMPORT YOUR CUSTOM EDITOR BUILD INSTEAD OF THE NPM PACKAGE
import ClassicEditor from "@ckeditor/ckeditor5-build-classic";
import ApiService from "../services/api";
// The same CSS file works perfectly with this new setup
import "./RichTextEditor.css"; 

const RichTextEditor = ({
  value = "",
  onChange = () => {},
  placeholder = "Start typing your document...",
}) => {
  const [editorData, setEditorData] = useState("");

  useEffect(() => {
    const loadContent = async () => {
      if (value && typeof value === 'string' && value.toLowerCase().endsWith('.docx')) {
        try {
          const htmlContent = await ApiService.convertDocxToHtml(value);
          setEditorData(htmlContent);
        } catch (error) {
          console.error("RichTextEditor: Error converting DOCX to HTML:", error);
          setEditorData(`<p style="color: red;">Error loading document: ${error.message}</p>`);
        }
      } else {
        setEditorData(value || "");
      }
    };
    loadContent();
  }, [value]);

  return (
    <div className="document-editor-container">
      <CKEditor
        editor={ClassicEditor}
        data={editorData}
        onReady={(editor) => {
          // Access the editor's main editable element, which is inside an iframe.
          const editableElement = editor.ui.view.editable.element;
          if (editableElement && editableElement.ownerDocument && editableElement.ownerDocument.defaultView) {
            const iframe = editableElement.ownerDocument.defaultView.frameElement;
            if (iframe && iframe.sandbox) {
              // Add 'allow-scripts' to the existing sandbox attributes
              iframe.sandbox.add('allow-scripts');
            }
          }
        }}
        onChange={(event, editor) => {
          const data = editor.getData();
          onChange(data);
        }}
        config={{
          placeholder: placeholder,
        }}
      />
    </div>
  );
};

export default RichTextEditor;