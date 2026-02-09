/**
 * Template Drafting Component - Routes Configuration
 */

// Direct exports of page components (not lazy loaded)
// App.jsx provides the Suspense wrapper
export { TemplateListingPage } from './pages/TemplateListingPage';
export { TemplatePreviewPage } from './pages/TemplatePreviewPage';
export { DraftEditorPage } from './pages/DraftEditorPage';
export { DraftResumePage } from './pages/DraftResumePage';
export { SectionDraftingPage } from './pages/SectionDraftingPage';
export { AssembledPreviewPage } from './pages/AssembledPreviewPage';

export const TEMPLATE_DRAFTING_ROUTES = {
    BASE: '/template-drafting',
    LISTING: '/template-drafting',
    TEMPLATE_PREVIEW: '/template-drafting/templates/:templateId/preview',
    DRAFTS: '/template-drafting/drafts',
    EDITOR: '/template-drafting/drafts/:draftId/edit',
    SECTION_DRAFTING: '/template-drafting/drafts/:draftId/sections',
    ASSEMBLED_PREVIEW: '/template-drafting/drafts/:draftId/preview'
};

export const templateDraftingRouteConfig = [
    {
        path: TEMPLATE_DRAFTING_ROUTES.LISTING,
        Component: 'TemplateListingPage',
        exact: true
    },
    {
        path: TEMPLATE_DRAFTING_ROUTES.TEMPLATE_PREVIEW,
        Component: 'TemplatePreviewPage'
    },
    {
        path: TEMPLATE_DRAFTING_ROUTES.DRAFTS,
        Component: 'DraftResumePage'
    },
    {
        path: TEMPLATE_DRAFTING_ROUTES.SECTION_DRAFTING,
        Component: 'SectionDraftingPage'
    },
    {
        path: TEMPLATE_DRAFTING_ROUTES.EDITOR,
        Component: 'DraftEditorPage'
    }
];
