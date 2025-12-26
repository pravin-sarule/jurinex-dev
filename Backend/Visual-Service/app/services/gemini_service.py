# """
# Gemini AI Service
# Handles interaction with Google's Gemini 1.5 Flash model for flowchart generation
# """




#     """
#     Service class for interacting with Gemini 1.5 Flash AI model
    
#     This service handles:
#     - Generating flowchart descriptions from document content
#     - Extracting Mermaid syntax from AI responses
#     - Error handling for AI API calls
#     """
    
#         """
#         Generate flowchart description using Gemini 1.5 Flash
        
#         This method:
#         1. Constructs a comprehensive prompt with document content
#         2. Sends prompt to Gemini 1.5 Flash model
#         3. Returns the generated flowchart description
#         4. Extracts Mermaid syntax if available
        
#         Args:
#             document_content (str): The document content to analyze
#             prompt (str, optional): Custom prompt for flowchart generation
#             flowchart_type (str): Type of flowchart (process, decision, etc.)
            
#         Returns:
#             dict: Contains:
#                 - flowchart_description: Full AI-generated description
#                 - mermaid_syntax: Extracted Mermaid syntax (if available)
                
#         Raises:
#             ValueError: If Gemini API is not configured or generation fails
#         """
        
#         flowchart_prompt = prompt or f'''Generate a {flowchart_type} flowchart based on the following document. 
# Create a clear, structured flowchart that visualizes the key processes, steps, or relationships described in the document.
# Use standard flowchart symbols (rectangles for processes, diamonds for decisions, arrows for flow).
# Make it comprehensive and easy to understand.'''
        
#         full_prompt = f'''{flowchart_prompt}

# {document_content}

# Please generate a detailed flowchart description in Mermaid syntax or a structured text format that can be used to create a visual flowchart. 
# Include all key steps, decision points, and relationships from the document.'''
        
            
            
            
    
#         """
#         Extract Mermaid syntax from AI-generated text
        
#         This helper method searches for Mermaid code blocks in the AI response
#         and extracts the syntax for direct use in visualization libraries.
        
#         Args:
#             text (str): The AI-generated text response
            
#         Returns:
#             str or None: Extracted Mermaid syntax, or None if not found
#         """
        
        
        
        

"""
Gemini AI Service
Handles interaction with Google's Gemini models for flowchart generation.
"""

#     """
#     Service class for interacting with Google Gemini AI models.
#     """
    

#         """Configures the Gemini API with the environment key."""

#         """
#         Generate flowchart description using Gemini.
        
#         Args:
#             document_content (str): The document content to analyze.
#             prompt (str, optional): Custom prompt.
#             flowchart_type (str): Type of flowchart (process, decision).
            
#         Returns:
#             dict: { 'flowchart_description': str, 'mermaid_syntax': str }
#         """
        


#         full_prompt = f"""
#         {base_prompt}

#         INSTRUCTIONS:
#         1. Analyze the text provided below.
#         2. Generate a valid Mermaid.js diagram code block.
#         3. Use 'graph TD' (Top-Down) or 'sequenceDiagram' as appropriate.
#         4. Do not use special characters inside node labels that break syntax (like parentheses or quotes) without escaping them.
#         5. Return the Mermaid code inside a markdown code block (```mermaid ... ```).

#         DOCUMENT CONTENT:
#         "{document_content}"
#         """
        
            

            
            
            

#         """
#         Tries to initialize the first available model from the preferred list.
#         """
        

#         """
#         Robustly extracts and cleans Mermaid syntax from AI response.
        
#         Args:
#             text (str): The AI-generated text response
            
#         Returns:
#             str or None: Extracted and cleaned Mermaid syntax, or None if not found
#         """


        

    
#         """
#         Clean and validate Mermaid syntax to fix common issues.
        
#         Args:
#             code (str): Raw Mermaid code
            
#         Returns:
#             str: Cleaned Mermaid code
#         """
        
        
        
        
        
        
            
            
        
        
        

#     sample_text = """
#     To publish a document, the user first uploads the file. 
#     If the file is valid, the system saves it to the database. 
#     If invalid, the system returns an error. 
#     Finally, a notification is sent to the admin.
#     """
    



"""
Gemini AI Service - ABSOLUTE FINAL VERSION
NO HTML entities - just removes problematic quotes entirely
"""
import os
import re
import json
import google.generativeai as genai
from google.api_core import exceptions

