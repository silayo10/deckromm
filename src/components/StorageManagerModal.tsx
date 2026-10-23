import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  HardDrive,
  Trash2,
  Play,
  Search,
  RefreshCw,
  FolderOpen,
  ArrowUpDown,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Gamepad2,
  Sparkles,
} from 'lucide-react';
import { FocusScope } from './FocusScope';
import { Game } from '../types';
import { formatBytes } from './GameCard';
import { rommApi } from '../services/rommApi';
import { bridge, isNativeApp } from '../services/bridge';
import { soundService } from '../services/soundService';
import { focusManager } from '../services/focusManager';
import type { NativeStorage } from '../env/electron';

export interface DownloadedRomItem {
  id: string | number;
  title: string;
  platformSlug: string;
  platformName: string;
  fileName: string;
  fullPath: string;
  sizeBytes: number;
  mtime: number;
  coverUrl?: string;
  game?: Game;
}

interface StorageManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
  onLaunchGame?: (game: Game) => void;
  onGameDeleted?: (gameId: string | number) => void;
}

type SortKey = 'size-desc' | 'size-asc' | 'title' | 'platform' | 'recent';

export const StorageManagerModal: React.FC<StorageManagerModalProps> = ({
  isOpen,
  onClose,
  onToast,
  onLaunchGame,
  onGameDeleted,
}) => {
  const [items, setItems] = useState<DownloadedRomItem[]>([]);
  const [totalSizeBytes, setTotalSizeBytes] = useState(0);
  const [romsRoot, setRomsRoot] = useState('');
  const [storage, setStorage] = useState<NativeStorage | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortKey>('size-desc');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | number | null>(null);
  const [deletingId, setDeletingId] = useState<string | number | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const rep = await rommApi.getDownloadedRomsReport();
      setItems(rep.items);
      setTotalSizeBytes(rep.totalSizeBytes);
      setRomsRoot(rep.romsRoot);
      setStorage(rep.storage);
    } catch (e: any) {
      onToast(`Failed to load storage report: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      setDeleteConfirmId(null);
    }
  }, [isOpen]);

  // Unique platform slugs in downloaded items
  const platforms = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => set.add(i.platformSlug));
    return Array.from(set).sort();
  }, [items]);

  // Filtered and sorted items
  const displayItems = useMemo(() => {
    let list = [...items];
    if (selectedPlatform !== 'all') {
      list = list.filter((i) => i.platformSlug.toLowerCase() === selectedPlatform.toLowerCase());
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.fileName.toLowerCase().includes(q) ||
          i.platformName.toLowerCase().includes(q)
      );
    }
    switch (sortBy) {
      case 'size-desc':
        return list.sort((a, b) => b.sizeBytes - a.sizeBytes || a.title.localeCompare(b.title));
      case 'size-asc':
        return list.sort((a, b) => a.sizeBytes - b.sizeBytes || a.title.localeCompare(b.title));
      case 'title':
        return list.sort((a, b) => a.title.localeCompare(b.title));
      case 'platform':
        return list.sort((a, b) => a.platformName.localeCompare(b.platformName) || b.sizeBytes - a.sizeBytes);
      case 'recent':
        return list.sort((a, b) => b.mtime - a.mtime);
      default:
        return list;
    }
  }, [items, selectedPlatform, searchQuery, sortBy]);

  if (!isOpen) return null;

  const handleDelete = async (item: DownloadedRomItem) => {
    soundService.playTick();
    setDeletingId(item.id);

    // Determine the next game down before removing item from displayItems
    const currentIndex = displayItems.findIndex((i) => String(i.id) === String(item.id));
    let nextItemToFocus: DownloadedRomItem | null = null;
    if (currentIndex !== -1) {
      if (currentIndex + 1 < displayItems.length) {
        // Move to the next game down
        nextItemToFocus = displayItems[currentIndex + 1];
      } else if (currentIndex > 0) {
        // If deleting the last game in the list, move to the one above
        nextItemToFocus = displayItems[currentIndex - 1];
      }
    }
    const nextTargetSelector = nextItemToFocus ? `#storage-item-${nextItemToFocus.id}` : null;

    try {
      const reqGame: Game = item.game || {
        id: item.id,
        title: item.title,
        platformSlug: item.platformSlug,
        platformName: item.platformName,
        fileName: item.fileName,
        fileSizeBytes: item.sizeBytes,
        releaseYear: 2000,
        developer: '',
        publisher: '',
        genres: [],
        rating: 0,
        summary: '',
        coverUrl: item.coverUrl || '',
      };

      const res = await bridge.roms.remove({
        romId: reqGame.id,
        platformSlug: reqGame.platformSlug,
        fileName: reqGame.fileName,
      });

      if (res.ok) {
        soundService.playSuccess();
        onToast(`Deleted ${item.title} (freed ${formatBytes(item.sizeBytes)})`, 'ok');
        onGameDeleted?.(item.id);

        setItems((prev) => prev.filter((i) => String(i.id) !== String(item.id)));
        setTotalSizeBytes((prev) => Math.max(0, prev - item.sizeBytes));
        setDeleteConfirmId(null);

        // Advance cursor to the next game down (not back to the top or search bar!)
        requestAnimationFrame(() => {
          if (nextTargetSelector) {
            const nextEl = document.querySelector<HTMLElement>(nextTargetSelector);
            if (nextEl) {
              focusManager.focus(nextEl, { scroll: true, instant: true });
              return;
            }
          }
          const anyItem = document.querySelector<HTMLElement>('[data-item-id]');
          if (anyItem) {
            focusManager.focus(anyItem, { scroll: true, instant: true });
          } else {
            focusManager.focusSelector('#storage-refresh');
          }
        });
      } else {
        soundService.playBack();
        onToast(`Could not delete file`, 'error');
      }
    } catch (e: any) {
      soundService.playBack();
      onToast(`Error deleting game: ${e.message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleLaunch = (item: DownloadedRomItem) => {
    soundService.playSelect();
    const gameToLaunch: Game = item.game || {
      id: item.id,
      title: item.title,
      platformSlug: item.platformSlug,
      platformName: item.platformName,
      fileName: item.fileName,
      fileSizeBytes: item.sizeBytes,
      releaseYear: 2000,
      developer: '',
      publisher: '',
      genres: [],
      rating: 0,
      summary: '',
      coverUrl: item.coverUrl || '',
      isInstalled: true,
      localPath: item.fullPath,
    };
    onClose();
    if (onLaunchGame) {
      onLaunchGame(gameToLaunch);
    } else {
      rommApi.launchNative(gameToLaunch);
    }
  };

  const handleOpenFolder = async () => {
    soundService.playTick();
    const folder = romsRoot || (storage?.emulationRoot ? `${storage.emulationRoot}/roms` : '~/Emulation/roms');
    onToast(`ROMs location: ${folder}`, 'ok');
  };

  const cycleSort = () => {
    soundService.playTick();
    const order: SortKey[] = ['size-desc', 'size-asc', 'title', 'platform', 'recent'];
    const nextIdx = (order.indexOf(sortBy) + 1) % order.length;
    setSortBy(order[nextIdx]);
  };

  const sortLabel: Record<SortKey, string> = {
    'size-desc': 'Largest Size',
    'size-asc': 'Smallest Size',
    title: 'Title A-Z',
    platform: 'Platform',
    recent: 'Recently Downloaded',
  };

  // Storage calculation
  const intTotal = storage?.internalTotalBytes || 512000000000;
  const intFree = storage?.internalFreeBytes || 248600000000;
  const intUsed = storage?.internalUsedBytes || (intTotal - intFree);
  const romsPct = intTotal > 0 ? Math.min(100, Math.max(1, Math.round((totalSizeBytes / intTotal) * 100))) : 0;
  const otherUsedBytes = Math.max(0, intUsed - totalSizeBytes);
  const otherPct = intTotal > 0 ? Math.min(100, Math.round((otherUsedBytes / intTotal) * 100)) : 0;
  const freePct = intTotal > 0 ? Math.min(100, Math.round((intFree / intTotal) * 100)) : 0;

  return (
    <div
      className="fixed inset-0 z-[220] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <FocusScope
        name="storage-manager-modal"
        initialFocus="[data-item-id]"
        onBack={onClose}
        onAction={(a) => {
          if (a === 'BACK') {
            if (deleteConfirmId !== null) {
              setDeleteConfirmId(null);
              return true;
            }
            onClose();
            return true;
          }
          if (a === 'ACTION_X') {
            const cur = focusManager.getCurrent();
            const itemId = cur?.getAttribute('data-item-id') || cur?.closest('[data-item-id]')?.getAttribute('data-item-id');
            if (itemId) {
              if (String(deleteConfirmId) === String(itemId)) {
                // If already confirming delete for this item, pressing X confirms delete!
                const target = displayItems.find((i) => String(i.id) === String(itemId));
                if (target) handleDelete(target);
                return true;
              }
              soundService.playTick();
              setDeleteConfirmId(itemId);
              const row = document.getElementById(`storage-item-${itemId}`);
              if (row) focusManager.focus(row);
              return true;
            }
          }
          if (a === 'SELECT') {
            const cur = focusManager.getCurrent();
            const itemId = cur?.getAttribute('data-item-id') || cur?.closest('[data-item-id]')?.getAttribute('data-item-id');
            if (itemId && String(deleteConfirmId) === String(itemId)) {
              // Pressing A confirms delete when in delete confirmation state
              const target = displayItems.find((i) => String(i.id) === String(itemId));
              if (target) {
                handleDelete(target);
                return true;
              }
            }
          }
          return false;
        }}
        className="w-full max-w-5xl h-[88vh] bg-gradient-to-b from-[#111827] to-[#0b0f19] border border-sky-400/40 rounded-2xl shadow-[0_0_50px_rgba(56,189,248,0.25)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/30">
              <HardDrive size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold text-white">Downloaded Games & Storage Space</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-500/20 text-sky-300 border border-sky-400/30">
                  {items.length} {items.length === 1 ? 'game' : 'games'} ({formatBytes(totalSizeBytes)})
                </span>
              </div>
              <p className="text-xs text-slate-400">
                View installed ROM files, sort by size to free up space, or launch games directly
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="storage-open-folder"
              data-focusable
              onClick={handleOpenFolder}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors"
              title="View ROMs directory on disk"
            >
              <FolderOpen size={14} />
              <span>ROMs Folder</span>
            </button>
            <button
              id="storage-refresh"
              data-focusable
              onClick={loadData}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-slate-300 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              id="storage-close"
              data-focusable
              onClick={onClose}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-slate-300 hover:text-white transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Storage Gauge Banner */}
        <div className="px-6 py-3.5 bg-slate-900/80 border-b border-white/10 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400"></span>
                <span className="text-slate-300 font-bold">Downloaded ROMs:</span>
                <span className="text-white font-mono font-extrabold">{formatBytes(totalSizeBytes)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-slate-500"></span>
                <span className="text-slate-400 font-medium">Other Data:</span>
                <span className="text-slate-300 font-mono">{formatBytes(otherUsedBytes)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                <span className="text-emerald-300 font-bold">Available Free:</span>
                <span className="text-emerald-200 font-mono font-extrabold">{formatBytes(intFree)}</span>
              </span>
            </div>

            <div className="flex items-center gap-3 font-mono text-slate-300">
              <span>Target: <strong className="text-white">{storage?.storageTarget === 'sdcard' ? 'microSD' : 'Internal SSD'}</strong></span>
              <span>Total: <strong className="text-white">{formatBytes(intTotal)}</strong></span>
            </div>
          </div>

          {/* Visual Bar */}
          <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden flex shadow-inner">
            <div
              className="bg-sky-500 h-full transition-all duration-300"
              style={{ width: `${romsPct}%` }}
              title={`ROMs: ${formatBytes(totalSizeBytes)} (${romsPct}%)`}
            />
            <div
              className="bg-slate-600 h-full transition-all duration-300"
              style={{ width: `${otherPct}%` }}
              title={`Other: ${formatBytes(otherUsedBytes)} (${otherPct}%)`}
            />
            <div
              className="bg-emerald-500/40 h-full transition-all duration-300"
              style={{ width: `${freePct}%` }}
              title={`Free: ${formatBytes(intFree)} (${freePct}%)`}
            />
          </div>

          {storage?.sdCardMounted && (
            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5 font-mono">
              <span>microSD Card Inserted ({storage.sdPath || '/run/media'}):</span>
              <span>
                <strong className="text-emerald-300">{formatBytes(storage.sdFreeBytes || 0)} free</strong> of {formatBytes(storage.sdTotalBytes || 0)}
              </span>
            </div>
          )}
        </div>

        {/* Toolbar: Search, Platform Filter, and Sort */}
        <div className="px-6 py-3 border-b border-white/10 bg-black/20 flex flex-wrap items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              id="storage-search-input"
              data-focusable
              data-nav-down="[data-item-id]"
              type="text"
              placeholder="Filter by title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-7 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Platform chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-md pb-0.5">
            <button
              data-focusable
              onClick={() => setSelectedPlatform('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                selectedPlatform === 'all'
                  ? 'bg-sky-500 text-white shadow-sm'
                  : 'bg-white/5 text-slate-400 hover:text-white'
              }`}
            >
              All ({items.length})
            </button>
            {platforms.map((p) => {
              const count = items.filter((i) => i.platformSlug === p).length;
              const pSize = items
                .filter((i) => i.platformSlug === p)
                .reduce((acc, curr) => acc + curr.sizeBytes, 0);
              return (
                <button
                  key={p}
                  data-focusable
                  onClick={() => setSelectedPlatform(p)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                    selectedPlatform === p
                      ? 'bg-sky-500 text-white shadow-sm'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  <span>{p.toUpperCase()}</span>
                  <span className="opacity-70 text-[10px]">({count})</span>
                </button>
              );
            })}
          </div>

          {/* Sort button */}
          <button
            id="storage-sort-btn"
            data-focusable
            onClick={cycleSort}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Cycle sort order"
          >
            <ArrowUpDown size={13} className="text-sky-400" />
            <span>Sort: {sortLabel[sortBy]}</span>
          </button>
        </div>

        {/* Main List */}
        <div data-scroll-primary className="deck-scroll flex-1 p-6 overflow-y-auto space-y-2.5 min-h-0">
          {loading ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-3">
              <RefreshCw size={28} className="animate-spin text-sky-400" />
              <span className="text-sm font-semibold">Scanning local ROM directories...</span>
            </div>
          ) : displayItems.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-3 text-center">
              <HardDrive size={36} className="text-slate-600" />
              <div className="text-base font-bold text-white">No downloaded games found</div>
              <p className="text-xs max-w-sm text-slate-400">
                {searchQuery || selectedPlatform !== 'all'
                  ? 'No games match your current filter.'
                  : 'Open any game in your library and press Download or Play to store it on your Steam Deck.'}
              </p>
            </div>
          ) : (
            displayItems.map((item, idx) => {
              const isConfirming = deleteConfirmId === item.id;
              const isDeleting = deletingId === item.id;
              const pctOfRoms = totalSizeBytes > 0 ? ((item.sizeBytes / totalSizeBytes) * 100).toFixed(1) : '0';

              return (
                <div
                  key={`${item.platformSlug}-${item.fileName}-${idx}`}
                  data-focusable
                  data-item-id={item.id}
                  id={`storage-item-${item.id}`}
                  onClick={() => !isConfirming && handleLaunch(item)}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-4 transition-all cursor-pointer ${
                    isConfirming
                      ? 'bg-red-950/40 border-red-500/50 shadow-lg'
                      : 'bg-white/5 hover:bg-white/10 border-white/10'
                  }`}
                >
                  {/* Left: Thumbnail & Info */}
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {item.coverUrl ? (
                      <img
                        src={item.coverUrl}
                        alt={item.title}
                        className="w-12 h-16 object-cover rounded-lg bg-slate-800 shrink-0 border border-white/10 shadow"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-12 h-16 rounded-lg bg-slate-800 shrink-0 border border-white/10 flex items-center justify-center text-slate-500">
                        <Gamepad2 size={22} />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-white text-base truncate">{item.title}</span>
                        <span className="px-2 py-0.5 rounded bg-sky-500/10 border border-sky-400/20 text-sky-300 font-mono text-[10px] font-bold shrink-0">
                          {item.platformName}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono truncate mt-0.5">
                        {item.fileName}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">
                        {item.fullPath}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Size Badge */}
                  <div className="flex flex-col items-end shrink-0 px-2 text-right">
                    <span className="text-base font-extrabold text-white font-mono tabular-nums">
                      {formatBytes(item.sizeBytes)}
                    </span>
                    <span className="text-[10px] text-sky-300 font-mono">
                      {pctOfRoms}% of ROMs
                    </span>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isConfirming ? (
                      <div
                        className="flex items-center gap-2 bg-red-950/80 p-1.5 rounded-xl border border-red-500/60 shadow-lg animate-in fade-in"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-xs font-bold text-red-200 px-1">
                          Delete & Free {formatBytes(item.sizeBytes)}?
                        </span>
                        <button
                          type="button"
                          data-focusable
                          id={`confirm-del-${item.id}`}
                          disabled={isDeleting}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-extrabold text-xs shadow active:scale-95 disabled:opacity-50 cursor-pointer"
                        >
                          {isDeleting ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          data-focusable
                          onClick={(e) => {
                            e.stopPropagation();
                            soundService.playTick();
                            setDeleteConfirmId(null);
                            const row = document.getElementById(`storage-item-${item.id}`);
                            if (row) focusManager.focus(row);
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLaunch(item);
                          }}
                          className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold flex items-center gap-1.5 shadow transition-all active:scale-95 cursor-pointer"
                          title={`Launch ${item.title}`}
                        >
                          <Play size={13} className="fill-white" />
                          <span>Play</span>
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            soundService.playTick();
                            setDeleteConfirmId(item.id);
                            const row = document.getElementById(`storage-item-${item.id}`);
                            if (row) focusManager.focus(row);
                          }}
                          className="p-2 rounded-xl bg-white/5 hover:bg-red-500/20 hover:text-red-300 text-slate-400 border border-white/10 hover:border-red-500/30 transition-colors cursor-pointer"
                          title="Delete game to free up space (X)"
                        >
                          <Trash2 size={16} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 bg-black/50 flex items-center justify-between text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
            <span>All files are stored in <code className="text-slate-300">~/Emulation/roms/&lt;platform&gt;</code></span>
          </div>
          <div className="flex items-center gap-4">
            {deleteConfirmId !== null ? (
              <>
                <span className="text-red-400 font-bold">Press <b className="text-white">A</b> or <b className="text-white">X</b> to Confirm Delete</span>
                <span><b className="text-white">B</b> Cancel</span>
              </>
            ) : (
              <>
                <span><b className="text-white">A</b> Play</span>
                <span><b className="text-white">X</b> Delete</span>
                <span><b className="text-white">B</b> Back</span>
              </>
            )}
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
