import React, { useEffect, useState, useRef, useMemo } from 'react';
import apiService from '../services/api';
import { Zap, Clock, ShieldAlert, Database, ChevronDown, ChevronUp } from 'lucide-react';

const INR_RATE    = 95.42;
const MAX_CONTEXT = 1_048_576;
const FALLBACK_PRICING_PRO = { storageRate: 4.50, cachedInputRate: 0.125, newInputRate: 1.25, outputRate: 10.00 };
const FALLBACK_PRICING_FLASH = { storageRate: 1.00, cachedInputRate: 0.03, newInputRate: 0.30, outputRate: 2.50 };

const fallbackPricingForModel = (modelName) => {
  const m = (modelName || '').toLowerCase();
  if (m.includes('pro')) return FALLBACK_PRICING_PRO;
  if (m.includes('lite')) return { storageRate: 1.00, cachedInputRate: 0.01, newInputRate: 0.10, outputRate: 0.40 };
  return FALLBACK_PRICING_FLASH;
};

const fmt = (n) => new Intl.NumberFormat('en-US').format(Math.round(n) || 0);
const fmtINR = (usd) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 4, maximumFractionDigits: 6 }).format((usd || 0) * INR_RATE);
const fmtUsdPerM = (rate) => `$${Number(rate || 0).toFixed(3)}/M`;
const fmtCountdown = (s) => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

const computeStorageCost = (docToks, elapsedMs, pricing) => docToks * ((pricing?.storageRate ?? FALLBACK_PRICING_PRO.storageRate) / 1_000_000) * Math.max(0, elapsedMs / 3_600_000);

const resolveStorageEndMs = (sessionData, now = Date.now()) => {
  if (sessionData.deletedAt) return new Date(sessionData.deletedAt).getTime();
  if (sessionData.status !== 'active' && sessionData.expiresAt) return new Date(sessionData.expiresAt).getTime();
  return now;
};

const fmtTime = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const SectionLabel = ({ children }) => <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">{children}</p>;
const Divider = () => <div className="border-t border-gray-100 my-3" />;

