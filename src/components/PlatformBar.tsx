import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Library, Star, HardDrive, FolderHeart, History, ChevronDown, Check, Layers, X, Gamepad2 } from 'lucide-react';
import { Collection, Platform } from '../types';
import { useScrollIntoView } from '../hooks/useScrollIntoView';
import { FocusScope } from './FocusScope';
import { soundService } from '../services/soundService';
import { focusManager } from '../services/focusManager';
import { groupPlatformsByFamily, PlatformFamily } from '../utils/platformGrouping';

export type LibrarySource =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'favorites' }
  | { kind: 'installed' }
  | { kind: 'platform'; platform: Platform }
  | { kind: 'platform_family'; familyId: string; name: string; platforms: Platform[] }
  | { kind: 'collection'; collection: Collection };

export const sourceKey = (s: LibrarySource): string => {
  switch (s.kind) {
    case 'platform': return `p:${s.platform.id}`;
    case 'platform_family': return `pf:${s.familyId}`;
    case 'collection': return `c:${s.collection.id}`;
    default: return s.kind;
  }
};

interface PlatformBarProps {
  sources: LibrarySource[];
  active: LibrarySource;
  onSelect: (s: LibrarySource) => void;
  platforms?: Platform[];
  collections?: Collection[];
  offlineMode?: boolean;
}

function quickSourceLabel(kind: 'all' | 'recent' | 'favorites' | 'installed', offlineMode?: boolean) {
  switch (kind) {
    case 'all': return { label: offlineMode ? 'All Downloaded' : 'All Games', icon: <Library size={16} /> };
    case 'recent': return { label: 'Recently Played', icon: <History size={16} /> };
    case 'favorites': return { label: 'Favorites', icon: <Star size={16} /> };
    case 'installed': return { label: 'On this Deck', icon: <HardDrive size={16} /> };
  }
}

