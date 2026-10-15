import React, { useEffect, useState } from 'react';
import { Menu, Search, Wifi, WifiOff, Battery, BatteryCharging, Download, HardDrive } from 'lucide-react';

interface HeaderBarProps {
  title: string;
  subtitle?: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenMenu: () => void;
  onOpenDownloads: () => void;
  onOpenStorage?: () => void;
  activeDownloads: number;
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
  connected,
  serverLabel,
}) => {
  const clock = useClock();
  const battery = useBattery();
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
            <span className="hidden sm:inline text-xs font-bold text-slate-200">Storage</span>
          </button>
        )}
        <button
          data-focusable
          onClick={onOpenDownloads}
          className="relative h-11 px-3 flex items-center gap-2 rounded-xl bg-deck-panel-2 border border-deck-line text-deck-text"
          aria-label="Downloads"
        >
          <Download size={18} />
          {activeDownloads > 0 && (
            <span className="min-w-5 h-5 px-1 rounded-full bg-deck-accent text-white text-xs font-bold flex items-center justify-center">
              {activeDownloads}
            </span>
          )}
        </button>
        <span className="flex items-center gap-1.5 max-w-[200px] truncate" title={serverLabel}>
          {connected ? <Wifi size={16} className="text-deck-ok" /> : <WifiOff size={16} className="text-deck-danger" />}
          <span className="truncate">{serverLabel}</span>
        </span>
        {battery && (
          <span className="flex items-center gap-1">
            {battery.charging ? <BatteryCharging size={18} /> : <Battery size={18} />}
            {Math.round(battery.level * 100)}%
          </span>
        )}
        <span className="text-base font-bold text-deck-text tabular-nums">{clock}</span>
      </div>
    </header>
  );
};
