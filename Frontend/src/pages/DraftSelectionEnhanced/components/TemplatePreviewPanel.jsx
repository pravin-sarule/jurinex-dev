import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { getDraftVersions, getDraft } from '../../../services/draftTemplateApi';

const TemplatePreviewPanel = ({ template, draft, onDraftUpdate }) => {
  const editorRef = useRef(null);
  const hasTransformedRef = useRef(false);
  const [versionHistory, setVersionHistory] = useState(null);
  const [selectedVersionId, setSelectedVersionId] = useState(null);

  // Load version history when draft is available
  useEffect(() => {
    if (draft?.id) {
      loadVersionHistory();
    }
  }, [draft?.id]);

  const loadVersionHistory = async () => {
    try {
      const history = await getDraftVersions(draft.id);
      setVersionHistory(history);
      setSelectedVersionId(history.currentVersionId);
    } catch (error) {
      console.error('Error loading version history:', error);
    }
  };

  // Transform template content to display format
  const transformedContent = useMemo(() => {
    if (!template?.content) {
      return { type: 'doc', content: [] };
    }

    // Handle TipTap JSON format
    if (template.content.type === 'doc') {
      return template.content;
    }

    // Handle HTML fallback
    if (typeof template.content === 'string' || template.content?.fallback_html) {
      // Return empty doc - we'll render HTML separately
      return { type: 'doc', content: [] };
    }

    return { type: 'doc', content: [] };
  }, [template?.content]);

  // Initialize editor for TipTap content
  const editor = useEditor({
    extensions: [StarterKit],
    content: transformedContent,
    editable: false, // Read-only preview
    editorProps: {
      attributes: {
        class: 'prose prose-lg max-w-none focus:outline-none px-8 py-6 min-h-full prose-headings:font-bold prose-p:my-4 prose-ol:my-4 prose-ul:my-4 prose-li:my-2',
        style: 'min-height: 100%; font-family: Georgia, "Times New Roman", serif;',
      },
    },
  });

  // Handle HTML fallback content - prioritize template content
  const htmlContent = useMemo(() => {
    // Check template content first (from GET /api/templates/:id)
    if (template?.content?.fallback_html?.pages) {
      console.log('Using template fallback_html.pages:', template.content.fallback_html.pages.length, 'pages');
      return template.content.fallback_html.pages;
    }
    // Check if content is directly in fallback_html
    if (template?.content?.fallback_html && Array.isArray(template.content.fallback_html)) {
      return template.content.fallback_html;
    }
    // Check if content is a string
    if (typeof template?.content === 'string') {
      return [{ html: template.content, pageNo: 1 }];
    }
    console.log('No HTML content found in template:', template?.content);
    return null;
  }, [template?.content]);

  // Get CSS from fallback_html if available
  const templateCss = useMemo(() => {
    return template?.content?.fallback_html?.css || '';
  }, [template?.content]);

  // Render editable blanks (fields) from schema
  const renderEditableBlanks = () => {
    if (!template?.schema?.fields) return null;

    return template.schema.fields.map((field) => {
      // Find field occurrences in content and make them editable
      return (
        <div key={field.key} className="inline-block">
          <input
            type="text"
            placeholder={field.label || field.key}
            className="editable-field inline-block min-w-[120px] px-2 py-1 mx-1 border-2 border-dashed border-[#21C1B6] rounded bg-yellow-50 focus:outline-none focus:border-[#1AA49B] focus:bg-yellow-100"
            data-field-key={field.key}
          />
        </div>
      );
    });
  };

  // Create a map of field values from draft blocks
  const fieldValuesMap = useMemo(() => {
    if (!draft?.blocks) {
      console.log('No draft blocks available');
      return {};
    }
    
    const values = {};
    draft.blocks.forEach((block) => {
      // Block structure: { id, key, content: { value, label, type, ... } }
      if (block.key && block.content?.value !== undefined && block.content?.value !== null) {
        values[block.key] = block.content.value;
      }
    });
    
    console.log('Field values map from draft blocks:', values);
    console.log('Total blocks:', draft.blocks.length);
    console.log('Blocks with values:', Object.keys(values).length);
    
    return values;
  }, [draft?.blocks]);

  // Helper to escape regex special characters
  const escapeRegex = (str) => {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Escape HTML in field values to prevent XSS
  const escapeHtml = (text) => {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  };

  // Replace placeholders in HTML content with filled values or show placeholders
  const processHtmlWithFields = (html) => {
    if (!html) return html;

    let processedHtml = String(html);
    
    if (!template?.schema?.fields || !draft?.blocks) {
      return processedHtml;
    }

    // Create a mapping of field labels to field keys for better matching
    const labelToKeyMap = {};
    template.schema.fields.forEach(field => {
      if (field.label) {
        labelToKeyMap[field.label.toLowerCase().trim()] = field.key;
      }
    });

    // Strategy 1: Replace spans with data-field-key that match schema field keys
    template.schema.fields.forEach((field) => {
      const fieldValue = fieldValuesMap[field.key];
      const hasValue = fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== '';
      
      // Match spans with data-field-key matching this field's key
      const fieldKeyPattern = new RegExp(
        `<span[^>]*data-field-key=["']${escapeRegex(field.key)}["'][^>]*>.*?</span>`,
        'gis'
      );
      
      const replacement = hasValue
        ? `<span class="filled-field" data-field-key="${escapeHtml(field.key)}" title="Filled: ${escapeHtml(field.label || field.key)}">${escapeHtml(String(fieldValue))}</span>`
        : `<span class="empty-field" data-field-key="${escapeHtml(field.key)}" title="Not filled: ${escapeHtml(field.label || field.key)}">[${escapeHtml(field.label || field.key)} not filled]</span>`;

      processedHtml = processedHtml.replace(fieldKeyPattern, replacement);
    });

    // Strategy 2: Replace spans with data-label that match schema field labels
    template.schema.fields.forEach((field) => {
      const fieldValue = fieldValuesMap[field.key];
      const hasValue = fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== '';
      
      if (field.label) {
        // Match spans with data-label containing this field's label
        const labelPattern = new RegExp(
          `<span[^>]*data-label=["'][^"]*${escapeRegex(field.label)}[^"]*["'][^>]*>.*?</span>`,
          'gis'
        );
        
        const replacement = hasValue
          ? `<span class="filled-field" data-field-key="${escapeHtml(field.key)}" title="Filled: ${escapeHtml(field.label)}">${escapeHtml(String(fieldValue))}</span>`
          : `<span class="empty-field" data-field-key="${escapeHtml(field.key)}" title="Not filled: ${escapeHtml(field.label)}">[${escapeHtml(field.label)} not filled]</span>`;

        processedHtml = processedHtml.replace(labelPattern, replacement);
      }
    });

    // Strategy 3: Replace traditional placeholder patterns: {{field}}, [field], {field}
    template.schema.fields.forEach((field) => {
      const fieldValue = fieldValuesMap[field.key];
      const hasValue = fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== '';
      
      const patterns = [
        new RegExp(`\\{\\{${escapeRegex(field.key)}\\}\\}`, 'gi'),
        new RegExp(`\\[${escapeRegex(field.key)}\\]`, 'gi'),
        new RegExp(`\\{${escapeRegex(field.key)}\\}`, 'gi'),
      ];

      if (field.label && field.label !== field.key) {
        patterns.push(new RegExp(`\\{\\{${escapeRegex(field.label)}\\}\\}`, 'gi'));
        patterns.push(new RegExp(`\\[${escapeRegex(field.label)}\\]`, 'gi'));
      }

      const replacement = hasValue
        ? `<span class="filled-field" data-field-key="${escapeHtml(field.key)}">${escapeHtml(String(fieldValue))}</span>`
        : `<span class="empty-field" data-field-key="${escapeHtml(field.key)}">[${escapeHtml(field.label || field.key)} not filled]</span>`;

      patterns.forEach((pattern) => {
        processedHtml = processedHtml.replace(pattern, replacement);
      });
    });

    // Strategy 4: Replace underscores/blanks that appear near field labels
    // This is more complex and might need context, so we'll be conservative
    template.schema.fields.forEach((field) => {
      const fieldValue = fieldValuesMap[field.key];
      const hasValue = fieldValue !== undefined && fieldValue !== null && String(fieldValue).trim() !== '';
      
      // Match patterns like "Rs. _______ /-" or "Rs. ________/-" near field labels
      if (field.label && (field.label.toLowerCase().includes('rent') || field.label.toLowerCase().includes('amount'))) {
        const amountPattern = new RegExp(
          `(Rs\\.|₹)\\s*_{5,}\\s*/?-?`,
          'gi'
        );
        
        if (hasValue && amountPattern.test(processedHtml)) {
          processedHtml = processedHtml.replace(
            amountPattern,
            `$1 ${escapeHtml(String(fieldValue))} /-`
          );
        }
      }
    });

    return processedHtml;
  };

  // Render draft blocks grouped by page
  // ⚠️ GOLDEN RULES:
  // - Group blocks by content.pageNo (backend provides this)
  // - Never reorder blocks
  // - Never move blocks across pages
  // - Never change structure
  // - Only display what backend gives
  const renderDraftBlocks = () => {
    if (!draft?.blocks || draft.blocks.length === 0) {
      console.log('No draft blocks to render');
      return null;
    }

    // Schema fields for matching
    const schemaFields = template?.schema?.fields || [];
    const schemaFieldKeys = new Set(schemaFields.map(f => f.key));

    // ✅ Group blocks by pageNo (backend provides this via normalizer)
    // Backend injects pageNo into block.content during normalization
    const blocksByPage = {};
    draft.blocks.forEach((block) => {
      // Use pageNo from block.content (injected by backend normalizer)
      const pageNo = block.content?.pageNo || 1;
      if (!blocksByPage[pageNo]) {
        blocksByPage[pageNo] = [];
      }
      // ✅ Preserve block order - never reorder
      blocksByPage[pageNo].push(block);
    });

    // Sort pages by pageNo (ascending)
    const pages = Object.keys(blocksByPage).sort((a, b) => parseInt(a) - parseInt(b));

    // Render one A4 page per pageNo
    return pages.map((pageNo) => (
      <div key={pageNo} className="a4-page mb-8 bg-white shadow-lg">
        <div className="px-8 py-6">
          {/* ✅ Render blocks in order - never reorder */}
          {blocksByPage[pageNo].map((block) => {
            const content = block.content || {};
            const value = content.value !== undefined && content.value !== null ? String(content.value) : '';
            const isAiGenerated = content.aiGenerated;

            // Check if this block matches a schema field (form field)
            const matchingField = schemaFields.find(f => f.key === block.key);
            
            if (matchingField) {
              // This is a form field block - render it as a field
              return (
                <div key={block.id} className="mb-3 pb-3 border-b border-gray-100 last:border-b-0">
                  <div className="flex items-start">
                    <span className="text-sm font-semibold text-gray-700 min-w-[180px] mr-4">
                      {matchingField.label || block.key}:
                    </span>
                    <span className={`flex-1 text-sm ${value ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                      {value || `[${matchingField.label || block.key} not filled]`}
                    </span>
                    {isAiGenerated && (
                      <span className="ml-2 text-xs text-[#21C1B6] font-medium">(AI)</span>
                    )}
                  </div>
                </div>
              );
            }

            // Handle content blocks (headings, paragraphs, etc.)
            if (content.type === 'heading') {
              return (
                <h2 
                  key={block.id} 
                  className={`text-2xl font-bold mb-4 mt-6 first:mt-0 ${isAiGenerated ? 'text-[#21C1B6]' : ''}`}
                >
                  {value || content.text || block.key}
                </h2>
              );
            }

            if (content.type === 'paragraph' || content.text) {
              return (
                <p 
                  key={block.id} 
                  className={`mb-4 text-gray-800 ${isAiGenerated ? 'text-[#21C1B6] italic' : ''}`}
                >
                  {value || content.text || ''}
                </p>
              );
            }

            // Fallback for other block types
            return (
              <div key={block.id} className="mb-3 pb-3 border-b border-gray-100 last:border-b-0">
                <div className="flex items-start">
                  <span className="text-sm font-medium text-gray-600 min-w-[120px] mr-4">
                    {block.key}:
                  </span>
                  <span className={`flex-1 text-sm ${value ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                    {value || '[Not filled]'}
                  </span>
                  {isAiGenerated && (
                    <span className="ml-2 text-xs text-[#21C1B6] font-medium">(AI)</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      {/* Preview Header */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
              Template Preview
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {draft ? 'Draft preview with filled fields' : 'Read-only preview • Editable fields highlighted'}
              {versionHistory && (
                <span className="ml-2">
                  • Version {versionHistory.versions?.find(v => v.id === selectedVersionId)?.versionNo || 'Latest'}
                </span>
              )}
            </p>
          </div>
          {versionHistory && versionHistory.versions && versionHistory.versions.length > 1 && (
            <select
              value={selectedVersionId || ''}
              onChange={(e) => {
                setSelectedVersionId(e.target.value);
                // TODO: Load specific version if needed
              }}
              className="text-xs px-2 py-1 border border-gray-300 rounded bg-white"
            >
              {versionHistory.versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.versionNo} - {version.actionType}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Preview Content */}
      <div className="flex-1 overflow-y-auto bg-gray-100">
        {/* Inject template CSS if available */}
        {templateCss && (
          <style dangerouslySetInnerHTML={{ __html: templateCss }} />
        )}
        
        {htmlContent && htmlContent.length > 0 ? (
          // Render HTML fallback content with filled values (PREFERRED - shows actual document)
          <div className="preview-content py-8">
            {htmlContent.map((page, pageIndex) => {
              const pageHtml = page.html || page;
              const pageNo = page.pageNo || pageIndex + 1;
              const processedHtml = processHtmlWithFields(pageHtml);
              
              return (
                <div
                  key={pageIndex}
                  dangerouslySetInnerHTML={{
                    __html: processedHtml
                  }}
                />
              );
            })}
          </div>
        ) : draft?.blocks && draft.blocks.length > 0 ? (
          // Fallback: Render draft blocks as structured content
          <div className="preview-content py-8">
            {renderDraftBlocks()}
          </div>
        ) : editor ? (
          // Render TipTap editor content
          <div className="h-full px-8 py-6">
            <EditorContent editor={editor} />
          </div>
        ) : (
          // Fallback: render schema fields as placeholders
          <div className="px-8 py-6">
            <div className="prose prose-lg max-w-none">
              <p className="text-gray-600 mb-4">
                Template content preview. Editable fields:
              </p>
              <div className="flex flex-wrap gap-2">
                {template?.schema?.fields?.map((field) => (
                    <input
                      key={field.key}
                      type="text"
                      placeholder={field.label || field.key}
                      className="editable-field px-3 py-2 border-2 border-dashed border-[#21C1B6] rounded bg-yellow-50 focus:outline-none focus:border-[#1AA49B] focus:bg-yellow-100"
                      data-field-key={field.key}
                    />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default TemplatePreviewPanel;
