import React, { useState, useCallback, useRef } from 'react';
import StructuredCaseView from '../components/StructuredCaseView';
import { summarizeCase } from '../api/summarizeCase';

/**
 * StructuredCaseDemo
 * ------------------
 * Self-contained page to exercise POST /api/summarize. Paste case text (and an
 * optional instruction), submit, and the structured JSON renders via
 * StructuredCaseView. Drop into your router, e.g.:
 *
 *   import StructuredCaseDemo from './pages/StructuredCaseDemo';
 *   <Route path="/structured-case" element={<StructuredCaseDemo />} />
 */
const SAMPLE = `IN THE COURT OF CIVIL JUDGE, SENIOR DIVISION, NILANGA
Special Civil Suit No. 42 of 2021
Krishnaji Atmaram Anandwade  ... Plaintiff
versus
Sagar Dinkar Martande       ... Defendant

The plaintiff advanced a hand-loan of Rs. 30,00,000/- to the defendant on
18/01/2021. Despite repeated demands the defendant failed to repay. The suit is
for recovery of Rs. 38,22,500/- (Principal Rs. 30,00,000/- + Interest
Rs. 8,22,500/-). Notice was issued on 04/04/2024; the defendant refused to pay.`;

const StructuredCaseDemo = () => {
  const [caseText, setCaseText] = useState(SAMPLE);
  const [query, setQuery] = useState('Summarise this recovery suit.');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const onSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setLoading(true);
      setError(null);
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const res = await summarizeCase(
          { caseText, query },
          { signal: abortRef.current.signal },
        );
        setResult(res);
      } catch (err) {
        if (err?.name !== 'AbortError') setError(err.message || 'Request failed');
      } finally {
        setLoading(false);
      }
    },
    [caseText, query],
  );

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16, color: '#0f172a' }}>
        Structured Case Summary
      </h1>

      <form onSubmit={onSubmit} style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Instruction (optional)
        </label>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Summarise the recovery claim"
          style={{
            width: '100%', padding: '8px 12px', marginBottom: 14, fontSize: 14,
            border: '1px solid #d1d5db', borderRadius: 8,
          }}
        />

        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Case text
        </label>
        <textarea
          value={caseText}
          onChange={(e) => setCaseText(e.target.value)}
          rows={10}
          style={{
            width: '100%', padding: '10px 12px', fontSize: 13, lineHeight: 1.6,
            border: '1px solid #d1d5db', borderRadius: 8, fontFamily: 'monospace',
            resize: 'vertical',
          }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 14, padding: '9px 18px', fontSize: 14, fontWeight: 600,
            color: '#fff', background: loading ? '#94a3b8' : '#4f46e5',
            border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Analyzing…' : 'Summarize'}
        </button>
      </form>

      <StructuredCaseView result={result} loading={loading} error={error} />
    </div>
  );
};

export default StructuredCaseDemo;
