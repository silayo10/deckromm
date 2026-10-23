import React from 'react';
import { Library, Search, RefreshCw, Download, HardDrive, Settings, LogIn, LogOut, Maximize, Power, Wand2, Sliders, Cpu, ArrowUpCircle, CloudOff } from 'lucide-react';
import { FocusScope } from './FocusScope';
import { isNativeApp } from '../services/bridge';

interface MainMenuProps {
  username: string | null;
  serverLabel: string;
  authenticated: boolean;
  offlineMode?: boolean;
  onToggleOfflineMode?: () => void;
  onClose: () => void;
  onLibrary: () => void;
  onSearch: () => void;
  onRefresh: () => void;
  onDownloads: () => void;
  onStorage?: () => void;
  onSettings: () => void;
  onPatcher?: () => void;
  onEmulators?: () => void;
  onBios?: () => void;
  onUpdate?: () => void;
  onSignIn: () => void;
  onLogout: () => void;
  onToggleFullscreen: () => void;
  onExit: () => void;
}

/** Start-button side menu (Steam-style). "Exit to Steam" is always last and red. */
export const MainMenu: React.FC<MainMenuProps> = (p) => {
  const item = 'deck-row w-full h-14 px-5 rounded-xl flex items-center gap-4 text-lg font-semibold text-left';
  const Item = ({ icon, label, onClick, id }: { icon: React.ReactNode; label: string; onClick?: () => void; id?: string }) => (
    <button id={id} data-focusable onClick={onClick} className={item}>
      {icon}
      {label}
    </button>
  );
  return (
    <div className="fixed inset-0 z-[120] flex deck-enter" onClick={p.onClose}>
      <FocusScope
        name="main-menu"
        onBack={p.onClose}
        onAction={(a) => {
          if (a === 'MENU') {
            p.onClose();
            return true;
          }
          return a !== 'SELECT' && a !== 'BACK' && !a.startsWith('SCROLL') && !a.startsWith('PAGE');
        }}
        initialFocus="#menu-library"
        className="w-[380px] h-full bg-[#0e131d] border-r border-deck-line shadow-2xl flex flex-col p-5 gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 pb-4 mb-2 border-b border-deck-line">
          <div className="text-2xl font-extrabold">DeckRomM</div>
          <div className="text-sm text-deck-dim truncate">{p.username ? `${p.username} @ ${p.serverLabel}` : p.serverLabel}</div>
        </div>
        <Item id="menu-library" icon={<Library size={22} />} label="Library" onClick={p.onLibrary} />
        <Item icon={<Search size={22} />} label="Search" onClick={p.onSearch} />
        <Item icon={<RefreshCw size={22} />} label="Refresh library" onClick={p.onRefresh} />
        {p.onPatcher && <Item icon={<Wand2 size={22} />} label="ROM Hacks & Patches" onClick={p.onPatcher} />}
        {p.onEmulators && <Item icon={<Sliders size={22} />} label="Standalone Emulators" onClick={p.onEmulators} />}
        {p.onBios && <Item icon={<Cpu size={22} />} label="BIOS & Firmware" onClick={p.onBios} />}
        {p.onUpdate && <Item icon={<ArrowUpCircle size={22} />} label="Check for Updates" onClick={p.onUpdate} />}
        {p.onStorage && <Item id="menu-storage" icon={<HardDrive size={22} />} label="Storage & Downloaded Games" onClick={p.onStorage} />}
        {p.onToggleOfflineMode && (
          <Item
            id="menu-offline-mode"
            icon={<CloudOff size={22} className={p.offlineMode ? 'text-amber-400' : 'text-deck-dim'} />}
            label={p.offlineMode ? 'Offline Mode: ON (Local)' : 'Offline Mode: OFF'}
            onClick={() => {
              p.onToggleOfflineMode?.();
              p.onClose();
            }}
          />
        )}
        {isNativeApp && <Item icon={<Download size={22} />} label="Downloads" onClick={p.onDownloads} />}
        <Item icon={<Settings size={22} />} label="Server & settings" onClick={p.onSettings} />
        {p.authenticated ? (
          <Item icon={<LogOut size={22} />} label="Sign out" onClick={p.onLogout} />
        ) : (
          <Item icon={<LogIn size={22} />} label="Sign in" onClick={p.onSignIn} />
        )}
        {isNativeApp && <Item icon={<Maximize size={22} />} label="Toggle fullscreen" onClick={p.onToggleFullscreen} />}
        <div className="flex-1" />
        {isNativeApp && (
          <button
            id="menu-exit"
            data-focusable
            onClick={p.onExit}
            className="w-full h-16 px-5 rounded-xl flex items-center gap-4 text-lg font-extrabold bg-deck-danger/20 border-2 border-deck-danger text-red-100"
          >
            <Power size={24} /> Exit to Steam
          </button>
        )}
      </FocusScope>
      <div className="flex-1 bg-black/60" />
    </div>
  );
};
