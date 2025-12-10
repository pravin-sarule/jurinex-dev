/**
 * Converts JSON response to readable plain text format
 * Handles structured output templates (like legal summaries) and converts them to readable format
 * @param {string|object} text - The text that might be JSON (string) or already parsed JSON (object)
 * @returns {string} Plain text representation
 */
export function convertJsonToPlainText(text) {
  // Handle null, undefined, or empty values
  if (!text) {
    return '';
  }

  // If it's already an object, use it directly
  if (typeof text === 'object' && text !== null) {
    return formatJsonAsPlainText(text);
  }

  // If it's not a string, convert to string first
  if (typeof text !== 'string') {
    text = String(text);
  }

  // Try to detect if the text is JSON
  let jsonData = null;
  try {
    // Check if text starts with JSON-like structure
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonData = JSON.parse(trimmed);
    }
  } catch (e) {
    // Not JSON, return as is
    return text;
  }

  // If it's JSON, convert to readable format
  if (jsonData) {
    return formatJsonAsPlainText(jsonData);
  }

  return text;
}

/**
 * Formats JSON object as readable plain text
 * Specifically handles structured output templates with generated_sections
 * @param {object} jsonData - The parsed JSON object
 * @returns {string} Formatted plain text
 */
function formatJsonAsPlainText(jsonData) {
  let formattedText = '';

  // Handle structured output template format
  if (jsonData.schemas && jsonData.schemas.output_summary_template) {
    const template = jsonData.schemas.output_summary_template;
    
    // Add metadata
    if (template.metadata) {
      formattedText += `# ${template.metadata.document_title || 'Document Summary'}\n\n`;
      if (template.metadata.case_title) {
        formattedText += `**Case:** ${template.metadata.case_title}\n`;
      }
      if (template.metadata.date) {
        formattedText += `**Date:** ${template.metadata.date}\n`;
      }
      if (template.metadata.prepared_by) {
        formattedText += `**Prepared By:** ${template.metadata.prepared_by}\n`;
      }
      formattedText += '\n---\n\n';
    }

    // Add generated sections
    if (template.generated_sections) {
      const sections = template.generated_sections;
      
      // Define section order and titles
      const sectionOrder = [
        { key: '2_1_ground_wise_summary', title: 'Ground-wise Summary' },
        { key: '2_2_annexure_summary', title: 'Annexure Summary' },
        { key: '2_3_risk_and_weak_points', title: 'Risk and Weak Points' },
        { key: '2_4_expected_counter_arguments', title: 'Expected Counter Arguments' },
        { key: '2_5_evidence_matrix', title: 'Evidence Matrix' },
        { key: '2_6_opponent_submissions_summary', title: 'Opponent Submissions Summary' },
        { key: '2_7_procedural_timeline_summary', title: 'Procedural Timeline Summary' },
        { key: '2_8_legal_strategy_note', title: 'Legal Strategy Note' },
        { key: '2_9_compliance_and_deficiency_summary', title: 'Compliance and Deficiency Summary' },
        { key: '2_10_court_history_summary', title: 'Court History Summary' },
      ];

      sectionOrder.forEach(({ key, title }) => {
        const section = sections[key];
        if (section && section.generated_text) {
          // Only add if generated_text has actual content (not just "Summary Type: ...")
          const text = section.generated_text.trim();
          if (text && !text.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i)) {
            formattedText += `## ${title}\n\n`;
            formattedText += `${text}\n\n`;
            if (section.required_summary_type) {
              formattedText += `*Summary Type: ${section.required_summary_type}*\n\n`;
            }
            formattedText += '---\n\n';
          }
        }
      });
    }

    // If no sections were added, try to extract any meaningful content
    if (!formattedText || formattedText.trim().length < 50) {
      // Fallback: try to extract any text from the JSON structure
      formattedText = extractTextFromJson(jsonData);
    }
  } else {
    // Generic JSON formatting - extract all meaningful content
    formattedText = extractTextFromJson(jsonData);
  }

  // If we still don't have meaningful content, try one more time with a more aggressive extraction
  if (!formattedText || formattedText.trim().length < 20) {
    // Last resort: try to find any string values in the JSON
    const allText = JSON.stringify(jsonData);
    // If the JSON is just metadata/empty, return empty string instead of showing JSON
    if (allText.length < 200 && !allText.match(/generated_text|content|text|summary|description/i)) {
      return '';
    }
    // Otherwise, do a final extraction attempt
    formattedText = extractTextFromJson(jsonData);
  }

  // Only return formatted text if we have meaningful content
  // Never return raw JSON string - if we can't format it, return empty or a message
  if (!formattedText || formattedText.trim().length < 10) {
    return 'Response content is being processed. Please try again or contact support if this persists.';
  }

  return formattedText;
}

