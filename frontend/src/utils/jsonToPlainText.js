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

function isPlaceholderPreparedBy(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || ['legal analyst', 'actual preparer name', 'not specified in document', 'unknown', 'n/a', 'na'].includes(normalized);
}

function isReplaceableMetadataDate(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized
    || ['actual date', 'date', 'not specified in document', 'unknown', 'n/a', 'na'].includes(normalized)
    || /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

/**
 * Strips inline source citation markers inserted by the agentic document service,
 * e.g. "[SOME DOCUMENT-FILED IN WP 2121-2024 (1).pdf]"
 */
export function stripAgenticCitations(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    // Remove [... .pdf] citation markers (with optional leading space/dot)
    .replace(/\.?\s*\[[^\]]*\.pdf[^\]]*\]/gi, '')
    // Collapse any "  |" left after stripping citations at line end
    .replace(/\s{2,}\|/g, ' |')
    // Collapse multiple consecutive spaces
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * True only for Learning Mode Socratic payloads — not generic JSON that happens
 * to include a "question" or "feedback" field (e.g. secret-prompt tabular output).
 */
function isLearningPayload(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const hasUi = 'ui_type' in obj && typeof obj.ui_type === 'string';
  const hasOptions = Array.isArray(obj.options) && obj.options.length > 0;
  const hasFeedback = 'feedback' in obj;
  const hasHint = 'content_hint' in obj;
  const hasQuestion = 'question' in obj;
  return (
    hasUi ||
    hasOptions ||
    (hasFeedback && (hasHint || hasQuestion || hasOptions))
  );
}

/** Converts a learning payload object into natural prose (no JSON key labels). */
function learningPayloadToPlainText(obj) {
  const parts = [];
  if (obj.feedback && String(obj.feedback).trim()) parts.push(String(obj.feedback).trim());
  if (obj.content_hint && String(obj.content_hint).trim()) parts.push(`💡 ${String(obj.content_hint).trim()}`);
  if (obj.question && String(obj.question).trim()) parts.push(String(obj.question).trim());
  if (obj.ui_type === 'options' && Array.isArray(obj.options) && obj.options.length > 0) {
    parts.push(obj.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('  '));
  }
  return parts.join('\n\n');
}

export function convertJsonToPlainText(text) {
  if (!text) {
    return '';
  }

  if (typeof text === 'object' && text !== null) {
    if (isLearningPayload(text)) return learningPayloadToPlainText(text);
    return formatJsonAsPlainText(text);
  }

  if (typeof text !== 'string') {
    text = String(text);
  }

  // Strip markdown code fences before attempting JSON parse
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  const trimmed = stripped;
  let jsonData = null;
  try {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonData = JSON.parse(trimmed);
    }
  } catch (e) {
    jsonData = tryParsePartialJson(trimmed);
    if (!jsonData) {
      if (trimmed.startsWith('{')) {
        // Before using the regex label fallback, check if it looks like a learning payload
        const hasLearningKey =
          trimmed.includes('"ui_type"') ||
          (trimmed.includes('"feedback"') &&
            (trimmed.includes('"content_hint"') || trimmed.includes('"question"') || trimmed.includes('"options"')));
        if (hasLearningKey) {
          // Extract values without showing keys as labels
          const valRegex = /"(?:feedback|content_hint|question)":\s*"([^"]*)"/g;
          const vals = [];
          let vm;
          while ((vm = valRegex.exec(trimmed)) !== null) {
            if (vm[1] && vm[1].trim()) vals.push(vm[1].trim());
          }
          if (vals.length > 0) return vals.join('\n\n');
        }
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
    if (isLearningPayload(jsonData)) return learningPayloadToPlainText(jsonData);
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
      if (template.metadata.date && !isReplaceableMetadataDate(template.metadata.date)) {
        formattedText += `**Date:** ${template.metadata.date}\n`;
      }
      if (template.metadata.prepared_by && !isPlaceholderPreparedBy(template.metadata.prepared_by)) {
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
      'schema', 'schemas', 'metadata', 'status', 'error', 'code',
      // Learning payload fields — never render these as section headers
      'feedback', 'content_hint', 'question', 'ui_type', 'options',
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

