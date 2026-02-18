from google import genai
try:
    import google.adk as adk
except ImportError:
    adk = None
try:
    import json_repair
except ImportError:
    json_repair = None
import json
import re
import asyncio
import os
from datetime import datetime
from typing import Optional
from ..config import settings

class AntigravityAgent:
    def __init__(self):
        # Configure Gemini using the official Google Gen AI SDK
        self.client = genai.Client(api_key=settings.GEMINI_API_KEY)
        # Using Gemini 2.0 Flash - latest and fastest
        self.model_name = 'gemini-2.0-flash'
        
        # Initialize Google ADK Agent for orchestration (Optional/Unused for now)
        # self.adk_agent = adk.Agent(
        #     name="master_template_analyser_agent",
        #     description="Expert legal template analyzer using Gemini for document analysis, section identification, and prompt generation."
        # )

    def _attempt_json_repair(self, text: str) -> str:
        """
        Attempt to repair truncated or malformed JSON by:
        1. Removing incomplete trailing elements
        2. Properly closing all open brackets/braces
        """
        # Count open braces and brackets to determine what needs closing
        open_braces = 0
        open_brackets = 0
        in_string = False
        escape_next = False
        last_valid_pos = 0

        for i, char in enumerate(text):
            if escape_next:
                escape_next = False
                continue

            if char == '\\':
                escape_next = True
                continue

            if char == '"' and not in_string:
                in_string = True
            elif char == '"' and in_string:
                in_string = False
            elif not in_string:
                if char == '{':
                    open_braces += 1
                    last_valid_pos = i
                elif char == '}':
                    open_braces -= 1
                    last_valid_pos = i
                elif char == '[':
                    open_brackets += 1
                    last_valid_pos = i
                elif char == ']':
                    open_brackets -= 1
                    last_valid_pos = i

        # If we're in the middle of a string, truncate before it
        if in_string:
            # Find the last complete field
            last_quote = text.rfind('"', 0, len(text) - 1)
            if last_quote > 0:
                # Find the quote before that
                prev_quote = text.rfind('"', 0, last_quote)
                if prev_quote > 0:
                    text = text[:last_quote + 1]

        # Remove any trailing incomplete content after the last complete element
        # Look for the last valid comma or closing bracket/brace
        text = text.rstrip()

        # Remove trailing comma if present
        if text.endswith(','):
            text = text[:-1]

        # Close all open structures
        closing = ']' * open_brackets + '}' * open_braces
        repaired = text + closing

        return repaired

    async def _call_gemini(self, prompt: str):
        """Helper to call Gemini and parse JSON safely"""
        print(f"DEBUG: Calling Gemini model {self.model_name} (Async)...")
        try:
            # Use the async interface of the genai SDK with a timeout
            response = await asyncio.wait_for(
                self.client.aio.models.generate_content(
                    model=self.model_name,
                    contents=prompt,
                    config={
                        "response_mime_type": "application/json",
                        "max_output_tokens": 65536, # Increased to handle large templates (gemini-2.0-flash supports up to 65536)
                        "temperature": 0.1 # Reduce randomness for clearer JSON
                    }
                ),
                timeout=120.0 # Increased timeout for large generation
            )
            print(f"DEBUG: Gemini response received.")
        except asyncio.TimeoutError:
            print(f"DEBUG: Gemini call timed out after 120s.")
            raise ValueError("Gemini AI analysis timed out. Please try again.")
        except Exception as e:
            print(f"DEBUG: Gemini call failed: {e}")
            raise e
        
        # Extract JSON from response - handle multiple markdown formats
        text = response.text.strip()

        # Log response length for debugging
        print(f"DEBUG: Gemini response length: {len(text)} characters")
        
        # Try to extract JSON from markdown code blocks
        json_match = re.search(r'```(?:json)?\s*\n?({[\s\S]*?})\s*\n?```', text)
        if json_match:
            clean_text = json_match.group(1)
        else:
            # If no code block, try to find JSON object directly
            json_match = re.search(r'({[\s\S]*})', text)
            if json_match:
                clean_text = json_match.group(1)
            else:
                clean_text = text
        
        # --- Robust JSON Cleaning ---
        # 1. Remove trailing commas before closing braces/brackets
        clean_text = re.sub(r',\s*([\]}])', r'\1', clean_text)
        # 2. Handle potential non-standard control characters
        clean_text = re.sub(r'[\x00-\x1F\x7F]', '', clean_text)
        # 3. Fix invalid backslash escapes (JSON only allows \ " \ / b f n r t and \uXXXX)
        #    Escape any \ not followed by a valid escape so json.loads won't raise Invalid \escape
        clean_text = re.sub(r'\\(?!["\\/bfnrt])(?!u[0-9a-fA-F]{4})', r'\\\\', clean_text)
        
        try:
            return json.loads(clean_text)
        except json.JSONDecodeError as e:
            # Provide detailed error for debugging
            print(f"JSON Parse Error: {str(e)}")
            line_no = getattr(e, 'lineno', 0)
            col_no = getattr(e, 'colno', 0)
            error_pos = getattr(e, 'pos', 0)
            print(f"Error near Line {line_no}, Col {col_no}, Position {error_pos}")

            # Show context around the error
            start = max(0, error_pos - 200)
            end = min(len(clean_text), error_pos + 200)
            print(f"Context around error position:")
            print(f"...{clean_text[start:end]}...")

            # 1) If error is near the end, try truncation repair first
            if error_pos >= len(clean_text) - 10:
                print(f"WARNING: JSON appears truncated. Attempting truncation repair...")
                repaired_text = self._attempt_json_repair(clean_text)
                if repaired_text != clean_text:
                    try:
                        result = json.loads(repaired_text)
                        print("Successfully repaired and parsed JSON (truncation fix).")
                        return result
                    except json.JSONDecodeError:
                        pass

            # 2) Try json_repair for mid-document issues (unescaped quotes, missing commas, etc.)
            if json_repair is not None:
                try:
                    result = json_repair.loads(clean_text)
                    print("Successfully parsed JSON using json_repair fallback.")
                    return result
                except Exception as repair_err:
                    print(f"json_repair fallback failed: {repair_err}")

            # 3) Try truncation repair for any error (sometimes helps mid-doc issues too)
            try:
                repaired_text = self._attempt_json_repair(clean_text)
                result = json.loads(repaired_text)
                print("Successfully repaired and parsed JSON (brace/bracket fix).")
                return result
            except json.JSONDecodeError:
                pass

            # Save the problematic JSON to a debug file
            try:
                debug_dir = "debug_json_errors"
                os.makedirs(debug_dir, exist_ok=True)
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                debug_file = os.path.join(debug_dir, f"failed_json_{timestamp}.txt")
                with open(debug_file, "w", encoding="utf-8") as f:
                    f.write(f"Error: {str(e)}\n")
                    f.write(f"Position: {error_pos}\n")
                    f.write(f"Length: {len(clean_text)}\n")
                    f.write(f"\n{'='*80}\n")
                    f.write(f"Full JSON Response:\n")
                    f.write(f"{'='*80}\n\n")
                    f.write(clean_text)
                print(f"DEBUG: Saved problematic JSON to {debug_file}")
            except Exception as save_error:
                print(f"WARNING: Could not save debug file: {save_error}")

            raise ValueError(f"Failed to parse Gemini response as JSON: {str(e)}")

    async def analyze_template(self, template_text: str, template_file_signed_url: Optional[str] = None):
        """Phase 1: Analysis & Field Extraction using Gemini. Extracts LOGICAL template sections
        (e.g. resume: Personal Info, Education, Experience, Skills) — not a large number of micro-sections.
        Optionally pass template_file_signed_url (signed URL of uploaded PDF) for context."""
        char_count = len(template_text)
        word_count = len(template_text.split())

        url_context = ""
        if template_file_signed_url:
            url_context = f"""
TEMPLATE DOCUMENT URL (uploaded template for reference; use the extracted text below as the primary source):
{template_file_signed_url}
When extracting fields, consider that the template PDF may contain visual blanks, form fields, or empty lines—capture every such fillable spot as a field.
"""

        prompt = f"""
You are analyzing a document template for a form generator. Extract LOGICAL SECTIONS that match how the document is structured (like a resume has sections: Personal Information, Education, Work Experience, Skills, References).

Document stats: {word_count} words, {char_count} characters

TEMPLATE CONTENT (extracted from the document):
\"\"\"{template_text}\"\"\"

SECTIONING RULES (STRICTLY FOLLOW):
1. **LOGICAL SECTIONS ONLY**: Identify the real, high-level sections in the template. Do NOT split into many tiny sections. Each section should be a meaningful block that can hold content (e.g. "Education", "Work Experience", "Skills" for a resume; "Parties", "Terms", "Signatures" for a contract).

2. **Document-type examples**:
   - **Resume/CV**: Personal Information, Education, Work Experience, Skills, Certifications, References (or similar — match what the template actually has).
   - **Contract**: Title/Header, Parties, Definitions, Main Terms, Payment, Termination, Signatures (or similar).
   - **Form/Application**: Only create sections that clearly exist in the template (e.g. "Applicant Details", "Employment History", "Declaration").

3. **Do NOT**:
   - Create 10–60+ micro-sections (e.g. "Rent Amount", "Rent Due Date" as separate sections). Group those as fields inside one section like "Rent / Payment Terms".
   - Invent sections that are not present in the template.

4. **Field Extraction (CRITICAL)**:
   - Extract ALL variable/empty/fillable fields and assign each to the section where it appears.
   - Include: blank lines, [placeholders], {{variables}}, ________, "Insert X here", form fields, dates/amounts/names as placeholders, signature lines.
   - Give each field a unique "key" (snake_case). Each section's "fields" array must list every variable in that section.

5. **Output Format**: Return ONLY valid JSON. No markdown blocks. No explanatory text.

REQUIRED JSON STRUCTURE:
{{
    "template_name": "Inferred Document Title",
    "total_sections": <number of logical sections you identified>,
    "document_type": "Resume|Contract|Form|Agreement|etc",
    "estimated_draft_length": "Brief estimate when fully drafted",
    "all_fields": [
        {{
            "key": "unique_variable_snake_case_name",
            "type": "string|date|number|currency|address|boolean|email|phone|text_long|percentage",
            "label": "Human readable label",
            "required": true,
            "default_value": "Optional default",
            "validation_rules": "e.g., min length, max length, pattern",
            "description": "Detailed helper text",
            "section_id": "section_id where this field belongs"
        }}
    ],
    "sections": [
        {{
            "section_id": "unique_section_id_001",
            "section_name": "Logical section title (e.g. Education, Work Experience)",
            "section_purpose": "What this section is for and what content it will hold",
            "section_category": "header|party_details|definitions|terms|obligations|experience|education|skills|signatures|other",
            "estimated_words": estimated word count when drafted,
            "depends_on": ["section_ids this depends on, if any"],
            "fields": [
                {{
                    "key": "unique_variable_snake_case_name",
                    "type": "string|date|number|currency|address|boolean|email|phone|text_long|percentage",
                    "label": "Human readable label",
                    "required": true,
                    "default_value": "Optional default",
                    "validation_rules": "e.g., min length, max length, pattern",
                    "description": "Detailed helper text"
                }}
            ]
        }}
    ]
}}

- "all_fields" = consolidated list of every field, each with "section_id" linking to its section.
- "sections" = only LOGICAL template sections (like resume sections). Fewer, meaningful sections — not a large number of tiny ones.
"""
        
        result = await self._call_gemini(prompt)
        
        # Post-processing: ensure all_fields exists (build from sections if missing)
        if 'sections' in result and 'all_fields' not in result:
            all_fields = []
            seen_keys = set()
            for sec in result['sections']:
                sid = sec.get('section_id', '')
                for f in sec.get('fields', []):
                    key = f.get('key')
                    if key and key not in seen_keys:
                        seen_keys.add(key)
                        all_fields.append({**f, 'section_id': sid})
            result['all_fields'] = all_fields
            print(f"DEBUG: Built all_fields from sections: {len(all_fields)} fields")
        elif result.get('all_fields'):
            print(f"DEBUG: all_fields present: {len(result['all_fields'])} fields")
        
        if 'sections' in result:
            actual_sections = len(result['sections'])
            print(f"DEBUG: Extracted {actual_sections} logical sections from {word_count} word document")
        return result

    async def generate_section_prompts(self, section_data: dict):
        """Phase 2 & 3: Section Processing & Prompt Generation using Gemini"""
        prompt = f"""
Analyze this section of a legal document and generate a SINGLE, COMPREHENSIVE set of instructions (Master Prompt) for an AI to generate this section later.

SECTION DATA:
{json.dumps(section_data, indent=2)}

TASK:
1. Create a detailed "Master Prompt" that instructs an AI on how to draft this specific section.
2. The prompt should enable generation of substantial, professional content (targeting 200-1000 words per section).
3. Include requirements for:
   - Legal formatting and structure
   - Appropriate tone and language
   - Specific clauses, terms, or provisions to include
   - How to incorporate the variable fields
   - Standard legal boilerplate if applicable
4. List all variables that need to be collected/used.
5. Return a strict JSON object with no markdown.

REQUIRED JSON STRUCTURE:
{{
    "section_intro": "Conversational intro explaining what this section is for",
    "drafting_complexity": "simple|moderate|complex",
    "estimated_output_words": Integer estimate of words when drafted,
    "field_prompts": [
        {{
            "field_id": "master_instruction",
            "prompt": "Comprehensive instructions on how to generate this section, including:
- Section structure and formatting
- Required legal language and terminology
- Specific clauses or provisions to include
- How to integrate variables: {json.dumps([f['key'] for f in section_data.get('fields', [])])}
- Tone and style guidelines
- Standard boilerplate or templates to use
- Examples of good output for this section type"
        }}
    ],
    "dependencies": ["List any sections this should reference or depend on"],
    "legal_references": ["Any relevant laws, regulations, or standard practices to cite"]
}}
"""
        return await self._call_gemini(prompt)

    async def validate_input(self, field_info: dict, user_input: str):
        """Phase 4 & 5: Validation & Error Recovery using Gemini"""
        prompt = f"""
Act as Antigravity validation system. Execute Phase 4 (Validation) and Phase 5 (Error Recovery) Protocol.

FIELD RULES: {json.dumps(field_info)}
USER INPUT: "{user_input}"

REQUIREMENTS:
- Check if input is valid according to field type and validation rules.
- Verify required fields are not empty.
- Check format constraints (e.g., email format, date format, number ranges).
- If invalid, generate a helpful, specific error prompt explaining the requirement.

OUTPUT: Strictly return JSON in one of these formats:
{{"valid": true}}
OR
{{"valid": false, "error_prompt": "Clear explanation of what's wrong and what's expected", "suggestion": "Optional helpful suggestion"}}
"""
        return await self._call_gemini(prompt)
    
    async def generate_section_content(self, section_data: dict, field_values: dict):
        """
        NEW METHOD: Generate actual section content based on master prompt and user inputs.
        This is called when user fetches sections to create the final draft.
        """
        prompt = f"""
You are a legal document drafting AI. Generate professional, detailed content for this section.

SECTION INFORMATION:
{json.dumps(section_data, indent=2)}

USER PROVIDED VALUES:
{json.dumps(field_values, indent=2)}

INSTRUCTIONS:
1. Generate comprehensive, professional legal content for this section.
2. Target output: 200-1000 words depending on section complexity.
3. Use proper legal formatting, numbering, and structure.
4. Incorporate all provided field values naturally into the text.
5. Include standard legal language and boilerplate where appropriate.
6. Ensure the output is polished, professional, and ready for inclusion in a legal document.
7. Return ONLY the drafted section content as plain text, no JSON wrapper.

OUTPUT FORMAT: Plain text content for the section (no JSON, no markdown, just the drafted text).
"""
        
        response = await self._call_gemini(prompt)
        # For this method, we expect plain text, not JSON
        # But _call_gemini expects JSON, so we might need a separate method or handle differently
        # For now, return the response as-is
        return response