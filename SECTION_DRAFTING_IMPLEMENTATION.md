# Section-by-Section Drafting Flow Implementation

## Overview
Implemented a comprehensive section-by-section drafting flow where users can:
1. Select sections in the form wizard (Step 3)
2. Generate each section individually with AI
3. View Critic agent validation with confidence scores
4. Edit generated content directly or via prompts
5. Assemble all sections into a final document

## Frontend Changes

### 1. New Page: SectionDraftingPage.tsx
**Location:** `frontend/src/template_drafting_component/pages/SectionDraftingPage.tsx`

**Features:**
- **Tabbed Interface**: Shows only user-selected sections as tabs
- **Section Generation**: Generate button for each section using Drafter agent
- **Critic Validation Display**: 
  - Shows PASS/FAIL status
  - Displays confidence score (0-100%)
  - Lists issues and suggestions
  - Color-coded feedback (green for PASS, yellow for FAIL)
- **Content Editing**:
  - Direct HTML editing in textarea
  - Update via prompt (sends to Drafter agent for refinement)
- **Assembly**: Button to combine all sections into final document
- **Loading States**: Visual feedback during generation and updates
- **Progress Tracking**: Shows X of Y sections generated

### 2. Updated Routes
**Location:** `frontend/src/template_drafting_component/routes.ts`

Added:
- `SECTION_DRAFTING: '/template-drafting/drafts/:draftId/sections'`
- Exported `SectionDraftingPage` component

### 3. Updated Navigation
**Location:** `frontend/src/pages/DraftFormPage.jsx`

Changed Step 3 "Next: Start Drafting" button to navigate to:
- **Before:** `/template-drafting/drafts/:draftId/edit` (old editor)
- **After:** `/template-drafting/drafts/:draftId/sections` (new section drafting)

### 4. Updated App.jsx
**Location:** `frontend/src/App.jsx`

Added route:
```jsx
<Route path="/template-drafting/drafts/:draftId/sections" element={<SectionDraftingPage />} />
```

## Backend Changes

### 1. New Assemble Endpoint
**Location:** `Backend/agent-draft-service/api/assemble_routes.py`

**Endpoint:** `POST /api/drafts/{draft_id}/assemble`

**Functionality:**
- Retrieves all active section versions for specified sections
- Combines sections in order
- Runs Assembler agent to format and structure
- Returns final assembled document

**Request Body:**
```json
{
  "section_ids": ["introduction", "facts", "arguments", "prayer"]
}
```

**Response:**
```json
{
  "success": true,
  "final_document": "<html>...</html>",
  "sections_assembled": 4,
  "metadata": {...},
  "message": "Document assembled successfully"
}
```

### 2. Updated FastAPI App
**Location:** `Backend/agent-draft-service/api/app.py`

Added:
- Import for `assemble_routes`
- Router registration: `app.include_router(assemble_routes.router)`

## Existing Backend Endpoints Used

### Section Generation
**Endpoint:** `POST /api/drafts/{draft_id}/sections/{section_key}/generate`

**Flow:**
1. Gets section prompt (custom or default)
2. Optionally runs Librarian for RAG context
3. Runs Drafter agent to generate content
4. Runs Critic agent for validation (auto_validate=true)
5. Auto-retries once if Critic returns FAIL
6. Saves version to database
7. Returns generated content + critic review

### Section Refinement
**Endpoint:** `POST /api/drafts/{draft_id}/sections/{section_key}/refine`

**Flow:**
1. Gets latest version
2. Optionally runs Librarian for updated context
3. Runs Drafter in refinement mode with user feedback
4. Runs Critic for validation
5. Saves new version (increments version_number)
6. Returns refined content + critic review

### Get All Sections
**Endpoint:** `GET /api/drafts/{draft_id}/sections`

Returns all active section versions for a draft.

## User Flow

### Complete Workflow:
1. **Template Selection** → User selects template
2. **Step 1: Upload/Case** → User attaches case or uploads file
3. **Step 2: Form Fields** → User fills in form fields
4. **Step 3: Template Sections** → User customizes section prompts, marks sections to skip
5. **Click "Next: Start Drafting"** → Navigates to Section Drafting Page
6. **Section Drafting Page:**
   - View tabs for selected sections
   - Click "Generate Section" for each section
   - View Critic validation results (confidence score, issues, suggestions)
   - Edit content directly or update via prompt
   - Repeat for all sections
7. **Click "Assemble Document"** → Combines all sections
8. **Preview/Download** → View final assembled document

## Critic Agent Integration

### Validation Criteria:
1. ✅ **Legal Accuracy**: Legally sound and accurate
2. ✅ **Completeness**: Addresses all prompt requirements
3. ✅ **Consistency**: Aligns with RAG context and form data
4. ✅ **Structure**: Well-formatted HTML
5. ✅ **Clarity**: Clear and unambiguous language

### Decision Rules:
- **PASS**: score >= 70, no critical issues
- **FAIL**: score < 70 or critical issues found

### Auto-Retry:
- If Critic returns FAIL, system automatically retries once with Critic feedback
- Re-validates the retry attempt

## Technical Details

### State Management (Frontend):
```typescript
interface SectionState {
    sectionId: string;
    content: string;
    isGenerated: boolean;
    isGenerating: boolean;
    criticReview: {
        status: 'PASS' | 'FAIL' | null;
        score: number;
        feedback: string;
        issues: string[];
        suggestions: string[];
    } | null;
    versionId: string | null;
}
```

### API Calls:
- **Generate**: `axios.post('http://localhost:8000/api/drafts/{draftId}/sections/{sectionId}/generate')`
- **Refine**: `axios.post('http://localhost:8000/api/drafts/{draftId}/sections/{sectionId}/refine')`
- **Assemble**: `axios.post('http://localhost:8000/api/drafts/{draftId}/assemble')`

## Benefits

1. **Granular Control**: Users can focus on one section at a time
2. **Quality Assurance**: Critic agent validates each section before assembly
3. **Iterative Refinement**: Easy to update specific sections without regenerating entire document
4. **Transparency**: Clear visibility into AI confidence and validation results
5. **Flexibility**: Edit directly or use prompts for AI-assisted updates
6. **Progress Tracking**: Visual indicators show which sections are complete

## Next Steps (Optional Enhancements)

1. **Version History**: Show previous versions for each section
2. **Section Comparison**: Compare different versions side-by-side
3. **Batch Generation**: Generate all sections at once
4. **Export Options**: Export individual sections or final document
5. **Collaboration**: Allow multiple users to work on different sections
6. **Templates**: Save section configurations as templates
7. **Analytics**: Track generation time, retry rates, average scores

## Files Modified/Created

### Frontend:
- ✅ Created: `frontend/src/template_drafting_component/pages/SectionDraftingPage.tsx`
- ✅ Modified: `frontend/src/template_drafting_component/routes.ts`
- ✅ Modified: `frontend/src/pages/DraftFormPage.jsx`
- ✅ Modified: `frontend/src/App.jsx`

### Backend:
- ✅ Created: `Backend/agent-draft-service/api/assemble_routes.py`
- ✅ Modified: `Backend/agent-draft-service/api/app.py`

### Existing (No Changes Needed):
- ✅ `Backend/agent-draft-service/api/section_routes.py` (already has generate/refine endpoints)
- ✅ `Backend/agent-draft-service/agents/drafter/agent.py` (already supports generate/refine)
- ✅ `Backend/agent-draft-service/agents/critic/agent.py` (already validates sections)
- ✅ `Backend/agent-draft-service/agents/assembler/agent.py` (ready for assembly)
