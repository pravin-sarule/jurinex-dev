import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import citationApi from '../services/citationApi';
import documentApi from '../services/documentApi';
import html2pdf from 'html2pdf.js';

/* ── tokens ── */
const N = '#1B2A4A', NL = '#2C4066', ND = '#0F1A30';
const G = '#1B5E20', GL = '#388E3C', GS = '#F0F9F0';
const Y = '#E65100', YS = '#FFF8E1';
const R = '#B71C1C', RS = '#FFF5F5';
const B = '#0D47A1', BS = '#EBF4FF';
const T = '#21C1B6', TD = '#1AA49B';
const W = '#FFFFFF';
const g50 = '#F8F9FB', g100 = '#EEF0F4', g200 = '#DDE1E8', g300 = '#C5CAD3', g400 = '#8690A2', g500 = '#556275', g600 = '#3D4A5C', g700 = '#263040', g800 = '#131B28';

const SCFG = {
  GREEN: { dot: '#16A34A', text: '#15532D', bg: '#F0FDF4', border: '#BBF7D0', label: 'VERIFIED' },
  YELLOW: { dot: '#D97706', text: '#92400E', bg: '#FFFBEB', border: '#FDE68A', label: 'REVIEW' },
  RED: { dot: '#DC2626', text: '#991B1B', bg: '#FEF2F2', border: '#FECACA', label: 'UNVERIFIED' },
  PENDING: { dot: '#7C3AED', text: '#4C1D95', bg: '#F5F3FF', border: '#DDD6FE', label: 'PENDING' },
  STALE: { dot: '#EA580C', text: '#7C2D12', bg: '#FFF7ED', border: '#FED7AA', label: 'STALE' },
};

// Priority score → SLA label
function _slaLabel(score) {
  if (score >= 0.85) return '4 hrs (URGENT)';
  if (score >= 0.70) return '8 hrs';
  if (score >= 0.50) return '24 hrs';
  return '72 hrs';
}

function Dot({ c, s = 7 }) { return <span style={{ width: s, height: s, borderRadius: '50%', background: c, display: 'inline-block', flexShrink: 0 }} />; }
function Spin() { return (<span style={{ display: 'inline-flex', gap: 4 }}>{[0, .18, .36].map((d, i) => <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: T, animation: `sp 1.2s ${d}s ease-in-out infinite` }} />)}<style>{`@keyframes sp{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}`}</style></span>); }

/* ─── Citation Force Graph (Canvas) ─── */
const EDGE_COLORS = { FOLLOWS: '#16A34A', DISTINGUISHES: '#E65100', OVERRULES: '#B71C1C', CITES: '#0D47A1' };
const NODE_COLORS = { FOLLOWS: '#16A34A', DISTINGUISHES: '#E65100', OVERRULES: '#B71C1C', CITES: '#0D47A1' };