/** Horizontal platform bar with family dropdowns for multi-system platforms (e.g. Sega, Nintendo, Sony, Microsoft). */
export const PlatformBar: React.FC<PlatformBarProps> = ({ sources, active, onSelect, platforms = [], collections = [], offlineMode }) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  const activeKey = sourceKey(active);
  useScrollIntoView(activeRef, activeKey);

  // ID of the platform family whose dropdown menu is currently open
  const [openDropdownFamilyId, setOpenDropdownFamilyId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Group platforms into families
  const families = useMemo(() => groupPlatformsByFamily(platforms), [platforms]);

  // Track the most recently selected system per family so returning to a family restores choice
  const [lastSelectedSystemPerFamily, setLastSelectedSystemPerFamily] = useState<Record<string, Platform>>({});

  useEffect(() => {
    if (active.kind === 'platform') {
      const p = active.platform;
      for (const fam of families) {
        if (fam.platforms.some((sp) => sp.id === p.id)) {
          setLastSelectedSystemPerFamily((prev) => ({ ...prev, [fam.id]: p }));
          break;
        }
      }
    }
  }, [active, families]);

  // Close dropdown on outside click or escape
  useEffect(() => {
    if (!openDropdownFamilyId) return;
    const handleDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdownFamilyId(null);
      }
    };
    window.addEventListener('mousedown', handleDown);
    return () => window.removeEventListener('mousedown', handleDown);
  }, [openDropdownFamilyId]);

  const handleOpenDropdown = (familyId: string) => {
    soundService.playTick();
    setOpenDropdownFamilyId((prev) => (prev === familyId ? null : familyId));
  };

  const handleSelectFromDropdown = (sourceToSelect: LibrarySource, familyId: string) => {
    soundService.playSelect();
    setOpenDropdownFamilyId(null);
    onSelect(sourceToSelect);

    // Return focus to the family dropdown button in the bar
    setTimeout(() => {
      focusManager.focusSelector(`#family-btn-${familyId}`);
    }, 50);
  };

  const activeFamily = openDropdownFamilyId ? families.find((f) => f.id === openDropdownFamilyId) : null;

  return (
    <div className="relative shrink-0 bg-deck-bg">
      <nav
        data-focus-memory="platforms"
        className="shrink-0 flex items-center gap-2 px-5 py-2.5 overflow-x-auto no-scrollbar"
        aria-label="Platforms and Libraries"
      >
        <span className="text-xs font-bold text-deck-dim mr-1 shrink-0">L1</span>

        {/* 1. Quick Root Sources: Recent, All, Favorites, Installed */}
        {(['recent', 'all', 'favorites', 'installed'] as const).map((kind) => {
          // Check if kind exists in available sources
          const exists = sources.some((s) => s.kind === kind);
          if (!exists) return null;
          const isActive = active.kind === kind;
          const { label, icon } = quickSourceLabel(kind, offlineMode);
          return (
            <button
              key={kind}
              ref={isActive ? activeRef : undefined}
              data-focusable
              id={`source-${kind}`}
              data-source-key={kind}
              onClick={() => {
                setOpenDropdownFamilyId(null);
                onSelect({ kind });
              }}
              className={`deck-chip shrink-0 h-10 px-4 flex items-center gap-2 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors ${
                isActive ? 'bg-deck-text text-deck-bg border-deck-text' : 'bg-deck-panel border-deck-line text-deck-text'
              }`}
            >
              {icon}
              {label}
            </button>
          );
        })}

        {/* Separator between library filters and platforms */}
        <div className="h-5 w-px bg-deck-line/80 shrink-0 mx-1" />

        {/* 2. Platform Families: Multi-system families become Dropdowns, single systems stay single */}
        {families.map((fam) => {
          const isMulti = fam.platforms.length > 1;

          // Check if active source belongs to this family
          const isFamilyActive =
            (active.kind === 'platform_family' && active.familyId === fam.id) ||
            (active.kind === 'platform' && fam.platforms.some((p) => p.id === active.platform.id));

          const activeSystemInFamily =
            active.kind === 'platform' ? fam.platforms.find((p) => p.id === active.platform.id) : null;

          const isOpen = openDropdownFamilyId === fam.id;

          if (isMulti) {
            // Dropdown button for multi-system platform (e.g. Sega, Nintendo, Sony, Microsoft)
            let displayLabel = fam.name;
            let displayCount = fam.totalGameCount;

            if (isFamilyActive) {
              if (activeSystemInFamily) {
                // Short name or sub-brand
                const short = activeSystemInFamily.shortName || activeSystemInFamily.name;
                displayLabel = `${fam.name}: ${short}`;
                displayCount = activeSystemInFamily.gameCount || 0;
              } else if (active.kind === 'platform_family') {
                displayLabel = `${fam.name} (All)`;
                displayCount = fam.totalGameCount;
              }
            }

            return (
              <div key={fam.id} className="relative shrink-0">
                <button
                  ref={isFamilyActive ? activeRef : undefined}
                  data-focusable
                  id={`family-btn-${fam.id}`}
                  data-source-key={`family:${fam.id}`}
                  onClick={() => handleOpenDropdown(fam.id)}
                  aria-haspopup="true"
                  aria-expanded={isOpen}
                  className={`deck-chip shrink-0 h-10 px-4 flex items-center gap-2 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors ${
                    isFamilyActive
                      ? 'bg-deck-text text-deck-bg border-deck-text shadow-sm font-bold'
                      : isOpen
                      ? 'bg-deck-panel-2 border-deck-accent text-white'
                      : 'bg-deck-panel border-deck-line text-deck-text hover:border-deck-dim/60'
                  }`}
                  title={`${fam.name} platform dropdown (${fam.platforms.length} systems)`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: fam.color }}
                  />
                  <span>{displayLabel}</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 opacity-70 ${isOpen ? 'rotate-180' : ''}`}
                  />
                  {displayCount > 0 && (
                    <span
                      className={`text-xs ml-0.5 tabular-nums ${
                        isFamilyActive ? 'text-deck-bg/75' : 'text-deck-dim'
                      }`}
                    >
                      {displayCount}
                    </span>
                  )}
                </button>
              </div>
            );
          }

          // Single-system platform (no dropdown needed, direct selection)
          const singlePlat = fam.platforms[0];
          const isSingleActive = active.kind === 'platform' && active.platform.id === singlePlat.id;

          return (
            <button
              key={singlePlat.id}
              ref={isSingleActive ? activeRef : undefined}
              data-focusable
              id={`platform-btn-${singlePlat.slug}`}
              data-source-key={`p:${singlePlat.id}`}
              onClick={() => {
                setOpenDropdownFamilyId(null);
                onSelect({ kind: 'platform', platform: singlePlat });
              }}
              className={`deck-chip shrink-0 h-10 px-4 flex items-center gap-2 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors ${
                isSingleActive
                  ? 'bg-deck-text text-deck-bg border-deck-text font-bold'
                  : 'bg-deck-panel border-deck-line text-deck-text hover:border-deck-dim/60'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: fam.color }} />
              <span>{singlePlat.name}</span>
              {singlePlat.gameCount != null && singlePlat.gameCount > 0 && (
                <span className={`text-xs tabular-nums ${isSingleActive ? 'text-deck-bg/75' : 'text-deck-dim'}`}>
                  {singlePlat.gameCount}
                </span>
              )}
            </button>
          );
        })}

        {/* 3. Collections (if any) */}
        {collections.length > 0 && (
          <>
            <div className="h-5 w-px bg-deck-line/80 shrink-0 mx-1" />
            {collections.map((c) => {
              const isActive = active.kind === 'collection' && active.collection.id === c.id;
              return (
                <button
                  key={`col-${c.id}`}
                  ref={isActive ? activeRef : undefined}
                  data-focusable
                  id={`collection-${c.id}`}
                  data-source-key={`c:${c.id}`}
                  onClick={() => {
                    setOpenDropdownFamilyId(null);
                    onSelect({ kind: 'collection', collection: c });
                  }}
                  className={`deck-chip shrink-0 h-10 px-4 flex items-center gap-2 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors ${
                    isActive ? 'bg-deck-text text-deck-bg border-deck-text' : 'bg-deck-panel border-deck-line text-deck-text'
                  }`}
                >
                  <FolderHeart size={16} />
                  <span>{c.name}</span>
                  {c.romCount > 0 && (
                    <span className={`text-xs ${isActive ? 'text-deck-bg/70' : 'text-deck-dim'}`}>{c.romCount}</span>
                  )}
                </button>
              );
            })}
          </>
        )}

        <span className="text-xs font-bold text-deck-dim ml-1 shrink-0">R1</span>
      </nav>

      {/* 4. Dropdown Popover Modal for Selected Multi-System Platform Family */}
      {activeFamily && (
        <div
          ref={dropdownRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${activeFamily.name} Systems Menu`}
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/60 backdrop-blur-sm deck-enter"
          onClick={() => {
            soundService.playBack();
            setOpenDropdownFamilyId(null);
          }}
        >
          <FocusScope
            name={`dropdown-${activeFamily.id}`}
            onBack={() => {
              soundService.playBack();
              setOpenDropdownFamilyId(null);
              focusManager.focusSelector(`#family-btn-${activeFamily.id}`);
            }}
            initialFocus={
              active.kind === 'platform' && activeFamily.platforms.some((p) => p.id === active.platform.id)
                ? `#dropdown-plat-${active.platform.id}`
                : active.kind === 'platform_family' && active.familyId === activeFamily.id
                ? `#dropdown-plat-all`
                : `#dropdown-plat-all`
            }
            className="w-full max-w-lg rounded-2xl bg-deck-panel border border-deck-line shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-deck-line bg-deck-panel-2">
              <div className="flex items-center gap-2.5">
                <span
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                  style={{ backgroundColor: activeFamily.color }}
                />
                <h3 className="text-lg font-black text-white">
                  {activeFamily.name} Systems
                </h3>
                <span className="text-xs text-deck-dim font-medium ml-1">
                  ({activeFamily.platforms.length} systems · {activeFamily.totalGameCount} games)
                </span>
              </div>
              <button
                data-focusable
                id="dropdown-close-btn"
                onClick={() => {
                  soundService.playBack();
                  setOpenDropdownFamilyId(null);
                  focusManager.focusSelector(`#family-btn-${activeFamily.id}`);
                }}
                className="h-8 w-8 rounded-lg bg-deck-panel border border-deck-line flex items-center justify-center text-deck-dim hover:text-white"
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>

            {/* List of Systems */}
            <div
              data-scroll-primary
              className="deck-scroll flex-1 overflow-y-auto p-3 flex flex-col gap-1.5"
            >
              {/* Option 1: All Systems of this Family */}
              {(() => {
                const isAllSelected = active.kind === 'platform_family' && active.familyId === activeFamily.id;
                return (
                  <button
                    data-focusable
                    id="dropdown-plat-all"
                    onClick={() =>
                      handleSelectFromDropdown(
                        {
                          kind: 'platform_family',
                          familyId: activeFamily.id,
                          name: activeFamily.name,
                          platforms: activeFamily.platforms,
                        },
                        activeFamily.id
                      )
                    }
                    className={`deck-row w-full p-3 rounded-xl border flex items-center justify-between text-left transition-colors ${
                      isAllSelected
                        ? 'bg-deck-accent/25 border-deck-accent text-white shadow-sm font-bold'
                        : 'bg-deck-panel-2/60 border-deck-line text-deck-text hover:bg-deck-panel-2 hover:border-deck-dim/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border ${
                          isAllSelected
                            ? 'bg-deck-accent/30 border-deck-accent text-white'
                            : 'bg-deck-panel border-deck-line text-deck-dim'
                        }`}
                      >
                        <Layers size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-white flex items-center gap-2">
                          <span>All {activeFamily.name} Games</span>
                          {isAllSelected && <Check size={14} className="text-deck-accent" />}
                        </div>
                        <div className="text-xs text-deck-dim">
                          Browse library across all {activeFamily.platforms.length} {activeFamily.name} systems
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xs font-mono font-bold text-deck-dim bg-deck-bg px-2.5 py-1 rounded-md border border-deck-line/80">
                        {activeFamily.totalGameCount} games
                      </span>
                    </div>
                  </button>
                );
              })()}

              <div className="my-1.5 px-3 flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-deck-dim/70">
                  Select Specific System
                </span>
                <div className="h-px flex-1 bg-deck-line/60" />
              </div>

              {/* Option 2..N: Individual Systems */}
              {activeFamily.platforms.map((plat) => {
                const isSelected = active.kind === 'platform' && active.platform.id === plat.id;
                return (
                  <button
                    key={plat.id}
                    data-focusable
                    id={`dropdown-plat-${plat.id}`}
                    onClick={() =>
                      handleSelectFromDropdown(
                        { kind: 'platform', platform: plat },
                        activeFamily.id
                      )
                    }
                    className={`deck-row w-full p-3 rounded-xl border flex items-center justify-between text-left transition-colors ${
                      isSelected
                        ? 'bg-deck-accent/25 border-deck-accent text-white shadow-sm font-bold'
                        : 'bg-deck-panel-2/60 border-deck-line text-deck-text hover:bg-deck-panel-2 hover:border-deck-dim/60'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'bg-deck-accent/30 border-deck-accent text-white'
                            : 'bg-deck-panel border-deck-line text-deck-dim'
                        }`}
                      >
                        <Gamepad2 size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-extrabold text-white flex items-center gap-2">
                          <span className="truncate">{plat.name}</span>
                          {isSelected && <Check size={14} className="text-deck-accent shrink-0" />}
                        </div>
                        <div className="text-xs text-deck-dim truncate">
                          {plat.generation || plat.shortName || plat.slug.toUpperCase()}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right ml-3">
                      <span className="text-xs font-mono font-bold text-deck-dim bg-deck-bg px-2.5 py-1 rounded-md border border-deck-line/80">
                        {plat.gameCount ?? 0} games
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Bottom hint */}
            <div className="shrink-0 px-5 py-2.5 bg-deck-panel-2/70 border-t border-deck-line flex items-center justify-between text-xs text-deck-dim">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="font-extrabold text-white bg-deck-bg px-1.5 py-0.5 rounded border border-deck-line text-[10px]">A</span> Confirm
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="font-extrabold text-white bg-deck-bg px-1.5 py-0.5 rounded border border-deck-line text-[10px]">B</span> Close
              </span>
            </div>
          </FocusScope>
        </div>
      )}
    </div>
  );
};
