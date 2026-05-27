import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { SUBSCRIPTION_PLANS_PATH, UPGRADE_LIMIT_SHORT } from '../utils/planUpgrade';

/**
 * Inline upgrade row for quota/limit modals.
 */
export default function UpgradePlanCta({ onDismiss, className = '' }) {
  const navigate = useNavigate();

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      <p className="text-xs text-[#1f6b5f]/80 leading-relaxed">{UPGRADE_LIMIT_SHORT}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate(SUBSCRIPTION_PLANS_PATH)}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#21C1B6] hover:bg-[#1AA49B] text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
        >
          <CreditCard className="h-3.5 w-3.5" aria-hidden />
          Upgrade plan
        </button>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="px-3 py-1.5 text-[#1f6b5f] hover:text-[#2b3528] text-xs font-medium rounded-lg border border-[#cfe1db] bg-white transition-colors"
          >
            Got it
          </button>
        )}
      </div>
    </div>
  );
}
