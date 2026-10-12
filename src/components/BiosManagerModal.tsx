import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  CheckCircle2,
  AlertTriangle,
  FolderOpen,
  RefreshCw,
  Cpu,
  Layers,
  Search,
  HardDrive,
  Info,
  ExternalLink,
} from 'lucide-react';
import { FocusScope } from './FocusScope';
import { rommApi } from '../services/rommApi';
import { bridge, isNativeApp } from '../services/bridge';
import { RommFirmwareItem, BiosProgressEvent } from '../types';

interface BiosManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
  initialPlatformFilter?: string;
}

export const BiosManagerModal: React.FC<BiosManagerModalProps> = ({
  isOpen,
  onClose,
  onToast,
  initialPlatformFilter,
}) => {
  const [firmwareList, setFirmwareList] = useState<RommFirmwareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState<string>(initialPlatformFilter || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [downloadingIds, setDownloadingIds] = useState<Record<string, number>>({}); // id -> progress percent
  const [activeItem, setActiveItem] = useState<RommFirmwareItem | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const items = await rommApi.getFirmware();
      setFirmwareList(items);
      if (items.length > 0 && !activeItem) {
        setActiveItem(items[0]);
      }
    } catch (e: any) {
      onToast(`Failed to load BIOS list: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  useEffect(() => {
    const unsub = bridge.on('bios:progress', (ev: BiosProgressEvent) => {
      const id = String(ev.firmwareId);
      if (ev.status === 'downloading') {
        setDownloadingIds((prev) => ({ ...prev, [id]: ev.percent }));
      } else if (ev.status === 'completed') {
        setDownloadingIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setFirmwareList((prev) =>
          prev.map((f) => (String(f.id) === id ? { ...f, isInstalled: true, localPath: ev.path } : f))
        );
        onToast(`Installed ${ev.fileName} to BIOS directory`, 'ok');
      } else if (ev.status === 'error') {
        setDownloadingIds((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        onToast(`Failed to download ${ev.fileName}: ${ev.error}`, 'error');
      }
    });
    return unsub;
  }, [onToast]);

  if (!isOpen) return null;

  const platforms = Array.from(
    new Set(firmwareList.map((f) => f.platformSlug || 'misc').filter(Boolean))
  );

  const filteredItems = firmwareList.filter((item) => {
    if (selectedPlatform !== 'all' && item.platformSlug !== selectedPlatform) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        item.fileName.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.platformName && item.platformName.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const ps2Items = firmwareList.filter((f) => ['ps2', 'playstation-2', 'playstation2'].includes(f.platformSlug));
  const ps2InstalledCount = ps2Items.filter((f) => f.isInstalled).length;

  const handleDownloadSingle = async (item: RommFirmwareItem) => {
    const id = String(item.id);
    if (downloadingIds[id] !== undefined) return;
    setDownloadingIds((prev) => ({ ...prev, [id]: 0 }));
    try {
      const res = await rommApi.downloadFirmware(item);
      if (res.ok) {
        setFirmwareList((prev) =>
          prev.map((f) => (f.id === item.id ? { ...f, isInstalled: true, localPath: res.path } : f))
        );
        onToast(res.message || `Downloaded ${item.fileName}`, 'ok');
      } else {
        onToast(res.message || `Download failed`, 'error');
      }
    } catch (e: any) {
      onToast(`Download error: ${e.message}`, 'error');
    } finally {
      setDownloadingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const handleDownloadAllFiltered = async () => {
    const missing = filteredItems.filter((f) => !f.isInstalled);
    if (missing.length === 0) {
      onToast('All items in this view are already installed', 'info');
      return;
    }
    onToast(`Starting download of ${missing.length} BIOS file(s)...`, 'info');
    for (const item of missing) {
      await handleDownloadSingle(item);
    }
  };

  const handleOpenFolder = async () => {
    if (!isNativeApp) {
      onToast('Folder opening is only supported in the native Steam Deck app', 'info');
      return;
    }
    const res = await bridge.bios.openFolder();
    if (res.ok) {
      onToast('Opened ~/Emulation/bios folder', 'ok');
    } else {
      onToast('Could not open folder', 'error');
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="fixed inset-0 z-[220] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <FocusScope name="bios-manager" initialFocus="#bios-download-all" onAction={(a) => {
        if (a === 'BACK') {
          onClose();
          return true;
        }
        return false;
      }}>
        <div className="w-full max-w-5xl h-[88vh] bg-deck-panel border border-deck-line rounded-2xl flex flex-col shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-deck-line flex items-center justify-between bg-deck-bg/40">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <Cpu size={24} />
              </div>
              <div>
                <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
                  BIOS & Firmware Manager
                </h2>
                <p className="text-xs text-deck-dim">
                  Pull system BIOS files from RomM into ~/Emulation/bios & standalone emulator folders
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                id="bios-open-folder"
                data-focusable
                onClick={handleOpenFolder}
                className="px-3 py-1.5 rounded-lg bg-deck-subtle hover:bg-deck-subtle-hover border border-deck-line text-xs font-semibold text-deck-text flex items-center gap-1.5 transition-colors"
                title="Open BIOS Folder"
              >
                <FolderOpen size={14} />
                <span>Open Folder</span>
              </button>
              <button
                id="bios-refresh"
                data-focusable
                onClick={loadData}
                className="p-2 rounded-lg bg-deck-subtle hover:bg-deck-subtle-hover border border-deck-line text-deck-dim hover:text-white transition-colors"
                title="Refresh"
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
              <button
                id="bios-close"
                data-focusable
                onClick={onClose}
                className="p-2 rounded-lg bg-deck-subtle hover:bg-deck-subtle-hover border border-deck-line text-deck-dim hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* PS2 Callout Banner */}
          <div className="px-6 py-3 bg-gradient-to-r from-blue-950/40 via-purple-950/30 to-transparent border-b border-blue-500/20 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-300">
                <HardDrive size={18} />
              </div>
              <div className="text-xs">
                <span className="font-bold text-blue-300 mr-2">PlayStation 2 (PCSX2):</span>
                <span className="text-deck-dim">
                  PS2 requires BIOS files (e.g. <code className="text-deck-text font-mono">scph39001.bin</code>). DeckRomM automatically places downloaded BIOS into <code className="text-blue-300 font-mono">~/Emulation/bios</code> and the PCSX2 Flatpak data directory.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold border ${ps2InstalledCount > 0 ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300' : 'bg-amber-950/60 border-amber-500/40 text-amber-300'}`}>
                {ps2InstalledCount > 0 ? `✓ ${ps2InstalledCount} PS2 BIOS Installed` : '⚠️ PS2 BIOS Missing'}
              </span>
            </div>
          </div>

          {/* Filters & Search Toolbar */}
          <div className="px-6 py-3 border-b border-deck-line bg-deck-bg/20 flex flex-wrap items-center justify-between gap-3">
            {/* Platform pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-xl pb-1">
              <button
                data-focusable
                onClick={() => setSelectedPlatform('all')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${selectedPlatform === 'all' ? 'bg-deck-accent text-white' : 'bg-deck-subtle text-deck-dim hover:text-white'}`}
              >
                All Systems ({firmwareList.length})
              </button>
              {platforms.map((p) => {
                const count = firmwareList.filter((f) => f.platformSlug === p).length;
                const installed = firmwareList.filter((f) => f.platformSlug === p && f.isInstalled).length;
                return (
                  <button
                    key={p}
                    data-focusable
                    onClick={() => setSelectedPlatform(p)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${selectedPlatform === p ? 'bg-deck-accent text-white' : 'bg-deck-subtle text-deck-dim hover:text-white'}`}
                  >
                    <span>{p.toUpperCase()}</span>
                    <span className="opacity-70 text-[10px]">({installed}/{count})</span>
                  </button>
                );
              })}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                id="bios-download-all"
                data-focusable
                onClick={handleDownloadAllFiltered}
                className="px-4 py-1.5 rounded-lg bg-deck-accent hover:bg-deck-accent-hover text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all active:scale-95"
              >
                <Download size={14} />
                <span>Download Missing ({filteredItems.filter((f) => !f.isInstalled).length})</span>
              </button>
            </div>
          </div>

          {/* Body: Two-column master/detail */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* List */}
            <div className="w-7/12 border-r border-deck-line overflow-y-auto p-4 space-y-2">
              {loading ? (
                <div className="h-64 flex flex-col items-center justify-center text-deck-dim gap-3">
                  <RefreshCw size={28} className="animate-spin text-deck-accent" />
                  <span className="text-sm">Scanning RomM server and local BIOS paths...</span>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-deck-dim gap-2 text-center p-6">
                  <Info size={32} className="text-deck-dim opacity-40" />
                  <span className="font-bold text-white">No BIOS files found for this filter</span>
                  <p className="text-xs max-w-sm">
                    In RomM, place your BIOS files under <code className="text-deck-accent font-mono">/romm/library/bios/{selectedPlatform !== 'all' ? selectedPlatform : '{platform}'}/</code> and run a scan to index them.
                  </p>
                </div>
              ) : (
                filteredItems.map((item) => {
                  const isDownloading = downloadingIds[String(item.id)] !== undefined;
                  const progress = downloadingIds[String(item.id)] || 0;
                  const isSelected = activeItem?.id === item.id;

                  return (
                    <div
                      key={item.id}
                      data-focusable
                      tabIndex={0}
                      onClick={() => setActiveItem(item)}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${isSelected ? 'bg-deck-accent/10 border-deck-accent shadow-md' : 'bg-deck-panel-2 border-deck-line hover:border-deck-dim'}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-lg flex-shrink-0 ${item.isInstalled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-deck-subtle text-deck-dim'}`}>
                          {item.isInstalled ? <CheckCircle2 size={18} /> : <HardDrive size={18} />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white truncate font-mono">{item.fileName}</span>
                            {item.isVerified && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/70 border border-emerald-500/30 text-emerald-400 font-semibold uppercase tracking-wider">
                                Verified
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-deck-dim flex items-center gap-2 mt-0.5">
                            <span className="font-semibold text-deck-accent">{item.platformName || item.platformSlug.toUpperCase()}</span>
                            <span>•</span>
                            <span>{formatBytes(item.fileSizeBytes)}</span>
                            {item.requiredForEmulators && item.requiredForEmulators.length > 0 && (
                              <>
                                <span>•</span>
                                <span className="text-purple-300 font-medium">Used by: {item.requiredForEmulators.join(', ')}</span>
                              </>
                            )}
                          </div>
                          {isDownloading && (
                            <div className="w-full bg-deck-subtle h-1.5 rounded-full overflow-hidden mt-2">
                              <div className="bg-deck-accent h-full transition-all duration-200" style={{ width: `${progress}%` }} />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {item.isInstalled ? (
                          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/40 px-3 py-1.5 rounded-lg border border-emerald-500/20">
                            <CheckCircle2 size={14} />
                            <span>Installed</span>
                          </div>
                        ) : (
                          <button
                            data-focusable
                            disabled={isDownloading}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadSingle(item);
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${isDownloading ? 'bg-deck-subtle text-deck-dim' : 'bg-deck-accent hover:bg-deck-accent-hover text-white'}`}
                          >
                            <Download size={14} />
                            <span>{isDownloading ? `${progress}%` : 'Pull BIOS'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Detail Pane */}
            <div className="w-5/12 p-6 overflow-y-auto flex flex-col justify-between bg-deck-bg/10">
              {activeItem ? (
                <div className="space-y-5">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-deck-dim">Selected BIOS File</span>
                    <h3 className="text-lg font-extrabold text-white font-mono break-all mt-1">{activeItem.fileName}</h3>
                    <p className="text-xs text-deck-dim mt-1.5 leading-relaxed">
                      {activeItem.description || `Required or recommended BIOS for ${activeItem.platformName || activeItem.platformSlug}.`}
                    </p>
                  </div>

                  <div className="space-y-3 p-4 rounded-xl bg-deck-panel-2 border border-deck-line text-xs">
                    <div className="flex justify-between py-1 border-b border-deck-line/60">
                      <span className="text-deck-dim">Platform:</span>
                      <span className="font-bold text-white">{activeItem.platformName || activeItem.platformSlug.toUpperCase()}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-deck-line/60">
                      <span className="text-deck-dim">Size:</span>
                      <span className="font-mono text-white">{formatBytes(activeItem.fileSizeBytes)}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-deck-line/60">
                      <span className="text-deck-dim">Status:</span>
                      <span className={`font-bold ${activeItem.isInstalled ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {activeItem.isInstalled ? 'Installed on Deck' : 'Available on RomM'}
                      </span>
                    </div>
                    {activeItem.md5Hash && (
                      <div className="py-1 border-b border-deck-line/60">
                        <span className="text-deck-dim block mb-1">MD5 Checksum:</span>
                        <span className="font-mono text-[11px] text-deck-accent break-all select-all">{activeItem.md5Hash}</span>
                      </div>
                    )}
                    {activeItem.localPath && (
                      <div className="py-1">
                        <span className="text-deck-dim block mb-1">Local Location:</span>
                        <span className="font-mono text-[11px] text-deck-text break-all select-all">{activeItem.localPath}</span>
                      </div>
                    )}
                  </div>

                  <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/20 text-xs space-y-2">
                    <div className="font-bold text-purple-300 flex items-center gap-1.5">
                      <Cpu size={14} />
                      <span>Emulator Deployment</span>
                    </div>
                    <p className="text-deck-dim leading-relaxed">
                      When downloaded, DeckRomM places the file into <code className="text-deck-text font-mono">~/Emulation/bios/</code> and automatically propagates it to the appropriate Flatpak directory (PCSX2, DuckStation, or RetroArch system) so your games can launch without manual configuration.
                    </p>
                  </div>

                  {!activeItem.isInstalled && (
                    <button
                      data-focusable
                      disabled={downloadingIds[String(activeItem.id)] !== undefined}
                      onClick={() => handleDownloadSingle(activeItem)}
                      className="w-full py-3 rounded-xl bg-deck-accent hover:bg-deck-accent-hover text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-transform active:scale-95"
                    >
                      <Download size={18} />
                      <span>Download {activeItem.fileName}</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-deck-dim text-xs">
                  Select a BIOS item from the list to see details.
                </div>
              )}

              {/* Help footer */}
              <div className="pt-4 border-t border-deck-line text-[11px] text-deck-dim flex items-center justify-between">
                <span>D-pad navigate • A download • B close</span>
                <span className="font-mono">RomM Firmware v2</span>
              </div>
            </div>
          </div>
        </div>
      </FocusScope>
    </div>
  );
};
