import React, { Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import MainLayout from './layouts/MainLayout';
import DashboardPage from './pages/DashboardPage';
import DocumentUploadPage from './pages/DocumentUploadPage';
import FolderDetailPage from './pages/FolderDetailPage';
import EvidenceMatrixPage from './pages/EvidenceMatrixPage';
import TimelinePage from './pages/TimelinePage';
import GroundSummaryPage from './pages/GroundSummaryPage';
import AnalysisPage from './pages/AnalysisPage';
import ChatModelPage from './pages/ChatModelPage';
import ToolsPage from './pages/ToolsPage';
import DraftingPage from './pages/DraftingPage';
import DraftsPage from './pages/DraftsPage';
import DraftEditorPage from './pages/DraftEditorPage';
import DraftSelectionPage from './pages/DraftSelectionEnhanced/DraftSelectionPageEnhanced';
import AllTemplatesPage from './pages/DraftSelectionEnhanced/AllTemplatesPage';
import DraftFormPage from './pages/DraftFormPage';
import GoogleDocsPage from './pages/GoogleDocsPage';
import MicrosoftWordPage from './pages/MicrosoftWordPage';
import ChatHistoryPage from './pages/ChatHistoryPage';
import { DraftingOiPage } from './components/drafting-frontend';
import LandingPage from './pages/LandingPage';
import LawFirmRegistrationPage from './pages/auth/LawFirmRegistrationPage';
import LoginPage from './pages/auth/LoginPage';
import SetPasswordPage from './pages/auth/SetPasswordPage';
import PublicLayout from './layouts/PublicLayout';
import ServicesPage from './pages/ServicesPage';
import AboutUsPage from './pages/AboutUsPage';
import PricingPage from './pages/PricingPage';
import AboutNexintelPage from './pages/AboutNexintelPage';
import SubscriptionPlanPage from './pages/SubscriptionPlanPage';
import BillingAndUsagePage from './pages/BillingAndUsagePage';
import SettingsPage from './pages/SettingsPage';
import GetHelpPage from './pages/GetHelpPage';
import CaseDetailView from './components/DashboardComponents/CaseDetailView';
import GoogleDriveCallback from './pages/GoogleDriveCallback';
import { SidebarProvider } from './context/SidebarContext';
import { FileManagerProvider } from './context/FileManagerContext';
import AuthChecker from './components/AuthChecker';
import { TemplateListingPage, TemplatePreviewPage, DraftEditorPage as TemplateDraftEditorPage, SectionDraftingPage, AssembledPreviewPage } from './template_drafting_component';

function App() {
  return (
    <Router>
      <ToastContainer />
      <SidebarProvider>
        <FileManagerProvider>
          <Routes>
            <Route path="/" element={<PublicLayout hideHeaderAndFooter={true}><LandingPage /></PublicLayout>} />
            <Route path="/register" element={<LawFirmRegistrationPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/auth/google/drive/callback" element={<GoogleDriveCallback />} />

            <Route path="/services" element={<PublicLayout hideContactBar={true} hideFooter={true}><ServicesPage /></PublicLayout>} />
            <Route path="/aboutus" element={<PublicLayout hideContactBar={true} hideFooter={true}><AboutUsPage /></PublicLayout>} />
            <Route path="/pricing" element={<PublicLayout hideContactBar={true} hideFooter={true}><PricingPage /></PublicLayout>} />
            <Route path="/about-nexintel" element={<PublicLayout><AboutNexintelPage /></PublicLayout>} />

            <Route
              path="/dashboard"
              element={
                <AuthChecker>
                  <MainLayout>
                    <DashboardPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/documents"
              element={
                <AuthChecker>
                  <MainLayout>
                    <DocumentUploadPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/documents/:folderName"
              element={
                <AuthChecker>
                  <MainLayout>
                    <FolderDetailPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/evidence-matrix"
              element={
                <AuthChecker>
                  <MainLayout>
                    <EvidenceMatrixPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/timeline"
              element={
                <AuthChecker>
                  <MainLayout>
                    <TimelinePage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/ground-summary"
              element={
                <AuthChecker>
                  <MainLayout>
                    <GroundSummaryPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/analysis"
              element={
                <AuthChecker>
                  <MainLayout>
                    <AnalysisPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/analysis/:fileId/:sessionId"
              element={
                <AuthChecker>
                  <MainLayout>
                    <AnalysisPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/analysis/session/:sessionId"
              element={
                <AuthChecker>
                  <MainLayout>
                    <AnalysisPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/chatmodel"
              element={
                <AuthChecker>
                  <MainLayout>
                    <ChatModelPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/chatmodel/:fileId/:sessionId"
              element={
                <AuthChecker>
                  <MainLayout>
                    <ChatModelPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/chatmodel/session/:sessionId"
              element={
                <AuthChecker>
                  <MainLayout>
                    <ChatModelPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/tools"
              element={
                <AuthChecker>
                  <MainLayout>
                    <ToolsPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/tools/:fileId/:sessionId"
              element={
                <AuthChecker>
                  <MainLayout>
                    <ToolsPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/drafting"
              element={
                <AuthChecker>
                  <MainLayout>
                    <DraftingPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            {/* Draft Selection Page */}
            <Route
              path="/draft-selection"
              element={
                <AuthChecker>
                  <MainLayout>
                    <DraftSelectionPage />
                  </MainLayout>
                </AuthChecker>
              }
            />
            <Route
              path="/draft-selection/templates"
              element={
                <AuthChecker>
                  <MainLayout>
                    <AllTemplatesPage />
                  </MainLayout>
                </AuthChecker>
              }
            />
            <Route
              path="/draft-form/:draftId"
              element={
                <AuthChecker>
                  <MainLayout>
                    <DraftFormPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            {/* Google Docs Drafting Routes */}
            <Route
              path="/draft/google-docs"
              element={
                <AuthChecker>
                  <MainLayout>
                    <GoogleDocsPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            {/* Microsoft Word Drafting Routes */}
            <Route
              path="/draft/microsoft-word"
              element={
                <AuthChecker>
                  <MainLayout>
                    <MicrosoftWordPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            {/* Zoho Office Drafting Routes */}
            <Route
              path="/draft/zoho-office"
              element={
                <AuthChecker>
                  <MainLayout>
                    <DraftingOiPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            {/* Template Drafting Routes */}
            <Route
              path="/template-drafting"
              element={
                <AuthChecker>
                  <MainLayout>
                    <TemplateListingPage />
                  </MainLayout>
                </AuthChecker>
              }
            />
            <Route
              path="/template-drafting/preview/:templateId"
              element={
                <AuthChecker>
                  <MainLayout>
                    <TemplatePreviewPage />
                  </MainLayout>
                </AuthChecker>
              }
            />
            <Route
              path="/template-drafting/drafts/:draftId/sections"
              element={
                <AuthChecker>
                  <MainLayout>
                    <SectionDraftingPage />
                  </MainLayout>
                </AuthChecker>
              }
            />
            <Route
              path="/template-drafting/drafts/:draftId/preview"
              element={
                <AuthChecker>
                  <MainLayout>
                    <AssembledPreviewPage />
                  </MainLayout>
                </AuthChecker>
              }
            />
            <Route
              path="/template-drafting/edit/:draftId"
              element={
                <AuthChecker>
                  <MainLayout>
                    <TemplateDraftEditorPage />
                  </MainLayout>
                </AuthChecker>
              }
            />
            {/* New Google Docs Drafting Service Routes */}
            <Route
              path="/drafts"
              element={
                <AuthChecker>
                  <MainLayout>
                    <DraftsPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/draft/:draftId"
              element={
                <AuthChecker>
                  <DraftEditorPage />
                </AuthChecker>
              }
            />

            <Route
              path="/draft/new"
              element={
                <AuthChecker>
                  <DraftEditorPage />
                </AuthChecker>
              }
            />

            <Route
              path="/chats"
              element={
                <AuthChecker>
                  <MainLayout>
                    <ChatHistoryPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/subscription-plans"
              element={
                <AuthChecker>
                  <MainLayout>
                    <SubscriptionPlanPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/billing-usage"
              element={
                <AuthChecker>
                  <MainLayout>
                    <BillingAndUsagePage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/settings"
              element={
                <AuthChecker>
                  <MainLayout>
                    <SettingsPage />
                  </MainLayout>
                </AuthChecker>
              }
            />

            <Route
              path="/get-help"
              element={
                <AuthChecker>
                  <MainLayout>
                    <GetHelpPage />
                  </MainLayout>
                </AuthChecker>
              }
            />
            <Route
              path="/cases/:id"
              element={
                <AuthChecker>
                  <MainLayout>
                    <CaseDetailView />
                  </MainLayout>
                </AuthChecker>
              }
            />
          </Routes>
        </FileManagerProvider>
      </SidebarProvider>
    </Router>
  );
}

export default App;