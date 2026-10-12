import React from 'react';
import { ArrowDownAZ, LayoutGrid, List, GalleryHorizontal, RefreshCw, Filter, X, ChevronDown, Globe } from 'lucide-react';
import { FilterTag, LibraryViewMode, SortOption } from '../types';
import { getGenreIcon } from './GenrePickerModal';
import { LanguageCountOption } from './LanguagePickerModal';

export interface GenreOption {
  name: string;
  count: number;
}

interface SearchFilterBarProps {
  filter: FilterTag;
  onFilterChange: (f: FilterTag) => void;
  selectedGenre: string;
  onGenreChange: (g: string) => void;
  availableGenres: GenreOption[];
  onOpenGenrePicker: () => void;
  selectedLanguage: string;
  onLanguageChange: (lang: string) => void;
  japaneseCount: number;
  availableLanguages: LanguageCountOption[];
  onOpenLanguagePicker: () => void;
  sortBy: SortOption;
  onSortChange: (s: SortOption) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (v: LibraryViewMode) => void;
  resultCount: number;
  totalCount: number;
  currentPlatformName?: string;
  loading: boolean;
  onRefresh: () => void;
}

const FILTERS: Array<{ id: FilterTag; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'cached', label: 'Installed' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'streamable', label: 'Plays in app' },
  { id: 'multiplayer', label: 'Multiplayer' },
];

export const SORTS: Array<{ id: SortOption; label: string }> = [
  { id: 'title', label: 'Title A-Z' },
  { id: 'recent', label: 'Recently played' },
  { id: 'rating', label: 'Rating' },
  { id: 'year', label: 'Release year' },
  { id: 'size', label: 'File size' },
];

export const VIEW_MODES: LibraryViewMode[] = ['grid', 'hero', 'table'];

