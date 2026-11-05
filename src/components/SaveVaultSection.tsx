import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Cloud,
  CloudUpload,
  CloudDownload,
  RotateCcw,
  Plus,
  Trash2,
  Check,
  Clock,
  Loader2,
  AlertCircle,
  HardDrive,
  FileCheck2,
  Save,
} from 'lucide-react';
import { Game } from '../types';
import {
  saveVaultService,
  SaveComparisonInfo,
  SaveSnapshot,
} from '../services/saveVaultService';
import { soundService } from '../services/soundService';
import { formatBytes } from './GameCard';

interface SaveVaultSectionProps {
  game: Game;
  onToast?: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
}

export const SaveVaultSection: React.FC<SaveVaultSectionProps> = ({ game, onToast }) => {
  const [loading, setLoading] = useState(true);
  const [comparison, setComparison] = useState<SaveComparisonInfo | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState('');
  const [showAddSnapshot, setShowAddSnapshot] = useState(false);

  const refreshSaves = useCallback(async () => {
    setLoading(true);
    try {
      const data = await saveVaultService.compareSaves(game);
      setComparison(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [game]);

  useEffect(() => {
    refreshSaves();
  }, [refreshSaves]);

  const handleCreateSnapshot = async () => {
    soundService.playTick();
    setActionLoading('snapshot');
    try {
      const label = customLabel.trim() || `Manual Save #${(comparison?.snapshots.length || 0) + 1}`;
      await saveVaultService.createSnapshot(game, label, 'manual');
      soundService.playSuccess();
      onToast?.(`Created RPG Backup Snapshot: "${label}"`, 'ok');
      setCustomLabel('');
      setShowAddSnapshot(false);
      await refreshSaves();
    } catch (e: any) {
      soundService.playBack();
      onToast?.(e?.message || 'Failed to create snapshot', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRollback = async (snapshot: SaveSnapshot) => {
    soundService.playTick();
    setActionLoading(`rollback_${snapshot.id}`);
    try {
      const res = await saveVaultService.rollbackToSnapshot(game, snapshot);
      if (res.ok) {
        soundService.playSuccess();
        onToast?.(res.message, 'ok');
        await refreshSaves();
      } else {
        soundService.playBack();
        onToast?.(res.message, 'error');
      }
    } catch (e: any) {
      soundService.playBack();
      onToast?.(e?.message || 'Rollback failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteSnapshot = (snapshotId: string) => {
    soundService.playTick();
    const updated = saveVaultService.deleteSnapshot(game.id, snapshotId);
    setComparison((prev) => (prev ? { ...prev, snapshots: updated } : null));
    onToast?.('Removed backup snapshot', 'info');
  };

  const handleUploadToRomM = async () => {
    soundService.playTick();
    setActionLoading('upload');
    try {
      const res = await saveVaultService.uploadToRomM(game);
      if (res.ok) {
        soundService.playSuccess();
        onToast?.(res.message, 'ok');
        await refreshSaves();
      } else {
        soundService.playBack();
        onToast?.(res.message, 'error');
      }
    } catch (e: any) {
      soundService.playBack();
      onToast?.(e?.message || 'Upload failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadFromRomM = async () => {
    if (!comparison?.serverSave?.downloadPath) return;
    soundService.playTick();
    setActionLoading('download');
    try {
      const res = await saveVaultService.downloadFromRomM(game, comparison.serverSave.downloadPath);
      if (res.ok) {
        soundService.playSuccess();
        onToast?.(res.message, 'ok');
        await refreshSaves();
      } else {
        soundService.playBack();
        onToast?.(res.message, 'error');
      }
    } catch (e: any) {
      soundService.playBack();
      onToast?.(e?.message || 'Download failed', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (ts: number) => {
    if (!ts) return 'Unknown';
    return new Date(ts).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <section
      data-focusable
      tabIndex={-1}
      className="p-5 rounded-2xl border border-indigo-500/30 bg-gradient-to-b from-indigo-950/20 via-deck-panel to-deck-panel flex flex-col gap-4 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0 shadow-inner">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-deck-accent flex items-center gap-1.5">
                <span>Cloud & Local Save Manager • RPG Vault</span>
              </h2>
              {comparison && (
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${comparison.statusColor}`}>
                  {comparison.statusLabel}
                </span>
              )}
            </div>
            <div className="text-xs text-deck-dim mt-0.5">
              RomM cloud synchronization & 5-slot rotating rollback protection
            </div>
          </div>
        </div>

        {/* Top Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            data-focusable
            disabled={Boolean(actionLoading)}
            onClick={() => {
              soundService.playTick();
              setShowAddSnapshot((v) => !v);
            }}
            className="text-xs font-bold text-white bg-indigo-600/80 hover:bg-indigo-500 px-3 py-1.5 rounded-xl border border-indigo-400/30 flex items-center gap-1.5 transition-all shadow active:scale-95 disabled:opacity-50"
            title="Create a new timestamped backup snapshot in the RPG vault"
          >
            <Plus size={14} />
            <span>Create Snapshot</span>
          </button>

          {comparison?.serverSave && (
            <button
              data-focusable
              disabled={Boolean(actionLoading)}
              onClick={handleDownloadFromRomM}
              className="text-xs font-bold text-sky-200 bg-sky-950/70 hover:bg-sky-900 border border-sky-400/40 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              title="Download the newest save from your RomM server to this Steam Deck"
            >
              {actionLoading === 'download' ? (
                <Loader2 size={14} className="animate-spin text-sky-400" />
              ) : (
                <CloudDownload size={14} className="text-sky-400" />
              )}
              <span>Download Cloud</span>
            </button>
          )}

          <button
            data-focusable
            disabled={Boolean(actionLoading)}
            onClick={handleUploadToRomM}
            className="text-xs font-bold text-emerald-200 bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-400/40 px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
            title="Upload your local battery save (.srm / .sav) to RomM cloud"
          >
            {actionLoading === 'upload' ? (
              <Loader2 size={14} className="animate-spin text-emerald-400" />
            ) : (
              <CloudUpload size={14} className="text-emerald-400" />
            )}
            <span>Upload to RomM</span>
          </button>
        </div>
      </div>

      {/* Snapshot creation input box (toggleable) */}
      {showAddSnapshot && (
        <div className="p-3.5 rounded-xl bg-black/50 border border-indigo-500/40 flex items-center gap-2.5 animate-in fade-in duration-150">
          <Save size={16} className="text-indigo-400 shrink-0" />
          <input
            data-focusable
            type="text"
            placeholder="Label (e.g. 'Before Final Boss', 'Chapter 4 Start')"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSnapshot();
            }}
            className="flex-1 bg-deck-panel-2 border border-deck-line rounded-lg px-3 py-1.5 text-xs text-white placeholder-deck-dim focus:outline-none focus:border-indigo-400"
          />
          <button
            data-focusable
            onClick={handleCreateSnapshot}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs"
          >
            Save Snapshot
          </button>
          <button
            data-focusable
            onClick={() => setShowAddSnapshot(false)}
            className="px-2.5 py-1.5 rounded-lg bg-deck-panel-2 border border-deck-line text-deck-dim hover:text-white text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Comparison Status Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Local Save Status */}
        <div className="p-3.5 rounded-xl bg-black/35 border border-deck-line/80 flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-deck-panel-2 border border-deck-line flex items-center justify-center text-deck-accent shrink-0">
            <HardDrive size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white flex items-center justify-between">
              <span>Steam Deck Local Save</span>
              <span className="text-[10px] font-mono text-deck-dim font-normal">
                {comparison?.localSave ? formatBytes(comparison.localSave.sizeBytes) : 'No file'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-deck-dim mt-0.5 truncate">
              {comparison?.localSave?.fileName || `${game.title}.srm`}
            </div>
            <div className="text-[10px] text-white/80 font-mono mt-1 flex items-center gap-1">
              <Clock size={11} className="text-deck-dim" />
              <span>
                {comparison?.localSave?.timestamp ? formatDate(comparison.localSave.timestamp) : 'No local save yet'}
              </span>
            </div>
          </div>
        </div>

        {/* Server Save Status */}
        <div className="p-3.5 rounded-xl bg-black/35 border border-deck-line/80 flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-deck-panel-2 border border-deck-line flex items-center justify-center text-sky-400 shrink-0">
            <Cloud size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white flex items-center justify-between">
              <span>RomM Cloud Save</span>
              <span className="text-[10px] font-mono text-deck-dim font-normal">
                {comparison?.serverSave ? formatBytes(comparison.serverSave.sizeBytes) : 'Not on server'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-deck-dim mt-0.5 truncate">
              {comparison?.serverSave?.fileName || 'Auto-sync slot'}
            </div>
            <div className="text-[10px] text-white/80 font-mono mt-1 flex items-center gap-1">
              <Clock size={11} className="text-deck-dim" />
              <span>
                {comparison?.serverSave?.timestamp ? formatDate(comparison.serverSave.timestamp) : 'Not synced yet'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* RPG Backup Vault (Rotating Snapshots) */}
      <div className="space-y-2 pt-1 border-t border-deck-line/60">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-extrabold text-white uppercase tracking-wider flex items-center gap-1.5">
            <FileCheck2 size={14} className="text-indigo-400" />
            <span>RPG Backup Vault Snapshots</span>
            <span className="text-[10px] font-mono px-2 py-0.2 rounded-full bg-indigo-950/60 text-indigo-300 border border-indigo-500/30 font-bold">
              {comparison?.snapshots.length || 0} / 5
            </span>
          </span>
          <span className="text-[10px] text-deck-dim">
            Rotating rollback points preserve your progress against corrupted saves
          </span>
        </div>

        {loading ? (
          <div className="p-6 text-center text-xs text-deck-dim flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin text-deck-accent" />
            <span>Scanning saves & vault...</span>
          </div>
        ) : !comparison?.snapshots || comparison.snapshots.length === 0 ? (
          <div className="p-5 rounded-xl bg-black/25 border border-deck-line/50 text-center text-xs text-deck-dim flex flex-col items-center gap-2">
            <p>No backup snapshots saved in the vault yet.</p>
            <button
              data-focusable
              onClick={handleCreateSnapshot}
              className="text-xs font-bold text-indigo-300 hover:text-white bg-indigo-950/40 border border-indigo-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <Plus size={13} />
              <span>Create Initial RPG Backup Snapshot</span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {comparison.snapshots.map((snap, idx) => {
              const isRollbacking = actionLoading === `rollback_${snap.id}`;
              return (
                <div
                  key={snap.id}
                  className="p-3 rounded-xl bg-deck-panel-2 border border-deck-line flex items-center justify-between gap-3 hover:border-deck-dim transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-mono font-bold text-xs shrink-0">
                      #{idx + 1}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold text-white truncate flex items-center gap-2">
                        <span>{snap.label}</span>
                        <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-black/50 text-deck-dim uppercase font-bold border border-deck-line/60">
                          {snap.source}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-deck-dim mt-0.5 flex items-center gap-2">
                        <span>{formatDate(snap.timestamp)}</span>
                        <span>•</span>
                        <span>{formatBytes(snap.sizeBytes)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      data-focusable
                      disabled={Boolean(actionLoading)}
                      onClick={() => handleRollback(snap)}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
                      title="Rollback active save to this snapshot"
                    >
                      {isRollbacking ? (
                        <Loader2 size={13} className="animate-spin text-amber-300" />
                      ) : (
                        <RotateCcw size={13} className="text-amber-400" />
                      )}
                      <span>Rollback</span>
                    </button>

                    <button
                      data-focusable
                      onClick={() => handleDeleteSnapshot(snap.id)}
                      className="h-8 w-8 rounded-lg bg-black/30 hover:bg-red-950/40 border border-deck-line hover:border-red-500/40 text-deck-dim hover:text-red-400 flex items-center justify-center transition-colors"
                      title="Delete snapshot"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
