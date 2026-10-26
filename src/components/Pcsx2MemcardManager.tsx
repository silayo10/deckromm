import React, { useState, useEffect } from 'react';
import {
  HardDrive,
  UploadCloud,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sliders,
  Folder,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Game } from '../types';
import { rommApi } from '../services/rommApi';
import { bridge, isNativeApp } from '../services/bridge';
import { soundService } from '../services/soundService';
import { formatBytes } from './GameCard';
import type { Pcsx2MemoryCard, Pcsx2MemcardStatus, CloudSave } from '../env/electron';

interface Pcsx2MemcardManagerProps {
  game?: Game;
  onToast: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
  compact?: boolean;
}

export const Pcsx2MemcardManager: React.FC<Pcsx2MemcardManagerProps> = ({
  game,
  onToast,
  compact = false,
}) => {
  const [status, setStatus] = useState<Pcsx2MemcardStatus | null>(null);
  const [cloudSaves, setCloudSaves] = useState<CloudSave[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selectedCard, setSelectedCard] = useState<string>('');
  const [showGuide, setShowGuide] = useState(false);
  const [lastUploaded, setLastUploaded] = useState<{ fileName: string; size: number; time: number } | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [memStatus, savesRes] = await Promise.all([
        rommApi.getPcsx2Memcards().catch(() => null),
        game?.id ? bridge.cloud.listSaves(game.id).catch(() => ({ ok: false, saves: [] })) : Promise.resolve({ ok: false, saves: [] }),
      ]);

      if (memStatus) {
        setStatus(memStatus);
        if (memStatus.cards.length > 0 && !selectedCard) {
          setSelectedCard(memStatus.cards[0].fileName);
        }
      }

      if (savesRes && savesRes.saves) {
        setCloudSaves(savesRes.saves);
      }
    } catch (e: any) {
      console.warn('Failed to load PCSX2 memory cards:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Listen for automatic post-game upload event from main process
    const off = bridge.on('pcsx2:memcard-uploaded', (ev) => {
      if (!game || String(game.id) === String(ev.romId)) {
        setLastUploaded({ fileName: ev.fileName, size: ev.sizeBytes, time: ev.time });
        soundService.playSuccess();
        onToast(`Auto-uploaded PCSX2 memory card (${ev.fileName}) to RomM!`, 'ok');
        loadData();
      }
    });

    return () => {
      off();
    };
  }, [game?.id]);

  const handleUpload = async (cardFileName?: string) => {
    const targetFile = cardFileName || selectedCard || (status?.cards[0]?.fileName);
    if (!targetFile) {
      onToast('No memory card found to upload', 'error');
      return;
    }

    soundService.playTick();
    setUploading(true);

    try {
      const g = game || {
        id: 'pcsx2-global',
        title: 'PlayStation 2 Memory Card',
        platformSlug: 'ps2',
        platformName: 'PlayStation 2',
        fileName: 'Mcd001.ps2',
        fileSizeBytes: 8650752,
        releaseYear: 2000,
        developer: '',
        publisher: '',
        genres: [],
        rating: 0,
        summary: '',
        coverUrl: '',
      };

      const res = await rommApi.uploadPcsx2Memcard(g, targetFile);
      if (res.ok) {
        soundService.playSuccess();
        const sz = res.sizeBytes ? formatBytes(res.sizeBytes) : '8.4 MB';
        onToast(`Successfully uploaded ${res.fileName || targetFile} (${sz}) to RomM server!`, 'ok');
        setLastUploaded({
          fileName: res.fileName || targetFile,
          size: res.sizeBytes || 8650752,
          time: Date.now(),
        });
        await loadData();
      } else {
        soundService.playBack();
        onToast(`Upload failed: ${res.message || 'unknown error'}`, 'error');
      }
    } catch (e: any) {
      soundService.playBack();
      onToast(`Error uploading memory card: ${e.message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (save: CloudSave) => {
    if (!save.downloadPath) return;
    soundService.playTick();
    setDownloading(true);

    try {
      const targetFileName = save.fileName || 'Mcd001.ps2';
      const res = await rommApi.downloadPcsx2Memcard(save.downloadPath, targetFileName);

      if (res.ok) {
        soundService.playSuccess();
        onToast(`Restored ${targetFileName} from RomM into PCSX2 memcards!`, 'ok');
        await loadData();
      } else {
        soundService.playBack();
        onToast(`Download failed: ${res.message}`, 'error');
      }
    } catch (e: any) {
      soundService.playBack();
      onToast(`Error restoring memory card: ${e.message}`, 'error');
    } finally {
      setDownloading(false);
    }
  };

  const handleToggleAutoSync = async () => {
    soundService.playTick();
    const nextState = !status?.autoSync;
    const res = await rommApi.setPcsx2AutoSync(nextState);
    if (res.ok) {
      setStatus((prev) => (prev ? { ...prev, autoSync: res.autoSync } : null));
      onToast(`PCSX2 auto-sync ${res.autoSync ? 'enabled' : 'disabled'}`, 'ok');
    }
  };

  const activeCard = status?.cards.find((c) => c.fileName === selectedCard) || status?.cards[0];
  const newestCloudSave = cloudSaves[0];

  return (
    <div className="rounded-2xl p-5 bg-gradient-to-br from-indigo-950/60 via-slate-900/80 to-blue-950/50 border border-indigo-400/30 shadow-xl flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-400/40">
            <HardDrive size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold text-white">PCSX2 Memory Card Cloud Sync</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                PlayStation 2
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Upload local PS2 memory card (.ps2 or folder card) to your RomM server, or restore cloud saves
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-Sync Toggle Badge */}
          <button
            data-focusable
            onClick={handleToggleAutoSync}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
              status?.autoSync !== false
                ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300 hover:bg-emerald-500/30'
                : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
            }`}
            title="When enabled, DeckRomM automatically uploads modified memory cards when PCSX2 closes"
          >
            <span className={`w-2 h-2 rounded-full ${status?.autoSync !== false ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
            <span>Auto-Sync on Exit: {status?.autoSync !== false ? 'ON' : 'OFF'}</span>
          </button>

          <button
            data-focusable
            onClick={loadData}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Refresh memory cards"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Local Memory Card Panel */}
        <div className="p-4 rounded-xl bg-black/40 border border-white/10 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 border-b border-white/10 pb-2">
            <span className="flex items-center gap-1.5">
              <HardDrive size={14} className="text-indigo-400" />
              <span>Local Memory Card on Deck</span>
            </span>
            <span className="text-[11px] font-mono text-slate-500 truncate max-w-[180px]" title={status?.memcardsDir}>
              {status?.memcardsDir ? '.../memcards' : 'Scanning...'}
            </span>
          </div>

          {status?.cards && status.cards.length > 0 ? (
            <div className="flex flex-col gap-2">
              {/* Select card if multiple */}
              {status.cards.length > 1 ? (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400 shrink-0">Card:</label>
                  <select
                    value={selectedCard}
                    onChange={(e) => setSelectedCard(e.target.value)}
                    className="flex-1 h-8 px-2.5 rounded-lg bg-slate-900 border border-white/20 text-xs text-white focus:outline-none focus:border-indigo-400 truncate"
                  >
                    {status.cards.map((c) => (
                      <option key={c.fileName} value={c.fileName}>
                        {c.isFolder ? '📁 ' : '💾 '}
                        {c.fileName} ({formatBytes(c.sizeBytes)}) {c.isFolder ? `[Folder${c.saveCount ? ` - ${c.saveCount} items` : ''}]` : ''} {c.isDefault ? '- Default' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {activeCard && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-extrabold text-sm text-white font-mono truncate max-w-[200px]">{activeCard.fileName}</span>
                      {activeCard.isFolder && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30 flex items-center gap-1 shrink-0">
                          <Folder size={10} /> Folder Card {activeCard.saveCount ? `(${activeCard.saveCount} saves)` : ''}
                        </span>
                      )}
                      {activeCard.isDefault && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 shrink-0">
                          Slot 1 (Standard)
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 font-mono truncate">
                      Size: <strong className="text-slate-200">{formatBytes(activeCard.sizeBytes)}</strong> · Modified:{' '}
                      <span className="text-slate-300">{new Date(activeCard.mtime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                    </div>
                  </div>

                  <button
                    data-focusable
                    disabled={uploading}
                    onClick={() => handleUpload(activeCard.fileName)}
                    className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-md border border-indigo-400/40 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                    title={`Upload ${activeCard.fileName} to RomM server`}
                  >
                    {uploading ? (
                      <>
                        <RefreshCw size={14} className="animate-spin" />
                        <span>Uploading...</span>
                      </>
                    ) : (
                      <>
                        <UploadCloud size={15} />
                        <span>Upload to RomM</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {lastUploaded && (
                <div className="text-[11px] text-emerald-300 font-mono flex items-center gap-1.5 bg-emerald-950/40 p-2 rounded-lg border border-emerald-500/30">
                  <CheckCircle2 size={13} className="shrink-0" />
                  <span className="truncate">
                    Uploaded <strong>{lastUploaded.fileName}</strong> ({formatBytes(lastUploaded.size)}) at{' '}
                    {new Date(lastUploaded.time).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 text-center text-xs text-slate-400 bg-white/5 rounded-lg border border-white/5 flex flex-col gap-2">
              <AlertCircle size={20} className="mx-auto text-amber-400" />
              <span className="font-semibold text-white">No PCSX2 memory cards or folder cards found.</span>
              <span className="text-[11px] text-slate-400">
                Play any PS2 game once or open PCSX2 settings to initialize your memory card or folder.
              </span>
            </div>
          )}
        </div>

        {/* RomM Server Cloud Saves Panel */}
        <div className="p-4 rounded-xl bg-black/40 border border-white/10 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-400 border-b border-white/10 pb-2">
            <span className="flex items-center gap-1.5">
              <UploadCloud size={14} className="text-sky-400" />
              <span>RomM Cloud Saves {game ? `(${game.title})` : ''}</span>
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              {cloudSaves.length} {cloudSaves.length === 1 ? 'cloud save' : 'cloud saves'}
            </span>
          </div>

          {newestCloudSave ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-sm text-white font-mono truncate">{newestCloudSave.fileName}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-500/20 text-sky-300 border border-sky-400/30">
                      Server Cloud
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                    Size: <strong className="text-slate-200">{formatBytes(newestCloudSave.sizeBytes)}</strong> · Updated:{' '}
                    <span className="text-slate-300">
                      {new Date(newestCloudSave.updatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                </div>

                <button
                  data-focusable
                  disabled={downloading}
                  onClick={() => handleDownload(newestCloudSave)}
                  className="px-3.5 py-2 rounded-xl text-xs font-extrabold bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5 shadow-md border border-sky-400/40 transition-all active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                  title="Download and restore this memory card into PCSX2"
                >
                  {downloading ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Restoring...</span>
                    </>
                  ) : (
                    <>
                      <DownloadCloud size={15} />
                      <span>Restore to Deck</span>
                    </>
                  )}
                </button>
              </div>

              <div className="text-[10px] text-slate-400 flex items-center gap-1.5 px-1">
                <Check size={12} className="text-emerald-400 shrink-0" />
                <span>Restoring creates a safety timestamped backup of your current local card.</span>
              </div>
            </div>
          ) : (
            <div className="p-3 text-center text-xs text-slate-400 bg-white/5 rounded-lg border border-white/5 flex flex-col gap-1.5">
              <span>No cloud saves found on RomM server for this title yet.</span>
              <p className="text-[11px] text-slate-500">
                Click <strong>"Upload to RomM"</strong> on the left to upload your memory card to the server!
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Guide Toggle */}
      <div className="pt-1">
        <button
          data-focusable
          onClick={() => setShowGuide(!showGuide)}
          className="text-xs text-indigo-300 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Sliders size={13} />
          <span className="font-bold">
            {showGuide ? 'Hide PCSX2 Per-Game Memory Card Guide' : 'Pro-Tip: How to enable Per-Game Memory Cards in PCSX2'}
          </span>
          {showGuide ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {showGuide && (
          <div className="mt-2 p-3.5 rounded-xl bg-black/50 border border-indigo-400/20 text-xs text-slate-300 flex flex-col gap-2 animate-in fade-in">
            <div className="font-extrabold text-white flex items-center gap-1.5">
              <span>Why use Per-Game Memory Cards?</span>
            </div>
            <p className="leading-relaxed text-slate-300">
              By default, PS2 uses one 8MB card (<code className="text-indigo-300 font-mono">Mcd001.ps2</code>) shared by all games. When you play many games, the 8MB fills up.
            </p>
            <div className="flex flex-col gap-1 text-[11px] bg-white/5 p-2.5 rounded-lg border border-white/10 font-mono">
              <span className="text-indigo-300 font-bold">Recommended Setup:</span>
              <span>1. Click "Configure PCSX2" to open the PCSX2 standalone GUI.</span>
              <span>2. Go to <strong>Settings</strong> → <strong>Memory Cards</strong>.</span>
              <span>3. Check <strong>"Auto-Eject / Per-Game Memory Cards"</strong>.</span>
              <span>4. Now each game gets its own 8MB card automatically (e.g. <code className="text-white">Final Fantasy X.ps2</code>).</span>
            </div>
            <p className="text-[11px] text-slate-400">
              DeckRomM supports both modes seamlessly! Whenever you close PCSX2, the modified card is automatically backed up to RomM.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
