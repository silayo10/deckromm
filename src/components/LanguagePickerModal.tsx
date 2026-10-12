import React, { useMemo, useRef, useState } from 'react';
import { X, Search, Globe, Check, ShieldAlert } from 'lucide-react';
import { soundService } from '../services/soundService';
import { useFocusScope } from '../hooks/useFocusScope';
import { PRESET_LANGUAGES } from '../utils/languageUtils';

export interface LanguageCountOption {
  id: string;
  label: string;
  shortLabel: string;
  flag?: string;
  count: number;
  description?: string;
}

interface LanguagePickerModalProps {
  selectedLanguage: string;
  availableLanguages: LanguageCountOption[];
  totalGamesCount: number;
  platformName: string;
  onSelect: (langId: string) => void;
  onClose: () => void;
}

export const LanguagePickerModal: React.FC<LanguagePickerModalProps> = ({
  selectedLanguage,
  availableLanguages,
  totalGamesCount,
  platformName,
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableLanguages;
    return availableLanguages.filter(
      (l) => l.label.toLowerCase().includes(q) || l.shortLabel.toLowerCase().includes(q)
    );
  }, [availableLanguages, query]);

  useFocusScope(modalRef, {
    name: 'LanguagePickerModal',
    onBack: onClose,
    initialFocus: '#lang-picker-active',
  });

  const handlePick = (id: string) => {
    soundService.playSelect();
    onSelect(id);
    onClose();
  };

  const activeId = selectedLanguage || 'all';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filter library by language"
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/75 backdrop-blur-md deck-enter"
    >
      <div
        ref={modalRef}
        className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl bg-deck-panel border border-deck-line shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-deck-line bg-deck-panel-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-deck-accent/20 border border-deck-accent/40 flex items-center justify-center text-deck-accent text-xl">
              <Globe size={20} />
            </div>
            <div>
              <h2 className="text-xl font-black text-white">Filter by Language</h2>
              <p className="text-xs text-deck-dim">
                Browsing {platformName} · Filter out Japanese or foreign releases
              </p>
            </div>
          </div>
          <button
            data-focusable
            onClick={onClose}
            className="h-9 w-9 rounded-xl border border-deck-line bg-deck-panel flex items-center justify-center text-deck-dim hover:text-white hover:border-deck-dim transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Quick Search */}
        {availableLanguages.length > 5 && (
          <div className="p-4 border-b border-deck-line/60 bg-deck-bg/40">
            <div className="relative">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-deck-dim" />
              <input
                data-focusable
                data-keyboard-title="Search Languages"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search languages..."
                className="w-full h-10 pl-10 pr-9 rounded-xl bg-deck-panel-2 border border-deck-line text-sm text-deck-text placeholder:text-deck-dim/60 focus:border-deck-accent focus:outline-none"
              />
              {query && (
                <button
                  data-focusable
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-deck-dim hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Language Options List */}
        <div data-scroll-primary className="deck-scroll flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {filtered.map((opt) => {
            const isActive = activeId === opt.id;
            const isNoJa = opt.id === 'no-ja';

            return (
              <button
                key={opt.id}
                id={isActive ? 'lang-picker-active' : undefined}
                data-focusable
                onClick={() => handlePick(opt.id)}
                className={`deck-row w-full min-h-14 p-3.5 rounded-xl border flex items-center justify-between text-left transition-all ${
                  isActive
                    ? 'bg-deck-accent/25 border-deck-accent shadow-md'
                    : isNoJa
                    ? 'bg-amber-950/20 border-amber-900/40 hover:border-amber-500/50'
                    : 'bg-deck-panel/60 border-deck-line hover:border-deck-dim/50'
                }`}
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <span className="text-2xl shrink-0">{opt.flag || '🌐'}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold text-sm ${isActive ? 'text-white' : isNoJa ? 'text-amber-200' : 'text-deck-text'}`}>
                        {opt.label}
                      </span>
                      {isNoJa && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          Recommended
                        </span>
                      )}
                    </div>
                    {opt.description && (
                      <p className="text-xs text-deck-dim truncate mt-0.5">{opt.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-lg tabular-nums font-semibold ${
                      isActive
                        ? 'bg-deck-accent text-white'
                        : 'bg-deck-panel-2 text-deck-dim border border-deck-line'
                    }`}
                  >
                    {opt.count} {opt.count === 1 ? 'game' : 'games'}
                  </span>
                  {isActive && <Check size={18} className="text-deck-accent" />}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer tip */}
        <div className="px-6 py-3 border-t border-deck-line bg-deck-panel-2 flex items-center justify-between text-xs text-deck-dim">
          <span>Tip: Press B to cancel</span>
          <span>{totalGamesCount} total games in library</span>
        </div>
      </div>
    </div>
  );
};
