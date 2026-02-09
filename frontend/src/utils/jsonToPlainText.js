function tryParsePartialJson(text) {
  if (!text || typeof text !== 'string') return null;
  
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    let fixedJson = trimmed;
    
    const openQuotes = (fixedJson.match(/"/g) || []).length;
    if (openQuotes % 2 !== 0) {
      fixedJson += '"';
    }
    
    const openBraces = (fixedJson.match(/\{/g) || []).length;
    const closeBraces = (fixedJson.match(/\}/g) || []).length;
    const openBrackets = (fixedJson.match(/\[/g) || []).length;
    const closeBrackets = (fixedJson.match(/\]/g) || []).length;
    
    for (let i = 0; i < openBraces - closeBraces; i++) {
      fixedJson += '}';
    }
    for (let i = 0; i < openBrackets - closeBrackets; i++) {
      fixedJson += ']';
    }
    
    try {
      return JSON.parse(fixedJson);
    } catch (e2) {
      return null;
    }
  }
}

export function convertJsonToPlainText(text) {
  if (!text) {
    return '';
  }

  if (typeof text === 'object' && text !== null) {
    return formatJsonAsPlainText(text);
  }

  if (typeof text !== 'string') {
    text = String(text);
  }

  let jsonData = null;
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonData = JSON.parse(trimmed);
    }
  } catch (e) {
    jsonData = tryParsePartialJson(text);
    if (!jsonData) {
      if (trimmed.startsWith('{')) {
        const keyValuePairs = [];
        const regex = /"([^"]+)":\s*"([^"]*)"/g;
        let match;
        while ((match = regex.exec(trimmed)) !== null) {
          keyValuePairs.push(`**${match[1]}:** ${match[2]}\n`);
        }
        if (keyValuePairs.length > 0) {
          return keyValuePairs.join('\n');
        }
      }
      return text;
    }
  }

  if (jsonData) {
    return formatJsonAsPlainText(jsonData);
  }

  return text;
}

function formatJsonAsPlainText(jsonData) {
  let formattedText = '';

  if (jsonData.schemas && jsonData.schemas.output_summary_template) {
    const template = jsonData.schemas.output_summary_template;
    
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

    if (template.generated_sections) {
      const sections = template.generated_sections;
      
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

    if (!formattedText || formattedText.trim().length < 50) {
      formattedText = extractTextFromJson(jsonData);
    }
  } else {
    formattedText = extractTextFromJson(jsonData);
  }

  if (!formattedText || formattedText.trim().length < 20) {
    const allText = JSON.stringify(jsonData);
    if (allText.length < 200 && !allText.match(/generated_text|content|text|summary|description/i)) {
      return '';
    }
    formattedText = extractTextFromJson(jsonData);
  }

  if (!formattedText || formattedText.trim().length < 10) {
    return 'Response content is being processed. Please try again or contact support if this persists.';
  }

  return formattedText;
}

function extractTextFromJson(obj, depth = 0) {
  if (depth > 10) return '';
  
  let text = '';
  
  if (typeof obj === 'string') {
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
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          text += `- ${extracted}\n`;
        } else {
          text += `${extracted}\n\n`;
        }
      }
    });
  } else if (obj && typeof obj === 'object') {
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
      if (skipKeys.includes(key.toLowerCase())) {
        return;
      }
      
      const value = obj[key];
      
      if (typeof value === 'string' && value.trim()) {
        if (!value.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i)) {
          const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          
          if (value.length > 50) {
            text += `## ${readableKey}\n\n${value}\n\n`;
          } else {
            text += `**${readableKey}:** ${value}\n\n`;
          }
        }
      } 
      else if (key === 'generated_text' && typeof value === 'string' && value.trim()) {
        if (!value.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i)) {
          text += `${value}\n\n`;
        }
      }
      else if (Array.isArray(value) && value.length > 0) {
        const extracted = extractTextFromJson(value, depth + 1);
        if (extracted && extracted.trim()) {
          const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          text += `## ${readableKey}\n\n${extracted}\n\n`;
        }
      }
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const extracted = extractTextFromJson(value, depth + 1);
        if (extracted && extracted.trim()) {
          const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
          if (extracted.length > 20) {
            text += `## ${readableKey}\n\n${extracted}\n\n`;
          } else {
            text += `**${readableKey}:** ${extracted}\n\n`;
          }
        }
      }
      else if (value !== null && value !== undefined && (typeof value === 'number' || typeof value === 'boolean')) {
        const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        text += `**${readableKey}:** ${String(value)}\n\n`;
      }
    });
  }
  
  return text.trim();
}

