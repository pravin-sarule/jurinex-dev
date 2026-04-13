import React, { useEffect, useState } from 'react';
import '../../styles/RedesignedCitationReport.css';

const PERSPECTIVES = [
  ['all', 'All'],
  ['appellant', 'Appellant'],
  ['respondent', 'Respondent'],
  ['court', "Court's Ratio"],
  ['neutral', 'Both Sides'],
];

const PARTY = {
  appellant: ['Appellant', 'blue'],
  respondent: ['Respondent', 'amber'],
  court: ["Court's Ratio", 'green'],
  neutral: ['Both Sides', 'slate'],
};

const STATUS = {
  GREEN: ['Verified', 'green'],
  YELLOW: ['Review advised', 'amber'],
  STALE: ['Freshness check', 'orange'],
  PENDING: ['Pending', 'purple'],
  RED: ['Unverified', 'red'],
};

function normalizePerspective(value, fallback = 'neutral') {
  const raw = String(value || '').toLowerCase().trim();
  if (!raw) return fallback;
  if (raw === 'all') return 'all';
  if (/(appellant|petitioner|plaintiff|accused)/.test(raw)) return 'appellant';
  if (/(respondent|defendant|state|prosecution)/.test(raw)) return 'respondent';
  if (/(court|ratio|analysis|conclusion|judge|bench)/.test(raw)) return 'court';
  if (/(neutral|both|shared|all parties|both parties)/.test(raw)) return fallback === 'all' ? 'all' : 'neutral';
  return fallback;
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeCourt(value) {
  const raw = normalizeSearch(value);
  return !raw || raw === 'court not specified' || raw === '-' ? 'unknown' : raw;
}

function effectiveParty(citation) {
  const args = citation.partyArguments || citation.party_arguments || {};
  const hasApp = Array.isArray(args.appellant) && args.appellant.length > 0;
  const hasResp = Array.isArray(args.respondent) && args.respondent.length > 0;
  const normalized = normalizePerspective(citation.argumentParty || citation.argument_party || '', 'neutral');
  if (hasApp && hasResp) return 'neutral';
  if (hasApp && !hasResp) return 'appellant';
  if (hasResp && !hasApp) return 'respondent';
  return normalized;
}

function matchesPerspective(citation, filter) {
  if (filter === 'all') return true;
  const args = citation.partyArguments || citation.party_arguments || {};
  const hasApp = Array.isArray(args.appellant) && args.appellant.length > 0;
  const hasResp = Array.isArray(args.respondent) && args.respondent.length > 0;
  const hasCourt = Boolean(args.court);
  const normalized = normalizePerspective(citation.argumentParty || citation.argument_party || '', 'neutral');
  if (filter === 'appellant') return normalized === 'appellant' || hasApp;
  if (filter === 'respondent') return normalized === 'respondent' || hasResp;
  if (filter === 'court') return normalized === 'court' || hasCourt;
  if (filter === 'neutral') return normalized === 'neutral' || (hasApp && hasResp);
  return true;
}

function dimensionGroups(reportFormat, citations) {
  const groups = new Map();
  (reportFormat.dimensionGroups || []).forEach((group, index) => {
    groups.set(String(group.dimension_id ?? `group_${index}`), {
      id: String(group.dimension_id ?? `group_${index}`),
      name: group.name || `Dimension ${index + 1}`,
      reasoning: group.reasoning || '',
      ids: new Set(group.citations || []),
      citations: [],
    });
  });
  citations.forEach((citation) => {
    const key = citation.dimensionId != null || citation.dimensionName
      ? String(citation.dimensionId ?? citation.dimensionName)
      : 'ungrouped';
    if (!groups.has(key)) {
      groups.set(key, { id: key, name: citation.dimensionName || 'Other Relevant Citations', reasoning: '', ids: null, citations: [] });
    }
    const group = groups.get(key);
    if (!group.ids || group.ids.has(citation.id)) group.citations.push(citation);
  });
  return Array.from(groups.values()).filter((group) => group.citations.length);
}

function normalizeRelevance(value) {
  const raw = String(value || '').toUpperCase();
  if (raw.includes('HIGH')) return 'High';
  return 'Medium';
}

function RelevanceBadge({ value }) {
  const relevance = normalizeRelevance(value);
  const relClass = relevance === 'High' ? 'rel-high' : 'rel-med';
  return (
    <span className={`rel-badge ${relClass}`}>Relevance: {relevance}</span>
  );
}

function CitationCard({ citation, onSelect, getCourtBadgeClass, getCourtLabel, dimensionLabel, isPriority }) {
  const courtBadgeClass = getCourtBadgeClass(citation.court);
  return (
    <div
      className={`cite-card ${isPriority ? 'sc-priority' : ''}`}
      onClick={() => onSelect(citation.id)}
    >
      <div className="cc-top">
        <span className={`court-badge ${courtBadgeClass}`}>{getCourtLabel(citation.court)}</span>
        <span className="dimension-badge">{dimensionLabel}</span>
        <RelevanceBadge value={citation.relevanceBadge} />
      </div>
      <div className="cc-name">{citation.caseName || 'Untitled Citation'}</div>
      <div className="cc-meta">
        {citation.dateOfJudgment || 'Date N/A'} &middot; {citation.coram || 'Coram N/A'}
      </div>
      <div className="cc-air">{citation.primaryCitation || 'Reporter citation unavailable'}</div>
    </div>
  );
}

function DimensionGroup({
  group,
  index,
  collapsed,
  onToggle,
  onSelectCitation,
  getCourtBadgeClass,
  getCourtLabel,
  priorityIds,
}) {
  return (
    <div className="dim-group">
      <button className="dim-header dim-toggle" onClick={() => onToggle(group.id)}>
        <span className="dim-pill">Dimension {index + 1}</span>
        <span className="dim-title">{group.name}</span>
        <span className="dim-count">{group.citations.length} citations</span>
      </button>
      {!collapsed && (
        <div>
          {group.citations.map((citation) => (
            <CitationCard
              key={citation.id}
              citation={citation}
              onSelect={onSelectCitation}
              getCourtBadgeClass={getCourtBadgeClass}
              getCourtLabel={getCourtLabel}
              dimensionLabel={`Dimension ${index + 1}`}
              isPriority={priorityIds.has(citation.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function RedesignedCitationReportDoc({
  report,
  query,
  initialPerspective = 'all',
  onPerspectiveChange,
  onViewFullJudgment,
  onDownloadCitation,
  onNotifyMe,
  notifyStatus = {},
}) {
  const [dimension, setDimension] = useState('all');
  const [courtFilter, setCourtFilter] = useState('all'); // 'all', 'sc', 'hc'
  const [perspective, setPerspective] = useState(initialPerspective || 'all');
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [activeTab, setActiveTab] = useState('rep'); // 'rep' or 'fj'
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const reportFormat = report?.report_format || {};
  const queryLabel = reportFormat.searchQuery || query || 'Citation research';
  
  const all = (reportFormat.citations || []).map((citation, index) => ({
    ...citation,
    id: citation.id || citation.canonicalId || citation.canonical_id || `citation_${index}`,
    argumentParty: normalizePerspective(citation.argumentParty || citation.argument_party || citation.partyBadge || citation.party_badge || citation.perspective || 'neutral', 'neutral'),
    normalizedCourt: normalizeCourt(citation.court),
    searchableText: normalizeSearch([
      citation.caseName,
      citation.primaryCitation,
      citation.court,
      citation.ratio,
      citation.headnote,
      citation.dimensionName,
      citation.dimensionJustification,
      ...(citation.alternateCitations || []),
    ].filter(Boolean).join(' ')),
  }));

  const verified = all.filter((citation) => ['GREEN', 'YELLOW', 'STALE'].includes(citation.verificationStatus));
  const groups = dimensionGroups(reportFormat, verified);
  
  useEffect(() => setPerspective(normalizePerspective(initialPerspective || 'all', 'all')), [initialPerspective]);
  useEffect(() => { if (typeof onPerspectiveChange === 'function') onPerspectiveChange(perspective); }, [onPerspectiveChange, perspective]);
  useEffect(() => { setDimension('all'); setCourtFilter('all'); setSearch(''); setActiveId(null); setCollapsedGroups({}); }, [report?.id, report?.report_id]);

  const term = normalizeSearch(search);
  const filtered = groups.map((group) => ({
    ...group,
    citations: group.citations.filter((citation) => {
      if (dimension !== 'all' && group.id !== dimension) return false;
      if (courtFilter === 'sc' && !(citation.normalizedCourt.includes('supreme court'))) return false;
      if (courtFilter === 'hc' && !(citation.normalizedCourt.includes('high court'))) return false;
      if (!matchesPerspective(citation, perspective)) return false;
      if (term && !citation.searchableText.includes(term)) return false;
      return true;
    }),
  })).filter((group) => group.citations.length);

  const visible = filtered.flatMap((group) => group.citations);
  const active = visible.find((citation) => citation.id === activeId) || null;
  const topSupremeCourtIds = new Set(
    visible
      .filter((citation) => citation.normalizedCourt.includes('supreme court'))
      .slice(0, 5)
      .map((citation) => citation.id)
  );

  if (!all.length) {
    return <div style={{padding: '24px'}}>No citations found for this report.</div>;
  }

  const getCourtBadgeClass = (courtName) => {
    if ((courtName || '').toLowerCase().includes('supreme')) return 'sc-b';
    return 'hc-b';
  };

  const getCourtLabel = (courtName) => {
    if ((courtName || '').toLowerCase().includes('supreme')) return 'Supreme Court';
    if ((courtName || '').toLowerCase().includes('high')) return 'High Court';
    return courtName || 'Court';
  };

  const toggleGroup = (groupId) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <div className="citation-panel-container">
      {/* PAGE HEADER */}
      <div className="page-header">
        <div className="page-logo">
          <div className="logo-mark">
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="2" width="14" height="16" rx="2" fill="white" fillOpacity=".2" stroke="white" strokeWidth="1.2"/>
              <rect x="6" y="6" width="8" height="1.5" rx=".75" fill="white"/>
              <rect x="6" y="9.5" width="8" height="1.5" rx=".75" fill="white"/>
              <rect x="6" y="13" width="5" height="1.5" rx=".75" fill="white"/>
            </svg>
          </div>
          <div>
            <div className="logo-name">JuriNex</div>
            <div className="logo-sub">Citation Panel — Redesigned UI</div>
          </div>
        </div>
        <div className="page-badge">Citation System v2 — Active</div>
      </div>

      {/* CASE BAR */}
      <div className="case-bar">
        <div>
          <div className="case-name">{queryLabel}</div>
        </div>
        <div className="case-meta">
          <div className="case-meta-item">Status: <span>{verified.length} approved</span></div>
        </div>
        <div className="case-badge">Legal Intelligence</div>
      </div>

      {/* MAIN PANEL */}
      <div className="panel-wrap">
        
        {/* SIDEBAR */}
        <div className="sidebar">
          <div className="sb-label">Dimensions</div>
          
          <div className={`dim-chip ${dimension === 'all' ? 'active' : ''}`} onClick={() => { setDimension('all'); setActiveId(null); }}>
            <span className="chip-num">All dimensions</span>
            {verified.length} citations total
          </div>

          {groups.map((group, index) => (
            <div key={group.id} className={`dim-chip ${dimension === group.id ? 'active' : ''}`} onClick={() => { setDimension(group.id); setActiveId(null); }}>
              <span className="chip-num">Dimension {index + 1}</span>
              {group.name}
            </div>
          ))}
          
        </div>

        {/* MAIN AREA */}
        <div className="main-area">

          {/* If there is no active citation, show Results Pane */}
          {!active && (
            <>
              <div className="panel-header">
                <div className="panel-title">Find Citations</div>
                <div className="count-pill"><b>{visible.length}</b> citations across <b>{filtered.length}</b> legal dimensions</div>
              </div>

              <div className="filter-row">
                <span className="filter-label">Court:</span>
                <button className={`flt ${courtFilter === 'all' ? 'active' : ''}`} onClick={() => setCourtFilter('all')}>All courts</button>
                <button className={`flt ${courtFilter === 'sc' ? 'active' : ''}`} onClick={() => setCourtFilter('sc')}>Supreme Court</button>
                <button className={`flt ${courtFilter === 'hc' ? 'active' : ''}`} onClick={() => setCourtFilter('hc')}>High Court</button>
                <input 
                  type="text" 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search citation, ratio..."
                  style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: '20px', border: '0.5px solid var(--border-mid)', fontSize: '13px', width: '200px' }}
                />
              </div>

              {/* RESULTS PANE */}
              <div className="results-pane" id="rp">
                {!filtered.length && <div style={{padding: '20px'}}>No citations match current filters.</div>}
                
                {filtered.map((group, index) => (
                  <DimensionGroup
                    key={group.id}
                    group={group}
                    index={index}
                    collapsed={Boolean(collapsedGroups[group.id])}
                    onToggle={toggleGroup}
                    onSelectCitation={setActiveId}
                    getCourtBadgeClass={getCourtBadgeClass}
                    getCourtLabel={getCourtLabel}
                    priorityIds={topSupremeCourtIds}
                  />
                ))}
              </div>
            </>
          )}

          {/* DETAIL PANE */}
          {active && (
            <div className="detail-pane" id="dp" style={{ display: 'flex' }}>
              <div className="det-topbar">
                <button className="back-btn" onClick={() => setActiveId(null)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 2.5L5 7L9 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Back to results
                </button>
                <button className={`tab-btn ${activeTab === 'rep' ? 'active' : ''}`} onClick={() => setActiveTab('rep')}>Report</button>
                <button className={`tab-btn ${activeTab === 'fj' ? 'active' : ''}`} onClick={() => setActiveTab('fj')}>Full Judgment</button>
                <div className="appr-badge" style={{ backgroundColor: STATUS[active.verificationStatus]?.[1] === 'green' ? 'var(--teal-bg)' : 'var(--amber-bg)', color: STATUS[active.verificationStatus]?.[1] === 'green' ? 'var(--teal-dark)' : 'var(--amber-str)' }}>
                  {STATUS[active.verificationStatus]?.[0] || 'Unverified'}
                </div>
              </div>

              {/* REPORT TAB */}
              {activeTab === 'rep' && (
                <div id="rep-content" style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="rep-body">
                    <div className="dim-tag-top">
                      <span className="dt-num">Dimension Name</span>
                      <span className="dt-name">{active.dimensionName || 'General Relevance'}</span>
                      <span className="dt-match">Matched on this Citation</span>
                    </div>

                    <div className="cite-hdr">
                      <div className="ch-court">{active.court || 'Court Not Specified'}</div>
                      <div className="ch-name">{active.caseName || 'Untitled'}</div>
                      <div className="meta-grid">
                        <div className="meta-cell">
                          <div className="mlbl">Primary Citation</div>
                          <div className="mval air">{active.primaryCitation || '-'}</div>
                        </div>
                        <div className="meta-cell">
                          <div className="mlbl">Date of Judgment</div>
                          <div className="mval">{active.dateOfJudgment || '-'}</div>
                        </div>
                        <div className="meta-cell">
                          <div className="mlbl">Coram</div>
                          <div className="mval">{active.coram || '-'}</div>
                        </div>
                      </div>
                      {!!(active.alternateCitations || []).length && (
                        <div className="eq-row">
                          {(active.alternateCitations || []).map(cit => (
                            <div key={cit} className="eq-chip">{cit}</div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="sec-hdr">Legal Analysis and Ratio</div>

                    <div className="rel-block">
                      <div className="rel-top">
                        <div className={`rel-rating ${String(active.relevanceBadge || '').toUpperCase() === 'HIGH' ? 'rh' : ''}`} style={{ backgroundColor: String(active.relevanceBadge || '').toUpperCase() === 'HIGH' ? 'var(--teal-bg)' : 'var(--amber-bg)', color: String(active.relevanceBadge || '').toUpperCase() === 'HIGH' ? 'var(--teal-dark)' : 'var(--amber-str)' }}>
                          Relevance: {normalizeRelevance(active.relevanceBadge)}
                        </div>
                      </div>
                      <div className="rel-reason">
                        {active.dimensionJustification || 'This citation was included because it materially supports the selected legal issue.'}
                      </div>
                    </div>

                    {active.ratio && active.ratio !== 'Ratio decidendi not extracted.' && (
                      <>
                        <div className="sec-hdr">Ratio Decidendi</div>
                        <div className="ab-item">{active.ratio}</div>
                      </>
                    )}

                    {active.headnote && (
                      <>
                        <div className="sec-hdr">Headnote</div>
                        <div className="ab-item">{active.headnote}</div>
                      </>
                    )}

                    {(active.excerpt?.text || active.excerptText || active.ikFragment?.headline) && (
                      <>
                        <div className="sec-hdr">Relevant Excerpt</div>
                        <div className="ab-item">{active.excerpt?.text || active.excerptText || active.ikFragment?.headline}</div>
                      </>
                    )}

                    {((active.ikCiteList || []).length > 0 || (active.ikCitedByList || []).length > 0) && (
                      <>
                        <div className="sec-hdr">Citation Context</div>
                        <div className="ctx-grid">
                          <div className="ctx-box">
                            <div className="ctx-n">{(active.ikCiteList || []).length}</div>
                            <div className="ctx-l">Cases cited</div>
                          </div>
                          <div className="ctx-box">
                            <div className="ctx-n">{(active.ikCitedByList || []).length}</div>
                            <div className="ctx-l">Cited by</div>
                          </div>
                        </div>
                      </>
                    )}

                    <div style={{ marginTop: '20px', paddingTop: '14px', borderTop: '0.5px solid #E0DED8', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {active.canonicalId && <button onClick={() => window.open(`https://indiankanoon.org/doc/${active.canonicalId}/`, '_blank')} style={{ fontSize: '13px', padding: '8px 18px', borderRadius: '8px', border: '0.5px solid #C4C2BB', background: '#fff', color: '#5F5E5A', cursor: 'pointer' }}>View on Indian Kanoon ↗</button>}
                      {active.originalCourtCopyUrl && <button onClick={() => window.open(active.originalCourtCopyUrl, '_blank')} style={{ fontSize: '13px', padding: '8px 18px', borderRadius: '8px', border: '0.5px solid #C4C2BB', background: '#fff', color: '#5F5E5A', cursor: 'pointer' }}>Open Court Copy</button>}
                      <button onClick={() => onDownloadCitation?.(active)} style={{ fontSize: '13px', padding: '8px 18px', borderRadius: '8px', border: '0.5px solid #534AB7', background: '#534AB7', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>Download PDF</button>
                    </div>
                  </div>
                </div>
              )}

              {/* FULL JUDGMENT TAB */}
              {activeTab === 'fj' && (
                <div id="fj-content" style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div className="fj-wrap">
                    <div className="fj-hdr">
                      <div className="fj-court">{active.court || 'Court Not Specified'}</div>
                      <div className="fj-title">{active.caseName || 'Untitled'}</div>
                    </div>
                    {!!(active.alternateCitations || []).length && (
                      <div className="fj-eq">
                        <strong>Equivalent Citations:</strong> {(active.alternateCitations || []).join(', ')}
                      </div>
                    )}
                    <div className="fj-meta">
                      <strong>Coram:</strong> {active.coram || '-'}
                    </div>
                    <div className="fj-body-text">
                      <p><em>Full judgment text is not fully embedded in this view unless fetched explicitly. For the full document, please click "View complete judgment" below or switch to the Report tab to view the primary excerpts.</em></p>
                      
                      <div style={{marginTop: '20px', textAlign: 'center'}}>
                        <button onClick={() => onViewFullJudgment?.(active.canonicalId, active.caseName)} disabled={!active.canonicalId} style={{ fontSize: '13px', padding: '8px 18px', borderRadius: '8px', border: '0.5px solid #534AB7', background: '#534AB7', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>View complete judgment</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
