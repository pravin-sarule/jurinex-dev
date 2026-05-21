import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

/**
 * Horizontally scrollable analysis-prompt chips (replaces dropdown selector).
 * onSelect(secret) — parent handles name / id / llm_name as needed.
 */
const PromptChipsBar = ({
  secrets = [],
  isLoading = false,
  selectedSecretId = null,
  activeLabel = null,
  onSelect,
  disabled = false,
  className = '',
  size = 'default',
}) => {
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return undefined;
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateScrollButtons)
      : null;
    ro?.observe(el);
    window.addEventListener('resize', updateScrollButtons);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      ro?.disconnect();
      window.removeEventListener('resize', updateScrollButtons);
    };
  }, [secrets, isLoading, updateScrollButtons]);

  const scrollBy = (direction) => {
    scrollRef.current?.scrollBy({ left: direction * 220, behavior: 'smooth' });
  };

  const chipClass =
    size === 'compact'
      ? 'px-2 py-0.5 text-[11px] leading-tight'
      : 'px-2.5 py-1 text-xs leading-tight';

  if (isLoading) {
    return (
      <div className={`flex items-center gap-1.5 py-0 text-gray-500 text-[11px] ${className}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading prompts…</span>
      </div>
    );
  }

  if (!secrets?.length) return null;

  return (
    <div className={`relative flex items-center gap-0.5 min-w-0 ${className}`}>
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          disabled={disabled}
          className="flex-shrink-0 p-0.5 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:border-gray-300 disabled:opacity-40"
          aria-label="Scroll prompts left"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex flex-1 gap-1.5 overflow-x-auto min-w-0 py-0 prompt-chips-scroll"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {secrets.map((secret) => {
          const isSelected =
            (selectedSecretId != null && selectedSecretId === secret.id) ||
            (activeLabel && activeLabel === secret.name);
          return (
            <button
              key={secret.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect?.(secret)}
              className={`flex-shrink-0 whitespace-nowrap font-medium rounded-full border transition-colors ${chipClass} ${
                isSelected
                  ? 'bg-[#E0F7F6] border-[#21C1B6] text-[#11766f]'
                  : 'bg-white border-gray-200 text-gray-700 hover:border-[#21C1B6] hover:text-[#21C1B6]'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {secret.name}
            </button>
          );
        })}
      </div>

      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          disabled={disabled}
          className="flex-shrink-0 p-0.5 rounded-md border border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:border-gray-300 disabled:opacity-40"
          aria-label="Scroll prompts right"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

export default PromptChipsBar;
