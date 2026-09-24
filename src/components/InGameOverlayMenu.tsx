import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Game, SaveState, OverlayButtonCombo, NavigationAction, EmulatorAspectRatio } from '../types';
import {
  Play,
  RotateCcw,
  Save,
  Volume2,
  VolumeX,
  Tv,
  Gamepad2,
  FolderOpen,
  FastForward,
  LogOut,
  Layers,
  Check,
  Trash2,
  Monitor,
  Zap,
  Activity,
  Minus,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { gamepadService } from '../services/gamepadService';
import { soundService } from '../services/soundService';

interface InGameOverlayMenuProps {
  isOpen: boolean;
  onClose: () => void;
  game: Game;
  selectedSlot: number;
  onSelectSlot: (slot: number) => void;
  saveStates: Record<number, SaveState>;
  onSaveState: (slot: number) => void;
  onLoadState: (slot: number) => void;
  onDeleteState: (slot: number) => void;
  /** Load-only states found on RomM that were not made in a DeckRomM slot. */
  cloudExtras?: SaveState[];
  onLoadExtra?: (index: number) => void;
  cloudStatus?: 'off' | 'checking' | 'ok' | 'offline';
  /** In-game battery save (SRAM) sync with RomM. */
  sramStatus?: { state: 'off' | 'checking' | 'none' | 'synced' | 'pending' | 'syncing' | 'offline'; at?: number; message?: string };
  onSyncSram?: () => void;
  onResetGame: () => void;
  onExitGame: () => void;
  crtFilterMode: 'off' | 'subtle' | 'arcade' | 'phosphor';
  onChangeCrtFilter: (mode: 'off' | 'subtle' | 'arcade' | 'phosphor') => void;
  aspectRatio: EmulatorAspectRatio;
  onChangeAspectRatio: (ratio: EmulatorAspectRatio) => void;
  turboSpeed: number;
  onChangeTurboSpeed: (speed: number) => void;
  volume: number;
  onChangeVolume: (vol: number) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  buttonCombo: OverlayButtonCombo;
  onChangeButtonCombo: (combo: OverlayButtonCombo) => void;
  fps: number;
  showFps: boolean;
  onToggleShowFps: () => void;
  /** True while a save/load round-trip with the emulator is in flight. */
  busy?: boolean;
}

type TabType = 'quick' | 'states' | 'video' | 'audio' | 'controls';

/** One row in the single-column menu. Every tab is a flat list navigated with Up/Down only. */
interface MenuItem {
  id: string;
  label: string;
  desc?: string;
  icon: React.ReactNode;
  /** Right-aligned value / status text. */
  value?: string;
  checked?: boolean;
  danger?: boolean;
  thumb?: string | null;
  onActivate: () => void;
}

const SLOT_COUNT = 5;

const TABS: Array<{ id: TabType; label: string; icon: React.ReactNode }> = [
  { id: 'quick', label: 'Quick Menu', icon: <Zap className="w-4 h-4" /> },
  { id: 'states', label: 'Save States', icon: <Save className="w-4 h-4" /> },
  { id: 'video', label: 'Display', icon: <Monitor className="w-4 h-4" /> },
  { id: 'audio', label: 'Audio & Speed', icon: <Volume2 className="w-4 h-4" /> },
  { id: 'controls', label: 'Hotkeys', icon: <Gamepad2 className="w-4 h-4" /> },
];

const CRT_MODES: Array<{ id: 'off' | 'subtle' | 'arcade' | 'phosphor'; label: string; desc: string }> = [
  { id: 'off', label: 'Crisp Pixels', desc: 'No filter' },
  { id: 'subtle', label: 'Subtle Scanlines', desc: 'Light scanline overlay' },
  { id: 'arcade', label: 'Arcade CRT', desc: 'Heavy scanlines with vignette' },
  { id: 'phosphor', label: 'Phosphor Glow', desc: 'Green phosphor tint' },
];

const ASPECT_RATIOS: Array<{ id: EmulatorAspectRatio; label: string; desc: string }> = [
  { id: 'native', label: 'Platform Native', desc: 'Original console shape' },
  { id: '4:3', label: 'Classic 4:3', desc: 'CRT television shape' },
  { id: '16:10', label: 'Deck 16:10', desc: 'Stretch to the full screen' },
  { id: '1:1', label: 'Square 1:1', desc: 'Handheld square' },
];

const TURBO_SPEEDS = [
  { speed: 1, label: 'Normal Speed (1x)' },
  { speed: 1.5, label: 'Fast-Forward 1.5x' },
  { speed: 2, label: 'Fast-Forward 2x' },
  { speed: 3, label: 'Fast-Forward 3x' },
];

const COMBOS: Array<{ id: OverlayButtonCombo; label: string; desc: string }> = [
  { id: 'select_start', label: 'Select + Start', desc: 'Default overlay shortcut' },
  { id: 'l3_r3', label: 'L3 + R3', desc: 'Click both thumbsticks' },
  { id: 'select_x', label: 'Select + X', desc: 'EmulationStation style' },
  { id: 'l1_r1_start', label: 'L1 + R1 + Start', desc: 'Three-button chord' },
];

const comboLabel = (c: OverlayButtonCombo) => (c || 'select_start').replace(/_/g, ' + ').toUpperCase();

function formatSaveTime(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const InGameOverlayMenu: React.FC<InGameOverlayMenuProps> = (props) => {
  const {
    isOpen,
    onClose,
    game,
    selectedSlot,
    onSelectSlot,
    saveStates,
    onSaveState,
    onLoadState,
    onDeleteState,
    cloudExtras = [],
    onLoadExtra,
    cloudStatus = 'off',
    sramStatus,
    onSyncSram,
    onResetGame,
    onExitGame,
    crtFilterMode,
    onChangeCrtFilter,
    aspectRatio,
    onChangeAspectRatio,
    turboSpeed,
    onChangeTurboSpeed,
    volume,
    onChangeVolume,
    isMuted,
    onToggleMute,
    buttonCombo,
    onChangeButtonCombo,
    showFps,
    onToggleShowFps,
    busy,
  } = props;

  const [activeTab, setActiveTab] = useState<TabType>('quick');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [confirm, setConfirm] = useState<null | 'exit' | 'reset'>(null);
  const [confirmFocus, setConfirmFocus] = useState<0 | 1>(1);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset to the top of the Quick Menu each time the overlay opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab('quick');
      setFocusedIndex(0);
      setConfirm(null);
    }
  }, [isOpen]);

  const doLoad = (slot: number) => {
    if (!saveStates[slot]) {
      soundService.playBack();
      return;
    }
    onLoadState(slot);
  };

  const items: MenuItem[] = useMemo(() => {
    const slotState = saveStates[selectedSlot];
    switch (activeTab) {
      case 'quick':
        return [
          { id: 'resume', label: 'Resume Game', desc: 'Return to gameplay', icon: <Play className="w-4 h-4 text-emerald-400" />, onActivate: onClose },
          {
            id: 'save',
            label: `Save State to Slot ${selectedSlot}`,
            desc: slotState ? `Overwrites save from ${formatSaveTime(slotState.timestamp)}` : 'Slot is empty',
            icon: <Save className="w-4 h-4 text-amber-400" />,
            onActivate: () => onSaveState(selectedSlot),
          },
          {
            id: 'load',
            label: `Load State from Slot ${selectedSlot}`,
            desc: slotState ? `Saved ${formatSaveTime(slotState.timestamp)}` : 'Slot is empty',
            icon: <FolderOpen className="w-4 h-4 text-sky-400" />,
            thumb: slotState?.screenshot || undefined,
            onActivate: () => doLoad(selectedSlot),
          },
          {
            id: 'slot',
            label: 'Active Save Slot',
            desc: 'Press A to switch to the next slot',
            value: `Slot ${selectedSlot} of ${SLOT_COUNT}`,
            icon: <Layers className="w-4 h-4 text-purple-400" />,
            onActivate: () => onSelectSlot(selectedSlot >= SLOT_COUNT ? 1 : selectedSlot + 1),
          },
          ...(sramStatus && sramStatus.state !== 'off'
            ? [
                {
                  id: 'sram',
                  label: 'In-Game Save',
                  desc:
                    sramStatus.state === 'synced'
                      ? `The game's own save is on RomM${sramStatus.at ? ` (${formatSaveTime(sramStatus.at)})` : ''}. A: sync now`
                      : sramStatus.state === 'none'
                        ? 'Saves the game writes itself are synced to RomM automatically'
                        : sramStatus.state === 'pending' || sramStatus.state === 'offline'
                          ? `Kept on this Deck, will upload when RomM is reachable. A: retry${sramStatus.message ? `  (${sramStatus.message})` : ''}`
                          : 'Talking to RomM...',
                  value:
                    sramStatus.state === 'synced'
                      ? 'Synced'
                      : sramStatus.state === 'none'
                        ? 'No save yet'
                        : sramStatus.state === 'syncing'
                          ? 'Syncing...'
                          : sramStatus.state === 'checking'
                            ? 'Checking...'
                            : 'Deck only',
                  icon: <RefreshCw className={`w-4 h-4 ${sramStatus.state === 'synced' ? 'text-emerald-400' : 'text-amber-400'}`} />,
                  onActivate: () => onSyncSram?.(),
                } as MenuItem,
              ]
            : []),
          {
            id: 'reset',
            label: 'Restart Game',
            desc: 'Reset the console (unsaved progress is lost)',
            icon: <RotateCcw className="w-4 h-4 text-orange-400" />,
            onActivate: () => {
              setConfirm('reset');
              setConfirmFocus(1);
            },
          },
          {
            id: 'exit',
            label: 'Exit to Library',
            desc: 'Close the emulator',
            danger: true,
            icon: <LogOut className="w-4 h-4 text-rose-400" />,
            onActivate: () => {
              setConfirm('exit');
              setConfirmFocus(1);
            },
          },
        ];
      case 'states': {
        const syncLabel = (st: SaveState) =>
          cloudStatus === 'off'
            ? 'Saved'
            : st.pendingUpload
              ? 'Deck only'
              : st.source === 'cloud'
                ? 'On RomM'
                : st.cloudId
                  ? 'Synced'
                  : 'Deck only';
        const slots = Array.from({ length: SLOT_COUNT }, (_, i) => {
          const slot = i + 1;
          const st = saveStates[slot];
          return {
            id: `slot-${slot}`,
            label: `Slot ${slot}`,
            desc: st ? `Saved ${formatSaveTime(st.timestamp)}  |  A: Load   X: Save over` : 'Empty  |  A or X: Save here',
            value: st ? syncLabel(st) : 'Empty',
            thumb: st?.screenshot || null,
            icon: <Save className={`w-4 h-4 ${st ? 'text-emerald-400' : 'text-slate-500'}`} />,
            onActivate: () => (st ? doLoad(slot) : onSaveState(slot)),
          } as MenuItem;
        });
        const extras = cloudExtras.map(
          (st, i) =>
            ({
              id: `cloud-${st.cloudId ?? i}`,
              label: 'From RomM',
              desc: `${formatSaveTime(st.timestamp)}  |  A: Load  (${(st.levelName || '').replace(/\.state$/i, '')})`,
              value: 'Load only',
              thumb: st.screenshot || null,
              icon: <FolderOpen className="w-4 h-4 text-sky-400" />,
              onActivate: () => onLoadExtra?.(i),
            }) as MenuItem
        );
        return [...slots, ...extras];
      }
      case 'video':
        return [
          ...CRT_MODES.map((m) => ({
            id: `crt-${m.id}`,
            label: `Filter: ${m.label}`,
            desc: m.desc,
            checked: crtFilterMode === m.id,
            icon: <Tv className="w-4 h-4 text-pink-400" />,
            onActivate: () => onChangeCrtFilter(m.id),
          })),
          ...ASPECT_RATIOS.map((r) => ({
            id: `aspect-${r.id}`,
            label: `Aspect: ${r.label}`,
            desc: r.desc,
            checked: aspectRatio === r.id,
            icon: <Monitor className="w-4 h-4 text-sky-400" />,
            onActivate: () => onChangeAspectRatio(r.id),
          })),
          {
            id: 'fps',
            label: 'Show FPS Counter',
            value: showFps ? 'On' : 'Off',
            icon: <Activity className="w-4 h-4 text-emerald-400" />,
            onActivate: onToggleShowFps,
          },
        ];
      case 'audio':
        return [
          {
            id: 'vol-up',
            label: 'Volume Up',
            value: isMuted ? 'Muted' : `${volume}%`,
            icon: <Plus className="w-4 h-4 text-emerald-400" />,
            onActivate: () => onChangeVolume(Math.min(100, volume + 10)),
          },
          {
            id: 'vol-down',
            label: 'Volume Down',
            value: isMuted ? 'Muted' : `${volume}%`,
            icon: <Minus className="w-4 h-4 text-emerald-400" />,
            onActivate: () => onChangeVolume(Math.max(0, volume - 10)),
          },
          {
            id: 'mute',
            label: isMuted ? 'Unmute' : 'Mute',
            value: isMuted ? 'On' : 'Off',
            icon: isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-slate-300" />,
            onActivate: onToggleMute,
          },
          ...TURBO_SPEEDS.map((t) => ({
            id: `speed-${t.speed}`,
            label: t.label,
            checked: turboSpeed === t.speed,
            icon: <FastForward className="w-4 h-4 text-amber-400" />,
            onActivate: () => onChangeTurboSpeed(t.speed),
          })),
        ];
      case 'controls':
        return COMBOS.map((c) => ({
          id: `combo-${c.id}`,
          label: `Overlay Shortcut: ${c.label}`,
          desc: c.desc,
          checked: buttonCombo === c.id,
          icon: <Gamepad2 className="w-4 h-4 text-sky-400" />,
          onActivate: () => {
            onChangeButtonCombo(c.id);
            gamepadService.setOverlayCombo(c.id);
          },
        }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedSlot, saveStates, cloudExtras, cloudStatus, sramStatus, crtFilterMode, aspectRatio, showFps, volume, isMuted, turboSpeed, buttonCombo]);

  // Keep the active slot in sync with the focused row on the Save States tab
  useEffect(() => {
    if (isOpen && activeTab === 'states') {
      const slot = focusedIndex + 1;
      if (slot !== selectedSlot && slot >= 1 && slot <= SLOT_COUNT) onSelectSlot(slot);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedIndex, activeTab, isOpen]);

  // Scroll the focused row into view inside the list container
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${focusedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedIndex, activeTab]);

  const switchTab = (dir: 1 | -1) => {
    soundService.playTick();
    const idx = TABS.findIndex((t) => t.id === activeTab);
    const next = TABS[(idx + dir + TABS.length) % TABS.length].id;
    setActiveTab(next);
    setFocusedIndex(next === 'states' ? Math.max(0, selectedSlot - 1) : 0);
  };

  // Controller navigation: one axis only. Up/Left = previous row, Down/Right = next row.
  useEffect(() => {
    if (!isOpen) return;
    const handleNav = (action: NavigationAction) => {
      if (confirm) {
        if (action === 'UP' || action === 'DOWN' || action === 'LEFT' || action === 'RIGHT') {
          soundService.playTick();
          setConfirmFocus((p) => (p === 0 ? 1 : 0));
        } else if (action === 'SELECT') {
          soundService.playSelect();
          const which = confirm;
          setConfirm(null);
          if (confirmFocus === 1) {
            if (which === 'exit') onExitGame();
            else onResetGame();
          }
        } else if (action === 'BACK' || action === 'TOGGLE_OVERLAY') {
          soundService.playBack();
          setConfirm(null);
        }
        return;
      }

      switch (action) {
        case 'TOGGLE_OVERLAY':
        case 'BACK':
          soundService.playBack();
          onClose();
          return;
        case 'PREV_PLATFORM':
          switchTab(-1);
          return;
        case 'NEXT_PLATFORM':
          switchTab(1);
          return;
        case 'UP':
        case 'LEFT':
          soundService.playTick();
          setFocusedIndex((p) => (p <= 0 ? items.length - 1 : p - 1));
          return;
        case 'DOWN':
        case 'RIGHT':
          soundService.playTick();
          setFocusedIndex((p) => (p >= items.length - 1 ? 0 : p + 1));
          return;
        case 'SELECT': {
          const item = items[Math.min(focusedIndex, items.length - 1)];
          if (item) {
            soundService.playSelect();
            item.onActivate();
          }
          return;
        }
        case 'ACTION_X':
          if (activeTab === 'states' && focusedIndex >= SLOT_COUNT) {
            soundService.playBack(); // RomM-only entries are load-only
            return;
          }
          onSaveState(activeTab === 'states' ? focusedIndex + 1 : selectedSlot);
          return;
        case 'ACTION_Y':
          if (activeTab === 'states' && focusedIndex >= SLOT_COUNT) {
            onLoadExtra?.(focusedIndex - SLOT_COUNT);
            return;
          }
          doLoad(activeTab === 'states' ? focusedIndex + 1 : selectedSlot);
          return;
        default:
          return;
      }
    };
    return gamepadService.addListener(handleNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, items, focusedIndex, activeTab, selectedSlot, confirm, confirmFocus, saveStates, cloudExtras, onLoadExtra]);

  if (!isOpen) return null;

  return (
    <div
      id="in-game-overlay-backdrop"
      className="absolute inset-0 z-40 bg-black/85 backdrop-blur-md flex items-center justify-center p-6 select-none"
    >
      <div
        id="in-game-overlay-container"
        className="w-full max-w-2xl bg-gradient-to-b from-[#0e1424] to-[#080c16] border border-sky-400/40 rounded-2xl shadow-[0_0_50px_rgba(56,189,248,0.25)] overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-black/60 border-b border-white/10 shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-white flex items-center gap-2">
              <span>In-Game Menu</span>
              <span className="px-1.5 rounded bg-sky-500/20 text-sky-300 font-mono text-[10px] uppercase">{game.platformSlug}</span>
            </h2>
            <p className="text-[11px] text-slate-400 truncate">{game.title}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {cloudStatus !== 'off' && (
              <span
                id="overlay-cloud-status"
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                  cloudStatus === 'ok'
                    ? 'border-emerald-400/50 text-emerald-300 bg-emerald-500/10'
                    : cloudStatus === 'checking'
                      ? 'border-white/20 text-slate-300'
                      : 'border-amber-400/50 text-amber-300 bg-amber-500/10'
                }`}
              >
                {cloudStatus === 'ok' ? 'RomM sync on' : cloudStatus === 'checking' ? 'Checking RomM...' : 'RomM offline: saving on Deck'}
              </span>
            )}
            {busy && <span className="text-[11px] font-mono text-amber-300 animate-pulse">Working...</span>}
          </div>
        </div>

        {/* Tabs (LB / RB) */}
        <div className="flex items-center gap-1 px-3 py-1.5 bg-black/40 border-b border-white/10 shrink-0">
          <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 text-[10px] font-mono font-bold">LB</span>
          <div className="flex-1 flex items-center justify-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                id={`overlay-tab-${tab.id}`}
                onClick={() => {
                  setActiveTab(tab.id);
                  setFocusedIndex(0);
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border ${
                  activeTab === tab.id ? 'bg-sky-500/25 border-sky-400/80 text-white' : 'text-slate-400 border-transparent'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
          <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 text-[10px] font-mono font-bold">RB</span>
        </div>

        {/* Single-column list */}
        <div ref={listRef} className="p-3 overflow-y-auto flex-1 flex flex-col gap-1.5 text-xs">
          {items.map((item, idx) => {
            const focused = idx === focusedIndex;
            return (
              <div
                key={item.id}
                data-row={idx}
                id={`overlay-item-${item.id}`}
                onClick={() => {
                  setFocusedIndex(idx);
                  item.onActivate();
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors cursor-pointer ${
                  focused
                    ? item.danger
                      ? 'bg-rose-500/20 border-rose-400 ring-2 ring-rose-400/50'
                      : 'bg-sky-500/20 border-sky-400 ring-2 ring-sky-400/50'
                    : 'bg-black/30 border-white/10'
                }`}
              >
                {item.thumb !== undefined ? (
                  <div className="w-14 h-10 rounded-md bg-black/60 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                    {item.thumb ? <img src={item.thumb} alt="" className="w-full h-full object-cover" /> : item.icon}
                  </div>
                ) : (
                  <div className="p-2 rounded-lg bg-black/40 border border-white/10 shrink-0">{item.icon}</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white truncate">{item.label}</div>
                  {item.desc && <div className="text-[11px] text-slate-400 truncate">{item.desc}</div>}
                </div>
                {item.value && <span className="font-mono text-[11px] text-slate-300 shrink-0">{item.value}</span>}
                {item.checked && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
                {activeTab === 'states' && idx < SLOT_COUNT && saveStates[idx + 1] && (
                  <button
                    type="button"
                    title="Delete this save"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteState(idx + 1);
                    }}
                    className="p-1.5 rounded-md bg-rose-950/40 border border-rose-500/40 text-rose-300 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                {focused && (
                  <span className="px-1.5 rounded bg-sky-400 text-slate-950 text-[10px] font-mono font-black shrink-0">A</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Confirmation strip */}
        {confirm && (
          <div className="p-4 bg-rose-950/95 border-t-2 border-rose-500 flex items-center justify-between gap-3">
            <div className="text-xs text-rose-200">
              <span className="font-extrabold text-white text-sm block">
                {confirm === 'exit' ? 'Exit to the library?' : 'Restart the game?'}
              </span>
              <span>Unsaved progress will be lost.</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                id={`btn-confirm-${confirm}-cancel`}
                type="button"
                onClick={() => setConfirm(null)}
                className={`px-4 py-2 rounded-xl font-bold text-xs ${
                  confirmFocus === 0 ? 'bg-white text-slate-950 ring-2 ring-white' : 'bg-white/10 text-slate-300'
                }`}
              >
                Cancel
              </button>
              <button
                id={`btn-confirm-${confirm}-action`}
                type="button"
                onClick={() => {
                  const which = confirm;
                  setConfirm(null);
                  if (which === 'exit') onExitGame();
                  else onResetGame();
                }}
                className={`px-4 py-2 rounded-xl font-extrabold text-xs text-white ${
                  confirmFocus === 1 ? 'bg-rose-500 ring-2 ring-rose-300' : 'bg-rose-600/70'
                }`}
              >
                {confirm === 'exit' ? 'Exit Game' : 'Restart'}
              </button>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="px-4 py-2.5 bg-black/70 border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-slate-300 shrink-0">
          <div className="flex items-center gap-3">
            <span>Up/Down Move</span>
            <span className="flex items-center gap-1"><b className="px-1.5 rounded bg-sky-400 text-slate-950">A</b>Select</span>
            <span className="flex items-center gap-1"><b className="px-1.5 rounded bg-emerald-400 text-slate-950">B</b>Resume</span>
            <span className="flex items-center gap-1"><b className="px-1.5 rounded bg-amber-400 text-slate-950">X</b>Save</span>
            <span className="flex items-center gap-1"><b className="px-1.5 rounded bg-purple-400 text-slate-950">Y</b>Load</span>
          </div>
          <span className="text-slate-400 text-[10px]">{comboLabel(buttonCombo)}</span>
        </div>
      </div>
    </div>
  );
};