export const SearchFilterBar: React.FC<SearchFilterBarProps> = ({
  filter,
  onFilterChange,
  selectedGenre,
  onGenreChange,
  availableGenres,
  onOpenGenrePicker,
  selectedLanguage,
  onLanguageChange,
  japaneseCount,
  availableLanguages,
  onOpenLanguagePicker,
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  resultCount,
  totalCount,
  currentPlatformName,
  loading,
  onRefresh,
}) => {
  const nextSort = () => {
    const i = SORTS.findIndex((s) => s.id === sortBy);
    onSortChange(SORTS[(i + 1) % SORTS.length].id);
  };
  const nextView = () => onViewModeChange(VIEW_MODES[(VIEW_MODES.indexOf(viewMode) + 1) % VIEW_MODES.length]);
  const ViewIcon = viewMode === 'grid' ? LayoutGrid : viewMode === 'hero' ? GalleryHorizontal : List;

  const isGenreActive = Boolean(selectedGenre && selectedGenre !== 'all' && selectedGenre.toLowerCase() !== 'all genres');
  const isLangActive = Boolean(selectedLanguage && selectedLanguage !== 'all');
  const currentLangObj = availableLanguages.find((l) => l.id === selectedLanguage);
  const currentLangLabel = currentLangObj ? currentLangObj.shortLabel : selectedLanguage === 'no-ja' ? 'No JP' : 'All';

  // Featured quick genres to show as fast-access chips in the bar
  // RPG is always prioritized first
  const quickGenres = React.useMemo(() => {
    // Sort genres: RPG first, then by count descending
    const sorted = [...availableGenres].sort((a, b) => {
      if (a.name.toLowerCase() === 'rpg') return -1;
      if (b.name.toLowerCase() === 'rpg') return 1;
      return b.count - a.count;
    });

    // Make sure the active genre is in quick chips if selected
    if (isGenreActive && !sorted.slice(0, 7).some((g) => g.name.toLowerCase() === selectedGenre.toLowerCase())) {
      const activeItem = availableGenres.find((g) => g.name.toLowerCase() === selectedGenre.toLowerCase());
      if (activeItem) return [activeItem, ...sorted.filter((g) => g.name !== activeItem.name).slice(0, 6)];
    }

    return sorted.slice(0, 7);
  }, [availableGenres, selectedGenre, isGenreActive]);

  return (
    <div className="shrink-0 flex flex-col gap-2 px-5 pb-2.5">
      {/* Top Filter & Tools Row */}
      <div data-focus-memory="filters" className="flex items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            data-focusable
            id={`filter-${f.id}`}
            onClick={() => onFilterChange(f.id)}
            className={`deck-chip h-9 px-3.5 rounded-lg text-sm font-semibold border transition-colors ${
              filter === f.id
                ? 'bg-deck-accent/25 border-deck-accent text-white shadow-sm'
                : 'bg-transparent border-deck-line text-deck-dim hover:text-deck-text'
            }`}
          >
            {f.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-deck-dim tabular-nums mr-2">
            {loading ? 'Loading ' : ''}
            {isGenreActive ? (
              <span className="font-semibold text-deck-accent">
                {resultCount} {selectedGenre} {resultCount === 1 ? 'game' : 'games'}
                {totalCount !== resultCount ? ` of ${totalCount}` : ''}
              </span>
            ) : resultCount === totalCount ? (
              `${totalCount} games`
            ) : (
              `${resultCount} of ${totalCount}`
            )}
            {selectedLanguage === 'no-ja' && (
              <span className="text-amber-400 font-bold ml-1.5 text-xs">(JP hidden)</span>
            )}
            {isLangActive && selectedLanguage !== 'no-ja' && (
              <span className="text-deck-accent font-semibold ml-1.5 text-xs">({currentLangLabel})</span>
            )}
          </span>
          <button
            data-focusable
            onClick={nextSort}
            className="deck-chip h-9 px-3 rounded-lg border border-deck-line bg-deck-panel text-sm font-semibold flex items-center gap-2 hover:border-deck-dim/50"
            title="Sort games"
          >
            <ArrowDownAZ size={16} /> {SORTS.find((s) => s.id === sortBy)?.label}
          </button>
          <button
            data-focusable
            onClick={nextView}
            className="deck-chip h-9 w-9 rounded-lg border border-deck-line bg-deck-panel flex items-center justify-center hover:border-deck-dim/50"
            aria-label={`View: ${viewMode}`}
          >
            <ViewIcon size={16} />
          </button>
          <button
            data-focusable
            onClick={onRefresh}
            className="deck-chip h-9 w-9 rounded-lg border border-deck-line bg-deck-panel flex items-center justify-center hover:border-deck-dim/50"
            aria-label="Refresh library (X)"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Genre & Language Filter Row */}
      <div data-focus-memory="genres" className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
        {/* Language Filter Button */}
        <button
          data-focusable
          id="lang-picker-trigger"
          onClick={onOpenLanguagePicker}
          className={`deck-chip shrink-0 h-8 px-2.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-colors ${
            isLangActive
              ? 'bg-deck-accent/30 border-deck-accent text-white'
              : 'bg-deck-panel-2 border-deck-line text-deck-dim hover:text-white'
          }`}
          title="Open Language Filter Picker"
        >
          <Globe size={13} className={isLangActive ? 'text-deck-accent' : ''} />
          <span>Lang:</span>
          <span className="font-extrabold text-white">
            {currentLangLabel}
          </span>
          <ChevronDown size={13} className="opacity-70" />
        </button>

        {/* Quick Hide JP Toggle Chip */}
        <button
          data-focusable
          id="lang-hide-ja-toggle"
          onClick={() => onLanguageChange(selectedLanguage === 'no-ja' ? 'all' : 'no-ja')}
          className={`deck-chip shrink-0 h-8 px-2.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all ${
            selectedLanguage === 'no-ja'
              ? 'bg-amber-500/25 border-amber-500 text-amber-300 font-extrabold shadow-sm'
              : 'bg-deck-panel/60 border-deck-line text-deck-dim hover:text-deck-text hover:border-deck-dim/50'
          }`}
          title="Filter out Japanese ROMs"
        >
          <span>🇯🇵 Hide JP</span>
          {japaneseCount > 0 && (
            <span
              className={`text-[10px] tabular-nums ${
                selectedLanguage === 'no-ja' ? 'text-amber-300/90 font-bold' : 'text-deck-dim'
              }`}
            >
              ({japaneseCount})
            </span>
          )}
        </button>

        <div className="h-4 w-px bg-deck-line/80 shrink-0 mx-0.5" />

        {/* Genre Picker Trigger */}
        <button
          data-focusable
          id="genre-picker-trigger"
          onClick={onOpenGenrePicker}
          className={`deck-chip shrink-0 h-8 px-2.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-colors ${
            isGenreActive
              ? 'bg-deck-accent/30 border-deck-accent text-white'
              : 'bg-deck-panel-2 border-deck-line text-deck-dim hover:text-white'
          }`}
          title="Open Genre Picker"
        >
          <Filter size={13} className={isGenreActive ? 'text-deck-accent' : ''} />
          <span>Genre:</span>
          <span className="font-extrabold text-white">
            {isGenreActive ? selectedGenre : 'All'}
          </span>
          <ChevronDown size={13} className="opacity-70" />
        </button>

        {/* All Genres Chip */}
        <button
          data-focusable
          id="genre-chip-all"
          onClick={() => onGenreChange('all')}
          className={`deck-chip shrink-0 h-8 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            !isGenreActive
              ? 'bg-deck-text text-deck-bg border-deck-text font-bold'
              : 'bg-deck-panel/60 border-deck-line text-deck-dim hover:text-deck-text'
          }`}
        >
          All Genres
          <span className={`text-[10px] tabular-nums ${!isGenreActive ? 'text-deck-bg/70' : 'text-deck-dim/70'}`}>
            ({totalCount})
          </span>
        </button>

        {/* Quick Genre Chips */}
        {quickGenres.map((g) => {
          const isActive = selectedGenre.toLowerCase() === g.name.toLowerCase();
          const icon = getGenreIcon(g.name);
          const isRpg = g.name.toLowerCase() === 'rpg';

          return (
            <button
              key={g.name}
              data-focusable
              id={`genre-chip-${g.name.toLowerCase()}`}
              onClick={() => onGenreChange(isActive ? 'all' : g.name)}
              className={`deck-chip shrink-0 h-8 px-3 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                isActive
                  ? 'bg-deck-accent border-deck-accent text-white font-bold shadow-sm'
                  : isRpg
                  ? 'bg-purple-950/30 border-purple-800/40 text-purple-200 hover:border-purple-600/60'
                  : 'bg-deck-panel/60 border-deck-line text-deck-text hover:border-deck-dim/50'
              }`}
            >
              <span>{icon}</span>
              <span>{g.name}</span>
              <span
                className={`text-[10px] tabular-nums font-normal ${
                  isActive ? 'text-white/80' : isRpg ? 'text-purple-300/80' : 'text-deck-dim'
                }`}
              >
                ({g.count})
              </span>
            </button>
          );
        })}

        {/* More Genres Button */}
        {availableGenres.length > quickGenres.length && (
          <button
            data-focusable
            onClick={onOpenGenrePicker}
            className="deck-chip shrink-0 h-8 px-2.5 rounded-lg border border-deck-line bg-deck-panel/40 text-xs font-semibold text-deck-dim hover:text-white flex items-center gap-1"
          >
            <span>More...</span>
            <span className="text-[10px] text-deck-dim">({availableGenres.length - quickGenres.length})</span>
          </button>
        )}

        {/* Clear Filter Button if active */}
        {(isGenreActive || isLangActive) && (
          <button
            data-focusable
            onClick={() => {
              onGenreChange('all');
              onLanguageChange('all');
            }}
            className="deck-chip shrink-0 h-8 px-2.5 rounded-lg border border-red-900/50 bg-red-950/20 text-xs font-bold text-red-300 hover:bg-red-900/30 flex items-center gap-1 ml-1"
            title="Clear active filters"
          >
            <X size={13} />
            <span>Clear</span>
          </button>
        )}
      </div>
    </div>
  );
};