class GeminiService:
    """Service class for interacting with Google Gemini AI models."""
    
    PREFERRED_MODELS = [
        'gemini-2.0-flash-exp',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-pro'
    ]

    @staticmethod
    def _configure_genai():
        """Configures the Gemini API with the environment key."""
        api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_GENERATIVE_AI_API_KEY')
        if not api_key:
            raise ValueError("API Key not found. Please set GEMINI_API_KEY environment variable.")
        genai.configure(api_key=api_key)

    @staticmethod
    def generate_flowchart(document_content, prompt=None, flowchart_type='process'):
        """Generate flowchart description using Gemini."""
        GeminiService._configure_genai()
        model = GeminiService._get_available_model()

        base_prompt = prompt or (
            f"Create a '{flowchart_type}' flowchart based on the document below. "
            "Identify the key actors, steps, and decision points."
        )

        full_prompt = f"""
        {base_prompt}

        CRITICAL MERMAID SYNTAX RULES:
        1. Use 'graph TD' format
        2. DO NOT use quotes in node labels at all
        3. For sections, write: Section 10 subsection 1 (not 10(1))
        4. For dates, write: dated 30 May 2022 (not (30/05/2022))
        5. Keep labels simple and clean
        6. Return in ```mermaid code block

        GOOD EXAMPLES:
        - [Start: Union alleges illegal termination]
        - [Union issues Demand Notice dated 30 May 2022]
        - [Company replies: Apprentices not workmen]
        - Decision nodes with simple text

        BAD EXAMPLES (DO NOT DO):
        - Do not use quotes around text
        - Avoid special date formats with slashes

        DOCUMENT CONTENT:
        {document_content}
        """
        
        try:
            response = model.generate_content(full_prompt)
            if not response.parts:
                raise ValueError("AI returned an empty response.")

            flowchart_result = response.text
            mermaid_syntax = GeminiService._extract_mermaid_syntax(flowchart_result)
            
            return {
                'flowchart_description': flowchart_result,
                'mermaid_syntax': mermaid_syntax,
                'model_used': model.model_name
            }
            
        except exceptions.ResourceExhausted:
            raise ValueError("Gemini API Quota Exceeded.")
        except Exception as e:
            raise ValueError(f"Failed to generate flowchart: {str(e)}")
    
    @staticmethod
    def generate_mindmap(document_content, prompt=None):
        """
        Generate mind map structure from document content.
        
        Returns JSON structure compatible with frontend mind map renderers.
        Format:
        {
            "title": "Central theme",
            "children": [
                {
                    "text": "Main branch",
                    "children": [
                        {"text": "Sub-branch", "children": [...]}
                    ]
                }
            ]
        }
        """
        GeminiService._configure_genai()
        model = GeminiService._get_available_model()

        base_prompt = prompt or (
            "Create a comprehensive mind map based on the document below. "
            "Extract the main theme, key topics, subtopics, and important details. "
            "Organize information hierarchically with a central theme and branching structure."
        )

        full_prompt = f"""
        {base_prompt}

        CRITICAL INSTRUCTIONS:
        1. Analyze the document and identify the CENTRAL THEME/TITLE
        2. Extract MAIN BRANCHES (3-8 major topics)
        3. For each main branch, identify SUB-BRANCHES (2-5 subtopics each)
        4. Add DETAILS under sub-branches where relevant
        5. Return ONLY valid JSON in this exact format (no markdown, no code blocks):

        {{
            "title": "Central Theme Title",
            "children": [
                {{
                    "text": "Main Branch 1",
                    "children": [
                        {{
                            "text": "Sub-branch 1.1",
                            "children": [
                                {{"text": "Detail 1.1.1"}},
                                {{"text": "Detail 1.1.2"}}
                            ]
                        }},
                        {{
                            "text": "Sub-branch 1.2",
                            "children": [
                                {{"text": "Detail 1.2.1"}}
                            ]
                        }}
                    ]
                }},
                {{
                    "text": "Main Branch 2",
                    "children": [
                        {{
                            "text": "Sub-branch 2.1",
                            "children": []
                        }}
                    ]
                }}
            ]
        }}

        IMPORTANT RULES:
        - Return ONLY the JSON object, no explanations, no markdown code blocks
        - Use double quotes for all strings
        - Keep text concise (max 50 characters per node)
        - Ensure valid JSON structure
        - Include 3-8 main branches
        - Each main branch should have 2-5 sub-branches
        - Add details where they add value

        DOCUMENT CONTENT:
        {document_content}
        """
        
        try:
            response = model.generate_content(full_prompt)
            if not response.parts:
                raise ValueError("AI returned an empty response.")

            mindmap_result = response.text.strip()
            
            mindmap_result = re.sub(r'^```json\s*', '', mindmap_result, flags=re.IGNORECASE)
            mindmap_result = re.sub(r'^```\s*', '', mindmap_result)
            mindmap_result = re.sub(r'\s*```$', '', mindmap_result)
            mindmap_result = mindmap_result.strip()
            
            try:
                import json
                mindmap_json = json.loads(mindmap_result)
                
                if not isinstance(mindmap_json, dict):
                    raise ValueError("Mind map must be a JSON object")
                if 'title' not in mindmap_json:
                    raise ValueError("Mind map must have a 'title' field")
                if 'children' not in mindmap_json:
                    mindmap_json['children'] = []
                
                return {
                    'mindmap_data': mindmap_json,
                    'mindmap_json': json.dumps(mindmap_json, indent=2),
                    'model_used': model.model_name
                }
            except json.JSONDecodeError as e:
                json_match = re.search(r'\{[\s\S]*\}', mindmap_result)
                if json_match:
                    try:
                        mindmap_json = json.loads(json_match.group(0))
                        return {
                            'mindmap_data': mindmap_json,
                            'mindmap_json': json.dumps(mindmap_json, indent=2),
                            'model_used': model.model_name
                        }
                    except:
                        pass
                
                raise ValueError(f"Failed to parse mind map JSON: {str(e)}. Response: {mindmap_result[:200]}")
            
        except exceptions.ResourceExhausted:
            raise ValueError("Gemini API Quota Exceeded.")
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"Failed to generate mind map: {str(e)}")

    @staticmethod
    def _get_available_model():
        """Tries to initialize the first available model."""
        for model_name in GeminiService.PREFERRED_MODELS:
            try:
                return genai.GenerativeModel(model_name)
            except Exception:
                continue
        return genai.GenerativeModel('gemini-pro')

    @staticmethod
    def _extract_mermaid_syntax(text):
        """Extracts and cleans Mermaid syntax from AI response."""
        if not text:
            return None

        patterns = [
            r"```mermaid\s*(.*?)\s*```",
            r"```\s*(graph\s+(?:TD|LR).*?)\s*```",
            r"```\s*(flowchart.*?)\s*```",
            r"```\s*(.*?)\s*```"
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
            if match:
                code = match.group(1).strip()
                if any(k in code.lower() for k in ['graph', 'flowchart', '-->', ' --']):
                    return GeminiService._clean_mermaid_syntax(code)
        
        text_stripped = text.strip()
        if text_stripped.startswith(("graph ", "flowchart ")):
            return GeminiService._clean_mermaid_syntax(text_stripped)

        return None
    
    @staticmethod
    def _clean_mermaid_syntax(code):
        """
        AGGRESSIVE cleaning - removes ALL problematic patterns.
        NO HTML entities - just clean text.
        """
        if not code:
            return None
        
        code = code.strip()
        code = re.sub(r'^```mermaid\s*', '', code, flags=re.IGNORECASE)
        code = re.sub(r'^```\s*', '', code)
        code = re.sub(r'\s*```$', '', code)
        code = code.strip()
        
        code = re.sub(r'\r\n', '\n', code)
        code = re.sub(r'\r', '\n', code)
        code = re.sub(r'\n{3,}', '\n\n', code)
        
        code = re.sub(r'\s*-->\s*', ' --> ', code)
        code = re.sub(r'\s*--\s+', ' -- ', code)
        
        lines = code.split('\n')
        cleaned_lines = []
        
        for line in lines:
            if not line.strip():
                cleaned_lines.append(line)
                continue
            
            line = GeminiService._fix_node_labels(line)
            cleaned_lines.append(line)
        
        code = '\n'.join(cleaned_lines)
        
        valid_starters = ['graph', 'flowchart', 'sequencediagram']
        first_line = code.split('\n')[0].strip().lower()
        if not any(first_line.startswith(kw) for kw in valid_starters):
            if '-->' in code or ' -- ' in code:
                code = 'graph TD\n' + code
        
        return code.strip()
    
    @staticmethod
    def _fix_node_labels(line):
        """
        CRITICAL FIX: Remove ALL quotes and problematic patterns.
        NO HTML entities - pure clean text only.
        """
        
        line = line.replace('#quot;', '')
        line = line.replace('&quot;', '')
        line = line.replace('&#34;', '')
        line = line.replace('&#39;', '')
        line = line.replace('&apos;', '')
        
        line = re.sub(r'\([^)]*["\'](?=\))', lambda m: m.group(0).replace('"', '').replace("'", ''), line)
        line = re.sub(r'\(["\']+', '(', line)
        
        line = re.sub(r'(\d+)\((["\']?)(\d+)(["\']?)\)', r'\1(\3)', line)
        line = re.sub(r'(\d{1,2}/\d{1,2}/\d{4})(["\']?)\)', r'\1)', line)
        
        def fix_label_content(label_text):
            """Clean label - NO HTML entities, just remove quotes."""
            label_text = label_text.replace('"', '')
            label_text = label_text.replace("'", '')
            label_text = label_text.replace('`', '')
            
            label_text = label_text.replace('#quot;', '')
            label_text = label_text.replace('&quot;', '')
            label_text = label_text.replace('&#34;', '')
            label_text = label_text.replace('&#39;', '')
            label_text = label_text.replace('&apos;', '')
            
            label_text = re.sub(r'(\d+)\((["\']?)(\d+)(["\']?)\)', r'\1(\3)', label_text)
            label_text = re.sub(r'\(([^)]*)["\'](?=\))', r'(\1', label_text)
            label_text = re.sub(r'["\']\)', ')', label_text)
            label_text = re.sub(r'\(["\']', '(', label_text)
            
            label_text = label_text.replace('\\', '/')
            
            label_text = ' '.join(label_text.split())
            
            return label_text.strip()
        
        def fix_label(match):
            """Process a matched node label."""
            node_id = match.group(1)
            open_delim = match.group(2)
            label_content = match.group(3)
            close_delim = match.group(4)
            
            cleaned_label = fix_label_content(label_content)
            
            return f'{node_id}{open_delim}{cleaned_label}{close_delim}'
        
        patterns = [
            (r'([A-Za-z0-9_]+)(\(\[)([^\]]+)(\]\))', fix_label),
            (r'([A-Za-z0-9_]+)(\[\()([^\)]+)(\)\])', fix_label),
            (r'([A-Za-z0-9_]+)(\(\()([^\)]+)(\)\))', fix_label),
            (r'([A-Za-z0-9_]+)(\[\[)([^\]]+)(\]\])', fix_label),
            (r'([A-Za-z0-9_]+)(\{)([^}]+)(\})', fix_label),
            (r'([A-Za-z0-9_]+)(\[)([^\]]+)(\])', fix_label),
            (r'([A-Za-z0-9_]+)(\()([^\)]+)(\))', fix_label),
        ]
        
        for pattern, replacer in patterns:
            line = re.sub(pattern, replacer, line)
        
        def fix_edge_label(match):
            arrow_start = match.group(1)
            label = match.group(2).strip()
            arrow_end = match.group(3)
            
            label = fix_label_content(label)
            
            return f'{arrow_start} {label} {arrow_end}'
        
        line = re.sub(r'(--\|?)\s*([^-\n|]+?)\s*(\|?-->|--)', fix_edge_label, line)
        
        return line


if __name__ == "__main__":
    test_code = """graph TD
    A[#quot;Start: Respondent Union alleges illegal termination#quot;] --> B[#quot;Respondent Union issues Demand Notice (30/05/2022#quot;)]
    B --> C[#quot;Petitioner Company replies (14/06/2022#quot;): Apprentices, not workmen]
    C --> D[#quot;Respondent No.1 makes Reference u/s 10(1#quot;) of ID Act (26/08/2022)]
    D --> E[Petitioner Company challenges order]
    E --> F[File Civil Writ Petition in High Court]
    F --> G[High Court reviews the petition]
    G --> H{Does the High Court agree with Petitioner?}
    H --> |Yes| I[#quot;Set aside the order u/s 10(1#quot;) of ID Act]
    H --> |No| J[Dismiss the petition]
    I --> K[End]
    J --> K"""
    
    print("BEFORE:")
    print(test_code)
    print("\n" + "="*80 + "\n")
    print("AFTER:")
    print(GeminiService._clean_mermaid_syntax(test_code))