function CitationGraphSVG({ nodes, edges }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !wrap || !nodes.length) return;

    const DPR = window.devicePixelRatio || 1;
    const W = wrap.clientWidth || 780;
    const H = wrap.clientHeight || 420;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(DPR, DPR);

    const center = nodes.find(n => n.role === 'center') || nodes[0];

    // Determine each node's primary relationship type for coloring
    const nodeType = {};
    edges.forEach(e => {
      if (e.from !== center?.id) nodeType[e.from] = nodeType[e.from] || e.type;
      if (e.to !== center?.id) nodeType[e.to] = nodeType[e.to] || e.type;
    });

    // Initialize positions — spread related nodes in a circle
    const related = nodes.filter(n => n.id !== center?.id);
    const pos = {};
    if (center) pos[center.id] = { x: W / 2, y: H / 2, vx: 0, vy: 0, fixed: true };
    related.forEach((n, i) => {
      const angle = (i / Math.max(related.length, 1)) * 2 * Math.PI - Math.PI / 2;
      const r = Math.min(W, H) * 0.32 + (Math.random() - 0.5) * 30;
      pos[n.id] = { x: W / 2 + r * Math.cos(angle), y: H / 2 + r * Math.sin(angle), vx: 0, vy: 0, fixed: false };
    });

    const simulate = () => {
      const REPULSE = 2800, ATTRACT = 0.025, DAMP = 0.75, GRAVITY = 0.008;
      const ids = nodes.map(n => n.id).filter(id => !pos[id]?.fixed);

      // Repulsion
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = pos[ids[i]], b = pos[ids[j]];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 1;
          const f = REPULSE / d2;
          const d = Math.sqrt(d2);
          a.vx -= (dx / d) * f; a.vy -= (dy / d) * f;
          b.vx += (dx / d) * f; b.vy += (dy / d) * f;
        }
      }

      // Edge attraction
      edges.forEach(e => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 1;
        const f = ATTRACT * d;
        if (!a.fixed) { a.vx += dx / d * f; a.vy += dy / d * f; }
        if (!b.fixed) { b.vx -= dx / d * f; b.vy -= dy / d * f; }
      });

      // Integrate
      ids.forEach(id => {
        const p = pos[id];
        p.vx += (W / 2 - p.x) * GRAVITY;
        p.vy += (H / 2 - p.y) * GRAVITY;
        p.vx *= DAMP; p.vy *= DAMP;
        p.x = Math.max(70, Math.min(W - 70, p.x + p.vx));
        p.y = Math.max(30, Math.min(H - 30, p.y + p.vy));
      });
    };

    const shortLabel = (s, max = 22) => (!s ? '—' : s.length > max ? s.slice(0, max - 1) + '…' : s);

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Edges
      edges.forEach(e => {
        const a = pos[e.from], b = pos[e.to];
        if (!a || !b) return;
        const color = EDGE_COLORS[e.type] || '#94A3B8';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = color + '99';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      });

      // Nodes
      nodes.forEach(n => {
        const p = pos[n.id];
        if (!p) return;
        const isCenter = n.id === center?.id;
        const r = isCenter ? 22 : 15;
        const color = isCenter ? '#1B2A4A' : (NODE_COLORS[nodeType[n.id]] || '#4B5563');

        // Glow for center
        if (isCenter) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
          ctx.fillStyle = '#21C1B620';
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = isCenter ? '#21C1B6' : color + 'CC';
        ctx.lineWidth = isCenter ? 2.5 : 1;
        ctx.stroke();

        // Label
        const label = shortLabel(n.label || n.id);
        ctx.font = `${isCenter ? '600 ' : ''}11px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#1E293B';
        ctx.fillText(label, p.x, p.y + r + 4);
      });
    };

    let frame = 0;
    const loop = () => {
      if (frame < 300) simulate();
      draw();
      frame++;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [nodes, edges]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}

/* ─── Helper sub-components ─── */
function JudgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
      <circle cx="7" cy="4.5" r="2.8" fill="#94A3B8" />
      <path d="M1.5 13.5c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke="#94A3B8" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function CourtHeading({ court }) {
  const upper = (court || '').toUpperCase();
  let line1 = 'IN THE SUPREME COURT OF INDIA';
  let line2 = 'CRIMINAL APPELLATE JURISDICTION';
  if (court && !/supreme/i.test(court) && court !== 'Court not specified' && court !== '—') {
    line1 = `IN THE ${upper}`;
    line2 = '';
  }
  return (
    <div style={{ textAlign: 'center', paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid #E2E8F0' }}>
      <div style={{ fontFamily: "'Source Serif 4',serif", fontSize: 11, fontWeight: 700, letterSpacing: '0.22em', color: '#0C4A6E', textTransform: 'uppercase' }}>{line1}</div>
      {line2 && <div style={{ fontFamily: "'Source Sans 3',sans-serif", fontSize: 9, letterSpacing: '0.14em', color: '#94A3B8', textTransform: 'uppercase', marginTop: 4 }}>{line2}</div>}
    </div>
  );
}

/* ─── Build plain-text content for RAG upload ─── */
function buildReportText(c, query, generatedAt) {
  const exc = c.excerpt || {};
  const treat = c.treatment || {};
  return [
    'JURINEX CITATION INTELLIGENCE REPORT',
    `Query: ${query || '—'}`, `Generated: ${generatedAt || '—'}`, '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `CASE NAME: ${c.caseName}`,
    `PRIMARY CITATION: ${c.primaryCitation || '—'}`,
    `EQUIVALENT CITATIONS: ${(c.alternateCitations || []).join('; ') || '—'}`,
    `COURT: ${c.court || '—'}`, `CORAM: ${c.coram || '—'}`,
    `BENCH TYPE: ${c.benchType || '—'}`, `DATE: ${c.dateOfJudgment || '—'}`,
    `STATUTORY PROVISIONS: ${(c.statutes || []).join(', ') || '—'}`, '',
    'RATIO DECIDENDI:', c.ratio || '—', '',
    `SOURCE EXCERPT (${exc.para || 'Para'}):`,
    (exc.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '—', '',
    'SUBSEQUENT TREATMENT:',
    `  Followed In: ${treat.followed ?? 0} cases`,
    `  Distinguished In: ${treat.distinguished ?? 0} cases`,
    `  Overruled By: ${treat.overruled ?? 0} cases`,
    ...(treat.followedList?.length ? [`  Followed: ${treat.followedList.join(', ')}`] : []),
    ...(treat.distinguishedList?.length ? [`  Distinguished: ${treat.distinguishedList.join(', ')}`] : []),
    '', `VERIFICATION: ${c.verificationStatusLabel || c.verificationStatus || '—'}`,
    `CONFIDENCE: ${c.confidence || 0}%`, `SOURCE: ${c.fetchedFrom || c.sourceLabel || '—'}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
}

/* ─── Build full report plain text (all citations) for auto-upload to case folder ─── */
function buildFullReportText(reportFormat, query) {
  const citations = reportFormat?.citations || [];
  const generatedAt = reportFormat?.generatedAt || '';
  const header = [
    'JURINEX CITATION REPORT — FULL REPORT',
    `Query: ${query || '—'}`,
    `Generated: ${generatedAt || '—'}`,
    `Total citations: ${citations.length}`,
    '',
    '═══════════════════════════════════════════════════════════',
    '',
  ].join('\n');
  const sections = citations.map((c, i) => {
    const one = buildReportText(c, query, generatedAt);
    return `[Citation ${i + 1} of ${citations.length}]\n${one}\n`;
  });
  return header + sections.join('\n');
}

/* ─── Escape for HTML ─── */
function esc(s) {
  if (s == null || s === '') return '—';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── Build full report HTML — exact match to ReportDoc UI layout ─── */
/* NOTE: Uses <table> for ALL multi-column layouts — html2canvas does not reliably
   render display:grid or multi-column display:flex, but renders <table> correctly. */
function buildFullReportHtml(reportFormat, query) {
  const citations = reportFormat?.citations || [];
  const generatedAt = reportFormat?.generatedAt || '';

  const baseStyles = `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Source+Sans+3:wght@400;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;background:#EAECF0;color:#0F172A;font-size:12px;padding:20px 14px 40px}
.serif{font-family:'Source Serif 4','Georgia',serif}
.sans{font-family:'Source Sans 3','Helvetica Neue',Arial,sans-serif}
.paper{background:#FFFFFF;border:1px solid #D4D9E2;border-radius:6px;overflow:hidden;margin-bottom:18px}
.inner{padding:26px 32px 22px}
.lbl{font-family:'Source Sans 3',sans-serif;font-size:8px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#94A3B8;margin-bottom:4px}
.sub-h{font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748B;margin:14px 0 7px}
.chip{display:inline-block;border:1px solid #BFDBFE;background:#EFF6FF;color:#1D4ED8;font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;padding:2px 8px;border-radius:3px;margin:2px 3px 2px 0}
.ratio-block{border-left:3px solid #0EA5E9;background:#F0F9FF;padding:13px 16px;font-family:'Source Serif 4',serif;font-size:13px;font-style:italic;line-height:1.9;color:#0F172A}
.prop-box{border:1px solid #E2E8F0;background:#F8FAFC;padding:11px 14px;border-radius:4px}
.excerpt-box{border:1px solid #E2E8F0;background:#FFFDF7;padding:13px 16px;font-family:'Source Serif 4',serif;font-size:12.5px;line-height:1.95;color:#1E293B;border-radius:4px}
@media print{.paper{page-break-inside:avoid}.paper+.paper{page-break-before:always}}
`;

  const titleHtml = `
<div style="background:#FFFFFF;border:1px solid #D4D9E2;border-radius:6px;padding:40px 24px;text-align:center;margin-bottom:18px">
  <div class="serif" style="font-size:22px;font-weight:700;color:#1E3A8A;margin-bottom:8px">JURINEX CITATION REPORT</div>
  <div class="sans" style="font-size:13px;color:#334155;margin-top:8px">${esc(query)}</div>
  <div class="sans" style="font-size:11px;color:#64748B;margin-top:14px">Generated: ${esc(generatedAt)}</div>
  <div class="sans" style="font-size:11px;color:#64748B;margin-top:6px">${citations.length} citation(s)</div>
</div>`;

  const citationBlocks = citations.map((c, idx) => {
    const judges = (c.coram || '').split(/[,;]/).map(j => j.trim()).filter(Boolean);
    const exc = c.excerpt || {};
    const treat = c.treatment || {};
    const followedList = treat.followedList || [];
    const distinguishedList = treat.distinguishedList || [];
    const overruledList = treat.overruledList || [];
    const reversedList = treat.reversedList || [];
    const reliedOnList = treat.reliedOnList || [];
    const appliedList = treat.appliedList || [];
    const citedList = treat.citedList || [];
    const referredList = treat.referredList || [];
    const approvedList = treat.approvedList || [];
    const score = (c.proposition || {}).matchScore ?? 0;
    const verdict = (c.proposition || {}).verdict || 'REVIEW';
    const matchLabel = score >= 80 ? 'MATCH CONFIRMED' : score >= 60 ? 'PARTIAL MATCH' : 'LOW MATCH';
    const matchColor = score >= 80 ? '#0D9488' : score >= 60 ? '#D97706' : '#DC2626';
    const excerptText = (exc.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '—';
    const courtLine = /supreme/i.test(c.court || '') || !c.court || c.court === '—' || c.court === 'Court not specified'
      ? 'IN THE SUPREME COURT OF INDIA' : `IN THE ${(c.court || '').toUpperCase()}`;
    const showJuris = /supreme/i.test(c.court || '') || !c.court || c.court === '—' || c.court === 'Court not specified';

    // YELLOW banner — uses <table> for 2-col claim/actual section
    const yellowBanner = c.verificationStatus === 'YELLOW' ? `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:6px;margin-bottom:18px"><tr>
  <td style="padding:11px 6px 11px 14px;width:22px;vertical-align:top"><span style="font-size:14px">&#9888;</span></td>
  <td style="padding:11px 14px 11px 4px;vertical-align:top">
    <div class="sans" style="font-size:10px;font-weight:700;color:#D97706;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Review Suggested — Source Attached</div>
    <div class="sans" style="font-size:11px;color:#92400E;line-height:1.55;margin-bottom:9px">This citation exists but the way it was used may not precisely match the holding. Please verify independently before relying on it in court.</div>
    <div class="sans" style="font-size:9px;color:#92400E;font-weight:700;margin-bottom:3px">Proposition Alignment: ${score}%</div>
    <div style="height:6px;background:#FDE68A;border-radius:3px;margin-bottom:10px"><div style="height:6px;width:${score}%;background:${score >= 75 ? '#D97706' : '#EF4444'};border-radius:3px"></div></div>
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="width:50%;padding-right:4px;vertical-align:top">
        <div style="background:#FFFDE7;border:1px solid #FDE68A;border-radius:4px;padding:8px 10px">
          <div class="sans" style="font-size:8px;font-weight:700;color:#B45309;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">What was claimed</div>
          <div class="serif" style="font-size:11px;color:#1E293B;line-height:1.55;font-style:italic">"${esc((c.proposition || {}).query || query || '—')}"</div>
        </div>
      </td>
      <td style="width:50%;padding-left:4px;vertical-align:top">
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:4px;padding:8px 10px">
          <div class="sans" style="font-size:8px;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.07em;margin-bottom:4px">Actual holding</div>
          <div class="serif" style="font-size:11px;color:#1E293B;line-height:1.55">${esc((c.ratio || '—').slice(0, 220))}${(c.ratio || '').length > 220 ? '…' : ''}</div>
        </div>
      </td>
    </tr></table>
  </td>
</tr></table>` : '';

    // STALE banner
    const staleBanner = c.verificationStatus === 'STALE' ? `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:6px;margin-bottom:18px"><tr>
  <td style="padding:11px 6px 11px 14px;width:22px;vertical-align:top"><span style="font-size:14px">&#8635;</span></td>
  <td style="padding:11px 14px 11px 4px;vertical-align:top">
    <div class="sans" style="font-size:10px;font-weight:700;color:#EA580C;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Freshness Check Pending</div>
    <div class="sans" style="font-size:11px;color:#7C2D12;line-height:1.55">${esc(c.staleReason || 'This citation was previously verified but a recent development may have affected its validity. We are re-checking.')}</div>
    <div class="sans" style="font-size:10px;color:#EA580C;margin-top:4px;font-weight:600">Do not rely on this citation until the check completes.</div>
  </td>
</tr></table>` : '';

    // Judges list (no flex — simple block divs)
    const judgesHtml = judges.length > 0
      ? judges.map(j => `<div style="margin-bottom:5px"><span style="color:#94A3B8;font-size:10px">&#9711;</span> <span class="serif" style="font-size:12px;color:#1E293B">${esc(j)}</span></div>`).join('')
      : `<span class="serif" style="font-size:12px;color:#94A3B8">—</span>`;

    // Statutes chips (inline-block)
    const statutesHtml = (c.statutes || []).length
      ? (c.statutes || []).map(st => `<span class="chip">${esc(st)}</span>`).join('')
      : `<span class="serif" style="font-size:12px;color:#94A3B8">—</span>`;

    // 3-stat treatment box — table columns
    const ovrBg = overruledList.length ? '#FEF2F2' : '#F8FAFC';
    const ovrCol = overruledList.length ? '#991B1B' : '#475569';
    const ovrBdr = overruledList.length ? '#FECACA' : '#E2E8F0';
    const treatStats3 = `
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:4px;overflow:hidden;margin-bottom:10px"><tr>
  <td style="background:#F0FDF4;border-right:1px solid #BBF7D0;padding:12px 18px;vertical-align:top;width:33%">
    <div class="serif" style="font-size:28px;font-weight:700;color:#166534;line-height:1">${followedList.length}</div>
    <div class="sans" style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#166534;margin-top:4px">Followed In</div>
    <div class="sans" style="font-size:10px;color:#166534;margin-top:2px">Cases</div>
  </td>
  <td style="background:#FFFBEB;border-right:1px solid ${ovrBdr};padding:12px 18px;vertical-align:top;width:33%">
    <div class="serif" style="font-size:28px;font-weight:700;color:#92400E;line-height:1">${distinguishedList.length}</div>
    <div class="sans" style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#92400E;margin-top:4px">Distinguished In</div>
    <div class="sans" style="font-size:10px;color:#92400E;margin-top:2px">Cases</div>
  </td>
  <td style="background:${ovrBg};padding:12px 18px;vertical-align:top;width:34%">
    <div class="serif" style="font-size:28px;font-weight:700;color:${ovrCol};line-height:1">${overruledList.length}</div>
    <div class="sans" style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${ovrCol};margin-top:4px">Overruled By</div>
    <div class="sans" style="font-size:10px;color:${ovrCol};margin-top:2px">Cases</div>
  </td>
</tr></table>`;

    // Secondary treatment pills — inline-block spans (no flex)
    const secondaryTreats = [
      { list: reliedOnList, label: 'Relied On', col: '#0D47A1', bg: '#E3F2FD', bdr: '#90CAF9' },
      { list: appliedList, label: 'Applied', col: '#1565C0', bg: '#E8F4FD', bdr: '#90CAF9' },
      { list: citedList, label: 'Cited', col: '#2E7D32', bg: '#E8F5E9', bdr: '#A5D6A7' },
      { list: referredList, label: 'Referred To', col: '#4E342E', bg: '#EFEBE9', bdr: '#BCAAA4' },
      { list: reversedList, label: 'Reversed', col: '#7B1FA2', bg: '#F3E5F5', bdr: '#CE93D8' },
      { list: approvedList, label: 'Approved', col: '#1B5E20', bg: '#F1F8E9', bdr: '#C5E1A5' },
    ].filter(p => p.list.length > 0);
    const secondaryHtml = secondaryTreats.length > 0 ? `
<div style="margin-bottom:10px">
  ${secondaryTreats.map(p => `<span style="display:inline-block;background:${p.bg};border:1px solid ${p.bdr};border-radius:5px;padding:4px 10px;margin:3px 4px 3px 0"><span style="font-size:13px;font-weight:800;color:${p.col}">${p.list.length}</span> <span style="font-size:9px;font-weight:700;color:${p.col};text-transform:uppercase;letter-spacing:.07em">${p.label}</span></span>`).join('')}
</div>` : '';

    // Treatment case rows — table
    const treatRows = [
      ...followedList.map(n => ({ n, type: 'FOLLOWED', col: '#166534', bg: '#F0FDF4', bdr: '#BBF7D0' })),
      ...distinguishedList.map(n => ({ n, type: 'DISTINGUISHED', col: '#92400E', bg: '#FFFBEB', bdr: '#FDE68A' })),
      ...overruledList.map(n => ({ n, type: 'OVERRULED', col: '#991B1B', bg: '#FEF2F2', bdr: '#FECACA' })),
      ...reversedList.map(n => ({ n, type: 'REVERSED', col: '#7B1FA2', bg: '#F3E5F5', bdr: '#CE93D8' })),
      ...reliedOnList.map(n => ({ n, type: 'RELIED ON', col: '#0D47A1', bg: '#E3F2FD', bdr: '#90CAF9' })),
      ...appliedList.map(n => ({ n, type: 'APPLIED', col: '#1565C0', bg: '#E8F4FD', bdr: '#90CAF9' })),
      ...citedList.map(n => ({ n, type: 'CITED', col: '#2E7D32', bg: '#E8F5E9', bdr: '#A5D6A7' })),
      ...referredList.map(n => ({ n, type: 'REFERRED TO', col: '#4E342E', bg: '#EFEBE9', bdr: '#BCAAA4' })),
      ...approvedList.map(n => ({ n, type: 'APPROVED', col: '#1B5E20', bg: '#F1F8E9', bdr: '#C5E1A5' })),
    ];
    const treatRowsHtml = treatRows.length > 0
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:4px;overflow:hidden;margin-bottom:6px">${treatRows.map((item, i) => `<tr style="background:#FFFFFF"><td style="padding:9px 14px;border-bottom:${i < treatRows.length - 1 ? '1px solid #F1F5F9' : 'none'};vertical-align:top"><div class="serif" style="font-size:13px;font-weight:600;color:#1E293B">${esc(item.n)}</div></td><td style="padding:9px 14px;border-bottom:${i < treatRows.length - 1 ? '1px solid #F1F5F9' : 'none'};vertical-align:top;text-align:right;width:1%;white-space:nowrap"><span style="display:inline-block;background:${item.bg};color:${item.col};border:1px solid ${item.bdr};font-family:'Source Sans 3',sans-serif;font-size:8px;font-weight:700;padding:2px 8px;border-radius:2px;letter-spacing:.06em">${item.type}</span></td></tr>`).join('')}</table>`
      : `<div style="font-size:11px;color:#94A3B8;padding:8px 0;font-style:italic">No subsequent treatment references found in judgment text.</div>`;

    // Source link
    const srcKey = c.source || 'unknown';
    const srcTxt = srcKey === 'local' ? 'Local DB' : srcKey === 'indian_kanoon' ? 'Indian Kanoon' : srcKey === 'google' ? 'Google Search (Gemini)' : (c.sourceApplication || c.sourceLabel || 'Unknown Source');
    const srcLinkUrl = c.importSourceLink || c.sourceUrl || c.officialSourceLink;
    const srcLinkHtml = srcLinkUrl ? `<div class="sans" style="font-size:9px;color:#94A3B8;margin-bottom:5px">Source: ${esc(srcTxt)} &middot; <a href="${esc(srcLinkUrl)}" style="color:#1D4ED8">Open document</a></div>` : '';

    return `
<div class="paper">
  <div class="inner">
    ${staleBanner}
    ${yellowBanner}

    <div style="text-align:center;padding-bottom:14px;margin-bottom:14px;border-bottom:1px solid #E2E8F0">
      <div class="serif" style="font-size:11px;font-weight:700;letter-spacing:.22em;color:#0C4A6E;text-transform:uppercase">${esc(courtLine)}</div>
      ${showJuris ? '<div class="sans" style="font-size:9px;letter-spacing:.14em;color:#94A3B8;text-transform:uppercase;margin-top:4px">CRIMINAL APPELLATE JURISDICTION</div>' : ''}
    </div>

    <h1 class="serif" style="text-align:center;font-size:21px;font-weight:700;color:#0F172A;line-height:1.3;margin-bottom:18px">${esc(c.caseName)}</h1>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:4px;margin-bottom:16px;overflow:hidden"><tr>
      <td style="width:160px;padding:10px 14px;border-right:1px solid #E2E8F0;vertical-align:top">
        <div class="lbl">Primary Citation</div>
        <div class="serif" style="font-size:13px;font-weight:700;color:#0F172A">${esc(c.primaryCitation || '—')}</div>
      </td>
      <td style="padding:10px 14px;border-right:1px solid #E2E8F0;vertical-align:top">
        <div class="lbl">Equivalent Citations</div>
        <div class="serif" style="font-size:11.5px;color:#334155;line-height:1.5">${esc((c.alternateCitations || []).join('; ') || '—')}</div>
      </td>
      <td style="width:155px;padding:10px 14px;vertical-align:top">
        <div class="lbl">Date of Judgment</div>
        <div class="serif" style="font-size:12px;font-weight:600;color:#0F172A">${esc(c.dateOfJudgment || '—')}</div>
      </td>
    </tr></table>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px"><tr>
      <td style="width:50%;padding-right:8px;vertical-align:top">
        <div class="lbl">Coram / Bench</div>
        <div style="margin-top:4px">${judgesHtml}</div>
        ${c.benchType && c.benchType !== '—' ? `<div class="sans" style="font-size:9px;color:#64748B;margin-top:2px">${esc(c.benchType)}</div>` : ''}
      </td>
      <td style="width:50%;padding-left:8px;vertical-align:top">
        <div class="lbl">Statutory Provisions</div>
        <div style="margin-top:4px">${statutesHtml}</div>
      </td>
    </tr></table>

    <div style="margin:20px 0 10px;border-left:3px solid #1E3A8A;padding-left:9px">
      <span class="sans" style="font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1E3A8A">I. Legal Analysis &amp; Ratio</span>
    </div>
    <div class="ratio-block">"${esc(c.ratio || '—')}"</div>

    <div class="sub-h">Proposition Verification</div>
    <div class="prop-box">
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px"><tr>
        <td style="width:22px;vertical-align:top;padding-top:1px">
          <span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:#DBEAFE;color:#1D4ED8;font-size:9px;font-weight:900;text-align:center;line-height:16px">i</span>
        </td>
        <td style="vertical-align:top;padding-left:6px">
          <div class="sans" style="font-size:9px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.07em;margin-bottom:3px">Query</div>
          <div class="serif" style="font-size:12.5px;color:#1E293B;line-height:1.65">${esc((c.proposition || {}).query || query || '—')}</div>
        </td>
      </tr></table>
      <div>
        <span style="display:inline-block;background:${matchColor};color:#FFFFFF;font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;letter-spacing:.07em;padding:3px 10px;border-radius:3px;margin-right:8px">${esc(matchLabel)}</span>
        <span class="sans" style="font-size:10px;color:#64748B">Semantic Similarity: ${(score / 100).toFixed(2)} (${esc(verdict.charAt(0) + verdict.slice(1).toLowerCase())}-Sbert)</span>
      </div>
    </div>

    <div class="sub-h">Source Excerpt (${esc(exc.para || 'Para —')})</div>
    <div class="excerpt-box">"${esc(excerptText)}"</div>

    <div style="margin:24px 0 10px;border-left:3px solid #1E3A8A;padding-left:9px">
      <span class="sans" style="font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1E3A8A">II. Subsequent Treatment</span>
    </div>
    ${treatStats3}
    ${secondaryHtml}
    ${treatRowsHtml}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;padding-top:14px;border-top:1px solid #E2E8F0"><tr>
      <td style="vertical-align:bottom">
        <div class="sans" style="font-size:8px;font-weight:700;letter-spacing:.15em;color:#1E3A8A;text-transform:uppercase;margin-bottom:4px">Jurinex Legal Intelligence Report</div>
        <div class="sans" style="font-size:9px;color:#94A3B8;margin-bottom:2px">Generated on ${esc(generatedAt || '—')}</div>
        ${srcLinkHtml}
        <span style="display:inline-block;background:#F0FDF4;border:1px solid #BBF7D0;border-radius:3px;padding:2px 9px">
          <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:#16A34A;vertical-align:middle;margin-right:4px"></span><span class="sans" style="font-size:8px;font-weight:700;color:#15803D;letter-spacing:.07em">AUTHENTICATED RESEARCH DOCUMENT</span>
        </span>
      </td>
      <td style="vertical-align:bottom;text-align:right;white-space:nowrap;padding-left:12px">
        <div class="sans" style="font-size:9px;color:#94A3B8">Citation ${idx + 1} of ${citations.length}</div>
      </td>
    </tr></table>
  </div>
</div>`;
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles}</style></head><body>${titleHtml}${citationBlocks.join('')}</body></html>`;
}


/* ─── Generate print window with only this citation ─── */
function downloadCitationPDF(c, query, generatedAt) {
  const judges = (c.coram || '').split(/[,;]/).map(j => j.trim()).filter(Boolean);
  const exc = c.excerpt || {};
  const treat = c.treatment || {};
  const score = (c.proposition || {}).matchScore ?? 0;
  const matchLabel = score >= 80 ? 'MATCH CONFIRMED' : score >= 60 ? 'PARTIAL MATCH' : 'LOW MATCH';
  const matchColor = score >= 80 ? '#0D9488' : score >= 60 ? '#D97706' : '#DC2626';
  const excerptText = (exc.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '—';
  const courtLine = /supreme/i.test(c.court || '') || !c.court || c.court === '—' || c.court === 'Court not specified'
    ? 'IN THE SUPREME COURT OF INDIA' : `IN THE ${(c.court || '').toUpperCase()}`;
  const showJuris = /supreme/i.test(c.court || '') || !c.court || c.court === '—' || c.court === 'Court not specified';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${c.caseName} — Jurinex Citation Report</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400&family=Source+Sans+3:wght@400;600;700&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;background:#fff;padding:36px 48px;color:#0F172A;font-size:12px}
.court{text-align:center;font-family:'Source Serif 4',serif;font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#0C4A6E;margin-bottom:4px}
.juris{text-align:center;font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#94A3B8;margin-bottom:12px}
h1{font-family:'Source Serif 4',serif;font-size:20px;font-weight:700;text-align:center;margin:0 0 16px;color:#0F172A;line-height:1.3}
.grid3{display:grid;grid-template-columns:155px 1fr 150px;border:1px solid #E2E8F0;border-radius:4px;margin-bottom:14px;overflow:hidden}
.cell{padding:9px 13px;border-right:1px solid #E2E8F0}.cell:last-child{border-right:none}
.lbl{font-size:7px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#94A3B8;margin-bottom:3px}
.val{font-family:'Source Serif 4',serif;font-size:12px;font-weight:700;color:#0F172A}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:12px}
.sec-h{border-left:3px solid #1E3A8A;padding-left:9px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1E3A8A;margin:18px 0 8px}
.ratio{border-left:3px solid #0EA5E9;background:#F0F9FF;padding:12px 16px;font-family:'Source Serif 4',serif;font-size:12.5px;font-style:italic;line-height:1.9;color:#0F172A}
.sub-h{font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748B;margin:12px 0 5px}
.prop{border:1px solid #E2E8F0;background:#F8FAFC;padding:10px 14px;border-radius:4px}
.match{display:inline-block;color:#fff;font-size:8px;font-weight:700;padding:2px 9px;border-radius:3px;margin-right:8px;letter-spacing:.06em}
.excerpt{border:1px solid #E2E8F0;background:#FFFDF7;padding:12px 16px;font-family:'Source Serif 4',serif;font-size:12px;line-height:1.9;border-radius:4px}
.chip{display:inline-block;border:1px solid #BFDBFE;background:#EFF6FF;color:#1D4ED8;font-size:8px;font-weight:700;padding:2px 7px;border-radius:3px;margin:2px 3px 2px 0}
.treats{display:grid;grid-template-columns:1fr 1fr 1fr;border:1px solid #E2E8F0;border-radius:4px;overflow:hidden;margin-bottom:10px}
.tstat{padding:10px 16px}.tcount{font-family:'Source Serif 4',serif;font-size:26px;font-weight:700;line-height:1}
.footer{margin-top:20px;padding-top:12px;border-top:1px solid #E2E8F0}
.auth{display:inline-flex;align-items:center;gap:4px;background:#F0FDF4;border:1px solid #BBF7D0;padding:2px 9px;border-radius:3px;font-size:7px;font-weight:700;color:#15803D;letter-spacing:.07em;margin-top:6px}
@media print{body{padding:20px 24px}@page{margin:1cm}}
</style></head><body>
<div class="court">${courtLine}</div>
${showJuris ? '<div class="juris">CRIMINAL APPELLATE JURISDICTION</div>' : ''}
<h1>${c.caseName}</h1>
<div class="grid3">
  <div class="cell"><div class="lbl">Primary Citation</div><div class="val" style="font-size:13px">${c.primaryCitation || '—'}</div></div>
  <div class="cell"><div class="lbl">Equivalent Citations</div><div class="val" style="font-size:11px;font-weight:400">${(c.alternateCitations || []).join('; ') || '—'}</div></div>
  <div class="cell"><div class="lbl">Date of Judgment</div><div class="val" style="font-size:12px">${c.dateOfJudgment || '—'}</div></div>
</div>
<div class="grid2">
  <div><div class="lbl">Coram / Bench</div><div style="margin-top:4px">${judges.map(j => `<div style="display:flex;align-items:center;gap:5px;margin-bottom:3px"><span style="color:#94A3B8;font-size:10px">◉</span><span style="font-family:'Source Serif 4',serif;font-size:12px">${j}</span></div>`).join('') || '—'}</div>${c.benchType && c.benchType !== '—' ? `<div style="font-size:9px;color:#64748B;margin-top:3px">${c.benchType}</div>` : ''}</div>
  <div><div class="lbl">Statutory Provisions</div><div style="margin-top:4px">${(c.statutes || []).map(s => `<span class="chip">${s}</span>`).join('') || '—'}</div></div>
</div>
<div class="sec-h">I. Legal Analysis &amp; Ratio</div>
<div class="ratio">"${c.ratio || '—'}"</div>
<div class="sub-h">Proposition Verification</div>
<div class="prop">
  <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748B;margin-bottom:4px">Query</div>
  <div style="font-family:'Source Serif 4',serif;font-size:12px;color:#1E293B;margin-bottom:8px">${(c.proposition || {}).query || query || '—'}</div>
  <span class="match" style="background:${matchColor}">${matchLabel}</span>
  <span style="font-size:9px;color:#64748B">Semantic Similarity: ${(score / 100).toFixed(2)}</span>
</div>
<div class="sub-h">Source Excerpt (${exc.para || 'Para —'})</div>
<div class="excerpt">"${excerptText}"</div>
<div class="sec-h" style="margin-top:20px">II. Subsequent Treatment</div>
<div class="treats">
  <div class="tstat" style="background:#F0FDF4;border-right:1px solid #BBF7D0"><div class="tcount" style="color:#166534">${treat.followed ?? 0}</div><div style="font-size:8px;font-weight:700;color:#166534;margin-top:3px;letter-spacing:.08em;text-transform:uppercase">Followed In</div><div style="font-size:9px;color:#166534">Cases</div></div>
  <div class="tstat" style="background:#FFFBEB;border-right:1px solid #FDE68A"><div class="tcount" style="color:#92400E">${treat.distinguished ?? 0}</div><div style="font-size:8px;font-weight:700;color:#92400E;margin-top:3px;letter-spacing:.08em;text-transform:uppercase">Distinguished In</div><div style="font-size:9px;color:#92400E">Cases</div></div>
  <div class="tstat" style="background:#F8FAFC"><div class="tcount" style="color:#475569">${treat.overruled ?? 0}</div><div style="font-size:8px;font-weight:700;color:#475569;margin-top:3px;letter-spacing:.08em;text-transform:uppercase">Overruled By</div><div style="font-size:9px;color:#475569">Cases</div></div>
</div>
<div class="footer">
  <div style="font-size:7px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#1E3A8A;margin-bottom:3px">Jurinex Legal Intelligence Report</div>
  <div style="font-size:8px;color:#94A3B8">Generated on ${generatedAt || '—'}</div>
  <div class="auth">● AUTHENTICATED RESEARCH DOCUMENT</div>
</div>
</body></html>`;
  const win = window.open('', '_blank', 'width=950,height=760');
  if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 700); }
}

/* ─── Full citation report doc view ─── */
function ReportDoc({ report, query, cases = [], onViewFullJudgment }) {
  const [sel, setSel] = useState(new Set());
  const [atcCitId, setAtcCitId] = useState(null);
  const [atcCase, setAtcCase] = useState('');
  const [atcStatus, setAtcStatus] = useState(null); // null | 'uploading' | 'done' | {error:string}
  const [atcPreviewUrl, setAtcPreviewUrl] = useState(null); // blob URL for inline PDF preview
  const [redExpanded, setRedExpanded] = useState(false);
  const [notifyStatus, setNotifyStatus] = useState({}); // ticketId → 'done'|'sending'
  const [exportWarnId, setExportWarnId] = useState(null); // citation id awaiting export confirm
  const [origDocModal, setOrigDocModal] = useState(null); // { url, caseName, isPdf }
  const allCitations = report?.report_format?.citations || [];
  const generatedAt = report?.report_format?.generatedAt || '';
  const kwByRoute = report?.report_format?.searchKeywordsByRoute || {};
  const normKeywords = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [String(v)] : []);
  const kwLocal = normKeywords(kwByRoute.local);
  const kwIK = normKeywords(kwByRoute.indian_kanoon || kwByRoute.indianKanoon);
  const kwGoogle = normKeywords(kwByRoute.google);

  // Split citations into 4 buckets
  const citations = allCitations.filter(c => ['GREEN', 'YELLOW', 'STALE'].includes(c.verificationStatus));
  const pendingCits = allCitations.filter(c => c.verificationStatus === 'PENDING');
  const redCits = allCitations.filter(c => c.verificationStatus === 'RED');

  useEffect(() => {
    if (citations.length) setSel(new Set([citations[0]?.id].filter(Boolean)));
  }, [report]);

  const toggle = id => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selCites = citations.filter(c => sel.has(c.id));

  const handleNotifyMe = async (ticketId) => {
    if (!ticketId) return;
    setNotifyStatus(p => ({ ...p, [ticketId]: 'sending' }));
    const _nu = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
    const userId = String(_nu.id || _nu.user_id || localStorage.getItem('userId') || 'anonymous');
    try {
      await citationApi.notifyMeOnHitl(ticketId, userId);
    } catch { /* silent */ }
    setNotifyStatus(p => ({ ...p, [ticketId]: 'done' }));
  };

  const handleAddToCase = async (citation) => {
    if (!atcCase) return;
    setAtcStatus('uploading');
    // Revoke any previous preview blob
    setAtcPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    try {
      const cr = await documentApi.getCaseById(atcCase);
      const cd = cr?.case ?? cr;
      const folderName = cd?.folders?.[0]?.name ?? cd?.folders?.[0]?.originalname;
      if (!folderName) throw new Error('No folder found for this case. Please add a document to the case first to create its folder.');

      // Build PDF-ready HTML for this single citation (reuse existing builder)
      const singleHtml = buildFullReportHtml({ citations: [citation], generatedAt }, query);

      // Render inside a hidden iframe so the full HTML document (including <head>/<style>)
      // is parsed correctly. Injecting via innerHTML into a div strips html/head/body tags
      // and loses the embedded <style> rules, producing a blank PDF.
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;left:-9999px;width:210mm;height:297mm;border:none;visibility:hidden';
      document.body.appendChild(iframe);
      iframe.contentDocument.open();
      iframe.contentDocument.write(singleHtml);
      iframe.contentDocument.close();

      // Allow fonts and layout to settle before capture
      await new Promise(resolve => setTimeout(resolve, 900));

      const blob = await html2pdf()
        .set({
          margin: 10,
          filename: '',
          enableLinks: false,
          html2canvas: { scale: 1.5, useCORS: true, logging: false },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        })
        .from(iframe.contentDocument.body)
        .outputPdf('blob');

      document.body.removeChild(iframe);

      const safeName = (citation.caseName || 'citation').slice(0, 40).replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
      const pdfName = `citation_${safeName}_${Date.now()}.pdf`;
      const file = new File([blob], pdfName, { type: 'application/pdf' });

      // Create blob URL for inline preview (before upload so we have it immediately)
      const previewUrl = URL.createObjectURL(blob);
      await documentApi.uploadDocuments(folderName, [file]);
      setAtcPreviewUrl(previewUrl);
      setAtcStatus('done');
    } catch (err) {
      setAtcStatus({ error: err.message || 'Upload failed' });
    }
  };

  if (!allCitations.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: g400 }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>No citations found</div>
      <div style={{ fontSize: 11 }}>Try a different query or broader search terms.</div>
    </div>
  );

  return (
    <>
    <div style={{ background: '#EAECF0', minHeight: '100vh', padding: '20px 14px 64px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400;1,600&family=Source+Sans+3:wght@400;600;700&display=swap');
        @keyframes fdIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .doc-selR{cursor:pointer;transition:background .12s}.doc-selR:hover{background:#EEF2FF !important}
        .doc-paper{background:#FFFFFF;border:1px solid #D4D9E2;box-shadow:0 2px 14px rgba(15,23,42,.07);border-radius:6px;overflow:hidden}
        .doc-serif{font-family:'Source Serif 4','Georgia',serif}
        .doc-sans{font-family:'Source Sans 3','Helvetica Neue',Arial,sans-serif}
        .doc-lbl{font-family:'Source Sans 3',sans-serif;font-size:8px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#94A3B8;margin-bottom:4px}
        .doc-sec-h{display:flex;align-items:center;gap:0;margin:20px 0 10px;border-left:3px solid #1E3A8A;padding-left:9px;font-family:'Source Sans 3',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1E3A8A}
        .doc-sub-h{font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748B;margin:14px 0 7px}
        .doc-chip{display:inline-flex;align-items:center;border:1px solid #BFDBFE;background:#EFF6FF;color:#1D4ED8;font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;padding:2px 8px;border-radius:3px;margin:2px 3px 2px 0}
        .doc-ratio{border-left:3px solid #0EA5E9;background:#F0F9FF;padding:13px 16px;font-family:'Source Serif 4',serif;font-size:13px;font-style:italic;line-height:1.9;color:#0F172A;margin:0}
        .doc-prop{border:1px solid #E2E8F0;background:#F8FAFC;padding:11px 14px;border-radius:4px}
        .doc-excerpt{border:1px solid #E2E8F0;background:#FFFDF7;padding:13px 16px;font-family:'Source Serif 4',serif;font-size:12.5px;line-height:1.95;color:#1E293B;border-radius:4px}
        .doc-match{display:inline-flex;align-items:center;gap:5px;color:#FFFFFF;font-family:'Source Sans 3',sans-serif;font-size:9px;font-weight:700;letter-spacing:.07em;padding:3px 10px;border-radius:3px}
        .doc-treat-stat{display:flex;flex-direction:column;padding:12px 18px;flex:1;min-width:110px}
        .doc-case-row{display:flex;justify-content:space-between;align-items:flex-start;padding:9px 14px;gap:10px}
        .doc-case-badge{font-family:'Source Sans 3',sans-serif;font-size:8px;font-weight:700;padding:2px 8px;border-radius:2px;letter-spacing:.06em;white-space:nowrap;flex-shrink:0}
        .doc-foot-btn{font-family:'Source Sans 3',sans-serif;font-size:10px;font-weight:700;letter-spacing:.05em;padding:7px 16px;border-radius:4px;cursor:pointer;border:1px solid;text-transform:uppercase}
      `}</style>

      <div style={{ maxWidth: 740, margin: '0 auto' }}>

        {/* Citation point selector */}
        <div style={{ background: W, marginBottom: 14, border: '1px solid #D4D9E2', borderRadius: 6, overflow: 'hidden', boxShadow: '0 1px 5px rgba(15,23,42,.06)' }}>
          <div style={{ background: '#1E3A8A', padding: '7px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="doc-sans" style={{ fontSize: 9, letterSpacing: '0.14em', color: '#BFDBFE', textTransform: 'uppercase' }}>Citation Points</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="doc-sans" style={{ fontSize: 9, color: '#93C5FD' }}>{sel.size} of {citations.length} selected</span>
              {pendingCits.length > 0 && <span className="doc-sans" style={{ fontSize: 8, background: '#7C3AED', color: W, borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>⏳ {pendingCits.length} pending</span>}
              {redCits.length > 0 && <span className="doc-sans" style={{ fontSize: 8, background: '#DC2626', color: W, borderRadius: 10, padding: '1px 6px', fontWeight: 700 }}>❌ {redCits.length} unverified</span>}
            </div>
          </div>
          {citations.map((c, idx) => {
            const s = SCFG[c.verificationStatus] || SCFG.YELLOW;
            const isSel = sel.has(c.id);
            const srcKey = c.source || 'unknown';
            let srcIcon = '🤖';
            let srcLabel = c.sourceApplication || c.sourceLabel || 'Unknown Source';
            if (srcKey === 'local') {
              srcIcon = '🏛';
              srcLabel = 'Local DB';
            } else if (srcKey === 'indian_kanoon') {
              srcIcon = '📚';
              srcLabel = 'Indian Kanoon';
            } else if (srcKey === 'google') {
              srcIcon = '🌐';
              srcLabel = 'Google Search (Gemini)';
            }
            return (
              <div key={c.id} className="doc-selR" onClick={() => toggle(c.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: isSel ? '#EEF2FF' : W, borderBottom: idx < citations.length - 1 ? '1px solid #F1F4F8' : 'none' }}>
                <div style={{ width: 13, height: 13, flexShrink: 0, border: `2px solid ${isSel ? '#1E3A8A' : '#C5CAD3'}`, background: isSel ? '#1E3A8A' : W, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isSel && <span style={{ color: W, fontSize: 9, lineHeight: 1, marginTop: -1 }}>✓</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="doc-serif" style={{ fontSize: 12.5, fontWeight: 600, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.caseName}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span className="doc-sans" style={{ fontSize: 10, fontWeight: 700, color: '#1E3A8A' }}>{c.primaryCitation}</span>
                      {c.court && c.court !== 'Court not specified' && <><span style={{ color: '#CBD5E1' }}>·</span><span className="doc-sans" style={{ fontSize: 10, color: '#64748B' }}>{c.court}</span></>}
                    </div>
                    <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{srcIcon}</span>
                      <span>{srcLabel}</span>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: s.bg, border: `1px solid ${s.border}`, padding: '2px 7px', borderRadius: 2, flexShrink: 0 }}>
                  <Dot c={s.dot} s={5} />
                  <span className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: s.text }}>{s.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {selCites.length === 0 && (
          <div className="doc-paper" style={{ padding: '52px 32px', textAlign: 'center' }}>
            <div className="doc-serif" style={{ fontSize: 15, fontStyle: 'italic', color: '#9CA3AF' }}>Select a citation point above to view the full report.</div>
          </div>
        )}

        {citations.length === 0 && (pendingCits.length > 0 || redCits.length > 0) && (
          <div className="doc-paper" style={{ padding: '32px', textAlign: 'center', marginBottom: 18 }}>
            <div className="doc-serif" style={{ fontSize: 14, fontStyle: 'italic', color: '#9CA3AF' }}>No verified citations available. See sections below.</div>
          </div>
        )}

        {selCites.map((c, idx) => {
          const score = (c.proposition || {}).matchScore ?? 0;
          const verdict = (c.proposition || {}).verdict || 'REVIEW';
          const matchLabel = score >= 80 ? 'MATCH CONFIRMED' : score >= 60 ? 'PARTIAL MATCH' : 'LOW MATCH';
          const matchColor = score >= 80 ? '#0D9488' : score >= 60 ? '#D97706' : '#DC2626';
          const treat = c.treatment || {};
          const followedList = treat.followedList || [];
          const distinguishedList = treat.distinguishedList || [];
          const overruledList = treat.overruledList || [];
          const reversedList = treat.reversedList || [];
          const reliedOnList = treat.reliedOnList || [];
          const appliedList = treat.appliedList || [];
          const citedList = treat.citedList || [];
          const referredList = treat.referredList || [];
          const approvedList = treat.approvedList || [];
          const judges = (c.coram || '').split(/[,;]/).map(j => j.trim()).filter(Boolean);
          const excerptRaw = (c.excerpt || {}).text || '';
          const excerptDisplay = (() => {
            // Backend already strips most HTML/CSS noise; here we just normalise whitespace
            const t = excerptRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            return t || '—';
          })();
          const srcKey = c.source || 'unknown';
          let srcIcon = '🤖';
          let srcLabel = c.sourceApplication || c.sourceLabel || 'Unknown Source';
          if (srcKey === 'local') {
            srcIcon = '🏛';
            srcLabel = 'Local DB';
          } else if (srcKey === 'indian_kanoon') {
            srcIcon = '📚';
            srcLabel = 'Indian Kanoon';
          } else if (srcKey === 'google') {
            srcIcon = '🌐';
            srcLabel = 'Google Search (Gemini)';
          }
          const treatRows = [
            ...followedList.map(name => ({ name, type: 'FOLLOWED', col: '#166534', bg: '#F0FDF4', bdr: '#BBF7D0' })),
            ...distinguishedList.map(name => ({ name, type: 'DISTINGUISHED', col: '#92400E', bg: '#FFFBEB', bdr: '#FDE68A' })),
            ...overruledList.map(name => ({ name, type: 'OVERRULED', col: '#991B1B', bg: '#FEF2F2', bdr: '#FECACA' })),
            ...reversedList.map(name => ({ name, type: 'REVERSED', col: '#7B1FA2', bg: '#F3E5F5', bdr: '#CE93D8' })),
            ...reliedOnList.map(name => ({ name, type: 'RELIED ON', col: '#0D47A1', bg: '#E3F2FD', bdr: '#90CAF9' })),
            ...appliedList.map(name => ({ name, type: 'APPLIED', col: '#1565C0', bg: '#E8F4FD', bdr: '#90CAF9' })),
            ...citedList.map(name => ({ name, type: 'CITED', col: '#2E7D32', bg: '#E8F5E9', bdr: '#A5D6A7' })),
            ...referredList.map(name => ({ name, type: 'REFERRED TO', col: '#4E342E', bg: '#EFEBE9', bdr: '#BCAAA4' })),
            ...approvedList.map(name => ({ name, type: 'APPROVED', col: '#1B5E20', bg: '#F1F8E9', bdr: '#C5E1A5' })),
          ];

          return (
            <div key={c.id} className="doc-paper" style={{ marginBottom: 18, animation: `fdIn .3s ease ${idx * .07}s both` }}>
              <div style={{ padding: '26px 32px 22px' }}>

                {/* STALE warning banner */}
                {c.verificationStatus === 'STALE' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6, padding: '11px 14px', marginBottom: 18 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>🔄</span>
                    <div>
                      <div className="doc-sans" style={{ fontSize: 10, fontWeight: 700, color: '#EA580C', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>Freshness Check Pending</div>
                      <div className="doc-sans" style={{ fontSize: 11, color: '#7C2D12', lineHeight: 1.55 }}>
                        {c.staleReason || 'This citation was previously verified but a recent development may have affected its validity. We are re-checking.'}
                      </div>
                      <div className="doc-sans" style={{ fontSize: 10, color: '#EA580C', marginTop: 4, fontWeight: 600 }}>Do not rely on this citation until the check completes.</div>
                    </div>
                  </div>
                )}

                {/* YELLOW review banner */}
                {c.verificationStatus === 'YELLOW' && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '11px 14px', marginBottom: 18 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
                    <div style={{ flex: 1 }}>
                      <div className="doc-sans" style={{ fontSize: 10, fontWeight: 700, color: '#D97706', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>Review Suggested — Source Attached</div>
                      <div className="doc-sans" style={{ fontSize: 11, color: '#92400E', lineHeight: 1.55 }}>
                        This citation exists but the way it was used may not precisely match the holding. Please read the excerpt below and verify independently before relying on it in court.
                      </div>
                      {/* Alignment score bar */}
                      <div style={{ marginTop: 9 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span className="doc-sans" style={{ fontSize: 9, color: '#92400E', fontWeight: 700 }}>Proposition Alignment</span>
                          <span className="doc-sans" style={{ fontSize: 9, color: '#D97706', fontWeight: 700 }}>{score}%</span>
                        </div>
                        <div style={{ height: 6, background: '#FDE68A', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${score}%`, background: score >= 75 ? '#D97706' : '#EF4444', borderRadius: 3, transition: 'width .6s ease' }} />
                        </div>
                      </div>
                      {/* Side-by-side: claimed vs actual */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                        <div style={{ background: '#FFFDE7', border: '1px solid #FDE68A', borderRadius: 4, padding: '8px 10px' }}>
                          <div className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#B45309', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>What was claimed</div>
                          <div className="doc-serif" style={{ fontSize: 11, color: '#1E293B', lineHeight: 1.55, fontStyle: 'italic' }}>"{(c.proposition || {}).query || query || '—'}"</div>
                        </div>
                        <div style={{ background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, padding: '8px 10px' }}>
                          <div className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>Actual holding</div>
                          <div className="doc-serif" style={{ fontSize: 11, color: '#1E293B', lineHeight: 1.55 }}>{(c.ratio || '—').slice(0, 220)}{(c.ratio || '').length > 220 ? '…' : ''}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Court header */}
                <CourtHeading court={c.court} />

                {/* Case name */}
                <h1 className="doc-serif" style={{ textAlign: 'center', fontSize: 21, fontWeight: 700, color: '#0F172A', lineHeight: 1.3, marginBottom: 18 }}>
                  {c.caseName}
                </h1>

                {/* Citation strip — 3 columns with dividers */}
                <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 155px', border: '1px solid #E2E8F0', borderRadius: 4, marginBottom: 16, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', borderRight: '1px solid #E2E8F0' }}>
                    <div className="doc-lbl">Primary Citation</div>
                    <div className="doc-serif" style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{c.primaryCitation || '—'}</div>
                  </div>
                  <div style={{ padding: '10px 14px', borderRight: '1px solid #E2E8F0' }}>
                    <div className="doc-lbl">Equivalent Citations</div>
                    <div className="doc-serif" style={{ fontSize: 11.5, color: '#334155', lineHeight: 1.5 }}>{(c.alternateCitations || []).join('; ') || '—'}</div>
                  </div>
                  <div style={{ padding: '10px 14px' }}>
                    <div className="doc-lbl">Date of Judgment</div>
                    <div className="doc-serif" style={{ fontSize: 12, fontWeight: 600, color: '#0F172A' }}>{c.dateOfJudgment || '—'}</div>
                  </div>
                </div>

                {/* Coram + Statutory Provisions */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 6 }}>
                  <div>
                    <div className="doc-lbl">Coram / Bench</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
                      {judges.length > 0
                        ? judges.map((j, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <JudgeIcon />
                            <span className="doc-serif" style={{ fontSize: 12, color: '#1E293B' }}>{j}</span>
                          </div>
                        ))
                        : <span className="doc-serif" style={{ fontSize: 12, color: '#94A3B8' }}>—</span>
                      }
                      {c.benchType && c.benchType !== '—' && (
                        <div className="doc-sans" style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>{c.benchType}</div>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="doc-lbl">Statutory Provisions</div>
                    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap' }}>
                      {(c.statutes || []).length
                        ? (c.statutes || []).map((st, i) => <span key={i} className="doc-chip">{st}</span>)
                        : <span className="doc-serif" style={{ fontSize: 12, color: '#94A3B8' }}>—</span>
                      }
                    </div>
                  </div>
                </div>

                {/* I. Legal Analysis & Ratio */}
                <div className="doc-sec-h">I. Legal Analysis &amp; Ratio</div>
                <blockquote className="doc-ratio">
                  "{c.ratio || '—'}"
                </blockquote>

                {/* Proposition Verification */}
                <div className="doc-sub-h">Proposition Verification</div>
                <div className="doc-prop">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', background: '#DBEAFE', color: '#1D4ED8', fontSize: 9, fontWeight: 900, flexShrink: 0, marginTop: 1 }}>i</span>
                    <div>
                      <div className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 3 }}>Query</div>
                      <div className="doc-serif" style={{ fontSize: 12.5, color: '#1E293B', lineHeight: 1.65 }}>{(c.proposition || {}).query || query || '—'}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                    <span className="doc-match" style={{ background: matchColor }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,.65)', display: 'inline-block', flexShrink: 0 }} />
                      {matchLabel}
                    </span>
                    <span className="doc-sans" style={{ fontSize: 10, color: '#64748B' }}>
                      Semantic Similarity: {(score / 100).toFixed(2)} ({verdict.charAt(0) + verdict.slice(1).toLowerCase() + '-Sbert'})
                    </span>
                  </div>
                </div>

                {/* Source Excerpt */}
                <div className="doc-sub-h">Source Excerpt ({(c.excerpt || {}).para || 'Para —'})</div>
                <div className="doc-excerpt">
                  "{excerptDisplay}"
                </div>

                {/* III. Indian Kanoon Enrichment */}
                {(c.originalCourtCopyUrl || (c.ikFragment && c.ikFragment.headline) || (c.ikCiteList && c.ikCiteList.length > 0) || (c.ikCitedByList && c.ikCitedByList.length > 0) || (c.ikDocMeta && Object.keys(c.ikDocMeta).length > 0)) && (
                  <div style={{ marginTop: 24 }}>
                    <div className="doc-sec-h">III. Indian Kanoon Enrichment</div>

                    {/* Original Court Copy */}
                    {c.originalCourtCopyUrl && (
                      <div style={{ marginBottom: 14 }}>
                        <div className="doc-sub-h">Original Court Copy</div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <button
                            onClick={() => setOrigDocModal({ url: c.originalCourtCopyUrl, caseName: c.caseName, isPdf: c.isOriginalCopyPdf })}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 7,
                              padding: '7px 14px', background: '#1E3A8A', color: '#FFFFFF',
                              borderRadius: 5, border: 'none', cursor: 'pointer',
                              fontSize: 11, fontWeight: 700, letterSpacing: '.04em',
                            }}
                          >
                            <span>📄</span>
                            <span>{c.isOriginalCopyPdf ? 'View Original PDF' : 'View Original Document'}</span>
                          </button>
                          <a
                            href={c.originalCourtCopyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '7px 12px', background: 'transparent', color: '#1E3A8A',
                              borderRadius: 5, border: '1px solid #1E3A8A',
                              fontSize: 11, fontWeight: 600, textDecoration: 'none',
                            }}
                          >
                            <span>↗</span><span>Open in Tab</span>
                          </a>
                        </div>
                      </div>
                    )}

                    {/* IK Relevant Fragment */}
                    {c.ikFragment && c.ikFragment.headline && (
                      <div style={{ marginBottom: 14 }}>
                        <div className="doc-sub-h">Relevant Fragment (Indian Kanoon)</div>
                        <div style={{
                          background: '#F0F9FF', border: '1px solid #BAE6FD',
                          borderLeft: '3px solid #0369A1', borderRadius: 4,
                          padding: '10px 14px', fontSize: 12, color: '#0C4A6E', lineHeight: 1.7,
                          fontStyle: 'italic',
                        }}>
                          {c.ikFragment.headline}
                        </div>
                      </div>
                    )}

                    {/* IK Doc Metadata */}
                    {c.ikDocMeta && (c.ikDocMeta.publishdate || c.ikDocMeta.docsource || c.ikDocMeta.numcites != null) && (
                      <div style={{ marginBottom: 14 }}>
                        <div className="doc-sub-h">Document Metadata</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {c.ikDocMeta.publishdate && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.07em' }}>Published</span>
                              <span style={{ fontSize: 11, color: '#1E293B', fontWeight: 600 }}>{c.ikDocMeta.publishdate}</span>
                            </div>
                          )}
                          {c.ikDocMeta.docsource && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.07em' }}>Court</span>
                              <span style={{ fontSize: 11, color: '#1E293B', fontWeight: 600 }}>{c.ikDocMeta.docsource}</span>
                            </div>
                          )}
                          {c.ikDocMeta.numcites != null && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 4 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '.07em' }}>Total Citations</span>
                              <span style={{ fontSize: 11, color: '#1E293B', fontWeight: 600 }}>{c.ikDocMeta.numcites}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* IK Citation Network */}
                    {((c.ikCiteList && c.ikCiteList.length > 0) || (c.ikCitedByList && c.ikCitedByList.length > 0)) && (
                      <div style={{ marginBottom: 14 }}>
                        <div className="doc-sub-h">Citation Network (Indian Kanoon)</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          {/* Cases Cited */}
                          <div style={{ border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ padding: '6px 10px', background: '#F1F5F9', borderBottom: '1px solid #E2E8F0' }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                                Cases Cited ({(c.ikCiteList || []).length})
                              </span>
                            </div>
                            {(c.ikCiteList || []).length === 0 ? (
                              <div style={{ padding: '8px 10px', fontSize: 10, color: '#94A3B8', fontStyle: 'italic' }}>None recorded</div>
                            ) : (
                              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                                {(c.ikCiteList || []).map((item, i) => (
                                  <div key={i} style={{ padding: '6px 10px', borderBottom: i < c.ikCiteList.length - 1 ? '1px solid #F1F5F9' : 'none', background: '#FFFFFF' }}>
                                    <a
                                      href={item.url || `https://indiankanoon.org/doc/${item.tid}/`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ fontSize: 11, color: '#1D4ED8', textDecoration: 'none', lineHeight: 1.45, display: 'block' }}
                                    >
                                      {item.title || `Doc #${item.tid}`}
                                    </a>
                                    {item.docsource && (
                                      <span style={{ fontSize: 9, color: '#94A3B8' }}>{item.docsource}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Cited By */}
                          <div style={{ border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ padding: '6px 10px', background: '#F1F5F9', borderBottom: '1px solid #E2E8F0' }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                                Cited By ({(c.ikCitedByList || []).length})
                              </span>
                            </div>
                            {(c.ikCitedByList || []).length === 0 ? (
                              <div style={{ padding: '8px 10px', fontSize: 10, color: '#94A3B8', fontStyle: 'italic' }}>None recorded</div>
                            ) : (
                              <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                                {(c.ikCitedByList || []).map((item, i) => (
                                  <div key={i} style={{ padding: '6px 10px', borderBottom: i < c.ikCitedByList.length - 1 ? '1px solid #F1F5F9' : 'none', background: '#FFFFFF' }}>
                                    <a
                                      href={item.url || `https://indiankanoon.org/doc/${item.tid}/`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ fontSize: 11, color: '#1D4ED8', textDecoration: 'none', lineHeight: 1.45, display: 'block' }}
                                    >
                                      {item.title || `Doc #${item.tid}`}
                                    </a>
                                    {item.docsource && (
                                      <span style={{ fontSize: 9, color: '#94A3B8' }}>{item.docsource}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* IV. Subsequent Treatment */}
                <div className="doc-sec-h" style={{ marginTop: 24 }}>IV. Subsequent Treatment</div>

                {/* Primary 3 stats */}
                <div style={{ display: 'flex', border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden', marginBottom: 10 }}>
                  {[
                    { count: followedList.length, label: 'Followed In', col: '#166534', bg: '#F0FDF4', bdr: '#BBF7D0' },
                    { count: distinguishedList.length, label: 'Distinguished In', col: '#92400E', bg: '#FFFBEB', bdr: '#FDE68A' },
                    { count: overruledList.length, label: 'Overruled By', col: overruledList.length ? '#991B1B' : '#475569', bg: overruledList.length ? '#FEF2F2' : '#F8FAFC', bdr: overruledList.length ? '#FECACA' : '#E2E8F0' },
                  ].map((p, i, arr) => (
                    <div key={i} className="doc-treat-stat" style={{ background: p.bg, borderRight: i < arr.length - 1 ? `1px solid ${p.bdr}` : 'none' }}>
                      <div className="doc-serif" style={{ fontSize: 28, fontWeight: 700, color: p.col, lineHeight: 1 }}>{p.count}</div>
                      <div className="doc-sans" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: p.col, marginTop: 4 }}>{p.label}</div>
                      <div className="doc-sans" style={{ fontSize: 10, color: p.col, marginTop: 2 }}>Cases</div>
                    </div>
                  ))}
                </div>

                {/* Secondary treatment counts (relied on, applied, cited, referred, reversed, approved) */}
                {(reliedOnList.length + appliedList.length + citedList.length + referredList.length + reversedList.length + approvedList.length) > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                    {[
                      { list: reliedOnList, label: 'Relied On', col: '#0D47A1', bg: '#E3F2FD', bdr: '#90CAF9' },
                      { list: appliedList, label: 'Applied', col: '#1565C0', bg: '#E8F4FD', bdr: '#90CAF9' },
                      { list: citedList, label: 'Cited', col: '#2E7D32', bg: '#E8F5E9', bdr: '#A5D6A7' },
                      { list: referredList, label: 'Referred To', col: '#4E342E', bg: '#EFEBE9', bdr: '#BCAAA4' },
                      { list: reversedList, label: 'Reversed', col: '#7B1FA2', bg: '#F3E5F5', bdr: '#CE93D8' },
                      { list: approvedList, label: 'Approved', col: '#1B5E20', bg: '#F1F8E9', bdr: '#C5E1A5' },
                    ].filter(p => p.list.length > 0).map((p, i) => (
                      <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: p.bg, border: `1px solid ${p.bdr}`, borderRadius: 5, padding: '4px 10px' }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: p.col }}>{p.list.length}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: p.col, textTransform: 'uppercase', letterSpacing: '.07em' }}>{p.label}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* All case rows */}
                {treatRows.length > 0 ? (
                  <div style={{ border: '1px solid #E2E8F0', borderRadius: 4, overflow: 'hidden', marginBottom: 6 }}>
                    {treatRows.map((item, i) => (
                      <div key={i} className="doc-case-row" style={{ borderBottom: i < treatRows.length - 1 ? '1px solid #F1F5F9' : 'none', background: W }}>
                        <div className="doc-serif" style={{ fontSize: 13, fontWeight: 600, color: '#1E293B' }}>{item.name}</div>
                        <span className="doc-case-badge" style={{ background: item.bg, color: item.col, border: `1px solid ${item.bdr}` }}>{item.type}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#94A3B8', padding: '8px 0', fontStyle: 'italic' }}>No subsequent treatment references found in judgment text.</div>
                )}

                {/* Footer */}
                <div style={{ marginTop: 24, paddingTop: 14, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div className="doc-sans" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '.15em', color: '#1E3A8A', textTransform: 'uppercase', marginBottom: 4 }}>Jurinex Legal Intelligence Report</div>
                    <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', marginBottom: 2 }}>Generated on {generatedAt || '—'}</div>
                    {(c.importSourceLink || c.sourceUrl || c.officialSourceLink) && (
                      <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', marginBottom: 5, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                        <span>Source:</span>
                        <span>{srcIcon}</span>
                        <span>{srcLabel}</span>
                        <span style={{ color: '#CBD5E1' }}>·</span>
                        <a href={c.importSourceLink || c.sourceUrl || c.officialSourceLink} target="_blank" rel="noopener noreferrer" style={{ color: '#1D4ED8', textDecoration: 'none' }}>Open document</a>
                      </div>
                    )}
                    {onViewFullJudgment && c.canonicalId && !String(c.canonicalId).startsWith('placeholder_') && (
                      <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', marginBottom: 5 }}>
                        <button type="button" onClick={() => onViewFullJudgment(c.canonicalId, c.caseName)} style={{ background: 'none', border: 'none', padding: 0, color: '#1D4ED8', cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>View complete judgment</button>
                      </div>
                    )}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 3 }}>
                      <Dot c="#16A34A" s={5} />
                      <span className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#15803D', letterSpacing: '.07em' }}>AUTHENTICATED RESEARCH DOCUMENT</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="doc-foot-btn"
                      style={{ background: '#F0F9FF', color: '#0369A1', borderColor: '#BAE6FD' }}
                      onClick={() => { setAtcCitId(atcCitId === c.id ? null : c.id); setAtcCase(''); setAtcStatus(null); setAtcPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); }}>
                      + Add to Case Folder
                    </button>
                    {c.verificationStatus === 'YELLOW' && exportWarnId !== c.id ? (
                      <button className="doc-foot-btn" style={{ background: '#FFFBEB', color: '#D97706', borderColor: '#FDE68A' }}
                        onClick={() => setExportWarnId(c.id)}>
                        ⚠ Download PDF
                      </button>
                    ) : c.verificationStatus === 'YELLOW' && exportWarnId === c.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                        <span className="doc-sans" style={{ fontSize: 9, color: '#92400E', maxWidth: 260, textAlign: 'right', lineHeight: 1.45 }}>I acknowledge this citation requires independent verification before use in court submissions.</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="doc-foot-btn" style={{ background: '#D97706', color: W, borderColor: '#D97706' }}
                            onClick={() => { downloadCitationPDF(c, query, generatedAt); setExportWarnId(null); }}>
                            Confirm & Download
                          </button>
                          <button className="doc-foot-btn" style={{ background: W, color: '#64748B', borderColor: '#E2E8F0' }}
                            onClick={() => setExportWarnId(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : c.verificationStatus === 'STALE' ? (
                      <button className="doc-foot-btn" style={{ background: '#FFF7ED', color: '#EA580C', borderColor: '#FED7AA', cursor: 'not-allowed', opacity: 0.7 }}
                        title="Cannot export while freshness check is pending">
                        🔄 Check Pending
                      </button>
                    ) : (
                      <button className="doc-foot-btn" style={{ background: '#1E3A8A', color: W, borderColor: '#1E3A8A' }}
                        onClick={() => downloadCitationPDF(c, query, generatedAt)}>
                        Download PDF
                      </button>
                    )}
                  </div>
                </div>

                {/* Add to Case Folder panel */}
                {atcCitId === c.id && (
                  <div style={{ marginTop: 12, padding: '14px 16px', background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 6 }}>
                    <div className="doc-sans" style={{ fontSize: 10, fontWeight: 700, color: '#0369A1', marginBottom: 8, letterSpacing: '.06em', textTransform: 'uppercase' }}>
                      Add Citation to Case Folder
                    </div>
                    {atcStatus === 'done' ? (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 4, marginBottom: atcPreviewUrl ? 10 : 0 }}>
                          <Dot c="#16A34A" s={7} />
                          <span className="doc-sans" style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>Successfully uploaded as PDF! The citation is now indexed for RAG queries on this case.</span>
                        </div>
                        {atcPreviewUrl && (
                          <div style={{ border: '1px solid #E2E8F0', borderRadius: 6, overflow: 'hidden', marginTop: 4 }}>
                            <div style={{ background: '#1E3A8A', padding: '7px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span className="doc-sans" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#BFDBFE' }}>PDF Preview — Uploaded to Case Folder</span>
                            </div>
                            <iframe
                              src={atcPreviewUrl}
                              style={{ width: '100%', height: 520, border: 'none', display: 'block', background: '#F8FAFC' }}
                              title="Citation Report PDF Preview"
                            />
                          </div>
                        )}
                      </div>
                    ) : atcStatus && atcStatus.error ? (
                      <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 4, fontSize: 11, color: '#991B1B', fontFamily: "'Source Sans 3',sans-serif" }}>
                        {atcStatus.error}
                      </div>
                    ) : (
                      <>
                        <div className="doc-sans" style={{ fontSize: 10, color: '#0C4A6E', marginBottom: 8, lineHeight: 1.5 }}>
                          Select a case from your cases to attach this citation. The report will be chunked, embedded, and indexed for AI search on that case.
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            value={atcCase}
                            onChange={e => { setAtcCase(e.target.value); setAtcStatus(null); }}
                            disabled={atcStatus === 'uploading'}
                            title="Cases you have access to"
                            style={{ flex: 1, minWidth: 200, padding: '7px 10px', border: '1px solid #BAE6FD', borderRadius: 4, fontSize: 11, outline: 'none', background: W, fontFamily: "'Source Sans 3',sans-serif", cursor: 'pointer' }}>
                            <option value="">— Select a case —</option>
                            {cases.map(cs => <option key={cs.id} value={cs.id}>{cs.case_title || cs.name || cs.id}</option>)}
                          </select>
                          <button
                            onClick={() => handleAddToCase(c)}
                            disabled={!atcCase || atcStatus === 'uploading'}
                            style={{ padding: '7px 18px', background: atcCase ? '#0369A1' : '#BAE6FD', color: W, border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: atcCase ? 'pointer' : 'default', fontFamily: "'Source Sans 3',sans-serif", display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                            {atcStatus === 'uploading' ? <><Spin /> Uploading…</> : 'Upload & Index'}
                          </button>
                          <button onClick={() => { setAtcCitId(null); setAtcStatus(null); setAtcPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); }}
                            style={{ padding: '7px 12px', background: 'transparent', color: '#64748B', border: '1px solid #E2E8F0', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontFamily: "'Source Sans 3',sans-serif" }}>
                            Cancel
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

              </div>
            </div>
          );
        })}

        {/* ── UNDER VERIFICATION — PENDING citations ───────────────────── */}
        {pendingCits.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1, height: 1, background: '#DDD6FE' }} />
              <span className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#7C3AED', letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                ⏳ Under Verification ({pendingCits.length})
              </span>
              <div style={{ flex: 1, height: 1, background: '#DDD6FE' }} />
            </div>
            <div style={{ background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ background: '#EDE9FE', padding: '10px 16px', borderBottom: '1px solid #DDD6FE' }}>
                <div className="doc-sans" style={{ fontSize: 11, color: '#4C1D95', lineHeight: 1.55 }}>
                  ⏳ <strong>Under Verification.</strong> These citations were found on the web but could not be confirmed in authoritative sources. A legal expert is reviewing each one. Click "Notify Me" and we'll alert you when resolved.
                </div>
              </div>
              {pendingCits.map((c, i) => {
                const ticketId = c.hitlTicketId || '';
                const nst = notifyStatus[ticketId];
                const ps = c.priorityScore || 0;
                return (
                  <div key={c.id} style={{ padding: '14px 16px', borderBottom: i < pendingCits.length - 1 ? '1px solid #EDE9FE' : 'none', background: W }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div className="doc-serif" style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', marginBottom: 3 }}>{c.caseName || '—'}</div>
                        <div className="doc-sans" style={{ fontSize: 10, color: '#7C3AED', fontWeight: 700, marginBottom: 2 }}>{c.primaryCitation || '—'}</div>
                        {c.importSourceLink && (
                          <div className="doc-sans" style={{ fontSize: 9, color: '#64748B' }}>
                            🌐 Found at: <a href={c.importSourceLink} target="_blank" rel="noopener noreferrer" style={{ color: '#7C3AED', textDecoration: 'none' }}>{c.importSourceLink.slice(0, 60)}{c.importSourceLink.length > 60 ? '…' : ''}</a>
                          </div>
                        )}
                        {ps > 0 && (
                          <div className="doc-sans" style={{ fontSize: 9, color: '#94A3B8', marginTop: 3 }}>
                            Review SLA: <span style={{ fontWeight: 700, color: ps >= 0.85 ? '#DC2626' : ps >= 0.70 ? '#D97706' : '#64748B' }}>{_slaLabel(ps)}</span>
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: '#F5F3FF', border: '1px solid #DDD6FE', borderRadius: 3 }}>
                          <Dot c="#7C3AED" s={5} />
                          <span className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#4C1D95' }}>PENDING</span>
                        </div>
                        {ticketId && (
                          nst === 'done' ? (
                            <span className="doc-sans" style={{ fontSize: 9, color: '#16A34A', fontWeight: 600 }}>✓ You'll be notified</span>
                          ) : (
                            <button className="doc-foot-btn"
                              disabled={nst === 'sending'}
                              style={{ background: '#7C3AED', color: W, borderColor: '#7C3AED', opacity: nst === 'sending' ? 0.6 : 1 }}
                              onClick={() => handleNotifyMe(ticketId)}>
                              {nst === 'sending' ? 'Registering…' : '🔔 Notify Me'}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── UNVERIFIED CITATIONS — RED, collapsed ─────────────────────── */}
        {redCits.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1, height: 1, background: '#FECACA' }} />
              <span className="doc-sans" style={{ fontSize: 9, fontWeight: 700, color: '#DC2626', letterSpacing: '.12em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                ❌ Unverified Citations ({redCits.length})
              </span>
              <div style={{ flex: 1, height: 1, background: '#FECACA' }} />
            </div>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, overflow: 'hidden' }}>
              {/* Collapsed header */}
              <button type="button" onClick={() => setRedExpanded(p => !p)}
                style={{ width: '100%', background: '#FEE2E2', border: 'none', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: redExpanded ? '1px solid #FECACA' : 'none' }}>
                <div className="doc-sans" style={{ fontSize: 11, color: '#991B1B', lineHeight: 1.55, textAlign: 'left' }}>
                  ❌ <strong>Unverified — Manual Check Required.</strong> These citations could not be confirmed in our verified database or external sources. Do not use without independent verification from the primary source.
                </div>
                <span className="doc-sans" style={{ fontSize: 11, color: '#DC2626', flexShrink: 0, marginLeft: 12 }}>{redExpanded ? '▲ Hide' : '▼ Show'}</span>
              </button>
              {redExpanded && redCits.map((c, i) => (
                <div key={c.id} style={{ padding: '14px 16px', borderBottom: i < redCits.length - 1 ? '1px solid #FECACA' : 'none', background: W }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div className="doc-serif" style={{ fontSize: 13, fontWeight: 600, color: '#0F172A', marginBottom: 3 }}>{c.caseName || '—'}</div>
                      <div className="doc-sans" style={{ fontSize: 10, color: '#DC2626', fontWeight: 700, marginBottom: 4 }}>{c.primaryCitation || '—'}</div>
                      {c.failureReason && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', background: '#FFF5F5', border: '1px solid #FECACA', borderRadius: 4, padding: '7px 10px' }}>
                          <span style={{ fontSize: 12, flexShrink: 0 }}>⚠</span>
                          <div className="doc-sans" style={{ fontSize: 10, color: '#991B1B', lineHeight: 1.55 }}>{c.failureReason}</div>
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 3, marginBottom: 6 }}>
                        <Dot c="#DC2626" s={5} />
                        <span className="doc-sans" style={{ fontSize: 8, fontWeight: 700, color: '#991B1B' }}>UNVERIFIED</span>
                      </div>
                      <div>
                        <button className="doc-foot-btn"
                          style={{ background: '#FEF2F2', color: '#DC2626', borderColor: '#FECACA', fontSize: 9 }}
                          title="Export blocked — this citation failed verification. Do not use in court submissions."
                          onClick={() => alert('⚠ Export blocked.\n\nThis citation could not be verified. Do not use in court submissions without independent verification from the primary source.')}>
                          ⛔ Export Blocked
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   AGENT LOG PANEL
══════════════════════════════════════════════════ */
function getLevelStyle(level) {
  switch (level) {
    case 'ERROR':
      return { color: '#DC2626', left: '#DC2626' };
    case 'WARNING':
      return { color: '#B45309', left: '#F59E0B' };
    case 'DEBUG':
      return { color: '#9CA3AF', left: 'transparent' };
    case 'INFO':
    default:
      return { color: '#374151', left: 'transparent' };
  }
}

// Extract count badges from metadata
function MetaBadges({ meta }) {
  if (!meta) return null;
  const badges = [];
  const pairs = [
    ['local_count', '🏛', '#10B981'],
    ['ik_count', '📚', '#3B82F6'],
    ['google_count', '🌐', '#F59E0B'],
    ['ik_fetched', '📥', '#3B82F6'],
    ['google_fetched', '📥', '#F59E0B'],
    ['ik_ingested', '✅', '#3B82F6'],
    ['google_ingested', '✅', '#F59E0B'],
    ['total_ingested', '📦', '#8B5CF6'],
    ['validated', '✓', '#10B981'],
    ['flagged', '⚠', '#F59E0B'],
    ['rejected', '✗', '#EF4444'],
    ['approved', '✅', '#10B981'],
    ['quarantined', '🚫', '#EF4444'],
    ['citation_count', '📜', '#14B8A6'],
    ['keyword_sets_count', '🔑', '#EC4899'],
    ['count', '#', '#64748B'],
  ];
  for (const [key, icon, color] of pairs) {
    if (meta[key] !== undefined && meta[key] !== null) {
      badges.push(
        <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: color + '22', border: `1px solid ${color}55`, borderRadius: 4, padding: '0 5px', fontSize: 9, color, fontWeight: 700, marginLeft: 4 }}>
          {icon} {meta[key]}
        </span>
      );
    }
  }
  return badges.length ? <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 2, marginLeft: 4 }}>{badges}</span> : null;
}

function AgentLogPanel({ logs, runId }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const PIPELINE_STAGES = [
    { id: 'start', label: 'Start', icon: '🧠', agent: 'root' },
    { id: 'keyword_extractor', label: 'Keywords', icon: '🔑', agent: 'keyword_extractor' },
    { id: 'watchdog', label: 'Watchdog', icon: '🐕', agent: 'watchdog' },
    { id: 'fetcher', label: 'Fetcher', icon: '📡', agent: 'fetcher' },
    { id: 'clerk', label: 'Clerk', icon: '📋', agent: 'clerk' },
    { id: 'librarian', label: 'Librarian', icon: '📚', agent: 'librarian' },
    { id: 'auditor', label: 'Auditor', icon: '🔍', agent: 'auditor' },
    { id: 'report_builder', label: 'Report', icon: '🏗', agent: 'report_builder' },
  ];

  const reachedAgents = new Set(logs.map(l => l.agent_name));
  const reachedStages = new Set(logs.map(l => l.stage));
  const lastLog = logs.length > 0 ? logs[logs.length - 1] : null;
  const activeAgent = lastLog?.agent_name;

  // Compute live stats from metadata
  const statsByAgent = {};
  for (const log of logs) {
    if (log.metadata) {
      statsByAgent[log.agent_name] = { ...(statsByAgent[log.agent_name] || {}), ...log.metadata };
    }
  }

  return (
    <div style={{ width: '100%', marginBottom: 14, animation: 'fdUp .25s ease', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(90deg,#F0FDF4,#EFF6FF)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #E2E8F0' }}>
        <Spin />
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0F766E', letterSpacing: '.04em' }}>PIPELINE RUNNING</span>
        <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 6 }}>— {logs.length} log{logs.length !== 1 ? 's' : ''}</span>
        {runId && <span style={{ fontSize: 9, color: '#CBD5E1', marginLeft: 'auto', fontFamily: 'monospace' }}>{runId.slice(0, 8)}…</span>}
      </div>

      {/* Stage progress bar */}
      <div style={{ background: '#F8FAFC', padding: '10px 14px', display: 'flex', gap: 0, alignItems: 'center', overflowX: 'auto', borderBottom: '1px solid #E2E8F0' }}>
        {PIPELINE_STAGES.map((s, i) => {
          const done = reachedAgents.has(s.agent) || reachedStages.has(s.id);
          const active = activeAgent === s.agent || (s.id === 'fetcher' && activeAgent === 'fetcher');
          const color = '#94A3B8';
          return (
            <React.Fragment key={s.id}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 54 }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: done ? color + '22' : active ? color + '15' : '#F1F5F9',
                  border: `2px solid ${done ? color : active ? color : '#CBD5E1'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: done ? 14 : 13, transition: 'all .3s',
                  boxShadow: active ? `0 0 8px ${color}55` : 'none',
                }}>
                  {done ? '✓' : s.icon}
                </div>
                <span style={{ fontSize: 8, color: done ? color : active ? color : '#94A3B8', fontWeight: done || active ? 700 : 400, whiteSpace: 'nowrap' }}>{s.label}</span>
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div style={{ flex: 1, height: 2, background: done ? color : '#E2E8F0', minWidth: 8, marginBottom: 14, transition: 'background .5s' }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Log stream */}
      <div style={{ background: '#FFFFFF', maxHeight: 320, overflowY: 'auto', padding: '6px 0', fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}>
        {logs.length === 0 ? (
          <div style={{ padding: '16px 14px', fontSize: 11, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Spin size="small" /> Waiting for pipeline to start…
          </div>
        ) : (
          logs.map((log, i) => {
            const ls = getLevelStyle(log.log_level);
            const icon = '⚙️';
            const agentColor = '#64748B';
            const ts = log.created_at
              ? new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
              : '';
            const isSection = log.message?.startsWith('✅') || log.message?.startsWith('🎉');

            if (log.metadata && log.metadata.type === 'AGENT_PROMPT_INFO') {
              return (
                <div key={log.id || i} style={{ margin: '14px 14px', padding: '12px 16px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderLeft: '3px solid #6366F1', borderRadius: 8, fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: 11, color: '#334155' }}>
                  <div style={{ fontWeight: 800, color: '#0F172A', marginBottom: 10, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {icon} {log.metadata.agent}
                  </div>
                  {log.metadata.prompt_key && <div style={{ marginBottom: 4 }}><span style={{ color: '#64748B', display: 'inline-block', width: 90 }}>Prompt Key:</span> <b>{log.metadata.prompt_key}</b></div>}
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ color: '#64748B', display: 'inline-block', width: 90 }}>Source:</span> <b>{log.metadata.source}</b> {log.metadata.source?.toUpperCase() === 'DATABASE' ? '🟢' : log.metadata.source?.toUpperCase() === 'DEFAULT' ? '🟡' : ''}
                  </div>
                  {log.metadata.model && <div style={{ marginBottom: 4 }}><span style={{ color: '#64748B', display: 'inline-block', width: 90 }}>Model:</span> {log.metadata.model}</div>}
                  {(log.metadata.temperature !== undefined && log.metadata.max_tokens !== undefined) && (
                    <div style={{ marginBottom: 4 }}><span style={{ color: '#64748B', display: 'inline-block', width: 90 }}>Config:</span> temp={log.metadata.temperature} | max_tokens={log.metadata.max_tokens}</div>
                  )}
                  <div><span style={{ color: '#64748B', display: 'inline-block', width: 90 }}>Runtime:</span> {log.metadata.runtime?.toFixed(2)}s</div>
                </div>
              );
            }

            return (
              <div key={log.id || i} style={{
                padding: isSection ? '6px 14px' : '3px 14px',
                borderLeft: `3px solid ${ls.left}`,
                display: 'flex', gap: 8, alignItems: 'flex-start',
                borderBottom: '1px solid #F1F5F9',
                background: isSection ? agentColor + '0D' : 'transparent',
              }}>
                <span style={{ fontSize: 11, flexShrink: 0, marginTop: 2, opacity: 0.9 }}>{icon}</span>
                <span style={{ fontSize: 9, color: '#0EA5E9', flexShrink: 0, minWidth: 56, marginTop: 3, letterSpacing: '.02em' }}>{ts}</span>
                <span style={{ fontSize: 8, color: agentColor, flexShrink: 0, minWidth: 68, fontWeight: 700, textTransform: 'uppercase', marginTop: 3, letterSpacing: '.06em' }}>{log.agent_name}</span>
                <span style={{ fontSize: 11, color: ls.color, lineHeight: 1.6, wordBreak: 'break-word', flex: 1 }}>
                  {log.message}
                  <MetaBadges meta={log.metadata} />
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════
   CASE SEARCH TAB
══════════════════════════════════════════════════ */
// All India courts — Supreme Court and major High Courts
const COURTS = [
  'Supreme Court',
  'Delhi HC',
  'Bombay HC',
  'Madras HC',
  'Kolkata HC',
  'Karnataka HC',
  'Gujarat HC',
  'Allahabad HC',
  'Punjab & Haryana HC',
  'Rajasthan HC',
  'Telangana HC',
  'Andhra Pradesh HC',
  'Kerala HC',
  'Madhya Pradesh HC',
  'Chhattisgarh HC',
  'Jharkhand HC',
  'Bihar HC',
  'Uttarakhand HC',
  'Himachal Pradesh HC',
  'Orissa HC',
  'Patna HC',
  'Gauhati HC',
  'Jammu & Kashmir HC',
  'Sikkim HC',
  'Manipur HC',
  'Meghalaya HC',
  'Tripura HC',
  'Mizoram HC',
  'Nagaland HC',
  'Goa HC',
];
const AREAS = ['Constitutional', 'Commercial', 'IT Law', 'Criminal', 'Family', 'Labour', 'Environmental', 'Tax', 'IPR', 'Administrative', 'Consumer', 'Arbitration', 'Company Law', 'Insolvency', 'Property', 'Tort'];
const AUDIT_BADGE = {
  VERIFIED: { label: 'Verified', dot: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', color: '#15532D' },
  VERIFIED_WITH_WARNINGS: { label: 'Verified', dot: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', color: '#15532D' },
  NEEDS_REVIEW: { label: 'Review', dot: '#D97706', bg: '#FFFBEB', border: '#FDE68A', color: '#92400E' },
  QUARANTINED: { label: 'Unverified', dot: '#DC2626', bg: '#FEF2F2', border: '#FECACA', color: '#991B1B' },
  not_audited: { label: 'Unverified', dot: '#DC2626', bg: '#FEF2F2', border: '#FECACA', color: '#991B1B' },
};

function StatusBadge({ status }) {
  const cfg = AUDIT_BADGE[status] || AUDIT_BADGE.not_audited;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700, color: cfg.color }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
      {cfg.label}
    </span>
  );
}

function CaseSearchTab() {
  const [query, setQuery] = useState('');
  const [courtFilter, setCourtFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [courtNameFilter, setCourtNameFilter] = useState(''); // free-text filter for court name
  const [areaLawFilter, setAreaLawFilter] = useState('');    // free-text filter for area of law
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vault, setVault] = useState([]); // saved canonical IDs

  // Apply court name and area of law text filters client-side
  const displayResults = (() => {
    let out = results;
    const courtLower = (courtNameFilter || '').trim().toLowerCase();
    const areaLower = (areaLawFilter || '').trim().toLowerCase();
    if (courtLower) {
      out = out.filter(r => (r.court || '').toLowerCase().includes(courtLower));
    }
    if (areaLower) {
      out = out.filter(r => (r.area || '').toLowerCase().includes(areaLower));
    }
    return out;
  })();

  // Load all on mount
  useEffect(() => { doSearch('', '', ''); }, []);

  const doSearch = useCallback(async (q, court, area) => {
    setLoading(true); setError(null);
    try {
      const data = await citationApi.searchJudgements({ q, court, area, limit: 200 });
      setResults(data.results || []);
      setTotal(data.total ?? (data.results || []).length);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => doSearch(query, courtFilter, areaFilter);

  const toggleVault = (id) => setVault(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);

  const matchColor = (pct) => {
    if (pct === null || pct === undefined) return g400;
    if (pct >= 80) return '#16A34A';
    if (pct >= 60) return '#D97706';
    return '#DC2626';
  };

  const courtMap = {};
  results.forEach(r => { if (r.court) courtMap[r.court] = (courtMap[r.court] || 0) + 1; });
  const areaMap = {};
  results.forEach(r => { if (r.area) areaMap[r.area] = (areaMap[r.area] || 0) + 1; });

  const triggerDownload = (blob, filename) => {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 200);
    } catch (e) {
      console.error('[Export] Download failed:', e);
    }
  };
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(displayResults, null, 2)], { type: 'application/json' });
    triggerDownload(blob, 'case-search-results.json');
  };
  const exportCSV = () => {
    const rows = vault.length ? displayResults.filter(r => vault.includes(r.canonicalId)) : displayResults;
    const csv = ['Case Name,Citation,Court,Year,Area,Status'].concat(rows.map(r =>
      [r.caseName, r.primaryCitation, r.court, r.year, r.area, r.auditStatus].map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')
    )).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, 'case-search-results.csv');
  };
  // Complete citation report — all AI citation report points
  const exportCompleteReport = () => {
    const rows = vault.length ? displayResults.filter(r => vault.includes(r.canonicalId)) : displayResults;
    const headers = 'Canonical ID,Case Name,Citation,Court,Coram,Date,Year,Area,Statutes,Ratio,Excerpt Para,Excerpt,Status,Confidence,Match %,Source,Source URL';
    const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
    const csv = [headers].concat(rows.map(r => [
      r.canonicalId, r.caseName, r.primaryCitation, r.court, r.coram,
      r.dateOfJudgment ?? r.year, r.year, r.area,
      (Array.isArray(r.statutes) ? r.statutes.join('; ') : r.statutes) ?? '',
      r.ratio ?? '', r.excerptPara ?? '', r.excerpt ?? '',
      r.auditStatus ?? '', r.confidence ?? '', r.matchPct ?? '', r.source ?? '',
      r.sourceUrl ?? ''
    ].map(escapeCsv).join(','))).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, 'complete-citation-report.csv');
  };

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{ width: 210, flexShrink: 0, borderRight: `1px solid ${g200}`, background: g50, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '16px 12px', gap: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: N, display: 'flex', alignItems: 'center', gap: 6 }}>🔍 Filters</div>

        {/* Court name filter — type to filter displayed results */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Court Name</div>
          <input
            value={courtNameFilter}
            onChange={e => setCourtNameFilter(e.target.value)}
            placeholder="e.g. Delhi, Supreme"
            style={{ width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 5, border: `1px solid ${g300}`, outline: 'none', color: g700, marginBottom: 6 }}
          />
        </div>

        {/* Court filter — preset list */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Court (preset)</div>
          <div style={{ maxHeight: 140, overflowY: 'auto', marginBottom: 4 }}>
            {['', ...COURTS].map(c => (
              <div key={c || 'all'} onClick={() => { setCourtFilter(c); doSearch(query, c, areaFilter); }}
                style={{ padding: '5px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontWeight: courtFilter === c ? 700 : 400, color: courtFilter === c ? N : g600, background: courtFilter === c ? g200 : 'transparent', marginBottom: 2 }}>
                {c || 'All Courts'}
              </div>
            ))}
          </div>
        </div>

        {/* Area of law filter — type to filter displayed results */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 6 }}>Area of Law</div>
          <input
            value={areaLawFilter}
            onChange={e => setAreaLawFilter(e.target.value)}
            placeholder="e.g. Criminal, Commercial"
            style={{ width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 5, border: `1px solid ${g300}`, outline: 'none', color: g700, marginBottom: 6 }}
          />
          <div style={{ maxHeight: 120, overflowY: 'auto' }}>
            {['', ...AREAS].map(a => (
              <div key={a || 'all'} onClick={() => { setAreaFilter(a); doSearch(query, courtFilter, a); }}
                style={{ padding: '5px 8px', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontWeight: areaFilter === a ? 700 : 400, color: areaFilter === a ? N : g600, background: areaFilter === a ? g200 : 'transparent', marginBottom: 2 }}>
                {a || 'All Areas'}
              </div>
            ))}
          </div>
        </div>

        {/* Citation Vault */}
        <div style={{ borderTop: `1px solid ${g200}`, paddingTop: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>🗄 Citation Vault</div>
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: N }}>{displayResults.length}</div>
            <div style={{ fontSize: 10, color: g500 }}>{courtNameFilter || areaLawFilter ? 'Filtered citations' : 'Citations'}</div>
          </div>
          <button onClick={exportJSON}
            style={{ width: '100%', padding: '6px 0', background: N, color: W, borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
            🗃 Export JSON
          </button>
          <button onClick={exportCSV}
            style={{ width: '100%', padding: '6px 0', background: N, color: W, borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
            📋 Export CSV
          </button>
          <button onClick={exportCompleteReport}
            style={{ width: '100%', padding: '6px 0', background: '#166534', color: W, borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 600, cursor: 'pointer', marginBottom: 5 }}>
            📄 Complete Citation Report
          </button>
          <button onClick={() => setVault([])}
            style={{ width: '100%', padding: '6px 0', background: W, color: '#DC2626', borderRadius: 6, border: '1px solid #FECACA', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            🗑 Reset Vault
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        {/* Search bar */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${g200}`, display: 'flex', gap: 10 }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search cases, statutes, holdings… (AND, OR, NOT)"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: `1px solid ${g300}`, fontSize: 13, outline: 'none', color: g700 }}
          />
          <button onClick={handleSearch}
            style={{ padding: '10px 22px', background: N, color: W, borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            🔍 Search
          </button>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          {loading && <div style={{ textAlign: 'center', padding: 40, color: g400, fontSize: 13 }}><Spin /> Loading…</div>}
          {error && <div style={{ color: R, fontSize: 13, padding: 20 }}>{error}</div>}
          {!loading && !error && (
            <>
              <div style={{ fontSize: 12, color: g500, marginBottom: 10 }}>{displayResults.length} results{(courtNameFilter || areaLawFilter) ? ' (filtered)' : ''}</div>
              {displayResults.length === 0 && <div style={{ color: g400, fontSize: 13, textAlign: 'center', padding: 40 }}>No cases found.</div>}
              {displayResults.map((r, i) => {
                const inVault = vault.includes(r.canonicalId);
                const pct = r.matchPct;
                const borderColor = pct >= 80 ? '#16A34A' : pct >= 60 ? '#D97706' : pct >= 40 ? '#DC2626' : g300;
                return (
                  <div key={r.canonicalId || i} style={{ border: `1px solid ${g200}`, borderLeft: `3px solid ${borderColor}`, borderRadius: 8, padding: '12px 16px', marginBottom: 8, background: W, display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', transition: 'box-shadow .15s' }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px #0002'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                    onClick={() => toggleVault(r.canonicalId)}>
                    {/* Vault checkbox */}
                    <div style={{ flexShrink: 0, marginTop: 2 }}>
                      <span style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${inVault ? '#16A34A' : g300}`, background: inVault ? '#16A34A' : W, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: W }}>
                        {inVault ? '✓' : ''}
                      </span>
                    </div>
                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: N, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.caseName}</div>
                      {r.primaryCitation && <div style={{ fontSize: 11, color: g500, marginBottom: 5 }}>{r.primaryCitation}</div>}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <StatusBadge status={r.auditStatus} />
                        {r.court && <span style={{ fontSize: 10, color: g600, background: g100, borderRadius: 4, padding: '2px 6px' }}>{r.court}</span>}
                        {r.year && <span style={{ fontSize: 10, color: g600, background: g100, borderRadius: 4, padding: '2px 6px' }}>{r.year}</span>}
                        {r.area && <span style={{ fontSize: 10, color: B, background: BS, borderRadius: 4, padding: '2px 6px' }}>{r.area}</span>}
                      </div>
                    </div>
                    {/* Match % */}
                    {pct !== null && pct !== undefined && (
                      <div style={{ flexShrink: 0, textAlign: 'right' }}>
                        <div style={{ fontSize: 20, fontWeight: 800, color: matchColor(pct) }}>{pct}%</div>
                        <div style={{ fontSize: 9, color: g400, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Match</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>

    {/* ── Original Court Copy PDF Modal ── */}
    {origDocModal && (
      <div
        onClick={() => setOrigDocModal(null)}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.72)', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: '92vw', maxWidth: 1100, height: '88vh',
            background: '#fff', borderRadius: 10, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
          }}
        >
          {/* Modal header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px', background: '#1E3A8A', color: '#fff', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16 }}>📄</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em' }}>
                  {origDocModal.isPdf ? 'Original Court Copy (PDF)' : 'Original Court Document'}
                </div>
                {origDocModal.caseName && (
                  <div style={{ fontSize: 10, opacity: 0.8, marginTop: 1 }}>{origDocModal.caseName}</div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <a
                href={origDocModal.url}
                download
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 11px', background: 'rgba(255,255,255,0.15)',
                  color: '#fff', borderRadius: 4, textDecoration: 'none',
                  fontSize: 11, fontWeight: 600, border: '1px solid rgba(255,255,255,0.3)',
                }}
              >
                ⬇ Download
              </a>
              <a
                href={origDocModal.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '5px 11px', background: 'rgba(255,255,255,0.15)',
                  color: '#fff', borderRadius: 4, textDecoration: 'none',
                  fontSize: 11, fontWeight: 600, border: '1px solid rgba(255,255,255,0.3)',
                }}
              >
                ↗ New Tab
              </a>
              <button
                onClick={() => setOrigDocModal(null)}
                style={{
                  background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff', borderRadius: 4, padding: '5px 11px',
                  cursor: 'pointer', fontSize: 13, fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>
          </div>
          {/* PDF iframe viewer */}
          <iframe
            src={origDocModal.url + (origDocModal.isPdf ? '#toolbar=1&navpanes=1' : '')}
            title="Original Court Copy"
            style={{ flex: 1, border: 'none', width: '100%' }}
          />
        </div>
      </div>
    )}
    </>
  );
}

/* ══════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════ */
export default function CitationReportPage({ embedded = false }) {
  const { reportId } = useParams();
  const navigate = useNavigate();

  // Firm visibility: analytics only for FIRM_ADMIN; team for both FIRM_ADMIN and FIRM_USER
  const _storedUser = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
  const _accountType = (_storedUser?.account_type || '').toUpperCase();
  const isFirmAdmin = _accountType === 'FIRM_ADMIN';
  const isFirmUser = _accountType === 'FIRM_ADMIN' || _accountType === 'FIRM_USER';

  // tabs — analytics only for firm admins; team for all firm users (admins see full firm, members see shared-with-me)
  const TABS = [
    { id: 'research', label: '⚖️ AI Research' },
    { id: 'search', label: '🔍 Case Search' },
    { id: 'map', label: '🕸️ Citations Map' },
    ...(isFirmAdmin ? [{ id: 'analytics', label: '📊 Analytics' }] : []),
    ...(isFirmUser ? [{ id: 'team', label: '👥 Team' }] : []),
  ];
  const [activeTab, setActiveTab] = useState('research');

  // chat
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const chatRef = useRef(null);

  // report
  const [report, setReport] = useState(null);
  const [query, setQuery] = useState('');
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [showReport, setShowReport] = useState(false);

  // live agent logs
  const [agentLogs, setAgentLogs] = useState([]);
  const [runId, setRunId] = useState(null);
  const [showFetchLog, setShowFetchLog] = useState(false);
  const [reportLogs, setReportLogs] = useState([]);
  const [reportLogsLoading, setReportLogsLoading] = useState(false);
  const logPollRef = useRef(null);
  const statusPollRef = useRef(null);
  const [fullJudgmentModal, setFullJudgmentModal] = useState(null); // null | { loading } | { error } | { caseName, fullText, sourceUrl }

  // citation graph (for Citations Map tab)
  const [citationGraph, setCitationGraph] = useState(null);
  const [citationGraphLoading, setCitationGraphLoading] = useState(false);
  const [citationGraphError, setCitationGraphError] = useState(null);

  // enterprise analytics (admin tab)
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(null);

  // team workspace tab
  const [teamMembers, setTeamMembers] = useState([]);
  const [teamReports, setTeamReports] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamSelCase, setTeamSelCase] = useState('');

  // ── share report modal ──
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMembers, setShareMembers] = useState([]);
  const [shareMembersLoading, setShareMembersLoading] = useState(false);
  const [shareSelected, setShareSelected] = useState(new Set()); // Set<user_id string>
  const [shareEmailInput, setShareEmailInput] = useState('');
  const [shareEmailAdded, setShareEmailAdded] = useState([]); // [{email}]
  const [shareSaving, setShareSaving] = useState(false);
  const [shareDone, setShareDone] = useState(false);
  const [shareError, setShareError] = useState(null);
  const [shareExisting, setShareExisting] = useState([]); // current shared_with list

  // sidebar / case context
  const [cases, setCases] = useState([]);
  const [selCase, setSelCase] = useState('');
  const [selCaseName, setSelCaseName] = useState('');
  const [casesLoading, setCasesLoading] = useState(false);
  const [vaultCount, setVaultCount] = useState(0);
  const [queryCount, setQueryCount] = useState(0);
  const [refDocs, setRefDocs] = useState([]);
  const fileRef = useRef(null);
  // case-specific report history
  const [caseReports, setCaseReports] = useState([]);
  const [caseReportsLoading, setCaseReportsLoading] = useState(false);
  // Report auto-save to case folder: 'uploading' | 'processing' | 'done' | { error: string }
  const [reportSaveToCaseStatus, setReportSaveToCaseStatus] = useState(null);
  const [reportSaveToCaseProgress, setReportSaveToCaseProgress] = useState(0);

  const SUGS = ['What are the grounds for anticipatory bail in India?', 'Explain right to privacy under Indian Constitution', 'Legal position on internet shutdowns in India', 'Is triple talaq constitutional?', 'Key IBC cases on resolution plan approval', 'Environmental liability principles in Indian law'];

  const loadCases = useCallback(() => {
    setCasesLoading(true);
    documentApi.getCases().then(r => { const l = r?.cases ?? r?.data ?? (Array.isArray(r) ? r : []); setCases(Array.isArray(l) ? l : []); }).catch(() => setCases([])).finally(() => setCasesLoading(false));
  }, []);

  useEffect(() => { loadCases(); }, [loadCases]);

  useEffect(() => {
    if (!reportId) return;
    citationApi.getReport(reportId).then(d => { setReport(d); setQuery(d?.query || ''); setShowReport(true); }).catch(() => { });
  }, [reportId]);

  // Load case-specific reports when case selection changes
  useEffect(() => {
    if (!selCase) { setCaseReports([]); return; }
    const _cu = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
    const uid = String(_cu.id || _cu.user_id || localStorage.getItem('userId') || 'anonymous');
    setCaseReportsLoading(true);
    citationApi.listReportsByCase(selCase, uid)
      .then(r => setCaseReports(r?.reports || []))
      .catch(() => setCaseReports([]))
      .finally(() => setCaseReportsLoading(false));
  }, [selCase]);

  useEffect(() => { chatRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, sending]);

  // Load enterprise analytics when Analytics tab is opened
  useEffect(() => {
    if (activeTab !== 'analytics') return;
    if (analytics && !analyticsError) return;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    citationApi.getEnterpriseAnalytics()
      .then(d => setAnalytics(d))
      .catch(err => setAnalyticsError(err.message || 'Failed to load analytics'))
      .finally(() => setAnalyticsLoading(false));
  }, [activeTab, analytics, analyticsError]);

  // Load team workspace data when Team tab opens (refetch each time so newly shared reports appear)
  useEffect(() => {
    if (activeTab !== 'team') return;
    setTeamLoading(true);
    citationApi.getFirmMembers()
      .catch(() => ({ members: [] }))
      .then(membersRes => {
        const members = membersRes.members || [];
        setTeamMembers(members);
        const memberIds = members.map(m => String(m.user_id)).filter(Boolean);
        return citationApi.getTeamReports(memberIds, teamSelCase || null).catch(() => ({ reports: [] }));
      })
      .then(reportsRes => setTeamReports(reportsRes.reports || []))
      .finally(() => setTeamLoading(false));
  }, [activeTab, teamSelCase]);

  // ── Share handlers ──
  const handleOpenShare = useCallback(async (reportId) => {
    setShareOpen(true);
    setShareDone(false);
    setShareError(null);
    setShareEmailInput('');
    // Load firm members if not yet loaded
    if (!shareMembers.length && !shareMembersLoading) {
      setShareMembersLoading(true);
      try {
        const res = await citationApi.getFirmMembers();
        const _storedU = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
        const myId = String(_storedU.id || '');
        setShareMembers((res.members || []).filter(m => String(m.user_id) !== myId));
      } catch { /* ignore */ }
      setShareMembersLoading(false);
    }
    // Load existing shares
    try {
      const res = await citationApi.getReportShares(reportId);
      const existing = res.shared_with || [];
      setShareExisting(existing);
      setShareSelected(new Set(existing.map(e => String(e.user_id)).filter(Boolean)));
      setShareEmailAdded(existing.filter(e => !e.user_id && e.email).map(e => ({ email: e.email })));
    } catch { /* ignore */ }
  }, [shareMembers.length, shareMembersLoading]);

  const handleShareAddEmail = () => {
    const email = shareEmailInput.trim();
    if (!email || !/\S+@\S+\.\S+/.test(email)) return;
    if (shareEmailAdded.find(e => e.email === email)) return;
    setShareEmailAdded(prev => [...prev, { email }]);
    setShareEmailInput('');
  };

  const handleShareSend = async (reportId) => {
    if (shareSaving) return;
    setShareSaving(true);
    try {
      const memberMap = Object.fromEntries(shareMembers.map(m => [String(m.user_id), m]));
      const selectedEmails = new Set([...shareSelected].map(uid => (memberMap[uid] || {}).email).filter(Boolean));
      const entries = [
        // Firm members — only valid numeric/string user_ids (skip "null" / undefined)
        ...[...shareSelected]
          .filter(uid => uid && uid !== 'null' && uid !== 'undefined')
          .map(uid => {
            const m = memberMap[uid] || {};
            return { user_id: uid, email: m.email || '', username: m.username || m.email || uid };
          }),
        // Email-only additions — omit user_id entirely, skip if already covered by a selected member
        ...shareEmailAdded
          .filter(e => e.email && !selectedEmails.has(e.email))
          .map(e => ({ email: e.email, username: e.email })),
      ];
      await citationApi.shareReport(reportId, entries);
      setShareExisting(entries);
      setShareDone(true);
      setShareError(null);
      setTimeout(() => setShareOpen(false), 1800);
    } catch (err) {
      console.error('[Share] Failed to share report:', err);
      setShareDone(false);
      setShareError(err?.message || 'Failed to share report. Please try again.');
    }
    setShareSaving(false);
  };

  const addMsg = (role, text, extra = {}) => setMsgs(p => [...p, { role, text, ts: Date.now(), ...extra }]);

  const stopPolling = useCallback(() => {
    if (logPollRef.current) { clearInterval(logPollRef.current); logPollRef.current = null; }
    if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
  }, []);

  useEffect(() => {
    return () => Object.values({ logPollRef, statusPollRef }).forEach(ref => {
      if (ref.current) clearInterval(ref.current);
    });
  }, []);

  const handleSend = async (force = false) => {
    const q = (input).trim();
    const hasContext = Boolean(selCase) || refDocs.length > 0;
    if (sending) return;
    if (!q && !hasContext) {
      addMsg('error', 'Please enter a query, select a case, or attach reference documents before generating a report.');
      return;
    }
    setInput('');
    addMsg('user', q || 'Generate verified citation report from case context.');
    setSending(true); setGenerating(true); setReportError(null);
    setReportSaveToCaseStatus(null);
    setReportSaveToCaseProgress(0);
    setAgentLogs([]); setRunId(null);
    setQueryCount(p => p + 1);
    stopPolling();

    try {
      // Resolve actual user ID from stored user object (auth stores under 'user' key as JSON)
      const _u = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
      const uid = String(_u.id || _u.user_id || localStorage.getItem('userId') || localStorage.getItem('user_id') || 'anonymous');
      let ctx = null;
      if (selCase) {
        try {
          const cr = await documentApi.getCaseById(selCase);
          const cd = cr?.case ?? cr;
          const fn = cd?.folders?.[0]?.name ?? cd?.folders?.[0]?.originalname;
          if (fn) {
            const fr = await documentApi.getDocumentsInFolder(fn);
            const files = fr?.files ?? fr?.data ?? (Array.isArray(fr) ? fr : []);
            ctx = (Array.isArray(files) ? files : []).map(f => ({ name: f.originalname || f.name || 'doc', snippet: (f.summary || f.full_text_content || '').slice(0, 4000) })).filter(f => f.snippet || f.name);
          }
        } catch (e) { console.warn(e); }
      }
      // If a case is selected, ONLY use that case's files as context.
      // Reference docs are used only when no case is selected.
      if (!selCase && refDocs.length > 0) {
        ctx = (ctx || []).concat(
          refDocs.map(d => ({ name: d.name, snippet: d.content.slice(0, 4000) })),
        );
      }
      if ((!ctx || ctx.length === 0) && selCaseName) ctx = [{ name: 'case', snippet: selCaseName }];

      // Start async pipeline — get run_id immediately
      const startData = await citationApi.startReport(q, uid, selCase || null, ctx);
      const rid = startData.run_id;
      setRunId(rid);

      // Poll agent logs every 1.5s (incremental, timestamp-based)
      let lastLogTime = '';
      logPollRef.current = setInterval(async () => {
        try {
          const logData = await citationApi.getRunLogs(rid, lastLogTime);
          const newLogs = logData.logs || [];
          if (newLogs.length > 0) {
            lastLogTime = newLogs[newLogs.length - 1].created_at;
            setAgentLogs(prev => [...prev, ...newLogs]);
          }
        } catch (_) { }
      }, 1500);

      // Poll status every 3s
      statusPollRef.current = setInterval(async () => {
        try {
          const st = await citationApi.getRunStatus(rid);
          if (st.status === 'completed' || st.status === 'failed') {
            stopPolling();
            // Final log fetch
            const finalLogs = await citationApi.getRunLogs(rid, lastLogTime);
            if (finalLogs.logs?.length) setAgentLogs(prev => [...prev, ...finalLogs.logs]);

            if (st.status === 'completed') {
              let rpt = null;
              if (st.report_format) {
                rpt = { report_id: st.report_id, report_format: st.report_format };
              } else if (st.report_id) {
                rpt = await citationApi.getReport(st.report_id);
              }
              if (rpt) {
                setReport(rpt); setQuery(q);
                setVaultCount(p => p + (rpt?.report_format?.citations?.length || 0));
                addMsg('assistant', `✅ Generated **${rpt?.report_format?.citations?.length || 0} verified citations** for your query.${selCase ? ` Tagged to case.` : ''}`, { reportId: st.report_id });
                if (st.report_id) navigate(`/citation/reports/${st.report_id}`, { replace: true });
                if (selCase) {
                  citationApi.listReportsByCase(selCase, uid).then(r => setCaseReports(r?.reports || [])).catch(() => { });
                  // Auto-upload report as PDF to the selected case folder; show uploading/processing until done
                  (async () => {
                    setReportSaveToCaseStatus('uploading');
                    setReportSaveToCaseProgress(0);
                    try {
                      const cr = await documentApi.getCaseById(selCase);
                      const cd = cr?.case ?? cr;
                      const folderName = cd?.folders?.[0]?.name ?? cd?.folders?.[0]?.originalname;
                      if (!folderName) {
                        setReportSaveToCaseStatus({ error: 'No folder found for this case.' });
                        return;
                      }
                      const fullHtml = buildFullReportHtml(rpt.report_format, q);
                      const reportIframe = document.createElement('iframe');
                      reportIframe.style.cssText = 'position:absolute;left:-9999px;width:210mm;height:297mm;border:none;visibility:hidden';
                      document.body.appendChild(reportIframe);
                      reportIframe.contentDocument.open();
                      reportIframe.contentDocument.write(fullHtml);
                      reportIframe.contentDocument.close();
                      await new Promise(resolve => setTimeout(resolve, 900));
                      const blob = await html2pdf()
                        .set({ margin: 10, filename: '', enableLinks: false, html2canvas: { scale: 1.5, useCORS: true, logging: false }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } })
                        .from(reportIframe.contentDocument.body)
                        .outputPdf('blob');
                      document.body.removeChild(reportIframe);
                      const pdfName = `Citation_Report_${Date.now()}.pdf`;
                      const file = new File([blob], pdfName, { type: 'application/pdf' });
                      const uploadRes = await documentApi.uploadDocuments(folderName, [file]);
                      const doc = uploadRes.documents && uploadRes.documents[0];
                      const fileId = doc && (doc.id ?? doc.fileId ?? doc._id);
                      if (!fileId) {
                        setReportSaveToCaseStatus('done');
                        addMsg('assistant', '📁 Report PDF uploaded to case folder. Processing may still be in progress.', {});
                        return;
                      }
                      setReportSaveToCaseStatus('processing');
                      setReportSaveToCaseProgress(10);
                      const pollInterval = 2500;
                      const maxPolls = 120; // 5 min
                      let polls = 0;
                      const poll = async () => {
                        if (polls >= maxPolls) {
                          setReportSaveToCaseStatus('done');
                          setReportSaveToCaseProgress(100);
                          addMsg('assistant', '📁 Report PDF uploaded to case folder. Processing is taking longer than usual.', {});
                          return;
                        }
                        try {
                          const status = await documentApi.getFileProcessingStatus(fileId);
                          const st = (status && status.status) ? String(status.status).toLowerCase() : '';
                          const progress = status && (status.processing_progress != null) ? Number(status.processing_progress) : 10 + (polls * 2);
                          setReportSaveToCaseProgress(Math.min(progress, 99));
                          if (st === 'processed' || st === 'completed') {
                            setReportSaveToCaseStatus('done');
                            setReportSaveToCaseProgress(100);
                            addMsg('assistant', '📁 Report PDF saved to case folder and ready for search (chunking & embeddings complete).', {});
                            return;
                          }
                          if (st === 'error' || st === 'failed') {
                            setReportSaveToCaseStatus({ error: status?.message || 'Processing failed.' });
                            return;
                          }
                        } catch (_) { /* ignore poll errors */ }
                        polls += 1;
                        setTimeout(poll, pollInterval);
                      };
                      setTimeout(poll, pollInterval);
                    } catch (err) {
                      console.warn('[Citation] Auto-save report PDF to case folder failed:', err);
                      setReportSaveToCaseStatus({ error: err?.message || 'Upload failed.' });
                      addMsg('assistant', `Report generated. Saving PDF to case folder failed: ${err?.message || 'Unknown error'}. You can add citations to case manually.`, {});
                    }
                  })();
                }
              }
            } else {
              addMsg('error', `❌ Pipeline failed: ${st.error || 'Unknown error'}`);
              setReportError(st.error || 'Pipeline failed');
            }
            setSending(false); setGenerating(false);
          }
        } catch (_) { }
      }, 3000);

    } catch (e) {
      stopPolling();
      addMsg('error', `❌ ${e.message}`);
      setReportError(e.message);
      setSending(false); setGenerating(false);
    }
  };

  // Load citation graph when user switches to Citations Map tab
  useEffect(() => {
    if (activeTab !== 'map') return;
    const citations = report?.report_format?.citations || [];
    if (!citations.length) {
      setCitationGraph(null);
      setCitationGraphError(null);
      return;
    }
    const target = citations[0];
    const cid = target?.canonicalId;
    if (!cid) {
      setCitationGraph(null);
      setCitationGraphError('No canonical ID available for this report.');
      return;
    }
    setCitationGraphLoading(true);
    setCitationGraphError(null);
    citationApi.getCaseCitationGraph(cid)
      .then(g => setCitationGraph(g))
      .catch(err => setCitationGraphError(err.message || 'Failed to load citation graph'))
      .finally(() => setCitationGraphLoading(false));
  }, [activeTab, report]);

  const handleFile = async (files) => {
    for (const f of Array.from(files).slice(0, 3)) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!['txt', 'md', 'json', 'csv', 'html'].includes(ext)) continue;
      const content = await f.text();
      setRefDocs(p => [...p.filter(d => d.name !== f.name), { name: f.name, content: content.slice(0, 15000), size: f.size }]);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleToggleFetchLog = async () => {
    if (showFetchLog) { setShowFetchLog(false); return; }
    setShowFetchLog(true);
    const rid = report?.run_id || runId;
    if (!rid || reportLogs.length > 0) return;
    setReportLogsLoading(true);
    try {
      const base = window.CITATION_API_BASE || 'http://localhost:8003';
      const res = await fetch(`${base}/citation/runs/${rid}/logs?limit=500`);
      const data = await res.json();
      setReportLogs(data.logs || []);
    } catch (e) {
      setReportLogs([]);
    } finally {
      setReportLogsLoading(false);
    }
  };

  const handleDeleteReport = async (rId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('Delete this citation report? This cannot be undone.')) return;
    const uid = localStorage.getItem('userId') || localStorage.getItem('user_id') || 'anonymous';
    try {
      await citationApi.deleteReport(rId, uid);
      if (reportId === rId || (report && report.id === rId)) {
        setReport(null);
        setShowReport(false);
        navigate('/citation', { replace: true });
      }
      if (selCase) {
        const list = await citationApi.listReportsByCase(selCase, uid).catch(() => []);
        setCaseReports(list?.reports || list || []);
      }
    } catch (err) {
      window.alert(err.message || 'Failed to delete report');
    }
  };

  const handleViewFullJudgment = useCallback(async (canonicalId, caseName) => {
    setFullJudgmentModal({ loading: true, caseName: caseName || 'Judgment' });
    try {
      const data = await citationApi.getJudgementFullText(canonicalId);
      if (!data || !data.success) {
        setFullJudgmentModal({ error: true, caseName: caseName || 'Judgment' });
        return;
      }
      setFullJudgmentModal({
        caseName: data.case_name || caseName,
        fullText: data.full_text || '',
        sourceUrl: data.source_url || '',
      });
    } catch {
      setFullJudgmentModal({ error: true, caseName: caseName || 'Judgment' });
    }
  }, []);

  /* ── If showing full report page ── */
  if (showReport && report) {
    const currentReportId = report?.report_id || report?.id || reportId;
    return (
      <div style={{ fontFamily: "'DM Sans',sans-serif", display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ background: g50, borderBottom: `1px solid ${g200}`, padding: '8px 24px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setShowReport(false)} style={{ padding: '8px 0', border: 'none', background: 'transparent', fontSize: 13, color: N, fontWeight: 700, cursor: 'pointer' }}>← Back to Research</button>
          <span style={{ color: g300 }}>|</span>
          <span style={{ fontSize: 12, color: g400 }}>Verified Citation Report · {report?.report_format?.citations?.length || 0} citations</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {(report?.run_id || runId) && (
              <button
                onClick={handleToggleFetchLog}
                style={{
                  padding: '6px 12px', fontSize: 11, fontWeight: 600,
                  color: showFetchLog ? '#0F766E' : '#374151',
                  background: showFetchLog ? '#F0FDF4' : W,
                  border: `1px solid ${showFetchLog ? '#6EE7B7' : g200}`,
                  borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                }}
                title="Show IK API fetch log for this report"
              >
                <span style={{ fontSize: 12 }}>📋</span>
                {showFetchLog ? 'Hide Log' : 'Fetch Log'}
              </button>
            )}
            <button
              onClick={() => handleOpenShare(currentReportId)}
              style={{ padding: '6px 14px', fontSize: 11, fontWeight: 600, color: N, background: W, border: `1px solid ${g200}`, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              title="Share this report with firm members"
            >
              <span style={{ fontSize: 13 }}>🔗</span> Share
            </button>
            <button
              onClick={() => handleDeleteReport(currentReportId)}
              style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, color: '#B71C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, cursor: 'pointer' }}
              title="Delete this report"
            >
              Delete report
            </button>
          </div>
        </div>
        {/* ── Report save to case folder: uploading / processing until complete ── */}
        {reportSaveToCaseStatus && (
          <div
            style={{
              background: reportSaveToCaseStatus === 'done' ? '#F0FDF4' : typeof reportSaveToCaseStatus === 'object' && reportSaveToCaseStatus?.error ? '#FEF2F2' : '#EFF6FF',
              borderBottom: `1px solid ${reportSaveToCaseStatus === 'done' ? '#BBF7D0' : typeof reportSaveToCaseStatus === 'object' ? '#FECACA' : '#BFDBFE'}`,
              padding: '10px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
              fontSize: 13,
            }}
          >
            {reportSaveToCaseStatus === 'uploading' && (
              <>
                <span style={{ color: '#1E40AF' }}>📤 Uploading report PDF to case folder…</span>
              </>
            )}
            {reportSaveToCaseStatus === 'processing' && (
              <>
                <span style={{ color: '#1E40AF' }}>⏳ Processing report (chunking & embeddings)…</span>
                <span style={{ color: '#3B82F6', fontWeight: 600 }}>{Math.round(reportSaveToCaseProgress)}%</span>
              </>
            )}
            {reportSaveToCaseStatus === 'done' && (
              <span style={{ color: '#166534', fontWeight: 600 }}>✓ Report PDF saved to case folder and ready for search.</span>
            )}
            {typeof reportSaveToCaseStatus === 'object' && reportSaveToCaseStatus?.error && (
              <span style={{ color: '#991B1B' }}>Report PDF could not be saved to case folder: {reportSaveToCaseStatus.error}</span>
            )}
          </div>
        )}
        {/* ── IK Fetch Log panel ── */}
        {showFetchLog && (
          <div style={{ background: '#0F172A', borderBottom: '2px solid #1E3A5F', maxHeight: 340, overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ padding: '8px 16px', background: '#1E293B', display: 'flex', alignItems: 'center', gap: 8, position: 'sticky', top: 0, zIndex: 1 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#38BDF8', letterSpacing: '.06em', textTransform: 'uppercase' }}>📋 Pipeline Fetch Log</span>
              <span style={{ fontSize: 9, color: '#475569', marginLeft: 4 }}>
                {report?.run_id ? `run: ${report.run_id.slice(0, 8)}…` : ''}
              </span>
              {reportLogsLoading && <span style={{ fontSize: 10, color: '#38BDF8', marginLeft: 6 }}>Loading…</span>}
              <span style={{ marginLeft: 'auto', fontSize: 9, color: '#475569' }}>{reportLogs.length} entries</span>
            </div>
            <div style={{ fontFamily: '"JetBrains Mono","Fira Code",monospace', padding: '4px 0' }}>
              {reportLogsLoading && reportLogs.length === 0 ? (
                <div style={{ padding: '12px 16px', fontSize: 11, color: '#475569' }}>Loading logs…</div>
              ) : reportLogs.length === 0 ? (
                <div style={{ padding: '12px 16px', fontSize: 11, color: '#475569' }}>No logs found for this run.</div>
              ) : reportLogs.map((log, i) => {
                const isIK = log.agent_name === 'fetcher' || log.message?.includes('/doc/') || log.message?.includes('/docfragment/') || log.message?.includes('/docmeta/') || log.message?.includes('/origdoc/') || log.message?.includes('CACHE');
                const isSec = log.message?.startsWith('✅') || log.message?.startsWith('🎉') || log.message?.startsWith('📡') || log.message?.startsWith('🗄');
                const levelColor = { ERROR: '#F87171', WARNING: '#FCD34D', INFO: '#86EFAC', DEBUG: '#94A3B8' }[log.log_level] || '#94A3B8';
                const ts = log.created_at ? new Date(log.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '';
                return (
                  <div key={log.id || i} style={{
                    display: 'flex', gap: 8, alignItems: 'flex-start',
                    padding: isSec ? '5px 16px' : '2px 16px',
                    borderBottom: '1px solid #1E293B',
                    background: isIK && isSec ? '#0C2847' : isIK ? '#0D1B2A' : 'transparent',
                  }}>
                    <span style={{ fontSize: 9, color: '#0EA5E9', flexShrink: 0, minWidth: 56, marginTop: 2 }}>{ts}</span>
                    <span style={{ fontSize: 8, color: '#475569', flexShrink: 0, minWidth: 60, marginTop: 2, textTransform: 'uppercase', letterSpacing: '.05em' }}>{log.agent_name}</span>
                    <span style={{ fontSize: 8, color: levelColor, flexShrink: 0, minWidth: 36, marginTop: 2 }}>{log.log_level}</span>
                    <span style={{ fontSize: 11, color: isIK ? '#BAE6FD' : '#64748B', lineHeight: 1.5, flex: 1, wordBreak: 'break-word' }}>{log.message}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <ReportDoc report={report} query={query} cases={cases} onViewFullJudgment={handleViewFullJudgment} />
        </div>

        {/* ── Share Report Modal ── */}
        {shareOpen && (() => {
          const totalSelected = shareSelected.size + shareEmailAdded.length;
          return (
            <div
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.48)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 24 }}
              onClick={() => setShareOpen(false)}
            >
              <div
                style={{ background: W, borderRadius: 16, boxShadow: '0 24px 64px rgba(0,0,0,.22)', width: '100%', maxWidth: 460, fontFamily: "'DM Sans',sans-serif", overflow: 'hidden' }}
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div style={{ padding: '20px 24px 14px', borderBottom: `1px solid ${g100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: N }}>Share Report</div>
                    <div style={{ fontSize: 12, color: g400, marginTop: 2 }}>Share with your firm members — they can view this report</div>
                  </div>
                  <button onClick={() => setShareOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: g400, lineHeight: 1, padding: '0 0 0 8px' }}>×</button>
                </div>

                {/* Email input with autocomplete */}
                {(() => {
                  const q = shareEmailInput.trim().toLowerCase();
                  const suggestions = q.length === 0 ? [] : [...shareMembers]
                    .filter(m => {
                      const uid = String(m.user_id);
                      if (shareSelected.has(uid)) return false;
                      const name = (m.username || '').toLowerCase();
                      const email = (m.email || '').toLowerCase();
                      return name.includes(q) || email.includes(q);
                    })
                    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));

                  const handleSuggestionClick = (m) => {
                    const uid = m.user_id != null ? String(m.user_id) : null;
                    if (uid && uid !== 'null') {
                      setShareSelected(prev => { const s = new Set(prev); s.add(uid); return s; });
                    } else if (m.email) {
                      // No user_id — treat as email-only addition
                      setShareEmailAdded(prev => prev.find(e => e.email === m.email) ? prev : [...prev, { email: m.email }]);
                    }
                    setShareEmailInput('');
                  };

                  return (
                    <div style={{ padding: '14px 24px 0' }}>
                      <div style={{ position: 'relative' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            type="text"
                            placeholder="Add people by name or email…"
                            value={shareEmailInput}
                            onChange={e => setShareEmailInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                if (suggestions.length > 0) handleSuggestionClick(suggestions[0]);
                                else handleShareAddEmail();
                              }
                              if (e.key === 'Escape') setShareEmailInput('');
                            }}
                            style={{ flex: 1, padding: '9px 13px', fontSize: 13, border: `1.5px solid ${suggestions.length > 0 ? N : g200}`, borderRadius: suggestions.length > 0 ? '8px 8px 0 0' : 8, outline: 'none', color: N, fontFamily: 'inherit', transition: 'border-color .15s' }}
                            autoComplete="off"
                          />
                          <button
                            onClick={handleShareAddEmail}
                            style={{ padding: '9px 15px', fontSize: 13, fontWeight: 700, background: N, color: W, border: 'none', borderRadius: 8, cursor: 'pointer' }}
                          >Add</button>
                        </div>

                        {/* Autocomplete dropdown */}
                        {suggestions.length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 48, background: W, border: `1.5px solid ${N}`, borderTop: 'none', borderRadius: '0 0 8px 8px', boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 100, overflow: 'hidden' }}>
                            {suggestions.map((m, i) => {
                              const name = m.username || m.email || String(m.user_id);
                              const initials = name.split(/[\s@._]/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
                              return (
                                <div
                                  key={m.user_id}
                                  onMouseDown={e => { e.preventDefault(); handleSuggestionClick(m); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', cursor: 'pointer', borderBottom: i < suggestions.length - 1 ? `1px solid ${g100}` : 'none', background: W, transition: 'background .1s' }}
                                  onMouseEnter={e => e.currentTarget.style.background = g50}
                                  onMouseLeave={e => e.currentTarget.style.background = W}
                                >
                                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: N, color: W, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                                    {initials}
                                  </div>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                                    <div style={{ fontSize: 11, color: g400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Added email chips */}
                      {shareEmailAdded.length > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {shareEmailAdded.map((e, i) => (
                            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px 4px 12px', background: BS, color: B, borderRadius: 20, fontSize: 12, fontWeight: 500 }}>
                              {e.email}
                              <button onClick={() => setShareEmailAdded(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: B, fontSize: 15, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Firm members list */}
                <div style={{ padding: '12px 24px', maxHeight: 280, overflowY: 'auto' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: g500, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>Firm Members</div>
                  {shareMembersLoading ? (
                    <div style={{ textAlign: 'center', padding: 20 }}><Spin /></div>
                  ) : shareMembers.length === 0 ? (
                    <div style={{ fontSize: 12, color: g400, padding: '10px 0' }}>No other firm members found.</div>
                  ) : shareMembers.map(m => {
                    const uid = String(m.user_id);
                    const isChecked = shareSelected.has(uid);
                    const name = m.username || m.email || uid;
                    const initials = name.split(/[\s@._]/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
                    return (
                      <div
                        key={uid}
                        onClick={() => setShareSelected(prev => { const s = new Set(prev); s.has(uid) ? s.delete(uid) : s.add(uid); return s; })}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: `1px solid ${g100}`, cursor: 'pointer', userSelect: 'none' }}
                      >
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: isChecked ? N : g100, color: isChecked ? W : g500, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, transition: 'background .15s' }}>
                          {initials}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                          <div style={{ fontSize: 11, color: g400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                        </div>
                        <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${isChecked ? N : g300}`, background: isChecked ? N : W, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
                          {isChecked && <span style={{ color: W, fontSize: 12, lineHeight: 1, fontWeight: 800 }}>✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Error message */}
                {shareError && (
                  <div style={{ padding: '10px 24px', background: RS, color: R, fontSize: 12, fontWeight: 600 }}>
                    {shareError}
                  </div>
                )}
                {/* Footer */}
                {shareDone ? (
                  <div style={{ padding: '14px 24px', borderTop: `1px solid ${g100}`, display: 'flex', alignItems: 'center', gap: 8, color: '#16A34A', fontSize: 13, fontWeight: 600 }}>
                    <span>✓</span> Report shared successfully!
                  </div>
                ) : (
                  <div style={{ padding: '14px 24px', borderTop: `1px solid ${g100}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: g400 }}>
                      {totalSelected > 0 ? `${totalSelected} ${totalSelected === 1 ? 'person' : 'people'} selected` : 'Select people to share with'}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setShareOpen(false)} style={{ padding: '8px 16px', fontSize: 13, border: `1px solid ${g200}`, borderRadius: 8, background: W, color: g600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      <button
                        onClick={() => handleShareSend(currentReportId)}
                        disabled={shareSaving || totalSelected === 0}
                        style={{ padding: '8px 20px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', fontFamily: 'inherit', cursor: totalSelected === 0 || shareSaving ? 'not-allowed' : 'pointer', background: totalSelected > 0 && !shareSaving ? N : g200, color: totalSelected > 0 && !shareSaving ? W : g400 }}
                      >
                        {shareSaving ? 'Sharing…' : `Share${totalSelected > 0 ? ` (${totalSelected})` : ''}`}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Full judgment modal */}
        {fullJudgmentModal && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15,23,42,.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
              padding: 24,
            }}
            onClick={() => setFullJudgmentModal(null)}
          >
            <div
              style={{
                background: W,
                borderRadius: 12,
                boxShadow: '0 20px 60px rgba(0,0,0,.25)',
                maxWidth: 720,
                width: '100%',
                maxHeight: '85vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                fontFamily: "'DM Sans',sans-serif",
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ padding: '16px 20px', borderBottom: `1px solid ${g200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: N, margin: 0 }}>
                  {fullJudgmentModal.caseName || 'Complete judgment'}
                </h2>
                <button
                  type="button"
                  onClick={() => setFullJudgmentModal(null)}
                  style={{ padding: '6px 12px', border: 'none', background: g200, borderRadius: 6, fontSize: 12, fontWeight: 600, color: g700, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 20 }}>
                {fullJudgmentModal.loading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 40, justifyContent: 'center' }}>
                    <Spin />
                    <span style={{ fontSize: 13, color: g500 }}>Loading judgment…</span>
                  </div>
                )}
                {fullJudgmentModal.error && (
                  <div style={{ padding: 24, textAlign: 'center', color: R, fontSize: 13 }}>
                    Could not load the complete judgment. It may not be available for this citation.
                  </div>
                )}
                {!fullJudgmentModal.loading && !fullJudgmentModal.error && (
                  <>
                    <div
                      style={{
                        fontFamily: "'Source Serif 4',Georgia,serif",
                        fontSize: 14,
                        lineHeight: 1.85,
                        color: '#1E293B',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {fullJudgmentModal.fullText || 'No full text available for this judgment.'}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── Main research page ── */
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontFamily: "'DM Sans',-apple-system,sans-serif", background: g50 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box}
        @keyframes fdUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .tab-c{cursor:pointer;border:none;background:transparent;display:flex;align-items:center;gap:6px;padding:12px 14px;font-size:13px;font-weight:500;color:${g500};border-bottom:2px solid transparent;transition:all .15s;font-family:'DM Sans',sans-serif}
        .tab-c:hover{color:${N}}
        .tab-c.on{color:${N};background:${BS};border-bottom-color:${N};font-weight:700}
        .sug{padding:6px 12px;background:${BS};border:1px solid rgba(13,71,161,.13);border-radius:20px;font-size:11px;color:${B};cursor:pointer;font-weight:500;transition:all .15s;font-family:'DM Sans',sans-serif}
        .sug:hover{background:${T};color:${W};border-color:${T}}
        .send-b{height:42px;padding:0 20px;background:linear-gradient(135deg,${N},${NL});color:${W};border:none;border-radius:10px;font-weight:700;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;transition:opacity .15s}
        .send-b:hover{opacity:.88}
        .send-b:disabled{opacity:.5;cursor:not-allowed}
        .gen-b{height:30px;padding:0 12px;background:${T};color:${W};border:none;border-radius:8px;font-weight:700;font-size:11px;cursor:pointer;font-family:'DM Sans',sans-serif}
        .gen-b:disabled{opacity:.5;cursor:not-allowed}
        .chat-in{flex:1;height:42px;border:2px solid ${g200};border-radius:10px;padding:0 12px;font-size:13px;outline:none;transition:border-color .2s;font-family:'DM Sans',sans-serif}
        .chat-in:focus{border-color:${T}}
        .sel-in{width:100%;padding:9px 12px;border:1.5px solid ${g200};border-radius:8px;font-size:12px;outline:none;font-family:'DM Sans',sans-serif;cursor:pointer}
        .sel-in:focus{border-color:${T}}
        .view-rep-btn{display:block;margin-top:8px;padding:6px 14px;background:${T};color:${W};border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif}
        .ref-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:#F3E5F5;border:1px solid #D1C4E9;border-radius:14px;font-size:10px;color:#4A148C;font-weight:600;margin:2px}
        .sc::-webkit-scrollbar{width:5px}.sc::-webkit-scrollbar-thumb{background:${g200};border-radius:8px}
      `}</style>

      {/* Tab nav — no shadow so it does not overlap or hide content below */}
      <div style={{ background: W, borderBottom: `1px solid ${g200}`, padding: '0 20px', display: 'flex', gap: 2, flexShrink: 0 }}>
        {TABS.map(t => (
          <button key={t.id} className={`tab-c${activeTab === t.id ? ' on' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}{t.id === 'team' && !teamLoading && teamReports.length > 0 ? ` (${teamReports.length})` : ''}
          </button>
        ))}
      </div>

      {/* AI Research tab */}
      {activeTab === 'research' && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 280px', gap: 0, overflow: 'hidden' }}>
          {/* Chat area — flex column so input row stays at bottom and visible */}
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, background: W, borderRight: `1px solid ${g200}` }}>
            {/* Chat header — no overlay shadow */}
            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${g200}`, display: 'flex', alignItems: 'center', gap: 10, background: W, flexShrink: 0 }}>
              <span style={{ fontSize: 20 }}>⚖️</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: N }}>AI Legal Research</div>
                <div style={{ fontSize: 10, color: g400 }}>Every citation verified · Enterprise access</div>
              </div>
              <button
                className="gen-b"
                onClick={() => handleSend(true)}
                disabled={sending || (!input.trim() && !selCase && refDocs.length === 0)}
                style={{ marginLeft: 'auto' }}
              >
                Generate Report
              </button>
              {report && (
                <button onClick={() => setShowReport(true)} style={{ padding: '6px 14px', background: T, color: W, border: 'none', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  View Report ({report?.report_format?.citations?.length || 0}) →
                </button>
              )}
            </div>

            {/* Messages — scrollable; input row below stays visible */}
            <div className="sc" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
              {msgs.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 16px', animation: 'fdUp .3s ease' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>⚖️</div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: N, marginBottom: 6 }}>Ask any Indian legal question</h3>
                  <p style={{ fontSize: 12, color: g400, marginBottom: 20, maxWidth: 400, margin: '0 auto 20px', lineHeight: 1.6 }}>Citations verified through multi-layer pipeline. Select case on the right for contextual research. Green = verified, Yellow = review.</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                    {SUGS.map((s, i) => <button key={i} className="sug" onClick={() => setInput(s)}>{s.length > 40 ? s.slice(0, 38) + '…' : s}</button>)}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', animation: 'fdUp .25s ease' }}>
                  {m.role === 'user' ? (
                    <div style={{ maxWidth: '82%', padding: '10px 14px', background: `linear-gradient(135deg,${N},${NL})`, color: W, borderRadius: '12px 12px 2px 12px', fontSize: 13, lineHeight: 1.6 }}>{m.text}</div>
                  ) : m.role === 'status' ? (
                    <div style={{ background: g50, border: `1px solid ${g200}`, borderRadius: '12px 12px 12px 2px', padding: '10px 14px', fontSize: 12, color: g500, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Spin /> {m.text}
                    </div>
                  ) : (
                    <div style={{ maxWidth: '85%', padding: '10px 14px', background: m.role === 'error' ? RS : g50, border: `1px solid ${m.role === 'error' ? '#FECACA' : g200}`, borderRadius: '12px 12px 12px 2px', fontSize: 13, color: m.role === 'error' ? R : g700, lineHeight: 1.7 }}>
                      <span dangerouslySetInnerHTML={{ __html: m.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
                      {m.reportId && <button className="view-rep-btn" onClick={() => setShowReport(true)}>📄 View Full Report →</button>}
                    </div>
                  )}
                </div>
              ))}
              {/* Live agent log panel */}
              {sending && <AgentLogPanel logs={agentLogs} runId={runId} />}
              <div ref={chatRef} />
            </div>

            {/* Ref docs bar */}
            {refDocs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 14px', borderTop: `1px solid ${g100}`, background: g50 }}>
                {refDocs.map((d, i) => (
                  <span key={i} className="ref-chip">📄 {d.name}
                    <span onClick={() => setRefDocs(p => p.filter((_, j) => j !== i))} style={{ cursor: 'pointer', marginLeft: 2, opacity: .6, fontSize: 12 }}>×</span>
                  </span>
                ))}
              </div>
            )}

            {/* Input row — stays visible, not covered by any overlay */}
            <div style={{ padding: '10px 14px', borderTop: `1px solid ${g200}`, display: 'flex', gap: 8, alignItems: 'center', background: W, flexShrink: 0, position: 'relative', zIndex: 1 }}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, background: '#F3E5F5', border: '1px solid #D1C4E9', borderRadius: 10, cursor: 'pointer', fontSize: 16, flexShrink: 0 }} title="Upload reference doc (.txt .md .json .csv)">
                📎
                <input ref={fileRef} type="file" accept=".txt,.md,.json,.csv,.html" multiple style={{ display: 'none' }} onChange={e => handleFile(e.target.files)} />
              </label>
              <input className="chat-in" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Ask a legal research question…" disabled={sending} />
              <button className="send-b" onClick={handleSend} disabled={sending || (!input.trim() && !selCase && refDocs.length === 0)}>
                {sending ? <Spin /> : 'Send'}
              </button>
            </div>
          </div>

          {/* Sidebar */}
          <div className="sc" style={{ overflowY: 'auto', padding: 14, background: g50, display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Vault pipeline card */}
            <div style={{ background: W, borderRadius: 10, padding: 14, border: `1px solid ${g200}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: N, marginBottom: 10, textTransform: 'uppercase', letterSpacing: .5 }}>🏛 Vault-First Pipeline</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 10 }}>
                {[{ v: queryCount, l: 'Queries (Session)', c: N }, { v: vaultCount, l: 'Vault Citations', c: G }].map(({ v, l, c }) => (
                  <div key={l} style={{ background: g50, borderRadius: 6, padding: '6px 8px' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: c }}>{v}</div>
                    <div style={{ fontSize: 9, color: g400, marginTop: 1 }}>{l}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding: 8, background: '#E8F5E9', borderRadius: 6, fontSize: 10, color: '#1B5E20', lineHeight: 1.4 }}>
                <b>How it works:</b> Your query runs through Watchdog → Fetcher → Clerk → Librarian → Auditor pipeline before generating the verified report.
              </div>
            </div>

            {/* Attach case — with case-specific reports below */}
            <div style={{ background: W, borderRadius: 10, padding: 14, border: `1px solid ${g200}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: N, marginBottom: 8, textTransform: 'uppercase', letterSpacing: .5 }}>📁 Attach Case Context</div>
              <select className="sel-in" value={selCase} onChange={e => {
                const id = e.target.value;
                setSelCase(id);
                const found = cases.find(c => c.id === id);
                setSelCaseName(found ? (found.case_title || found.name || id) : '');
              }} disabled={casesLoading}>
                <option value="">{casesLoading ? 'Loading cases…' : cases.length === 0 ? 'No cases found' : '— Select a case (optional) —'}</option>
                {cases.map(c => <option key={c.id} value={c.id}>{c.case_title || c.name || c.id}</option>)}
              </select>
              {selCase && (
                <div style={{ marginTop: 6, fontSize: 10, color: GL, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Dot c={GL} s={6} /> Case docs will be used as AI context · Reports tagged to this case
                </div>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: g400, lineHeight: 1.4 }}>
                Selecting a case sends its documents to Claude for keyword extraction, improving search precision.
              </div>

              {/* Case-specific reports */}
              {selCase && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${g100}`, paddingTop: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: N, marginBottom: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>📋 Reports for this case</span>
                    {caseReportsLoading && <Spin />}
                  </div>
                  {!caseReportsLoading && caseReports.length === 0 && (
                    <div style={{ fontSize: 10, color: g400, fontStyle: 'italic' }}>No reports yet for this case. Generate one above!</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {caseReports.map(r => (
                      <div key={r.id}
                        onClick={async () => {
                          const data = await citationApi.getReport(r.id).catch(() => null);
                          if (data) { setReport(data); setQuery(data.query || ''); setShowReport(true); navigate(`/citation/reports/${r.id}`, { replace: true }); }
                        }}
                        style={{ padding: '7px 10px', background: g50, border: `1px solid ${g200}`, borderRadius: 7, cursor: 'pointer', transition: 'background .12s', display: 'flex', flexDirection: 'column', gap: 4 }}
                        onMouseEnter={e => e.currentTarget.style.background = '#EEF0F4'}
                        onMouseLeave={e => e.currentTarget.style.background = g50}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {r.query && r.query.length > 40 ? r.query.slice(0, 38) + '…' : r.query || 'Untitled'}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteReport(r.id, e)}
                            title="Delete this report"
                            style={{ flexShrink: 0, padding: '2px 6px', fontSize: 9, fontWeight: 600, color: '#B71C1C', background: 'transparent', border: '1px solid #FECACA', borderRadius: 4, cursor: 'pointer' }}
                          >
                            Delete
                          </button>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 9, color: g400 }}>
                            {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                          </span>
                          <span style={{ fontSize: 9, color: GL, fontWeight: 700 }}>
                            {r.citation_count ?? '?'} citations
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Reference docs */}
            <div style={{ background: W, borderRadius: 10, padding: 14, border: `1px solid ${g200}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: N, marginBottom: 8, textTransform: 'uppercase', letterSpacing: .5 }}>📎 Reference Documents</div>
              {refDocs.length === 0 ? (
                <div style={{ fontSize: 11, color: g400 }}>No files uploaded. Use 📎 in the chat bar to add reference files.</div>
              ) : (
                refDocs.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${g100}` }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: N }}>{d.name}</div>
                      <div style={{ fontSize: 9, color: g400 }}>{(d.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <span onClick={() => setRefDocs(p => p.filter((_, j) => j !== i))} style={{ cursor: 'pointer', fontSize: 14, color: g400, padding: '0 4px' }}>×</span>
                  </div>
                ))
              )}
              <button onClick={() => fileRef.current?.click()} style={{ marginTop: 8, width: '100%', padding: '5px', background: '#F3E5F5', border: '1px solid #D1C4E9', borderRadius: 6, fontSize: 10, fontWeight: 600, color: '#4A148C', cursor: 'pointer', fontFamily: 'inherit' }}>📎 Upload Files (.txt .md .json .csv)</button>
              <div style={{ marginTop: 6, padding: '5px 8px', background: '#F3E5F5', borderRadius: 6, fontSize: 9, color: '#4A148C', lineHeight: 1.4 }}>File content is included as context. Max 3 files at a time.</div>
            </div>

            {/* Confidence guide */}
            <div style={{ background: W, borderRadius: 10, padding: 14, border: `1px solid ${g200}` }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: N, marginBottom: 8, textTransform: 'uppercase', letterSpacing: .5 }}>Confidence Guide</div>
              {[{ c: '#1B5E20', l: 'Verified — Fully confirmed' }, { c: '#E65100', l: 'Review Suggested' }, { c: '#B71C1C', l: 'Unverified — Needs verification' }].map(({ c, l }) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 11, color: g600 }}><Dot c={c} /> {l}</div>
              ))}
            </div>

            {/* Disclaimer */}
            <div style={{ background: '#FFFBF0', border: '1px solid #F0DCA0', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9A6700' }}>⚠️ Disclaimer</div>
              <div style={{ fontSize: 10, color: g600, lineHeight: 1.5, marginTop: 4 }}>AI-generated research assistance only. Not legal advice. Always verify citations independently before court proceedings.</div>
            </div>
          </div>
        </div>
      )}

      {/* Citations Map tab */}
      {activeTab === 'map' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20 }}>
          {!report && (
            <div style={{ margin: '0 auto', textAlign: 'center', color: g400 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No report selected</div>
              <div style={{ fontSize: 12 }}>Generate a verified citation report first, then open the Citations Map.</div>
            </div>
          )}
          {report && (
            <>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: N, display: 'flex', alignItems: 'center', gap: 6 }}>✦ Citation Relationships</div>
                  <div style={{ fontSize: 11, color: g400 }}>Explore how landmark cases connect — click any node for details</div>
                </div>
                <div style={{ fontSize: 10, color: g400 }}>
                  {report.report_format?.citations?.length ? (
                    <>Showing map for: <span style={{ fontWeight: 600, color: N }}>
                      {report.report_format.citations[0].caseName || report.report_format.citations[0].citation || report.report_format.citations[0].canonicalId}
                    </span></>
                  ) : 'No citations available in this report.'}
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0, borderRadius: 8, border: `1px solid ${g200}`, background: W, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {citationGraphLoading && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                    <Spin />
                    <span style={{ fontSize: 13, color: g500 }}>Loading citation map…</span>
                  </div>
                )}
                {citationGraphError && !citationGraphLoading && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: R, fontSize: 12 }}>
                    {citationGraphError}
                  </div>
                )}
                {!citationGraphLoading && !citationGraphError && citationGraph && (citationGraph.nodes || []).length === 0 && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', color: g400, fontSize: 12 }}>
                    No citation relationships found in the graph for this judgment yet.
                  </div>
                )}
                {!citationGraphLoading && !citationGraphError && citationGraph && (citationGraph.nodes || []).length > 0 && (() => {
                  const grEdges = citationGraph.edges || [];
                  const centerId = (citationGraph.nodes.find(n => n.role === 'center') || citationGraph.nodes[0])?.id;
                  const followsCount = grEdges.filter(e => e.type === 'FOLLOWS' && e.to === centerId).length;
                  const distinguishesCount = grEdges.filter(e => e.type === 'DISTINGUISHES' && e.to === centerId).length;
                  const overrulesCount = grEdges.filter(e => e.type === 'OVERRULES' && e.to === centerId).length;
                  return (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
                      {/* Treatment counts + legend */}
                      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
                        {[
                          { color: '#16A34A', bg: '#F0FDF4', label: 'Followed In', count: followsCount },
                          { color: '#E65100', bg: '#FFF3E0', label: 'Distinguished In', count: distinguishesCount },
                          { color: '#B71C1C', bg: '#FFF5F5', label: 'Overruled By', count: overrulesCount },
                        ].map(({ color, bg, label, count }) => (
                          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: bg, border: `1px solid ${color}33`, borderRadius: 6, padding: '3px 10px' }}>
                            <span style={{ fontSize: 15, fontWeight: 800, color }}>{count}</span>
                            <span style={{ fontSize: 10, fontWeight: 600, color, lineHeight: 1.2 }}>{label}<br />Cases</span>
                          </span>
                        ))}
                        <span style={{ fontSize: 10, color: g400, marginLeft: 4 }}>· Node colors match relationship type</span>
                      </div>
                      {/* Canvas graph */}
                      <div style={{ flex: 1, minHeight: 400, position: 'relative' }}>
                        <CitationGraphSVG nodes={citationGraph.nodes} edges={citationGraph.edges} />
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {/* Case Search tab */}
      {activeTab === 'search' && <CaseSearchTab />}

      {/* Analytics tab */}
      {activeTab === 'analytics' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20, gap: 20 }}>
          {/* ── Header ── */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: N, letterSpacing: -0.3 }}>Enterprise Analytics</div>
              <div style={{ fontSize: 12, color: g400, marginTop: 2 }}>Usage insights for your legal team</div>
            </div>
            <button
              onClick={() => { setAnalytics(null); setAnalyticsError(null); }}
              style={{ fontSize: 11, color: T, background: 'none', border: `1px solid ${g200}`, borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontWeight: 600 }}
            >
              ↻ Refresh
            </button>
          </div>

          {analyticsLoading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Spin />
              <span style={{ fontSize: 13, color: g500 }}>Loading analytics…</span>
            </div>
          )}

          {!analyticsLoading && analyticsError && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: R, fontSize: 13 }}>
              {analyticsError}
            </div>
          )}

          {!analyticsLoading && !analyticsError && analytics && (() => {
            const sum = analytics.summary || {};
            const trend = analytics.volume_trend || [];
            const team = analytics.team_activity || [];
            const timeSavedHrs = Math.round((sum.total_time_saved_minutes || 0) / 60);

            // ── Area chart helpers ──
            const vbW = 560, vbH = 260;
            const ml = 52, mr = 16, mt = 16, mb = 32;
            const iW = vbW - ml - mr;
            const iH = vbH - mt - mb;
            const baseY = mt + iH;

            const maxRaw = Math.max(...trend.map(t => Math.max(t.queries || 0, t.citations || 0)), 1);
            // Round up maxY to nice intervals (e.g. 200, 400, 1200) matching the reference chart
            const step = maxRaw <= 200 ? 50 : maxRaw <= 1200 ? 200 : Math.ceil(maxRaw / 6 / 100) * 100;
            const maxY = Math.ceil(maxRaw / step) * step || step;
            const yTicks = 6;

            const xFor = (idx) => ml + (iW * (trend.length <= 1 ? 0.5 : idx / (trend.length - 1)));
            const yFor = (v) => baseY - (iH * Math.min(v, maxY) / maxY);

            // Smooth bezier path
            const smoothPath = (coords) => {
              if (!coords.length) return '';
              if (coords.length === 1) return `M ${coords[0].x},${coords[0].y}`;
              let d = `M ${coords[0].x},${coords[0].y}`;
              for (let i = 1; i < coords.length; i++) {
                const cp1x = (coords[i - 1].x + coords[i].x) / 2;
                d += ` C ${cp1x},${coords[i - 1].y} ${cp1x},${coords[i].y} ${coords[i].x},${coords[i].y}`;
              }
              return d;
            };

            const areaPath = (coords, color) => {
              if (!coords.length) return null;
              const line = smoothPath(coords);
              const last = coords[coords.length - 1];
              const first = coords[0];
              const closed = `${line} L ${last.x},${baseY} L ${first.x},${baseY} Z`;
              return closed;
            };

            const qCoords = trend.map((t, i) => ({ x: xFor(i), y: yFor(t.queries || 0), v: t.queries || 0 }));
            const cCoords = trend.map((t, i) => ({ x: xFor(i), y: yFor(t.citations || 0), v: t.citations || 0 }));
            const qLinePath = smoothPath(qCoords);
            const cLinePath = smoothPath(cCoords);
            const qAreaPath = areaPath(qCoords);
            const cAreaPath = areaPath(cCoords);

            const CHART_QUERIES = '#1B2A4A';   // Dark blue for Queries
            const CHART_CITATIONS = '#1B5E20'; // Dark green for Citations

            return (
              <>
                {/* ── Stat Cards ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 14 }}>
                  {[
                    { label: 'Queries This Month', value: sum.total_queries ?? 0, icon: '🔍', iconBg: '#EBF4FF', color: '#0D47A1' },
                    { label: 'Citations Accessed', value: sum.total_citations ?? 0, icon: '📄', iconBg: '#F0F9F0', color: '#1B5E20' },
                    { label: 'Time Saved', value: `${timeSavedHrs} hrs`, icon: '⏱️', iconBg: '#FFF8E1', color: '#E65100' },
                    { label: 'Team Members', value: team.length || (sum.active_users ?? 0), icon: '👥', iconBg: '#F5F0FF', color: '#6B21A8' },
                  ].map(({ label, value, icon, iconBg, color }) => (
                    <div key={label} style={{ background: W, borderRadius: 14, padding: '16px 20px', border: `1px solid ${g200}`, display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      <div style={{ width: 44, height: 44, borderRadius: 12, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                        {icon}
                      </div>
                      <div>
                        <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
                        <div style={{ fontSize: 11, color: g400, marginTop: 3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── Chart + Team ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, alignItems: 'stretch' }}>

                  {/* Area Chart */}
                  <div style={{ background: W, borderRadius: 14, padding: '20px 20px 12px', border: `1px solid ${g200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: N }}>Research Volume Trend</div>
                        <div style={{ fontSize: 11, color: g400 }}>Queries vs citations (last 6 months)</div>
                      </div>
                      <div style={{ display: 'flex', gap: 14, fontSize: 11, alignItems: 'center', marginTop: 2 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: g600, fontWeight: 500 }}>
                          <span style={{ width: 24, height: 10, background: CHART_QUERIES, borderRadius: 2, display: 'inline-block' }} />
                          Queries
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: g600, fontWeight: 500 }}>
                          <span style={{ width: 24, height: 10, background: CHART_CITATIONS, borderRadius: 2, display: 'inline-block' }} />
                          Citations
                        </span>
                      </div>
                    </div>

                    {!trend.length ? (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: g400, fontSize: 12, minHeight: 160 }}>
                        Not enough data yet. Generate a few reports to see trends.
                      </div>
                    ) : (
                      <svg width="100%" viewBox={`0 0 ${vbW} ${vbH}`} style={{ overflow: 'visible', display: 'block' }}>
                        <defs>
                          <linearGradient id="gQ" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_QUERIES} stopOpacity="0.18" />
                            <stop offset="100%" stopColor={CHART_QUERIES} stopOpacity="0.02" />
                          </linearGradient>
                          <linearGradient id="gC" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={CHART_CITATIONS} stopOpacity="0.22" />
                            <stop offset="100%" stopColor={CHART_CITATIONS} stopOpacity="0.02" />
                          </linearGradient>
                        </defs>

                        {/* Horizontal grid lines + Y-axis labels */}
                        {Array.from({ length: yTicks + 1 }, (_, i) => {
                          const fraction = i / yTicks;
                          const yVal = Math.round(maxY * fraction);
                          const yPos = baseY - iH * fraction;
                          return (
                            <g key={i}>
                              <line x1={ml} y1={yPos} x2={ml + iW} y2={yPos}
                                stroke={i === 0 ? g300 : g100} strokeWidth={i === 0 ? 1 : 1} />
                              <text x={ml - 8} y={yPos + 4} fontSize={10} fill={g400} textAnchor="end" fontFamily="inherit">
                                {yVal >= 1000 ? `${Math.round(yVal / 100) / 10}k` : yVal}
                              </text>
                            </g>
                          );
                        })}

                        {/* Filled areas */}
                        {qAreaPath && <path d={qAreaPath} fill="url(#gQ)" />}
                        {cAreaPath && <path d={cAreaPath} fill="url(#gC)" />}

                        {/* Smooth lines (drawn above areas for prominence) */}
                        <path d={qLinePath} fill="none" stroke={CHART_QUERIES} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                        <path d={cLinePath} fill="none" stroke={CHART_CITATIONS} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

                        {/* Data points */}
                        {qCoords.map((p, i) => (
                          <circle key={`q${i}`} cx={p.x} cy={p.y} r={5} fill={CHART_QUERIES} stroke={W} strokeWidth="2.5">
                            <title>{trend[i].label}: {p.v} queries</title>
                          </circle>
                        ))}
                        {cCoords.map((p, i) => (
                          <circle key={`c${i}`} cx={p.x} cy={p.y} r={5} fill={CHART_CITATIONS} stroke={W} strokeWidth="2.5">
                            <title>{trend[i].label}: {p.v} citations</title>
                          </circle>
                        ))}

                        {/* X-axis labels */}
                        {trend.map((t, i) => (
                          <text key={i} x={xFor(i)} y={baseY + 18} fontSize={11} fill={g400} textAnchor="middle" fontFamily="inherit">
                            {t.label}
                          </text>
                        ))}
                      </svg>
                    )}
                  </div>

                  {/* Team Activity */}
                  <div style={{ background: W, borderRadius: 14, padding: '20px', border: `1px solid ${g200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: N, marginBottom: 2 }}>Team Activity</div>
                    <div style={{ fontSize: 11, color: g400, marginBottom: 14 }}>Last 30 days</div>

                    {/* Header row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.2fr 0.8fr', fontSize: 11, fontWeight: 700, color: g500, borderBottom: `1.5px solid ${g200}`, paddingBottom: 8, marginBottom: 2 }}>
                      <span>Member</span>
                      <span style={{ textAlign: 'right' }}>Queries</span>
                      <span style={{ textAlign: 'right' }}>Citations</span>
                      <span style={{ textAlign: 'right' }}>Saved</span>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto', maxHeight: 240 }}>
                      {team.map((m, idx) => (
                        <div key={`${m.user_id}-${idx}`} style={{
                          display: 'grid',
                          gridTemplateColumns: '2fr 1fr 1.2fr 0.8fr',
                          fontSize: 13,
                          padding: '10px 0',
                          borderBottom: `1px solid ${g100}`,
                          alignItems: 'center',
                        }}>
                          <span style={{ color: N, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.user_id}>
                            {[m.username || m.display_name || m.user_id || 'Unknown', m.auth_type && m.auth_type !== '—' ? `(${m.auth_type})` : null, m.role && m.role !== '—' ? m.role : null].filter(Boolean).join(' · ')}
                          </span>
                          <span style={{ textAlign: 'right', color: g600, fontWeight: 500 }}>{m.queries}</span>
                          <span style={{ textAlign: 'right', color: g600, fontWeight: 500 }}>{m.citations}</span>
                          <span style={{ textAlign: 'right', color: g600, fontWeight: 500 }}>{Math.round((m.time_saved_minutes || 0) / 60)}</span>
                        </div>
                      ))}
                      {!team.length && (
                        <div style={{ padding: '20px 0', fontSize: 12, color: g400, textAlign: 'center' }}>No team activity yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Team Workspace Tab ── */}
      {activeTab === 'team' && (() => {
        const _u = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
        const myId = String(_u.id || _u.user_id || '');
        const memberMap = Object.fromEntries(teamMembers.map(m => [String(m.user_id), m]));
        const totalCitations = teamReports.reduce((s, r) => s + (r.citation_count || 0), 0);

        const fmtDate = (iso) => {
          if (!iso) return '';
          const d = new Date(iso);
          return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        };

        const getInitials = (nameOrEmail = '') =>
          nameOrEmail.split(/[\s@._]/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

        const getAuthorName = (userId) => {
          const m = memberMap[String(userId)];
          if (m) return m.username || m.email || String(userId);
          if (String(userId) === myId) {
            return _u.username || _u.email || 'You';
          }
          return `User ${userId}`;
        };

        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, padding: 20, gap: 20, overflowY: 'auto' }}>
            {/* Header */}
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: N, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>👥</span> Team Workspace
              </div>
              <div style={{ fontSize: 12, color: g400, marginTop: 2 }}>Collaborate on research, share findings</div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
              {[
                { icon: '📁', value: teamLoading ? '…' : teamReports.length, label: 'SHARED RESEARCH' },
                { icon: '👥', value: teamLoading ? '…' : `${teamMembers.length + 1}/10`, label: 'SEATS USED' },
                { icon: '📚', value: teamLoading ? '…' : totalCitations, label: 'LIBRARY CITATIONS' },
              ].map(({ icon, value, label }) => (
                <div key={label} style={{ background: W, border: `1px solid ${g200}`, borderRadius: 12, padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                  <span style={{ fontSize: 28 }}>{icon}</span>
                  <div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: N, lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: g400, marginTop: 4, letterSpacing: .5, textTransform: 'uppercase' }}>{label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Body: shared library + members */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>

              {/* Shared Research Library */}
              <div style={{ background: W, border: `1px solid ${g200}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${g100}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>📁</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: N }}>Shared Research Library</span>
                  <select
                    value={teamSelCase}
                    onChange={e => setTeamSelCase(e.target.value)}
                    title="Filter by your cases — only reports linked to cases you have access to"
                    style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: 12, border: `1px solid ${g200}`, borderRadius: 8, background: W, color: N, cursor: 'pointer' }}
                  >
                    <option value="">All shared reports</option>
                    {cases.map(c => (
                      <option key={c.id} value={c.id}>{c.case_title || c.name || c.id}</option>
                    ))}
                  </select>
                </div>
                {teamLoading ? (
                  <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
                ) : teamReports.length === 0 ? (
                  <div style={{ padding: '24px 20px', fontSize: 13, color: g400, textAlign: 'center' }}>
                    No shared research yet. Share a report with your team to see it here.
                  </div>
                ) : (
                  <div>
                    {teamReports.slice(0, 20).map((r, idx) => {
                      const authorName = getAuthorName(r.user_id);
                      const authorInitials = getInitials(authorName);
                      const isSharedWithMe = String(r.user_id) !== myId;
                      const caseName = r.case_id ? (cases.find(x => x.id === r.case_id)?.case_title || cases.find(x => x.id === r.case_id)?.name || r.case_id) : null;
                      const reportStatus = (r.status || 'completed').toLowerCase();
                      const isComplete = reportStatus === 'completed';
                      return (
                        <div
                          key={r.id}
                          onClick={() => { window.location.href = `/citation/reports/${r.id}`; }}
                          style={{ padding: '14px 20px', borderBottom: idx < teamReports.length - 1 ? `1px solid ${g100}` : 'none', cursor: 'pointer', transition: 'background .12s' }}
                          onMouseEnter={e => e.currentTarget.style.background = g50}
                          onMouseLeave={e => e.currentTarget.style.background = W}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: N, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.query || 'Untitled Report'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              {isSharedWithMe && (
                                <span style={{ fontSize: 9, fontWeight: 700, color: '#0369A1', background: '#E0F2FE', padding: '2px 6px', borderRadius: 4, letterSpacing: '.05em' }}>Shared</span>
                              )}
                              <span style={{ fontSize: 9, fontWeight: 700, color: isComplete ? '#166534' : '#92400E', background: isComplete ? '#DCFCE7' : '#FEF3C7', padding: '2px 6px', borderRadius: 4 }}>
                                {isComplete ? 'Complete' : 'Pending'}
                              </span>
                            </div>
                          </div>
                          {caseName && (
                            <div style={{ fontSize: 12, color: T, fontWeight: 600, marginBottom: 4 }}>
                              📁 {caseName}
                            </div>
                          )}
                          <div style={{ fontSize: 12, color: g400, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 18, height: 18, borderRadius: '50%', background: N, color: W, fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{authorInitials}</span>
                              {isSharedWithMe ? <>Shared by {authorName}</> : authorName}
                            </span>
                            <span>·</span>
                            <span>{fmtDate(r.created_at)}</span>
                            <span>·</span>
                            <span>{r.citation_count || 0} citations</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Team Members */}
              <div style={{ background: W, border: `1px solid ${g200}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
                <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${g100}` }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: N }}>Team Members</span>
                </div>
                {/* Current user always first; exclude current user from teamMembers to avoid duplicate key */}
                {[
                  { user_id: myId, username: _u.username || _u.email || 'You', email: _u.email || '', role: 'FIRM_ADMIN', isMe: true },
                  ...teamMembers.filter(m => String(m.user_id) !== String(myId)).map(m => ({ ...m, isMe: false })),
                ].map((m, idx, arr) => {
                  const name = m.username || m.email || String(m.user_id);
                  const initials = getInitials(name);
                  const role = (m.role || 'STAFF').toLowerCase().replace('_', ' ');
                  const displayRole = m.isMe ? 'Super Admin' : role === 'firm_admin' ? 'Super Admin' : role.charAt(0).toUpperCase() + role.slice(1);
                  const isOnline = m.isMe; // Only show current user as definitely online
                  return (
                    <div key={m.isMe ? 'me' : (m.user_id || idx)} style={{ padding: '12px 20px', borderBottom: idx < arr.length - 1 ? `1px solid ${g100}` : 'none', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 38, height: 38, borderRadius: '50%', background: N, color: W, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: N, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name}{m.isMe ? ' (Admin)' : ''}
                        </div>
                        <div style={{ fontSize: 11, color: g400 }}>{displayRole}</div>
                      </div>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: isOnline ? '#22C55E' : g300, flexShrink: 0 }} title={isOnline ? 'Online' : 'Offline'} />
                    </div>
                  );
                })}
                {!teamLoading && teamMembers.length === 0 && (
                  <div style={{ padding: '16px 20px', fontSize: 12, color: g400 }}>No other members in your firm yet.</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Other tabs placeholder */}
      {activeTab !== 'research' && activeTab !== 'map' && activeTab !== 'search' && activeTab !== 'analytics' && activeTab !== 'team' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: g400 }}>
          <div style={{ fontSize: 40 }}>{TABS.find(t => t.id === activeTab)?.label.split(' ')[0]}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: g600 }}>{TABS.find(t => t.id === activeTab)?.label.replace(/^\S+\s/, '')}</div>
          <div style={{ fontSize: 12 }}>Coming soon</div>
        </div>
      )}
    </div>
  );
}
