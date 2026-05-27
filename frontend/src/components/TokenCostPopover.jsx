/**
 * TokenCostPopover.jsx — White theme, Gemini 2.5 Flash context-cache cost tracker.
 * Shows TOKEN USAGE · SESSION COST · QUERY HISTORY · GRAND TOTAL
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, Clock, Trash2, RefreshCw, X, ShieldAlert, Database, ChevronDown, ChevronUp } from 'lucide-react';
import { CHAT_SERVICE_URL } from '../config/apiConfig';

// ── Constants ─────────────────────────────────────────────────────────────────
const INR_RATE    = 95.42;
const MAX_CONTEXT = 1_048_576;
const PRICING = {
  storageRate:     1.00,
  cachedInputRate: 0.03,
  newInputRate:    0.30,
  outputRate:      2.50,
};

// ── Formatters ─────────────────────────────────────────────────────────────────
const fmt = (n) => new Intl.NumberFormat('en-US').format(Math.round(n) || 0);

const fmtINR = (usd) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR',
    minimumFractionDigits: 4, maximumFractionDigits: 6,
  }).format((usd || 0) * INR_RATE);

const fmtCountdown = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

// ── Tiny helpers ───────────────────────────────────────────────────────────────
const SectionLabel = ({ children }) => (
  <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">{children}</p>
);

const Divider = () => <div className="border-t border-gray-100 my-3" />;

// ── Main Component ─────────────────────────────────────────────────────────────
const TokenCostPopover = ({
  sessionId,
  fileId              = null,
  initialData         = null,
  preSessionDocTokens = 0,    // token count from free countTokens call before first query
  isLoadingTokens     = false,
  modelName           = 'gemini-2.5-flash',
  onCacheExpired      = null,
  triggerType         = 'click',
}) => {
  const [isOpen,          setIsOpen]          = useState(false);
  const [sessionData,     setSessionData]     = useState(initialData);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState(null);
  const [showHistory,     setShowHistory]     = useState(false);

  const [liveStorageCost, setLiveStorageCost] = useState(0);
  const [liveTotalCost,   setLiveTotalCost]   = useState(0);
  const [remainingSeconds,setRemainingSeconds]= useState(120);
  const [elapsedSeconds,  setElapsedSeconds]  = useState(0);

  const popoverRef = useRef(null);
  const tickRef    = useRef(null);
  const hoverTimer = useRef(null);

  // ── Hover ──────────────────────────────────────────────────────────────────
  const handleMouseEnter = () => {
    if (triggerType !== 'hover' && triggerType !== 'hover-text') return;
    clearTimeout(hoverTimer.current);
    setIsOpen(true);
  };
  const handleMouseLeave = () => {
    if (triggerType !== 'hover' && triggerType !== 'hover-text') return;
    hoverTimer.current = setTimeout(() => setIsOpen(false), 200);
  };

  // ── Server polling ─────────────────────────────────────────────────────────
  // Prefer file-based endpoint (returns cross-session full history) when fileId is available.
  const fetchStatus = useCallback(async () => {
    const base  = CHAT_SERVICE_URL || 'http://localhost:8080';
    const token = localStorage.getItem('token');
    const url   = fileId
      ? `${base}/api/chat/cache/file-status/${fileId}`
      : sessionId
        ? `${base}/api/chat/cache/status/${sessionId}`
        : null;

    if (!url) return;

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        if (res.status === 404 || res.status === 410) {
          setSessionData(p => p ? { ...p, status: 'deleted', deleteReason: 'inactivity_timeout' } : null);
          onCacheExpired?.();
          return;
        }
        throw new Error(`Status ${res.status}`);
      }
      const json = await res.json();
      if (json.success && json.data) { setSessionData(json.data); setError(null); }
    } catch (err) {
      console.warn('[TokenCostPopover] fetchStatus:', err.message);
    }
  }, [fileId, sessionId, onCacheExpired]);

  useEffect(() => {
    if (!isOpen) return;
    if (!fileId && !sessionId) return;
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [isOpen, fileId, sessionId, fetchStatus]);

  useEffect(() => {
    if (!initialData) return;
    setSessionData(prev => {
      // Skip update if session and status are unchanged to prevent ticker restart cascade
      if (
        prev?.sessionId === initialData.sessionId &&
        prev?.status    === initialData.status    &&
        prev?.expiresAt === initialData.expiresAt
      ) return prev;
      return initialData;
    });
  }, [initialData]);

  // ── 100ms ticker ───────────────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(tickRef.current);
    if (!sessionData?.createdAt) return;
    const tick = () => {
      const now       = Date.now();
      const createdMs = new Date(sessionData.createdAt).getTime();
      const isActive  = sessionData.status === 'active';
      const docToks   = sessionData.documentTokens || 0;

      if (isActive) {
        // Live: storage cost accumulates in real time while cache is active
        const elapsed = Math.max(0, now - createdMs);
        const hrs     = elapsed / 3_600_000;
        setElapsedSeconds(Math.floor(elapsed / 1000));
        const storage = docToks * (PRICING.storageRate / 1_000_000) * hrs;
        setLiveStorageCost(storage);
        setLiveTotalCost((sessionData.setupCost || 0) + storage + (sessionData.totalQueryCost || 0));

        // Countdown to auto-expiry
        if (sessionData.expiresAt) {
          const remain = Math.max(0, Math.ceil((new Date(sessionData.expiresAt).getTime() - now) / 1000));
          setRemainingSeconds(remain);
          if (remain === 0) {
            // Clear interval first to prevent double-fire on next tick
            clearInterval(tickRef.current);
            setSessionData(p => p.status === 'active'
              ? { ...p, status: 'deleted', deleteReason: 'inactivity_timeout' }
              : p
            );
            onCacheExpired?.();
          }
        }
      } else {
        // Frozen: cache was deleted — stop the storage clock at the deletion moment
        const deletedMs = sessionData.deletedAt
          ? new Date(sessionData.deletedAt).getTime()
          : createdMs;
        const frozenElapsed = Math.max(0, deletedMs - createdMs);
        setElapsedSeconds(Math.floor(frozenElapsed / 1000));
        // Use server-side storageCost if available, otherwise compute from frozen duration
        const frozenStorage = sessionData.storageCost != null
          ? sessionData.storageCost
          : docToks * (PRICING.storageRate / 1_000_000) * (frozenElapsed / 3_600_000);
        setLiveStorageCost(frozenStorage);
        setLiveTotalCost((sessionData.setupCost || 0) + frozenStorage + (sessionData.totalQueryCost || 0));
        setRemainingSeconds(0);
        // Stop the interval — nothing to update anymore
        clearInterval(tickRef.current);
      }
    };
    tick();
    tickRef.current = setInterval(tick, 100);
    return () => clearInterval(tickRef.current);
  }, [sessionData, onCacheExpired]);

  // ── Outside click ──────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => { if (popoverRef.current && !popoverRef.current.contains(e.target)) setIsOpen(false); };
    if (isOpen) document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [isOpen]);

  // ── Manual delete ──────────────────────────────────────────────────────────
  const handleDelete = async (e) => {
    e.stopPropagation();
    // When using file-based polling, the active sessionId lives in sessionData
    const activeSessionId = sessionData?.sessionId || sessionId;
    if (!activeSessionId) return;
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const base  = CHAT_SERVICE_URL || 'http://localhost:8080';
      const res = await fetch(`${base}/api/chat/cache/delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      const json = await res.json();
      if (json.success) setSessionData(p => ({ ...p, status: 'deleted', deleteReason: 'manual' }));
    } catch (err) {
      setError('Delete failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const hasSession    = !!sessionData;
  const isActive      = sessionData?.status === 'active';
  // Before the first query, show the pre-session document token count so the
  // chip always reflects the document size, not "0 tokens".
  const docTokens     = sessionData?.documentTokens      || preSessionDocTokens || 0;
  const newPrompts    = sessionData?.totalNewPromptTokens || 0;
  const outputToks    = sessionData?.totalOutputTokens    || 0;
  const displayTotal  = docTokens + newPrompts + outputToks;
  const docPct        = Math.min(100, (docTokens  / MAX_CONTEXT) * 100);
  const inputPct      = Math.min(100, (newPrompts / MAX_CONTEXT) * 100);
  const outputPct     = Math.min(100, (outputToks / MAX_CONTEXT) * 100);
  const setupCost     = sessionData?.setupCost      || 0;
  const totalQueryCost= sessionData?.totalQueryCost || 0;
  const lastQuery     = sessionData?.lastQuery      || null;
  const queryHistory  = sessionData?.queryHistory   || [];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="relative inline-block text-left" ref={popoverRef}>

      {/* Trigger chip */}
      {triggerType === 'hover-text' ? (
        <span
          onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
          className="text-xs text-[#21C1B6] hover:underline cursor-pointer font-bold"
        >
          {isActive ? `(${fmt(docTokens)} cached)` : '(Tokens & Cost)'}
        </span>
      ) : (
        <button
          onClick={() => setIsOpen(s => !s)}
          onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all shadow-sm ${
            isOpen
              ? 'bg-[#21C1B6] text-white border-[#1AA49B]'
              : isActive
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                : hasSession
                  ? 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                  : 'bg-[#21C1B6]/5 text-[#21C1B6] border-[#21C1B6]/20 hover:bg-[#21C1B6]/10'
          }`}
        >
          {isLoadingTokens ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          <span>
            {isLoadingTokens ? 'Counting…' : `${fmt(displayTotal)} tokens`}
          </span>
          {isActive && (
            <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-500 text-white font-mono text-[10px]">
              {fmtCountdown(remainingSeconds)}
            </span>
          )}
        </button>
      )}

      {/* Popover card */}
      {isOpen && (
        <div
          onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
          className="absolute right-0 mt-2.5 w-[360px] bg-white text-gray-800 rounded-2xl border border-gray-200 shadow-2xl z-50 overflow-hidden origin-top-right"
        >
          {/* Header */}
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-[#21C1B6]/10 flex items-center justify-center">
                <Database className="h-3.5 w-3.5 text-[#21C1B6]" />
              </div>
              <span className="text-sm font-bold text-gray-800">Token Usage &amp; Cost</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-700 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="p-4 space-y-1 overflow-y-auto max-h-[80vh]">

            {/* ══ PRE-SESSION STATE — document uploaded, no queries yet ══ */}
            {!hasSession && (
              <div className="mb-3 rounded-xl bg-[#21C1B6]/5 border border-[#21C1B6]/15 px-4 py-3 flex items-start gap-3">
                <Zap className="h-4 w-4 text-[#21C1B6] mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-[#21C1B6]">Ready to cache</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {isLoadingTokens
                      ? 'Counting document tokens…'
                      : preSessionDocTokens > 0
                        ? `${fmt(preSessionDocTokens)} tokens will be cached on your first prompt.`
                        : 'Send your first prompt to create the cache.'}
                  </p>
                </div>
              </div>
            )}

            {/* ══ TOKEN USAGE ══ */}
            <SectionLabel>Token Usage</SectionLabel>

            <div className="flex justify-between items-baseline mb-1.5">
              <span className="text-[10px] text-gray-400">Context Window</span>
              <span className="text-xs font-mono text-gray-700">
                {fmt(displayTotal)}{' '}
                <span className="text-gray-400">/ {fmt(MAX_CONTEXT)}</span>
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 bg-gray-100 rounded-full flex overflow-hidden mb-3">
              <div className="bg-emerald-400 h-full transition-all duration-300"
                   style={{ width: `${Math.max(docTokens > 0 ? 2 : 0, docPct)}%` }}
                   title={`Cached doc: ${fmt(docTokens)}`} />
              <div className="bg-[#21C1B6] h-full transition-all duration-300"
                   style={{ width: `${Math.max(newPrompts > 0 ? 1 : 0, inputPct)}%` }}
                   title={`New prompts: ${fmt(newPrompts)}`} />
              <div className="bg-violet-400 h-full rounded-r-full transition-all duration-300"
                   style={{ width: `${Math.max(outputToks > 0 ? 1 : 0, outputPct)}%` }}
                   title={`Output: ${fmt(outputToks)}`} />
            </div>

            {/* Token rows */}
            {[
              { color: 'bg-emerald-400', label: 'Cached document', val: docTokens,  badge: 'cached' },
              { color: 'bg-[#21C1B6]',  label: 'New input tokens', val: newPrompts, badge: 'prompts' },
              { color: 'bg-violet-400',  label: 'Output tokens',    val: outputToks },
            ].map(({ color, label, val, badge }) => (
              <div key={label} className="flex justify-between items-center py-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${color}`} />
                  <span className="text-gray-500 text-xs">{label}</span>
                  {badge && (
                    <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">{badge}</span>
                  )}
                </div>
                <span className="font-mono text-xs text-gray-800">{fmt(val)}</span>
              </div>
            ))}

            <div className="flex justify-between items-baseline pt-1.5 border-t border-gray-100 mt-1">
              <span className="text-xs text-gray-700 font-semibold pl-4">Total tokens</span>
              <span className="font-mono text-xs font-bold text-gray-900">{fmt(displayTotal)}</span>
            </div>

            <Divider />

            {/* ══ SESSION COST ══ */}
            {!hasSession ? (
              <div className="py-2">
                <SectionLabel>Session Cost</SectionLabel>
                <p className="text-xs text-gray-400 italic">Cost tracking starts after your first prompt.</p>
              </div>
            ) : (
            <SectionLabel>Session Cost</SectionLabel>
            )}

            {/* Setup + Storage — only shown once session exists */}
            {hasSession && (
              <>
                <div className="flex justify-between items-start py-1">
                  <div>
                    <span className="text-xs text-gray-700 font-medium">Setup (cache write)</span>
                    <p className="text-[10px] text-gray-400">
                      {fmt(docTokens)} tokens × ₹{(0.30 * INR_RATE / 1_000_000).toFixed(6)}/token
                    </p>
                  </div>
                  <span className="font-mono text-xs text-gray-800 font-semibold">{fmtINR(setupCost)}</span>
                </div>

                <div className="flex justify-between items-start py-1">
                  <div>
                    <div className="flex items-center gap-1.5">
                      {isActive && (
                        <span className="animate-ping inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 opacity-75 flex-shrink-0" />
                      )}
                      <span className="text-xs text-gray-700 font-medium">Cache storage</span>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      {elapsedSeconds}s elapsed · {fmt(docTokens)} tokens
                      {!isActive && <span className="text-orange-400 ml-1">(stopped)</span>}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-gray-800 font-semibold">{fmtINR(liveStorageCost)}</span>
                </div>
              </>
            )}

            <Divider />

            {/* ══ QUERY HISTORY ══ */}
            <button
              onClick={() => setShowHistory(s => !s)}
              className="flex items-center justify-between w-full group"
            >
              <SectionLabel>
                Query History ({queryHistory.length})
              </SectionLabel>
              {showHistory
                ? <ChevronUp   className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 -mt-2" />
                : <ChevronDown className="h-3.5 w-3.5 text-gray-400 group-hover:text-gray-600 -mt-2" />
              }
            </button>

            {showHistory && (
              <div className="space-y-2 mb-1">
                {queryHistory.length === 0 ? (
                  <p className="text-xs text-gray-400 italic text-center py-2">No queries yet</p>
                ) : (
                  queryHistory.map((q) => (
                    <div key={q.index} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      {/* Row header */}
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[10px] font-bold text-[#21C1B6] uppercase tracking-wide">
                          Query #{q.index}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">{fmtTime(q.createdAt)}</span>
                      </div>

                      {/* Token breakdown */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                            <span className="text-gray-500">Cached</span>
                            <span className="font-mono text-gray-700">{fmt(q.cachedTokens)}</span>
                            <span className="text-[9px] text-gray-400">× $0.03/M</span>
                          </div>
                          <span className="font-mono text-gray-700">
                            {fmtINR(q.cachedTokens * (PRICING.cachedInputRate / 1_000_000))}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#21C1B6] inline-block" />
                            <span className="text-gray-500">Input</span>
                            <span className="font-mono text-gray-700">{fmt(q.promptTokens)}</span>
                            <span className="text-[9px] text-gray-400">× $0.30/M</span>
                          </div>
                          <span className="font-mono text-gray-700">
                            {fmtINR(q.promptTokens * (PRICING.newInputRate / 1_000_000))}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                            <span className="text-gray-500">Output</span>
                            <span className="font-mono text-gray-700">{fmt(q.outputTokens)}</span>
                            <span className="text-[9px] text-gray-400">× $2.50/M</span>
                          </div>
                          <span className="font-mono text-gray-700">
                            {fmtINR(q.outputTokens * (PRICING.outputRate / 1_000_000))}
                          </span>
                        </div>
                      </div>

                      {/* Query subtotal */}
                      <div className="flex justify-between items-center pt-2 mt-1 border-t border-gray-200">
                        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Query cost</span>
                        <span className="font-mono text-xs font-bold text-gray-900">{fmtINR(q.queryCost)}</span>
                      </div>
                    </div>
                  ))
                )}

                {/* All queries total */}
                {queryHistory.length > 1 && (
                  <div className="flex justify-between items-center px-3 py-2 rounded-xl bg-gray-100 border border-gray-200">
                    <span className="text-xs font-semibold text-gray-600">All {queryHistory.length} queries</span>
                    <span className="font-mono text-xs font-bold text-gray-900">{fmtINR(totalQueryCost)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Last query quick view (when history is collapsed) */}
            {!showHistory && lastQuery && (
              <div className="bg-gray-50 rounded-xl border border-gray-100 p-2.5 space-y-1.5">
                {[
                  { color: 'bg-emerald-400', label: 'Cached', val: lastQuery.cachedTokens,  rate: PRICING.cachedInputRate },
                  { color: 'bg-[#21C1B6]',  label: 'Input',  val: lastQuery.promptTokens,   rate: PRICING.newInputRate },
                  { color: 'bg-violet-400',  label: 'Output', val: lastQuery.outputTokens,   rate: PRICING.outputRate },
                ].map(({ color, label, val, rate }) => (
                  <div key={label} className="flex justify-between items-center text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${color} inline-block`} />
                      <span className="text-gray-500">{label} <span className="text-gray-700 font-mono">{fmt(val)}</span></span>
                    </div>
                    <span className="font-mono text-gray-700">{fmtINR(val * (rate / 1_000_000))}</span>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-1.5 border-t border-gray-200">
                  <span className="text-xs text-gray-700 font-semibold">Last query total</span>
                  <span className="font-mono text-xs font-bold text-gray-900">{fmtINR(lastQuery.queryCost)}</span>
                </div>
              </div>
            )}

            {!showHistory && !lastQuery && (
              <p className="text-xs text-gray-400 italic">No queries yet</p>
            )}

            <Divider />

            {/* ══ GRAND TOTAL ══ */}
            <div className="rounded-xl border border-[#21C1B6]/20 bg-gradient-to-r from-[#21C1B6]/5 to-teal-50 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-[#21C1B6] uppercase tracking-wider">Grand Total</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Setup + Storage + {sessionData?.totalQueries || 0} quer{sessionData?.totalQueries === 1 ? 'y' : 'ies'}
                  </p>
                </div>
                <span className="text-xl font-bold text-gray-900 font-mono">{fmtINR(liveTotalCost)}</span>
              </div>
            </div>

            <Divider />

            {/* ══ FOOTER ══ */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                {!hasSession ? (
                  <div className="flex items-center gap-1.5 text-xs text-[#21C1B6]">
                    <Zap className="h-3.5 w-3.5" />
                    <span className="font-semibold">Cache ready — waiting for first prompt</span>
                  </div>
                ) : isActive ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <Clock className="h-3.5 w-3.5 animate-pulse" />
                    <span className="font-semibold">Expires in {fmtCountdown(remainingSeconds)}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-orange-500">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    <span className="font-semibold">
                      {sessionData?.deleteReason === 'inactivity_timeout' ? 'Expired (idle) · will recreate on next prompt' : 'Deleted · will recreate on next prompt'}
                    </span>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <button
                    onClick={fetchStatus}
                    disabled={loading || (!fileId && !sessionId)}
                    title="Sync status"
                    className="p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-800 disabled:opacity-40 transition-colors"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                  {isActive && (
                    <button
                      onClick={handleDelete}
                      disabled={loading || !(sessionData?.sessionId || sessionId)}
                      title="Delete cache"
                      className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-100 text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {isActive && (
                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-emerald-400 h-full transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${Math.max(0, (remainingSeconds / 120) * 100)}%` }}
                  />
                </div>
              )}

              <div className="flex justify-between text-[10px] text-gray-400 pt-0.5">
                <span className="font-mono">{modelName}</span>
                <span>{fmt(MAX_CONTEXT)} token limit</span>
              </div>
            </div>

            {error && (
              <p className="text-[11px] text-red-500 bg-red-50 border border-red-100 p-2 rounded-lg text-center">
                {error}
              </p>
            )}

          </div>
        </div>
      )}
    </div>
  );
};

// Wrap with memo so parent re-renders (e.g. ChatModelPage streaming state changes)
// don't re-render this component unless its own props actually change.
export default React.memo(TokenCostPopover);