/**
 * Recursively extracts text content from JSON structure
 * @param {any} obj - The object to extract text from
 * @param {number} depth - Current recursion depth
 * @returns {string} Extracted text
 */
function extractTextFromJson(obj, depth = 0) {
  if (depth > 10) return ''; // Prevent infinite recursion
  
  let text = '';
  
  if (typeof obj === 'string') {
    // Skip placeholder text and very short strings that are likely metadata
    if (!obj.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i)) {
      return obj;
    }
    return '';
  }
  
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }
  
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const extracted = extractTextFromJson(item, depth + 1);
      if (extracted && extracted.trim()) {
        // If it's a simple string, add it as a list item
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          text += `- ${extracted}\n`;
        } else {
          text += `${extracted}\n\n`;
        }
      }
    });
  } else if (obj && typeof obj === 'object') {
    // Skip common metadata/system keys
    const skipKeys = [
      'format', 'version', 'description', 'instructions', 'extraction_metadata', 
      'required_summary_type', 'type', 'id', 'timestamp', 'created_at', 'updated_at',
      'schema', 'schemas', 'metadata', 'status', 'error', 'code'
    ];
    
    const keys = Object.keys(obj);
    const hasContent = keys.some(key => {
      const val = obj[key];
      return (typeof val === 'string' && val.trim().length > 10) ||
             (Array.isArray(val) && val.length > 0) ||
             (val && typeof val === 'object' && Object.keys(val).length > 0);
    });
    
    if (!hasContent) {
      return '';
    }
    
    keys.forEach(key => {
      // Skip metadata keys that don't contain user content
      if (skipKeys.includes(key.toLowerCase())) {
        return;
      }
      
      const value = obj[key];
      
      // Handle string values
      if (typeof value === 'string' && value.trim()) {
        // Skip placeholder text
        if (!value.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i)) {
          // Format key as readable title
          const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          
          // If it's a long text (likely content), add as section
          if (value.length > 50) {
            text += `## ${readableKey}\n\n${value}\n\n`;
          } else {
            text += `**${readableKey}:** ${value}\n\n`;
          }
        }
      } 
      // Handle generated_text specifically (common in templates)
      else if (key === 'generated_text' && typeof value === 'string' && value.trim()) {
        if (!value.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i)) {
          text += `${value}\n\n`;
        }
      }
      // Handle arrays
      else if (Array.isArray(value) && value.length > 0) {
        const extracted = extractTextFromJson(value, depth + 1);
        if (extracted && extracted.trim()) {
          const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          text += `## ${readableKey}\n\n${extracted}\n\n`;
        }
      }
      // Handle nested objects
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const extracted = extractTextFromJson(value, depth + 1);
        if (extracted && extracted.trim()) {
          const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          // Only add header if there's meaningful content
          if (extracted.length > 20) {
            text += `## ${readableKey}\n\n${extracted}\n\n`;
          } else {
            text += `**${readableKey}:** ${extracted}\n\n`;
          }
        }
      }
      // Handle other primitive types
      else if (value !== null && value !== undefined && (typeof value === 'number' || typeof value === 'boolean')) {
        const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        text += `**${readableKey}:** ${String(value)}\n\n`;
      }
    });
  }
  
  return text.trim();
}

