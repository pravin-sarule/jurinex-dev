import React from 'react';
import { X, Clock, AlertCircle } from 'lucide-react';
import { coerceChatErrorDisplay } from '../utils/llmQuotaMessages';

/**
 * Same fixed toast/modal pattern as ChatModelPage for quota and generic chat errors.
 */
export default function ChatQuotaErrorModal({ error, onDismiss }) {
  const display = coerceChatErrorDisplay(error);
  if (!display) return null;

  const { isLimit, title, body, limitType } = display;
  const limitIcons = { minute: '⏱️', hour: '🕐', daily: '📅', tokens: '🔋' };
  const limitEmoji = isLimit ? limitIcons[limitType] || '🚫' : null;

  if (isLimit) {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[92vw] max-w-md pointer-events-auto">
        <div className="bg-white rounded-2xl shadow-2xl border border-[#cfe1db] overflow-hidden">
          <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <span className="text-xl leading-none">{limitEmoji}</span>
              <h3 className="text-white font-semibold text-sm tracking-wide">{title}</h3>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="text-white/70 hover:text-white transition-colors ml-3"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="bg-[#eef5f2] px-5 py-4">
            <p className="text-sm text-[#2b3528] leading-relaxed">{body}</p>
            <div className="mt-4 pt-3 border-t border-[#cfe1db] flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-xs text-[#1f6b5f]/70">
                <Clock className="h-3 w-3" />
                <span>Limits reset automatically</span>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="px-4 py-1.5 bg-[#21C1B6] hover:bg-[#1AA49B] text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[92vw] max-w-md pointer-events-auto">
      <div className="bg-white rounded-xl shadow-xl border border-[#cfe1db] overflow-hidden">
        <div className="bg-gradient-to-r from-[#21C1B6] to-[#1f6b5f] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 text-white flex-shrink-0" />
            <h3 className="text-white font-semibold text-sm">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-white/70 hover:text-white transition-colors ml-3"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="bg-[#eef5f2] px-4 py-3">
          <p className="text-sm text-[#2b3528] leading-relaxed">{body}</p>
        </div>
      </div>
    </div>
  );
}
