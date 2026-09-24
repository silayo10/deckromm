import React, { useRef } from 'react';
import { Library, Star, HardDrive, FolderHeart, History } from 'lucide-react';
import { Collection, Platform } from '../types';
import { useScrollIntoView } from '../hooks/useScrollIntoView';

export type LibrarySource =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'favorites' }
  | { kind: 'installed' }
  | { kind: 'platform'; platform: Platform }
  | { kind: 'collection'; collection: Collection };

export const sourceKey = (s: LibrarySource) =>
  s.kind === 'platform' ? `p:${s.platform.id}` : s.kind === 'collection' ? `c:${s.collection.id}` : s.kind;

interface PlatformBarProps {
  sources: LibrarySource[];
  active: LibrarySource;
  onSelect: (s: LibrarySource) => void;
}

function labelFor(s: LibrarySource) {
  switch (s.kind) {
    case 'all': return { label: 'All Games', icon: <Library size={16} />, count: undefined };
    case 'recent': return { label: 'Recently Played', icon: <History size={16} />, count: undefined };
    case 'favorites': return { label: 'Favorites', icon: <Star size={16} />, count: undefined };
    case 'installed': return { label: 'On this Deck', icon: <HardDrive size={16} />, count: undefined };
    case 'platform': return { label: s.platform.name, icon: null, count: s.platform.gameCount };
    case 'collection': return { label: s.collection.name, icon: <FolderHeart size={16} />, count: s.collection.romCount };
  }
}

/** Horizontal platform / collection selector. LB / RB cycle it from anywhere. */
export const PlatformBar: React.FC<PlatformBarProps> = ({ sources, active, onSelect }) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  const activeKey = sourceKey(active);
  useScrollIntoView(activeRef, activeKey);

  return (
    <nav
      data-focus-memory="platforms"
      className="shrink-0 flex items-center gap-2 px-5 py-2.5 overflow-x-auto no-scrollbar bg-deck-bg"
      aria-label="Platforms"
    >
      <span className="text-xs font-bold text-deck-dim mr-1 shrink-0">L1</span>
      {sources.map((s) => {
        const key = sourceKey(s);
        const isActive = key === activeKey;
        const { label, icon, count } = labelFor(s);
        return (
          <button
            key={key}
            ref={isActive ? activeRef : undefined}
            data-focusable
            data-source-key={key}
            onClick={() => onSelect(s)}
            className={`deck-chip shrink-0 h-10 px-4 flex items-center gap-2 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors ${
              isActive ? 'bg-deck-text text-deck-bg border-deck-text' : 'bg-deck-panel border-deck-line text-deck-text'
            }`}
          >
            {icon}
            {label}
            {count != null && <span className={`text-xs ${isActive ? 'text-deck-bg/70' : 'text-deck-dim'}`}>{count}</span>}
          </button>
        );
      })}
      <span className="text-xs font-bold text-deck-dim ml-1 shrink-0">R1</span>
    </nav>
  );
};
