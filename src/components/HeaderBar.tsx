import React, { useEffect, useState } from 'react';
import { Menu, Search, Wifi, WifiOff, Battery, BatteryCharging, Download, HardDrive, CloudOff, Activity, Gauge } from 'lucide-react';
import { rommApi } from '../services/rommApi';

interface HeaderBarProps {
  title: string;
  subtitle?: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenMenu: () => void;
  onOpenDownloads: () => void;
  onOpenStorage?: () => void;
  offlineMode?: boolean;
  onToggleOfflineMode?: () => void;
  activeDownloads: number;
  downloadSpeed?: string;
  connected: boolean;
  serverLabel: string;
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function useBattery() {
  const [bat, setBat] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const nav = navigator as any;
    if (!nav.getBattery) return;
    let battery: any;
    const update = () => battery && setBat({ level: battery.level, charging: battery.charging });
    nav.getBattery().then((b: any) => {
      battery = b;
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    });
    return () => {
      battery?.removeEventListener('levelchange', update);
      battery?.removeEventListener('chargingchange', update);
    };
  }, []);
  return bat;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  title,
  subtitle,
  searchQuery,
  onSearchChange,
  onOpenMenu,
  onOpenDownloads,
  onOpenStorage,
  activeDownloads,
  downloadSpeed,
  connected,
  serverLabel,
  offlineMode = false,
  onToggleOfflineMode,
}) => {
  const clock = useClock();
  const battery = useBattery();

  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [freeStorageGb, setFreeStorageGb] = useState<number | null>(null);

  useEffect(() => {
    if (offlineMode || !connected) {
      setLatencyMs(null);
      return;
    }
    let alive = true;
    const measure = async () => {
      const start = performance.now();
      try {
        await rommApi.refreshAuthStatus();
        if (alive) {
          const delta = Math.round(performance.now() - start);
          setLatencyMs(delta);
        }
      } catch {
        if (alive) setLatencyMs(null);
      }
    };
    measure();
    const interval = setInterval(measure, 30000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [connected, offlineMode]);

  useEffect(() => {
    rommApi.getDownloadedRomsReport().then((rep) => {
      const free = rep?.storage?.sdFreeBytes || rep?.storage?.internalFreeBytes;
      if (free) {
        setFreeStorageGb(Math.round((free / (1024 ** 3)) * 10) / 10);
      }
    }).catch(() => {});
  }, []);
  return (
    <header className="h-16 shrink-0 flex items-center gap-4 px-5 bg-[#0a0d14] border-b border-deck-line">
      <button
        data-focusable
        id="header-menu"
        onClick={onOpenMenu}
        className="h-11 w-11 flex items-center justify-center rounded-xl bg-deck-panel-2 border border-deck-line"
        aria-label="Main menu"
      >
        <Menu size={22} />
      </button>
      <div className="min-w-0 w-[260px]">
        <div className="text-lg font-extrabold leading-tight truncate">{title}</div>
        {subtitle && <div className="text-xs text-deck-dim truncate">{subtitle}</div>}
      </div>

      <label className="flex-1 max-w-[440px] relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-deck-dim pointer-events-none" />
        <input
          id="header-search"
          data-focusable
          data-keyboard-mode="search"
          data-keyboard-title="Search library"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search games  (Y)"
          className="deck-input w-full h-11 rounded-xl bg-deck-panel border-2 border-deck-line pl-10 pr-3 text-base text-deck-text placeholder:text-deck-dim"
        />
      </label>

      <div className="ml-auto flex items-center gap-3 text-sm text-deck-dim">
        {onToggleOfflineMode && (
          <button
            data-focusable
            id="header-offline-toggle"
            onClick={onToggleOfflineMode}
            className={`h-11 px-3.5 flex items-center gap-2 rounded-xl border transition-all ${
              offlineMode
                ? 'bg-amber-500/25 hover:bg-amber-500/35 border-amber-500/50 text-amber-300 shadow-sm'
                : 'bg-deck-panel-2 hover:bg-white/10 border-deck-line text-deck-dim hover:text-white'
            }`}
            aria-label={offlineMode ? 'Offline Mode Active' : 'Online Mode Active'}
            title={
              offlineMode
                ? 'Offline Mode Active: Showing downloaded games only. Click to switch to Online.'
                : 'Click to enable Offline Mode (show downloaded games only)'
            }
          >
            {offlineMode ? <CloudOff size={16} className="text-amber-400" /> : <Wifi size={16} className="text-deck-ok" />}
            <span className="text-xs font-bold tracking-wide">
              {offlineMode ? 'Offline Mode' : 'Online'}
            </span>
          </button>
        )}

        {onOpenStorage && (
          <button
            data-focusable
            id="header-storage"
            onClick={onOpenStorage}
            className="h-11 px-3.5 flex items-center gap-2 rounded-xl bg-deck-panel-2 hover:bg-white/10 border border-deck-line text-deck-text hover:text-white transition-colors"
            aria-label="Storage and Downloaded Games"
            title="Storage & Downloaded Games Space"
          >
            <HardDrive size={18} className="text-sky-400" />
            <span className="hidden sm:inline text-xs font-bold text-slate-200">
              {freeStorageGb != null ? `${freeStorageGb} GB` : 'Storage'}
            </span>
          </button>
        )}
        <button
          data-focusable
          onClick={onOpenDownloads}
          className="relative h-11 px-3 flex items-center gap-2 rounded-xl bg-deck-panel-2 border border-deck-line text-deck-text"
          aria-label="Downloads"
          title={activeDownloads > 0 ? `Active Downloads (${activeDownloads}) - ${downloadSpeed || 'In Progress'}` : 'Downloads'}
        >
          <Download size={18} />
          {activeDownloads > 0 && (
            <span className="min-w-5 h-5 px-1 rounded-full bg-deck-accent text-white text-xs font-bold flex items-center justify-center">
              {activeDownloads}
            </span>
          )}
          {activeDownloads > 0 && downloadSpeed && (
            <span className="hidden md:flex items-center gap-1 text-[11px] font-mono font-bold text-sky-300">
              <Activity size={12} className="animate-pulse text-sky-400" />
              <span>{downloadSpeed}</span>
            </span>
          )}
        </button>

        {/* RomM Server connection & Ping Latency Glance */}
        <span className="flex items-center gap-2 max-w-[240px] truncate" title={serverLabel}>
          {offlineMode ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold text-xs">
              <CloudOff size={13} className="text-amber-400" />
              <span>Offline</span>
            </span>
          ) : connected ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-deck-panel-2 border border-deck-line text-xs font-mono font-bold text-deck-text">
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  latencyMs && latencyMs < 80
                    ? 'bg-deck-ok animate-pulse shadow-[0_0_8px_rgba(91,163,43,0.8)]'
                    : latencyMs && latencyMs < 200
                    ? 'bg-amber-400'
                    : 'bg-deck-ok'
                }`}
              />
              <span className="truncate">{latencyMs != null ? `${latencyMs}ms` : 'Online'}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 font-bold text-xs">
              <WifiOff size={13} className="text-deck-danger" />
              <span>Disconnected</span>
            </span>
          )}
          <span className="truncate text-xs font-medium text-deck-dim hidden lg:inline">
            {offlineMode ? 'Local Games' : serverLabel}
          </span>
        </span>

        {battery && (
          <span className="flex items-center gap-1 text-xs sm:text-sm">
            {battery.charging ? <BatteryCharging size={18} className="text-emerald-400" /> : <Battery size={18} />}
            {Math.round(battery.level * 100)}%
          </span>
        )}
        <span className="text-base font-bold text-deck-text tabular-nums">{clock}</span>
      </div>
    </header>
  );
};
