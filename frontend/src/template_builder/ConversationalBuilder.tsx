/**
 * ConversationalBuilder — Main page for the AI Template Builder.
 *
 * Lives inside MainLayout (JuriNex sidebar + MainContent).
 * Two-column layout:
 *   LEFT (240px, sticky)  → Step progress sidebar
 *   RIGHT (flex-1)        → One-question-at-a-time Q&A OR GeneratedTemplateView
 *
 * Theme: JuriNex teal (#21C1B6)
 */
import React from 'react';
import { useTemplateBuilderStore } from './templateBuilderStore';
import { RequirementsSidebar } from './RequirementsSidebar';
import { BuilderChat } from './BuilderChat';
import { GeneratedTemplateView } from './GeneratedTemplateView';

const BRAND = '#21C1B6';

export const ConversationalBuilder: React.FC = () => {
  const { phase } = useTemplateBuilderStore();

  const showPreview = phase === 'preview' || phase === 'saving' || phase === 'saved';

  return (
    <div className="flex min-h-screen bg-gray-50 items-start">

      {/* ── Step Progress Sidebar (sticky) ─────────────────────────────── */}
      <aside
        className="w-56 shrink-0 bg-white border-r border-gray-100 sticky top-0 self-start overflow-y-auto"
        style={{ minHeight: '100vh' }}
      >
        <RequirementsSidebar />
      </aside>

      {/* ── Main Column ────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">

        {/* Page header */}
        <div className="bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ backgroundColor: BRAND }}
            >
              ✨
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-800">AI Template Builder</h1>
              <p className="text-xs text-gray-400">Any legal document · AI generates a complete template</p>
            </div>
          </div>
          <span
            className="text-xs font-semibold px-3 py-1 rounded-full text-white hidden sm:block"
            style={{ backgroundColor: BRAND }}
          >
            Powered by Claude AI
          </span>
        </div>

        {/* Content */}
        {showPreview ? (
          <GeneratedTemplateView />
        ) : (
          <BuilderChat />
        )}
      </main>
    </div>
  );
};

export default ConversationalBuilder;
