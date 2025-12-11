/**
 * Renders structured JSON response from secret prompts into formatted markdown
 * Handles both simple structure and complex output template structure (schemas, generated_sections, etc.)
 * @param {string|object} response - The response text (may contain JSON in markdown code blocks) or parsed JSON object
 * @returns {string} Formatted markdown string ready for ReactMarkdown
 */
/**
 * Attempts to parse partial/incomplete JSON during streaming
 * Returns the parsed object if successful, or null if parsing fails
 */
function tryParsePartialJson(text) {
  if (!text || typeof text !== 'string') return null;
  
  // Try to extract JSON from markdown code blocks first
  const jsonMatch = text.match(/```json\s*([\s\S]*?)(?:\s*```|$)/i);
  const jsonText = jsonMatch ? jsonMatch[1] : text.trim();
  
  // If it starts with { or [, try to parse it
  if (jsonText.startsWith('{') || jsonText.startsWith('[')) {
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      // If parsing fails, try to fix common incomplete JSON issues
      let fixedJson = jsonText;
      
      // Try to close unclosed strings
      const openQuotes = (fixedJson.match(/"/g) || []).length;
      if (openQuotes % 2 !== 0) {
        fixedJson += '"';
      }
      
      // Try to close unclosed objects/arrays
      const openBraces = (fixedJson.match(/\{/g) || []).length;
      const closeBraces = (fixedJson.match(/\}/g) || []).length;
      const openBrackets = (fixedJson.match(/\[/g) || []).length;
      const closeBrackets = (fixedJson.match(/\]/g) || []).length;
      
      // Add missing closing braces/brackets
      for (let i = 0; i < openBraces - closeBraces; i++) {
        fixedJson += '}';
      }
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        fixedJson += ']';
      }
      
      // Try parsing again
      try {
        return JSON.parse(fixedJson);
      } catch (e2) {
        // Still failed, return null
        return null;
      }
    }
  }
  
  return null;
}

