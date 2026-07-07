import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import InteractiveTable from './InteractiveTable';
import { markdownTableComponents, markdownRehypePlugins } from '../utils/markdownUtils';
import '../styles/StructuredCaseView.css';

/**
 * StructuredCaseView
 * ------------------
 * Renders the structured JSON returned by POST /api/summarize:
 *   - a header card with case name / type
 *   - an overview paragraph
 *   - InteractiveTable(s) for parties, claim components, acts & sections
 *   - a timeline list for dates & events
 *   - numbered lists for issues and reliefs
 *
 * If the backend could not produce JSON it returns `rawMarkdown`; we render that
 * with react-markdown (so DeepSeek's markdown tables still display correctly).
 *
 * Props:
 *   result   { data, rawMarkdown?, warnings? }  — the SummarizeResponse
 *   loading  boolean
 *   error    string | null
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const hasItems = (arr) => Array.isArray(arr) && arr.length > 0;

const Section = ({ title, children }) => (
  <section className="sc-section">
    <h3 className="sc-section-title">{title}</h3>
    {children}
  </section>
);

const StructuredCaseView = ({ result, loading = false, error = null }) => {
  if (loading) {
    return (
      <div className="sc-state sc-loading">
        <span className="sc-spinner" aria-hidden="true" />
        Analyzing case…
      </div>
    );
  }

  if (error) {
    return <div className="sc-state sc-error">⚠️ {error}</div>;
  }

  if (!result) return null;

  const { data, rawMarkdown, warnings } = result;

  // Markdown fallback — the model didn't return parseable JSON.
  if (rawMarkdown && (!data || !data.overview)) {
    return (
      <div className="sc-card">
        {hasItems(warnings) && <div className="sc-warning">{warnings.join(' ')}</div>}
        <div className="formatted-assistant-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={markdownRehypePlugins}
            components={markdownTableComponents}
          >
            {rawMarkdown}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    caseName,
    caseType,
    overview,
    parties,
    claimAmount,
    components,
    datesAndEvents,
    issues,
    reliefs,
    actsAndSections,
  } = data;

  return (
    <div className="sc-card">
      {hasItems(warnings) && <div className="sc-warning">{warnings.join(' ')}</div>}

      {/* Header */}
      <header className="sc-header">
        <h2 className="sc-case-name">{caseName || 'Untitled Case'}</h2>
        {caseType && <span className="sc-badge">{caseType}</span>}
      </header>

      {/* Overview */}
      {overview && (
        <Section title="Overview">
          <p className="sc-overview">{overview}</p>
        </Section>
      )}

      {/* Claim amount + components */}
      {(claimAmount || hasItems(components)) && (
        <Section title="Claim Amount">
          {claimAmount && (
            <div className="sc-claim-total">
              <span className="sc-claim-label">Total claimed</span>
              <span className="sc-claim-value">{claimAmount}</span>
            </div>
          )}
          {hasItems(components) && (
            <InteractiveTable
              headers={['Component', 'Amount']}
              rows={components.map((c) => [
                escapeHtml(c.description),
                escapeHtml(c.amount),
              ])}
            />
          )}
        </Section>
      )}

      {/* Parties */}
      {hasItems(parties) && (
        <Section title="Parties">
          <InteractiveTable
            headers={['Role', 'Name', 'Details']}
            rows={parties.map((p) => [
              escapeHtml(p.role),
              escapeHtml(p.name),
              escapeHtml(p.details),
            ])}
          />
        </Section>
      )}

      {/* Dates & events timeline */}
      {hasItems(datesAndEvents) && (
        <Section title="Dates & Events">
          <ol className="sc-timeline">
            {datesAndEvents.map((d, i) => (
              <li key={i} className="sc-timeline-item">
                <span className="sc-timeline-date">{d.date || '—'}</span>
                <span className="sc-timeline-event">{d.event}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {/* Issues */}
      {hasItems(issues) && (
        <Section title="Issues / Questions of Law">
          <ol className="sc-list">
            {issues.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ol>
        </Section>
      )}

      {/* Reliefs */}
      {hasItems(reliefs) && (
        <Section title="Reliefs / Prayers Sought">
          <ol className="sc-list">
            {reliefs.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </Section>
      )}

      {/* Acts & sections */}
      {hasItems(actsAndSections) && (
        <Section title="Acts & Sections">
          <InteractiveTable
            headers={['Act / Statute', 'Section(s)', 'Purpose']}
            rows={actsAndSections.map((a) => [
              escapeHtml(a.act),
              escapeHtml(a.section),
              escapeHtml(a.purpose),
            ])}
          />
        </Section>
      )}
    </div>
  );
};

export default StructuredCaseView;