const TokenOverview = ({ sessionId, fileId, isChatActive, sessionMetrics, preSessionDocTokens = 0 }) => {
  const [sessionData, setSessionData] = useState(sessionMetrics || null);
  const [showHistory, setShowHistory] = useState(false);
  const [liveStorageCost, setLiveStorageCost] = useState(0);
  const [liveTotalCost, setLiveTotalCost] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const tickRef = useRef(null);
  const displayModel = sessionData?.modelName || 'gemini-2.5-flash';

  const activePricing = useMemo(() => {
    if (sessionData?.pricing && typeof sessionData.pricing === 'object') return sessionData.pricing;
    return fallbackPricingForModel(displayModel);
  }, [sessionData?.pricing, displayModel]);

  // Sync with prop updates
  useEffect(() => {
    if (sessionMetrics) setSessionData(sessionMetrics);
  }, [sessionMetrics]);

  // Polling for latest metrics if not provided directly
  useEffect(() => {
    if (!isChatActive || (!fileId && !sessionId)) return;
    let cancelled = false;

    const fetchMetrics = async () => {
      try {
        let res;
        if (fileId) res = await apiService.getGeminiCacheFileStatus(fileId);
        else if (sessionId) res = await apiService.getGeminiCacheStatus(sessionId);
        
        if (res && res.success && res.data && !cancelled) {
          if (res.data.status === 'NOT_FOUND' && sessionId && fileId) {
             res = await apiService.getGeminiCacheFileStatus(fileId);
          }
          if (res?.data && res.data.status !== 'NOT_FOUND') {
             setSessionData(res.data);
          }
        }
      } catch (e) {
        console.error("Failed to fetch token overview metrics:", e);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, fileId, isChatActive]);

  // Timer for active cache elapsed time and cost
  useEffect(() => {
    clearInterval(tickRef.current);
    if (!sessionData?.createdAt) return;
    
    const tick = () => {
      const now = Date.now();
      const createdMs = new Date(sessionData.createdAt).getTime();
      const isActive = sessionData.status === 'active';
      const docToks = sessionData.documentTokens || 0;

      if (isActive) {
        const elapsed = Math.max(0, now - createdMs);
        setElapsedSeconds(Math.floor(elapsed / 1000));
        const storage = computeStorageCost(docToks, elapsed, activePricing);
        setLiveStorageCost(storage);
        const queryCost = sessionData.totalQueryCost || 0;
        setLiveTotalCost(sessionData.grandTotal != null ? sessionData.grandTotal : (sessionData.setupCost || 0) + storage + queryCost);

        if (sessionData.expiresAt) {
          const remain = Math.max(0, Math.ceil((new Date(sessionData.expiresAt).getTime() - now) / 1000));
          setRemainingSeconds(remain);
          if (remain === 0) clearInterval(tickRef.current);
        }
      } else {
        const endMs = resolveStorageEndMs(sessionData, now);
        const frozenElapsed = Math.max(0, endMs - createdMs);
        setElapsedSeconds(Math.floor(frozenElapsed / 1000));
        const frozenStorage = computeStorageCost(docToks, frozenElapsed, activePricing);
        setLiveStorageCost(frozenStorage);
        const frozenQueryCost = sessionData.totalQueryCost || 0;
        setLiveTotalCost(sessionData.grandTotal != null ? sessionData.grandTotal : (sessionData.setupCost || 0) + frozenStorage + frozenQueryCost);
        setRemainingSeconds(0);
        clearInterval(tickRef.current);
      }
    };
    tick();
    tickRef.current = setInterval(tick, 100);
    return () => clearInterval(tickRef.current);
  }, [sessionData, activePricing]);

  const session = sessionData || {};
  const hasSession    = !!session.createdAt;
  const isActive      = session.status === 'active';
  const docTokens     = session.documentTokens      || preSessionDocTokens || 0;
  const cacheTotal    = session.cacheTotalTokens    || docTokens;
  const sysInstToks   = session.systemInstructionTokens ?? Math.max(0, cacheTotal - docTokens);
  const newPrompts    = session.totalNewPromptTokens || 0;
  const outputToks    = session.totalOutputTokens    || 0;
  const displayTotal  = session.displayTotal ?? (docTokens + newPrompts + outputToks);
  const docPct        = Math.min(100, (docTokens  / MAX_CONTEXT) * 100);
  const inputPct      = Math.min(100, (newPrompts / MAX_CONTEXT) * 100);
  const outputPct     = Math.min(100, (outputToks / MAX_CONTEXT) * 100);
  const setupCost     = session.setupCost      || 0;
  const totalQueryCost= session.totalQueryCost || 0;
  const lastQuery     = session.lastQuery      || null;
  const queryHistory  = session.queryHistory   || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 w-full">
      <div className="flex items-center gap-2 mb-4 border-b border-gray-100 pb-3">
        <div className="w-8 h-8 rounded-lg bg-[#21C1B6]/10 flex items-center justify-center">
          <Database className="h-4 w-4 text-[#21C1B6]" />
        </div>
        <span className="text-[15px] font-bold text-gray-800">Token & Cache Overview</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Token Usage Section */}
        <div>
          <SectionLabel>Token Usage</SectionLabel>
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-[10px] text-gray-400">Context Window</span>
            <span className="text-xs font-mono text-gray-700">
              {fmt(displayTotal)} <span className="text-gray-400">/ {fmt(MAX_CONTEXT)}</span>
            </span>
          </div>

          <div className="w-full h-2 bg-gray-100 rounded-full flex overflow-hidden mb-3">
            <div className="bg-emerald-400 h-full transition-all duration-300" style={{ width: `${Math.max(docTokens > 0 ? 2 : 0, docPct)}%` }} />
            <div className="bg-[#21C1B6] h-full transition-all duration-300" style={{ width: `${Math.max(newPrompts > 0 ? 1 : 0, inputPct)}%` }} />
            <div className="bg-violet-400 h-full rounded-r-full transition-all duration-300" style={{ width: `${Math.max(outputToks > 0 ? 1 : 0, outputPct)}%` }} />
          </div>

          {[
            { color: 'bg-emerald-400', label: 'Document (file)', val: docTokens, badge: 'file' },
            ...(sysInstToks > 0 ? [{ color: 'bg-teal-300', label: 'System prompt (in cache)', val: sysInstToks, badge: 'cached' }] : []),
            { color: 'bg-[#21C1B6]',  label: 'New input tokens', val: newPrompts, badge: 'prompts' },
            { color: 'bg-violet-400',  label: 'Output tokens',    val: outputToks },
          ].map(({ color, label, val, badge }) => (
            <div key={label} className="flex justify-between items-center py-1">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full inline-block flex-shrink-0 ${color}`} />
                <span className="text-gray-500 text-xs">{label}</span>
                {badge && <span className="text-[9px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded-full">{badge}</span>}
              </div>
              <span className="font-mono text-xs text-gray-800">{fmt(val)}</span>
            </div>
          ))}

          <div className="flex justify-between items-baseline pt-1.5 border-t border-gray-100 mt-1">
            <span className="text-xs text-gray-700 font-semibold pl-4">Total tokens</span>
            <span className="font-mono text-xs font-bold text-gray-900">{fmt(displayTotal)}</span>
          </div>
        </div>

        {/* Cost Section */}
        <div>
          <SectionLabel>Session Cost</SectionLabel>
          {!hasSession ? (
            <p className="text-xs text-gray-400 italic mb-4">Cost tracking starts after your first prompt.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-xs text-gray-700 font-medium">Setup (cache write)</span>
                  <p className="text-[10px] text-gray-400">
                    {fmt(cacheTotal)} cached tokens × ₹{((activePricing.creationRate ?? activePricing.newInputRate) * INR_RATE / 1_000_000).toFixed(6)}/token
                  </p>
                </div>
                <span className="font-mono text-xs text-gray-800 font-semibold">{fmtINR(setupCost)}</span>
              </div>

              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-1.5">
                    {isActive && <span className="animate-ping inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 opacity-75 flex-shrink-0" />}
                    <span className="text-xs text-gray-700 font-medium">Cache storage</span>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {elapsedSeconds}s elapsed · {fmt(cacheTotal)} cached tokens
                    {!isActive && <span className="text-orange-400 ml-1">(stopped)</span>}
                  </p>
                </div>
                <span className="font-mono text-xs text-gray-800 font-semibold">{fmtINR(liveStorageCost)}</span>
              </div>

              {totalQueryCost > 0 && (
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-xs text-gray-700 font-medium">Query costs</span>
                    <p className="text-[10px] text-gray-400">
                      {sessionData?.totalQueries || queryHistory.length} completed quer{(sessionData?.totalQueries || queryHistory.length) === 1 ? 'y' : 'ies'}
                    </p>
                  </div>
                  <span className="font-mono text-xs text-gray-800 font-semibold">{fmtINR(totalQueryCost)}</span>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-[#21C1B6]/20 bg-gradient-to-r from-[#21C1B6]/5 to-teal-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-[#21C1B6] uppercase tracking-wider">Grand Total</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Setup + storage + queries</p>
              </div>
              <span className="text-xl font-bold text-gray-900 font-mono">{fmtINR(liveTotalCost)}</span>
            </div>
          </div>
        </div>
      </div>

      <Divider />

      {/* Query History */}
      <button onClick={() => setShowHistory(s => !s)} className="flex items-center justify-between w-full group py-1">
        <SectionLabel>Query History ({queryHistory.length})</SectionLabel>
        {showHistory ? <ChevronUp className="h-4 w-4 text-gray-400 group-hover:text-gray-600 -mt-2" /> : <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-gray-600 -mt-2" />}
      </button>

      {showHistory && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          {queryHistory.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No queries yet</p>
          ) : (
            queryHistory.map((q) => (
              <div key={q.index} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-bold text-[#21C1B6] uppercase tracking-wide">Query #{q.index}</span>
                  <span className="text-[10px] text-gray-400 font-mono">{fmtTime(q.createdAt)}</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-gray-500">Cached</span><span className="font-mono text-gray-700">{fmt(q.cachedTokens)}</span></div>
                    <span className="font-mono text-gray-700">{fmtINR(q.cachedTokens * (activePricing.cachedInputRate / 1_000_000))}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[#21C1B6]" /><span className="text-gray-500">Input</span><span className="font-mono text-gray-700">{fmt(q.promptTokens)}</span></div>
                    <span className="font-mono text-gray-700">{fmtINR(q.promptTokens * (activePricing.newInputRate / 1_000_000))}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-violet-400" /><span className="text-gray-500">Output</span><span className="font-mono text-gray-700">{fmt(q.outputTokens)}</span></div>
                    <span className="font-mono text-gray-700">{fmtINR(q.outputTokens * (activePricing.outputRate / 1_000_000))}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2 mt-2 border-t border-gray-200">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Query cost</span>
                  <span className="font-mono text-xs font-bold text-gray-900">{fmtINR(q.queryCost)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Footer Info */}
      <div className="flex items-center justify-between mt-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
        {!hasSession ? (
          <div className="flex items-center gap-1.5 text-xs text-[#21C1B6]">
            <Zap className="h-4 w-4" />
            <span className="font-semibold">Ready to cache document</span>
          </div>
        ) : isActive ? (
          <div className="flex items-center gap-1.5 text-xs text-emerald-600">
            <Clock className="h-4 w-4 animate-pulse" />
            <span className="font-semibold">Cache Active · Expires in {fmtCountdown(remainingSeconds)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-orange-500">
            <ShieldAlert className="h-4 w-4" />
            <span className="font-semibold">
              {sessionData?.deleteReason === 'inactivity_timeout' ? 'Expired (idle) · recreating on next prompt' : 'Deleted · recreating on next prompt'}
            </span>
          </div>
        )}
        <div className="text-[10px] text-gray-400 flex flex-col items-end">
          <span className="font-mono">{displayModel}</span>
          <span>{fmt(MAX_CONTEXT)} token limit</span>
        </div>
      </div>
    </div>
  );
};

export default TokenOverview;