export function renderSecretPromptResponse(response) {
  if (!response) {
    return '';
  }

  // If it's already an object, use it directly
  let jsonData = null;
  if (typeof response === 'object' && response !== null) {
    jsonData = response;
  } else if (typeof response === 'string') {
    // First, try to extract JSON from markdown code blocks (case-insensitive)
    // This handles responses like: ```json\n{...}\n```
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      try {
        const jsonText = jsonMatch[1].trim();
        jsonData = JSON.parse(jsonText);
        console.log('[renderSecretPromptResponse] Successfully parsed JSON from markdown code block');
      } catch (e) {
        console.warn('[renderSecretPromptResponse] Failed to parse JSON from code block, trying partial parse:', e);
        // Try partial JSON parsing for streaming
        jsonData = tryParsePartialJson(jsonMatch[1]);
        if (!jsonData) {
          // Try to clean and parse again
          try {
            // Remove any leading/trailing whitespace or newlines
            const cleaned = jsonMatch[1].trim().replace(/^\s+|\s+$/g, '');
            jsonData = JSON.parse(cleaned);
          } catch (e2) {
            console.warn('[renderSecretPromptResponse] Failed to parse cleaned JSON:', e2);
          }
        }
      }
    } else {
      // Try to parse as direct JSON (raw JSON without code blocks)
      const trimmed = response.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          jsonData = JSON.parse(trimmed);
          console.log('[renderSecretPromptResponse] Successfully parsed direct JSON');
        } catch (e) {
          console.warn('[renderSecretPromptResponse] Failed to parse direct JSON, trying partial parse:', e);
          // Try partial JSON parsing for streaming
          jsonData = tryParsePartialJson(response);
          if (!jsonData) {
            // Try to find JSON object in the text
            const jsonPattern = /\{[\s\S]*\}/;
            const match = trimmed.match(jsonPattern);
            if (match) {
              try {
                jsonData = JSON.parse(match[0]);
              } catch (e2) {
                // Not JSON, return as is
                console.warn('[renderSecretPromptResponse] Could not parse JSON from response:', e2);
                return response;
              }
            } else {
              // Not JSON format, return as is
              console.warn('[renderSecretPromptResponse] Response does not appear to be JSON');
              return response;
            }
          }
        }
      } else {
        // Try to find JSON anywhere in the response (for cases where there's extra text)
        const jsonPattern = /\{[\s\S]{20,}\}/;
        const match = response.match(jsonPattern);
        if (match) {
          try {
            jsonData = JSON.parse(match[0]);
            console.log('[renderSecretPromptResponse] Successfully parsed JSON from pattern match');
          } catch (e) {
            // Try partial JSON parsing
            jsonData = tryParsePartialJson(match[0]);
            if (!jsonData) {
              // Not JSON, return as is
              console.warn('[renderSecretPromptResponse] Could not parse JSON from pattern match');
              return response;
            }
          }
        } else {
          // Not JSON format, return as is
          console.warn('[renderSecretPromptResponse] No JSON pattern found in response');
          return response;
        }
      }
    }
  }

  if (!jsonData || typeof jsonData !== 'object') {
    // If we couldn't parse JSON, return the response as-is (might be plain text or incomplete JSON)
    // For streaming, show what we have so far
    return response;
  }

  let markdown = '';

  // Helper function to parse annexure summary into table format
  function parseAnnexureSummary(text) {
    if (!text) return '';
    
    const exhibits = [];
    
    // Split by lines and process each line
    const lines = text.split('\n').filter(line => line.trim());
    
    lines.forEach(line => {
      // Match pattern: **Exhibit X:** or **Exhibit X (Colly.):** followed by description
      const exhibitMatch = line.match(/\*\*Exhibit\s+([A-Z0-9-]+(?:\s*\([^)]+\))?):\*\*\s*(.+)/i);
      if (exhibitMatch) {
        const exhibit = exhibitMatch[1].trim();
        let description = exhibitMatch[2].trim();
        
        // Extract page references from SECTION numbers
        const sectionMatches = description.match(/\[SECTION\s+(\d+)(?:,\s*SECTION\s+\d+)*\]/g);
        let pageRef = 'N/A';
        if (sectionMatches && sectionMatches.length > 0) {
          // Try to extract actual page numbers from the first few sections
          // For now, use section numbers as page reference
          const sectionNums = [];
          sectionMatches.forEach(match => {
            const nums = match.match(/\d+/g);
            if (nums) sectionNums.push(...nums);
          });
          // Use unique section numbers, sorted
          const uniqueSections = [...new Set(sectionNums)].sort((a, b) => parseInt(a) - parseInt(b));
          pageRef = uniqueSections.length > 0 ? uniqueSections.join(', ') : 'N/A';
        }
        
        // Try to find explicit page numbers in description
        const pageNumMatch = description.match(/(?:page|pages?|pg\.?)\s*(\d+(?:-\d+)?)/i);
        if (pageNumMatch) {
          pageRef = pageNumMatch[1];
        }
        
        // Clean description (remove section references for cleaner display)
        let cleanDescription = description.replace(/\[SECTION\s+\d+(?:,\s*SECTION\s+\d+)*\]/g, '').trim();
        
        // Extract key insight - look for patterns that indicate key information
        // The key insight is usually the main point of the exhibit
        let keyInsight = cleanDescription;
        
        // If description is long, try to extract the most important part
        // Look for phrases that indicate importance
        const importantPhrases = [
          /(?:proves?|shows?|demonstrates?|confirms?|establishes?|indicates?)\s+([^.]+)/i,
          /(?:evidence|proof|confirmation|establishment)\s+of\s+([^.]+)/i,
        ];
        
        for (const pattern of importantPhrases) {
          const match = cleanDescription.match(pattern);
          if (match) {
            keyInsight = match[1] || match[0];
            break;
          }
        }
        
        // If still too long, truncate intelligently
        if (keyInsight.length > 150) {
          // Try to find a sentence boundary
          const sentenceMatch = keyInsight.match(/^(.{0,150}[.!?])\s/);
          if (sentenceMatch) {
            keyInsight = sentenceMatch[1];
          } else {
            keyInsight = keyInsight.substring(0, 147) + '...';
          }
        }
        
        // Clean up description - remove trailing periods and extra spaces
        cleanDescription = cleanDescription.replace(/\s+/g, ' ').trim();
        
        exhibits.push({
          exhibit: exhibit.replace(/\(Colly\.\)/i, '(Colly.)'),
          description: cleanDescription,
          pageRef: pageRef,
          keyInsight: keyInsight
        });
      }
    });
    
    if (exhibits.length > 0) {
      let table = '| EXHIBIT | DESCRIPTION | PAGE REF. | KEY INSIGHT |\n';
      table += '|---------|-------------|-----------|-------------|\n';
      exhibits.forEach(exp => {
        // Escape pipe characters in content
        const safeDesc = exp.description.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        const safeInsight = exp.keyInsight.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        table += `| ${exp.exhibit} | ${safeDesc} | ${exp.pageRef} | ${safeInsight} |\n`;
      });
      return table;
    }
    
    return text; // Fallback to original text if parsing fails
  }

  // Helper function to format procedural timeline
  function formatProceduralTimeline(text) {
    if (!text) return '';
    
    // Extract dates and events
    const datePattern = /\*\*(\d{2}\.\d{2}\.\d{4}):\*\*\s*(.+?)(?=\*\*\d{2}\.\d{2}\.\d{4}|$)/g;
    const events = [];
    let match;
    
    while ((match = datePattern.exec(text)) !== null) {
      events.push({
        date: match[1],
        event: match[2].trim().replace(/\[SECTION\s+\d+(?:,\s*SECTION\s+\d+)*\]/g, '').trim()
      });
    }
    
    if (events.length > 0) {
      let formatted = '### Key Dates (Chronology)\n\n';
      events.forEach(event => {
        formatted += `- **${event.date}:** ${event.event}\n`;
      });
      return formatted;
    }
    
    return text; // Fallback to original text
  }

  // Handle output template structure (schemas.output_summary_template)
  if (jsonData.schemas && jsonData.schemas.output_summary_template) {
    const template = jsonData.schemas.output_summary_template;
    
    // Render metadata header
    if (template.metadata) {
      if (template.metadata.document_title) {
        markdown += `# ${template.metadata.document_title}\n\n`;
      }
      if (template.metadata.case_title) {
        markdown += `**Case:** ${template.metadata.case_title}\n\n`;
      }
      if (template.metadata.date) {
        markdown += `**Date:** ${template.metadata.date}\n\n`;
      }
      if (template.metadata.prepared_by) {
        markdown += `**Prepared By:** ${template.metadata.prepared_by}\n\n`;
      }
      markdown += '---\n\n';
    }

    // Render generated sections in order
    if (template.generated_sections) {
      const sectionOrder = [
        { key: '2_1_ground_wise_summary', title: '2.1 Ground-wise Summary with Supporting Facts' },
        { key: '2_2_annexure_summary', title: '2.2 Annexure Summary with Page References' },
        { key: '2_3_risk_and_weak_points', title: '2.3 Risk and Weak Points' },
        { key: '2_4_expected_counter_arguments', title: '2.4 Expected Counter Arguments' },
        { key: '2_5_evidence_matrix', title: '2.5 Evidence Matrix' },
        { key: '2_6_opponent_submissions_summary', title: '2.6 Summary of Opponent\'s Submissions' },
        { key: '2_7_procedural_timeline_summary', title: '2.7 Procedural Timeline Summary' },
        { key: '2_8_legal_strategy_note', title: '2.8 Legal Strategy Note' },
        { key: '2_9_compliance_and_deficiency_summary', title: '2.9 Compliance and Deficiency Summary' },
        { key: '2_10_court_history_summary', title: '2.10 Court History Summary' },
      ];

      sectionOrder.forEach(({ key, title }) => {
        const section = template.generated_sections[key];
        if (section && section.generated_text) {
          const text = section.generated_text.trim();
          // Skip placeholder text
          if (text && !text.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i)) {
            markdown += `## ${title}\n\n`;
            
            // Special formatting for annexure summary (convert to table)
            if (key === '2_2_annexure_summary') {
              const tableContent = parseAnnexureSummary(text);
              markdown += tableContent || text;
            }
            // Special formatting for procedural timeline
            else if (key === '2_7_procedural_timeline_summary') {
              const timelineContent = formatProceduralTimeline(text);
              markdown += timelineContent || text;
            }
            else {
              markdown += text;
            }
            
            markdown += '\n\n';
            if (section.required_summary_type) {
              markdown += `*Summary Type: ${section.required_summary_type}*\n\n`;
            }
            markdown += '---\n\n';
          }
        }
      });
    }
  }
  // Handle direct structure (generated_sections at root level)
  else if (jsonData.generated_sections) {
    // Render metadata header
    if (jsonData.metadata) {
      if (jsonData.metadata.document_title) {
        markdown += `# ${jsonData.metadata.document_title}\n\n`;
      }
      if (jsonData.metadata.case_title) {
        markdown += `**Case:** ${jsonData.metadata.case_title}\n\n`;
      }
      if (jsonData.metadata.date) {
        markdown += `**Date:** ${jsonData.metadata.date}\n\n`;
      }
      if (jsonData.metadata.prepared_by) {
        markdown += `**Prepared By:** ${jsonData.metadata.prepared_by}\n\n`;
      }
      markdown += '---\n\n';
    }

    // Render title if present
    if (jsonData.title) {
      markdown += `# ${jsonData.title}\n\n`;
    }

    // Render summary if present
    if (jsonData.summary) {
      markdown += `> ${jsonData.summary}\n\n`;
      markdown += '---\n\n';
    }

    // Render generated sections in order
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
      const section = jsonData.generated_sections[key];
      if (section && section.generated_text) {
        const text = section.generated_text.trim();
        // Skip placeholder text or empty sections
        if (text && !text.match(/^Summary Type:\s*(Extractive|Abstractive|Extractive \+ Abstractive)$/i) && text.length > 10) {
          markdown += `## ${title}\n\n`;
          
          // Special formatting for annexure summary (convert to table)
          if (key === '2_2_annexure_summary') {
            const tableContent = parseAnnexureSummary(text);
            markdown += tableContent || text;
          }
          // Special formatting for procedural timeline
          else if (key === '2_7_procedural_timeline_summary') {
            const timelineContent = formatProceduralTimeline(text);
            markdown += timelineContent || text;
          }
          // Clean up evidence matrix (remove template placeholders)
          else if (key === '2_5_evidence_matrix') {
            // Remove common template placeholders
            let cleanedText = text.replace(/\[List key documents[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Witness Name\]:\s*\[Role[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Expert Name\]:\s*\[Expertise[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Description[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Date\]:\s*\[Description[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Relevant[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Case Name\]:\s*\[Holding[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Burden[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Monetary[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Specific[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Dismissal[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Date\]:\s*\[Motion[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Any temporary[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Summary[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Pending[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Upcoming[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[When[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Court's[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Summary[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Specific[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Yes\/No[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Any collection[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Award[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Any additional[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[List of all[^\]]*\]/gi, '');
            cleanedText = cleanedText.replace(/\[Name\]/gi, '');
            cleanedText = cleanedText.replace(/\[Date\]/gi, '');
            cleanedText = cleanedText.replace(/\n{3,}/g, '\n\n'); // Remove excessive newlines
            markdown += cleanedText.trim() || text;
          }
          else {
            markdown += text;
          }
          
          markdown += '\n\n';
          markdown += '---\n\n';
        }
      }
    });

    // Render key findings
    if (jsonData.keyFindings && Array.isArray(jsonData.keyFindings) && jsonData.keyFindings.length > 0) {
      markdown += '## Key Findings\n\n';
      jsonData.keyFindings.forEach((finding) => {
        if (finding && typeof finding === 'string' && finding.trim()) {
          markdown += `- ${finding}\n`;
        }
      });
      markdown += '\n---\n\n';
    }

    // Render recommendations
    if (jsonData.recommendations && Array.isArray(jsonData.recommendations) && jsonData.recommendations.length > 0) {
      markdown += '## Recommendations\n\n';
      jsonData.recommendations.forEach((recommendation) => {
        if (recommendation && typeof recommendation === 'string' && recommendation.trim()) {
          markdown += `- ${recommendation}\n`;
        }
      });
      markdown += '\n';
    }
  }
  // Handle simple structure (title, summary, sections, etc.)
  else {
    // Render title
    if (jsonData.title) {
      markdown += `# ${jsonData.title}\n\n`;
    }

    // Render summary
    if (jsonData.summary) {
      markdown += `> ${jsonData.summary}\n\n`;
      markdown += '---\n\n';
    }

    // Render sections
    if (jsonData.sections && Array.isArray(jsonData.sections)) {
      jsonData.sections.forEach((section, index) => {
        if (section.heading) {
          markdown += `## ${section.heading}\n\n`;
        }
        
        if (section.content) {
          markdown += `${section.content}\n\n`;
        }

        // Render subsections
        if (section.subsections && Array.isArray(section.subsections)) {
          section.subsections.forEach((subsection) => {
            if (subsection.heading) {
              markdown += `### ${subsection.heading}\n\n`;
            }
            
            if (subsection.content) {
              markdown += `${subsection.content}\n\n`;
            }
          });
        }

        // Add separator between sections (except last one)
        if (index < jsonData.sections.length - 1) {
          markdown += '---\n\n';
        }
      });
    }

    // Render key findings
    if (jsonData.keyFindings && Array.isArray(jsonData.keyFindings) && jsonData.keyFindings.length > 0) {
      markdown += '## Key Findings\n\n';
      jsonData.keyFindings.forEach((finding) => {
        if (finding && typeof finding === 'string' && finding.trim()) {
          markdown += `- ${finding}\n`;
        }
      });
      markdown += '\n';
    }

    // Render recommendations
    if (jsonData.recommendations && Array.isArray(jsonData.recommendations) && jsonData.recommendations.length > 0) {
      markdown += '## Recommendations\n\n';
      jsonData.recommendations.forEach((recommendation) => {
        if (recommendation && typeof recommendation === 'string' && recommendation.trim()) {
          markdown += `- ${recommendation}\n`;
        }
      });
      markdown += '\n';
    }

    // Render metadata (optional, at the end)
    if (jsonData.metadata && typeof jsonData.metadata === 'object') {
      const metadataEntries = Object.entries(jsonData.metadata).filter(([_, value]) => value);
      if (metadataEntries.length > 0) {
        markdown += '---\n\n';
        markdown += '### Metadata\n\n';
        metadataEntries.forEach(([key, value]) => {
          const readableKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
          markdown += `**${readableKey}:** ${value}\n\n`;
        });
      }
    }
  }

  return markdown.trim();
}

/**
 * Checks if a response is a structured JSON secret prompt response
 * @param {string|object} response - The response to check
 * @returns {boolean} True if it appears to be a structured JSON response
 */
export function isStructuredJsonResponse(response) {
  if (!response) return false;
  
  if (typeof response === 'object' && response !== null) {
    // Check for simple structure
    if (response.title || response.sections || response.summary) return true;
    // Check for output template structure
    if (response.schemas && response.schemas.output_summary_template) return true;
    // Check for direct generated_sections structure
    if (response.generated_sections) return true;
    return false;
  }
  
  if (typeof response === 'string') {
    let jsonToCheck = response;
    
    // First, try to extract JSON from markdown code blocks (case-insensitive)
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      jsonToCheck = jsonMatch[1].trim();
    } else {
      // If no code blocks, use the response as-is
      jsonToCheck = response.trim();
    }
    
    // Check if it looks like JSON (starts with { or [)
    if (jsonToCheck.startsWith('{') || jsonToCheck.startsWith('[')) {
      try {
        const parsed = JSON.parse(jsonToCheck);
        // Check for simple structure
        if (parsed.title || parsed.sections || parsed.summary) return true;
        // Check for output template structure
        if (parsed.schemas && parsed.schemas.output_summary_template) return true;
        // Check for direct generated_sections structure
        if (parsed.generated_sections) return true;
      } catch (e) {
        // If parsing fails, try to find JSON object in the text
        const jsonPattern = /\{[\s\S]{20,}\}/;
        const match = jsonToCheck.match(jsonPattern);
        if (match) {
          try {
            const parsed = JSON.parse(match[0]);
            // Check for simple structure
            if (parsed.title || parsed.sections || parsed.summary) return true;
            // Check for output template structure
            if (parsed.schemas && parsed.schemas.output_summary_template) return true;
            // Check for direct generated_sections structure
            if (parsed.generated_sections) return true;
          } catch (e2) {
            return false;
          }
        }
        return false;
      }
    }
  }
  
  return false;
}