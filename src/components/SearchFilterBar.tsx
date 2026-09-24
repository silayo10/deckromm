import React from 'react';
import { ArrowDownAZ, LayoutGrid, List, GalleryHorizontal, RefreshCw } from 'lucide-react';
import { FilterTag, LibraryViewMode, SortOption } from '../types';

interface SearchFilterBarProps {
  filter: FilterTag;
  onFilterChange: (f: FilterTag) => void;
  sortBy: SortOption;
  onSortChange: (s: SortOption) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (v: LibraryViewMode) => void;
  resultCount: number;
  totalCount: number;
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
  sortBy,
  onSortChange,
  viewMode,
  onViewModeChange,
  resultCount,
  totalCount,
  loading,
  onRefresh,
}) => {
  const nextSort = () => {
    const i = SORTS.findIndex((s) => s.id === sortBy);
    onSortChange(SORTS[(i + 1) % SORTS.length].id);
  };
  const nextView = () => onViewModeChange(VIEW_MODES[(VIEW_MODES.indexOf(viewMode) + 1) % VIEW_MODES.length]);
  const ViewIcon = viewMode === 'grid' ? LayoutGrid : viewMode === 'hero' ? GalleryHorizontal : List;

  return (
    <div data-focus-memory="filters" className="shrink-0 flex items-center gap-2 px-5 pb-2.5">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          data-focusable
          id={`filter-${f.id}`}
          onClick={() => onFilterChange(f.id)}
          className={`deck-chip h-9 px-3.5 rounded-lg text-sm font-semibold border ${
            filter === f.id ? 'bg-deck-accent/25 border-deck-accent text-white' : 'bg-transparent border-deck-line text-deck-dim'
          }`}
        >
          {f.label}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-2">
        <span className="text-sm text-deck-dim tabular-nums mr-2">
          {loading ? 'Loading ' : ''}
          {resultCount === totalCount ? `${totalCount} games` : `${resultCount} of ${totalCount}`}
        </span>
        <button data-focusable onClick={nextSort} className="deck-chip h-9 px-3 rounded-lg border border-deck-line bg-deck-panel text-sm font-semibold flex items-center gap-2">
          <ArrowDownAZ size={16} /> {SORTS.find((s) => s.id === sortBy)?.label}
        </button>
        <button data-focusable onClick={nextView} className="deck-chip h-9 w-9 rounded-lg border border-deck-line bg-deck-panel flex items-center justify-center" aria-label={`View: ${viewMode}`}>
          <ViewIcon size={16} />
        </button>
        <button data-focusable onClick={onRefresh} className="deck-chip h-9 w-9 rounded-lg border border-deck-line bg-deck-panel flex items-center justify-center" aria-label="Refresh library (X)">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  );
};
