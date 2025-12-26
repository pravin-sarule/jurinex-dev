import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Search, Download, Printer, ArrowLeft, Save, Share2,
  Settings, MoreVertical, Clock, Users, FileText,
  ChevronDown, Bell, User, Loader, X
} from "lucide-react";
import { CKEditor } from "@ckeditor/ckeditor5-react";
import ClassicEditor from "@ckeditor/ckeditor5-build-classic";
import Templates from "../components/Templates";
import ApiService from "../services/api";
import '../styles/ckeditor-a4.css';

const generateUserId = () => {
  const stored = localStorage.getItem('documentEditorUserId') || localStorage.getItem('userId');
  if (stored) return stored;
  
  const newId = 'user_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  localStorage.setItem('documentEditorUserId', newId);
  return newId;
};

const createStorageKey = (userId, templateId, suffix = '') => {
  return `docEditor_${userId}_${templateId || 'blank'}${suffix ? '_' + suffix : ''}`;
};

const downloadBlob = (filename, blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const useAutoSave = (content, storageKey, templateId, delay = 3000) => {
  const timeoutRef = useRef(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(async () => {
      if (content && typeof content === 'string') {
        setIsSaving(true);
        try {
          localStorage.setItem(storageKey, content);
          localStorage.setItem(storageKey + '_lastSaved', new Date().toISOString());
          
          if (typeof templateId === 'string' && !templateId.includes('-')) {
            const blob = new Blob([content], { type: 'text/html' });
            const file = new File([blob], 'document.html', { type: 'text/html' });
            
            await ApiService.saveUserDraft(templateId, 'Auto-saved Document', file);
          }
          
          setLastSaved(new Date());
        } catch (error) {
          console.error('Auto-save failed:', error);
        } finally {
          setIsSaving(false);
        }
      }
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content, storageKey, templateId, delay]);

  return { isSaving, lastSaved };
};

const DraftingPage = () => {
  const userId = useMemo(() => generateUserId(), []);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [documentList, setDocumentList] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const currentSessionKey = 'drafting_current_session';
  const currentSessionData = JSON.parse(localStorage.getItem(currentSessionKey) || 'null');

  const [selectedTemplate, setSelectedTemplate] = useState(() => {
    if (currentSessionData && currentSessionData.selectedTemplate) {
      return currentSessionData.selectedTemplate;
    }
    return null;
  });

  const [fileName, setFileName] = useState(() => {
    if (currentSessionData && currentSessionData.fileName) {
      return currentSessionData.fileName;
    }
    return "Untitled Document";
  });

  const [editorContent, setEditorContent] = useState(() => {
    if (currentSessionData && currentSessionData.editorContent) {
      return currentSessionData.editorContent;
    }
    return '';
  });

  const location = window.location;
  const queryParams = new URLSearchParams(location.search);
  const templateIdFromUrl = queryParams.get('templateId');
  const editUrlFromUrl = queryParams.get('editUrl');

  console.log('DraftingPage: Initializing with URL Params:', { templateIdFromUrl, editUrlFromUrl });
  console.log('DraftingPage: Current session data:', currentSessionData);

  const currentStorageKey = useMemo(() => 
    createStorageKey(userId, selectedTemplate?.id, 'content'), 
    [userId, selectedTemplate?.id]
  );

  const fileNameStorageKey = useMemo(() => 
    createStorageKey(userId, selectedTemplate?.id, 'fileName'), 
    [userId, selectedTemplate?.id]
  );

  const { isSaving, lastSaved } = useAutoSave(editorContent, currentStorageKey, selectedTemplate?.id);

  useEffect(() => {
    const sessionData = {
      selectedTemplate,
      fileName,
      editorContent,
      lastModified: new Date().toISOString()
    };
    localStorage.setItem(currentSessionKey, JSON.stringify(sessionData));
  }, [selectedTemplate, fileName, editorContent, currentSessionKey]);

  useEffect(() => {
    const loadTemplateFromUrl = async () => {
      if (templateIdFromUrl && !currentSessionData) {
        try {
          setIsLoading(true);
          setError(null);
          let templateToLoad = null;

          if (templateIdFromUrl) {
            const result = await ApiService.openTemplateForEditing(templateIdFromUrl);
            const htmlContent = result?.html || result || '';
            
            templateToLoad = {
              id: templateIdFromUrl,
              name: result?.name || 'Document from Backend',
              content: htmlContent,
              isBackendTemplate: true,
            };
            
            setEditorContent(typeof htmlContent === 'string' ? htmlContent : '');
            setFileName(templateToLoad.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
          } else {
            setEditorContent('');
            setFileName('Untitled Document');
          }
          setSelectedTemplate(templateToLoad);
        } catch (err) {
          console.error('Error loading template from URL:', err);
          setError(`Failed to load document: ${err.message}`);
          setSelectedTemplate(null);
          setEditorContent('');
          setFileName('Untitled Document');
        } finally {
          setIsLoading(false);
        }
      }
    };
    loadTemplateFromUrl();
  }, [templateIdFromUrl, editUrlFromUrl, currentSessionData]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.id) {
      const savedContent = localStorage.getItem(currentStorageKey);
      const savedFileName = localStorage.getItem(fileNameStorageKey);
      
      if (!currentSessionData || !currentSessionData.editorContent) {
        if (savedContent) {
          setEditorContent(savedContent);
        }
      }
      
      if (!currentSessionData || !currentSessionData.fileName) {
        if (savedFileName) {
          setFileName(savedFileName);
        }
      }
    }
  }, [selectedTemplate, currentStorageKey, fileNameStorageKey, currentSessionData]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.id && editorContent) {
      localStorage.setItem(currentStorageKey, editorContent);
    }
  }, [editorContent, currentStorageKey, selectedTemplate]);

  useEffect(() => {
    if (selectedTemplate && selectedTemplate.id && fileName && fileName !== "Untitled Document") {
      localStorage.setItem(fileNameStorageKey, fileName);
    }
  }, [fileName, fileNameStorageKey, selectedTemplate]);

  useEffect(() => {
    const loadDocumentList = () => {
      const allKeys = Object.keys(localStorage);
      const userDocs = allKeys
        .filter(key => key.startsWith(`docEditor_${userId}_`) && key.endsWith('_content'))
        .map(key => {
          const parts = key.split('_');
          const templateId = parts[2];
          const content = localStorage.getItem(key);
          const lastSavedKey = key + '_lastSaved';
          const lastSaved = localStorage.getItem(lastSavedKey);
          const fileNameKey = key.replace('_content', '_fileName');
          const fileName = localStorage.getItem(fileNameKey) || 'Untitled Document';
          
          return {
            id: key,
            templateId,
            fileName,
            content,
            lastSaved: lastSaved ? new Date(lastSaved) : new Date(),
            wordCount: content ? content.replace(/<[^>]*>/g, '').split(/\s+/).filter(Boolean).length : 0
          };
        })
        .sort((a, b) => new Date(b.lastSaved) - new Date(a.lastSaved));
      
      setDocumentList(userDocs);
    };

    loadDocumentList();
  }, [userId, editorContent]);

  const handleTemplateSelection = useCallback(async (template) => {
    const hasChanges = editorContent && editorContent.trim() !== '' && 
                      (!selectedTemplate || editorContent !== (selectedTemplate.content || ''));
    
    if (hasChanges) {
      window.pendingTemplate = template;
      setShowDiscardDialog(true);
      return;
    }
    
    await selectTemplate(template);
  }, [editorContent, selectedTemplate]);

  const selectTemplate = useCallback(async (template) => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('Template selected:', template);

      let fetchedHtmlContent = '';
      try {
        const result = await ApiService.openTemplateForEditing(template.id);
        console.log('Backend template result:', result);
        
        if (typeof result === 'string') {
          fetchedHtmlContent = result;
        } else if (result && typeof result === 'object') {
          fetchedHtmlContent = result.html || result.content || '';
        }
        
        fetchedHtmlContent = typeof fetchedHtmlContent === 'string' ? fetchedHtmlContent : '';
        
        setSelectedTemplate({
          ...template,
          content: fetchedHtmlContent,
          isBackendTemplate: true,
        });
        
        setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
        
      } catch (err) {
        console.error('Error opening backend template:', err);
        setError('Failed to open backend template. Please try again.');
        
        fetchedHtmlContent = template.content || '';
        setSelectedTemplate({
          ...template,
          content: fetchedHtmlContent,
        });
        setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
      }

        const specificTemplateStorageKey = createStorageKey(userId, template.id, 'content');
        const savedContent = localStorage.getItem(specificTemplateStorageKey);
        
        if (savedContent) {
          setEditorContent(savedContent);
          console.log('Loaded content from localStorage for template:', template.id);
        } else {
          setEditorContent(fetchedHtmlContent);
          console.log('Loaded content from fetched HTML for template:', template.id);
        }
      
    } catch (error) {
      console.error('Error selecting template:', error);
      setError('Failed to load template. Please try again.');
      
      const fallbackContent = template.content || '';
      setSelectedTemplate({
        ...template,
        content: fallbackContent,
      });
      setEditorContent(typeof fallbackContent === 'string' ? fallbackContent : '');
      setFileName(template.name?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'document');
    } finally {
      setIsLoading(false);
    }
  }, [userId, createStorageKey]);

  const handleEditorChange = useCallback((content) => {
    const stringContent = typeof content === 'string' ? content : '';
    setEditorContent(stringContent);
    console.log('Editor content changed:', typeof stringContent, stringContent.substring(0, 100));
  }, []);

  const exportToPDF = useCallback(() => {
    const printWindow = window.open('', '_blank');
    const contentToPrint = typeof editorContent === 'string' ? editorContent : '';

    const printHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${fileName}</title>
          <link rel="stylesheet" href="https://cdn.ckeditor.com/ckeditor5/41.4.2/classic/ckeditor.css">
          <style>
            body {
              font-family: 'Times New Roman', serif;
              margin: 0;
              padding: 40px;
              background-color: white;
              line-height: 1.6;
              color: #1a1a1a;
            }
            @page {
              margin: 1in;
            }
            @media print {
              body { margin: 0; padding: 0; }
              .no-print { display: none; }
            }
            .ck-content {
              word-wrap: break-word;
            }
            h1, h2, h3, h4, h5, h6 {
              margin-top: 1.5em;
              margin-bottom: 0.5em;
              page-break-after: avoid;
            }
            table {
              border-collapse: collapse;
              width: 100%;
              margin: 1em 0;
            }
            th, td {
              border: 1px solid #ccc;
              padding: 8px;
              text-align: left;
            }
            th { background-color: #f5f5f5; }
            .page-break { page-break-before: always; }
          </style>
        </head>
        <body class="ck-content">
          ${contentToPrint}
        </body>
      </html>
    `;

    printWindow.document.write(printHtml);
    printWindow.document.close();
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    };
  }, [editorContent, fileName]);

  const exportToHTML = useCallback(() => {
    const contentToExport = typeof editorContent === 'string' ? editorContent : '';
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <title>${fileName}</title>
          <link rel="stylesheet" href="https://cdn.ckeditor.com/ckeditor5/41.4.2/classic/ckeditor.css">
          <style>
            body {
              font-family: 'Times New Roman', serif;
              max-width: 800px;
              margin: 0 auto;
              padding: 40px;
              line-height: 1.6;
              color: #1a1a1a;
            }
            .ck-content {
              word-wrap: break-word;
            }
            h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; }
            p { margin-bottom: 1em; }
            table { border-collapse: collapse; width: 100%; margin: 1em 0; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
            th { background-color: #f5f5f5; }
            img { max-width: 100%; height: auto; }
          </style>
        </head>
        <body class="ck-content">
          ${contentToExport}
        </body>
      </html>
    `;
    
    downloadBlob(`${fileName}.html`, new Blob([htmlContent], { type: "text/html;charset=utf-8" }));
  }, [editorContent, fileName]);

  const exportToText = useCallback(() => {
    const contentToExport = typeof editorContent === 'string' ? editorContent : '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = contentToExport;
    const textContent = tempDiv.textContent || tempDiv.innerText || '';
    
    downloadBlob(`${fileName}.txt`, new Blob([textContent], { type: "text/plain;charset=utf-8" }));
  }, [editorContent, fileName]);

  const handleBackToTemplates = useCallback(async () => {
    const hasChanges = editorContent && editorContent.trim() !== '' && 
                      (!selectedTemplate || editorContent !== (selectedTemplate.content || ''));
    
    if (hasChanges) {
      window.pendingAction = 'backToTemplates';
      setShowDiscardDialog(true);
      return;
    }
    
    await goBackToTemplates();
  }, [editorContent, selectedTemplate]);

  const goBackToTemplates = useCallback(async () => {
    try {
      if (editorContent && selectedTemplate) {
        localStorage.setItem(currentStorageKey, editorContent);
        localStorage.setItem(currentStorageKey + '_lastSaved', new Date().toISOString());
        
        if (selectedTemplate.id && typeof selectedTemplate.id === 'string' && !selectedTemplate.id.includes('-')) {
          const blob = new Blob([editorContent], { type: 'text/html' });
          const file = new File([blob], fileName + '.html', { type: 'text/html' });
          
          await ApiService.saveUserDraft(selectedTemplate.id, fileName, file);
        }
      }
    } catch (error) {
      console.error('Error saving before exit:', error);
    }
    
    localStorage.removeItem(currentSessionKey);
    
    setSelectedTemplate(null);
    setEditorContent('');
    setFileName('Untitled Document');
    setError(null);
  }, [editorContent, selectedTemplate, currentStorageKey, fileName, currentSessionKey]);

  const handleManualSave = useCallback(async () => {
    try {
      setIsLoading(true);
      
      localStorage.setItem(currentStorageKey, editorContent);
      localStorage.setItem(currentStorageKey + '_lastSaved', new Date().toISOString());
      
      if (selectedTemplate?.id && typeof selectedTemplate.id === 'string' && !selectedTemplate.id.includes('-')) {
        const blob = new Blob([editorContent], { type: 'text/html' });
        const file = new File([blob], fileName + '.html', { type: 'text/html' });
          
        await ApiService.saveUserDraft(selectedTemplate.id, fileName, file);
      }
      
      setError(null);
      
    } catch (error) {
      console.error('Manual save failed:', error);
      setError('Failed to save document. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [editorContent, currentStorageKey, selectedTemplate, fileName]);

  const handleDiscardChanges = useCallback(async () => {
    setShowDiscardDialog(false);
    
    if (window.pendingTemplate) {
      await selectTemplate(window.pendingTemplate);
      window.pendingTemplate = null;
    } else if (window.pendingAction === 'backToTemplates') {
      await goBackToTemplates();
      window.pendingAction = null;
    }
  }, [selectTemplate, goBackToTemplates]);

  const handleKeepChanges = useCallback(() => {
    setShowDiscardDialog(false);
    window.pendingTemplate = null;
    window.pendingAction = null;
  }, []);

  return (
    <div className="flex h-screen bg-gray-50">
      {!selectedTemplate ? (
        <div className="flex-1 flex flex-col">
          <header className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Document Templates</h1>
                <p className="text-sm text-gray-600 mt-1">Choose a template to start creating your document</p>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2 text-sm text-gray-600">
                  <User className="w-4 h-4" />
                  <span>User: {userId.slice(-8)}</span>
                </div>
                {documentList.length > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      className="flex items-center space-x-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <FileText className="w-4 h-4" />
                      <span>Recent Documents ({documentList.length})</span>
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    
                    {isMenuOpen && (
                      <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                        <div className="p-4 border-b border-gray-100">
                          <h3 className="font-semibold text-gray-900">Recent Documents</h3>
                        </div>
                        <div className="max-h-64 overflow-y-auto">
                          {documentList.slice(0, 10).map((doc) => (
                            <button
                              key={doc.id}
                              onClick={() => {
                                const template = { id: doc.templateId, content: doc.content };
                                handleTemplateSelection(template);
                                setIsMenuOpen(false);
                              }}
                              className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium text-gray-900 truncate">{doc.fileName}</p>
                                  <p className="text-sm text-gray-600">{doc.wordCount} words</p>
                                </div>
                                <div className="text-xs text-gray-500 ml-2">
                                  {new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
                                    Math.floor((doc.lastSaved - new Date()) / (1000 * 60 * 60 * 24)),
                                    'day'
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="bg-white border-b border-gray-200 px-6 py-4">
            <div className="max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-400 p-4 mx-6 mt-4">
              <div className="flex">
                <div className="ml-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-auto px-6 py-6">
            <Templates onSelectTemplate={handleTemplateSelection} query={searchQuery} />
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <header className="bg-white border-b border-gray-200 px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleBackToTemplates}
                  disabled={isLoading}
                  className="flex items-center space-x-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                  title="Back to Templates"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-sm font-medium">Templates</span>
                </button>
                
                <div className="h-6 w-px bg-gray-300"></div>
                
                <div className="flex items-center space-x-3">
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    className="text-lg font-semibold bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1 min-w-0 w-64"
                    placeholder="Document name"
                    disabled={isLoading}
                  />
                  
                  <div className="flex items-center space-x-2 text-xs text-gray-500">
                    {isSaving ? (
                      <>
                        <Loader className="w-3 h-3 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : lastSaved ? (
                      <>
                        <Clock className="w-3 h-3" />
                        <span>
                          Saved {new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
                            Math.floor((lastSaved - new Date()) / (1000 * 60)),
                            'minute'
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-yellow-600">● Unsaved changes</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={handleManualSave}
                  disabled={isLoading || isSaving}
                  className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  title="Save Document"
                >
                  {isLoading ? (
                    <Loader className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span className="text-sm">Save</span>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    disabled={isLoading}
                    className="flex items-center space-x-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                    <span className="text-sm">Export</span>
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  
                  {isMenuOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                      <div className="py-1">
                        <button
                          onClick={() => {
                            exportToPDF();
                            setIsMenuOpen(false);
                          }}
                          className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <Printer className="w-4 h-4" />
                          <span>Export as PDF</span>
                        </button>
                        <button
                          onClick={() => {
                            exportToHTML();
                            setIsMenuOpen(false);
                          }}
                          className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <FileText className="w-4 h-4" />
                          <span>Export as HTML</span>
                        </button>
                        <button
                          onClick={() => {
                            exportToText();
                            setIsMenuOpen(false);
                          }}
                          className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          <FileText className="w-4 h-4" />
                          <span>Export as Text</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-2 text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
                  <User className="w-4 h-4" />
                  <span>User: {userId.slice(-8)}</span>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-2 text-sm text-red-600 bg-red-50 px-3 py-1 rounded">
                {error}
              </div>
            )}
          </header>

          <div className="flex-1 overflow-auto">
            <CKEditor
              editor={ClassicEditor}
              data={typeof editorContent === 'string' ? editorContent : ''}
              onReady={editor => {
                console.log('Editor is ready to use!', editor);
              }}
              onChange={(event, editor) => {
                const data = editor.getData();
                handleEditorChange(data);
              }}
              onBlur={(event, editor) => {
                console.log('Blur.', editor);
              }}
              onFocus={(event, editor) => {
                console.log('Focus.', editor);
              }}
            />
          </div>
        </div>
      )}

      {showDiscardDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center space-x-3">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
                    <span className="text-yellow-600 text-xl">⚠️</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Unsaved Changes</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    You have unsaved changes that will be lost if you continue. Do you want to discard your changes?
                  </p>
                </div>
              </div>
              
              <div className="flex space-x-3 mt-6">
                <button
                  onClick={handleKeepChanges}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Keep Editing
                </button>
                <button
                  onClick={handleDiscardChanges}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isMenuOpen && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => setIsMenuOpen(false)}
        />
      )}

      {isLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl flex items-center space-x-3">
            <Loader className="h-5 w-5 animate-spin text-blue-600" />
            <span>Loading...</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default DraftingPage;