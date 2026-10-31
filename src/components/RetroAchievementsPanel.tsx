import React, { useState, useEffect } from 'react';
import {
  Trophy,
  Award,
  Lock,
  CheckCircle2,
  Sparkles,
  ShieldAlert,
  Flame,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Info,
  Server,
  Loader2,
  Link2,
  Settings,
  X,
  Check,
} from 'lucide-react';
import { Game, RetroAchievement, RetroAchievementsGameSummary, RommConfig } from '../types';
import { retroAchievementsService } from '../services/retroAchievementsService';
import { rommApi } from '../services/rommApi';
import { soundService } from '../services/soundService';

interface RetroAchievementsPanelProps {
  game: Game;
  config: RommConfig;
  onOpenSettings?: () => void;
  onToast?: (msg: string, tone?: 'ok' | 'error' | 'info') => void;
}

type FilterState = 'all' | 'unlocked' | 'locked';

export const RetroAchievementsPanel: React.FC<RetroAchievementsPanelProps> = ({
  game,
  config,
  onOpenSettings,
  onToast,
}) => {
  const [summary, setSummary] = useState<RetroAchievementsGameSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncingRomm, setSyncingRomm] = useState(false);
  const [filter, setFilter] = useState<FilterState>('all');
  const [expanded, setExpanded] = useState(true);
  const [selectedAchievement, setSelectedAchievement] = useState<RetroAchievement | null>(null);
  const [showIdModal, setShowIdModal] = useState(false);
  const [idInput, setIdInput] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await retroAchievementsService.getGameAchievements(game, config);
      setSummary(data);
    } catch {
      // Ignored
    } finally {
      setLoading(false);
    }
  };

  const handleSyncRomm = async () => {
    soundService.playTick();
    setSyncingRomm(true);
    try {
      const res = await rommApi.detectRetroAchievements();
      if (res.ok) {
        soundService.playSuccess();
        onToast?.(res.message, 'ok');
        retroAchievementsService.clearCache(game.id);
        await loadData();
      } else {
        soundService.playBack();
        onToast?.(res.message, 'info');
      }
    } catch (e: any) {
      soundService.playBack();
      onToast?.(`Sync failed: ${e.message}`, 'error');
    } finally {
      setSyncingRomm(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id, config.raUsername, config.raApiKey, config.raHardcoreOnly]);

  const handleSaveCustomId = () => {
    soundService.playSuccess();
    const val = idInput.trim();
    if (!val) {
      retroAchievementsService.setCustomRaId(game.id, null);
      onToast?.('Cleared custom RetroAchievements Game ID.', 'info');
    } else {
      const num = Number(val);
      if (isNaN(num) || num <= 0) {
        onToast?.('Please enter a valid numeric Game ID.', 'error');
        return;
      }
      retroAchievementsService.setCustomRaId(game.id, num);
      onToast?.(`Linked RetroAchievements Game ID #${num}!`, 'ok');
    }
    setShowIdModal(false);
    loadData();
  };

  const renderCustomIdModal = () => (
    <div
      className="fixed inset-0 z-[300] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => setShowIdModal(false)}
    >
      <div
        className="w-full max-w-md p-6 rounded-2xl bg-gradient-to-b from-[#131b2e] to-[#0c121e] border border-amber-500/40 shadow-2xl flex flex-col relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <Link2 size={18} className="text-amber-400" />
            <span>Link RetroAchievements Game ID</span>
          </div>
          <button
            data-focusable
            onClick={() => setShowIdModal(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-slate-300 mt-3 leading-relaxed">
          Enter the official Game ID from RetroAchievements (e.g. from <code className="px-1 py-0.5 rounded bg-black/40 text-amber-300 font-mono">retroachievements.org/game/XXXX</code>). DeckRomM will load that game's official achievements.
        </p>

        <div className="mt-4">
          <label className="block text-xs font-bold text-slate-400 mb-1">
            RetroAchievements Game ID
          </label>
          <input
            type="number"
            data-focusable
            id="ra-game-id-input"
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            placeholder="e.g. 228 (Super Mario World)"
            className="w-full px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/20 text-white placeholder-slate-500 font-mono text-sm focus:border-amber-400 focus:outline-none"
            data-keyboard-title="Enter RetroAchievements Game ID"
          />
        </div>

        <div className="mt-5 flex items-center justify-between gap-2.5">
          <button
            data-focusable
            type="button"
            onClick={() => {
              setIdInput('');
              retroAchievementsService.setCustomRaId(game.id, null);
              setShowIdModal(false);
              loadData();
              onToast?.('Cleared custom Game ID.', 'info');
            }}
            className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-bold"
          >
            Clear Override
          </button>

          <div className="flex items-center gap-2">
            <button
              data-focusable
              type="button"
              onClick={() => setShowIdModal(false)}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold"
            >
              Cancel
            </button>
            <button
              data-focusable
              type="button"
              id="ra-save-game-id-btn"
              onClick={handleSaveCustomId}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-400 text-black text-xs font-black shadow-lg"
            >
              Save & Link
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading && !summary) {
    return (
      <section className="p-4 rounded-2xl bg-gradient-to-b from-[#131b2e] to-[#0c121e] border border-white/10 text-deck-text flex items-center justify-between gap-3 animate-pulse">
        <div className="flex items-center gap-3">
          <Loader2 size={18} className="animate-spin text-amber-400" />
          <span className="text-xs text-slate-300 font-medium">
            Checking RomM server & RetroAchievements for <strong className="text-white">{game.title}</strong>...
          </span>
        </div>
      </section>
    );
  }

  if (!summary || summary.achievements.length === 0) {
    return (
      <section
        data-focusable
        tabIndex={-1}
        className="p-5 rounded-2xl bg-gradient-to-b from-[#131b2e] to-[#0c121e] border border-white/10 text-deck-text relative overflow-hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-slate-800/80 border border-white/10 flex items-center justify-center text-slate-400 shrink-0">
              <Trophy size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-extrabold text-white">RetroAchievements</h2>
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-800/80 border border-white/10 text-slate-400">
                  Unmatched / Not Linked
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                No active achievement set matched for this ROM on RomM.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              data-focusable
              onClick={handleSyncRomm}
              disabled={syncingRomm}
              className="px-3 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/40 text-sky-200 font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Query RomM server for RetroAchievements match"
            >
              {syncingRomm ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              <span>{syncingRomm ? 'Syncing...' : 'Sync from RomM'}</span>
            </button>

            <button
              data-focusable
              onClick={() => {
                soundService.playTick();
                setIdInput(String(retroAchievementsService.getCustomRaId(game.id) || game.raId || ''));
                setShowIdModal(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 font-bold text-xs flex items-center gap-1.5 transition-colors"
              title="Link official RetroAchievements Game ID directly"
            >
              <Link2 size={13} />
              <span>Link RA Game ID</span>
            </button>

            {onOpenSettings && (
              <button
                data-focusable
                onClick={() => {
                  soundService.playTick();
                  onOpenSettings();
                }}
                className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-semibold text-xs flex items-center gap-1.5 transition-colors"
              >
                <Settings size={13} />
                <span>Settings</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 text-xs text-slate-400 space-y-1">
          <p>
            • RomM matches games by ROM hash against RetroAchievements. If hash calculation is off or this is a modified dump, click <strong>Link RA Game ID</strong> to associate it with its official ID from retroachievements.org.
          </p>
        </div>

        {/* Custom RA ID Modal */}
        {showIdModal && renderCustomIdModal()}
      </section>
    );
  }

  const { numAchievements, numUnlocked, pointsTotal, pointsEarned, achievements, mastered } = summary;
  const pct = numAchievements > 0 ? Math.round((numUnlocked / numAchievements) * 100) : 0;

  const filteredAchievements = achievements.filter((a) => {
    if (filter === 'unlocked') return a.unlocked;
    if (filter === 'locked') return !a.unlocked;
    return true;
  });

  const handleAchievementClick = (a: RetroAchievement) => {
    soundService.playTick();
    setSelectedAchievement(a);
  };

  const handleToggleAchievement = (a: RetroAchievement) => {
    soundService.playSuccess();
    const cacheKey = `${game.platformSlug}:${game.id}`;
    const updated = retroAchievementsService.toggleAchievement(cacheKey, a.id);
    if (updated) {
      setSummary(updated);
      const isNowUnlocked = !a.unlocked;
      onToast?.(
        isNowUnlocked
          ? `🏆 Unlocked "${a.title}" (+${a.points} pts)!`
          : `Locked "${a.title}"`,
        isNowUnlocked ? 'ok' : 'info'
      );
    }
  };

  return (
    <section
      data-focusable
      tabIndex={-1}
      className="p-5 rounded-2xl bg-gradient-to-b from-[#131b2e] to-[#0c121e] border border-amber-500/30 shadow-[0_0_25px_rgba(245,158,11,0.12)] text-deck-text relative overflow-hidden"
    >
      {/* Background ambient badge */}
      <div className="absolute top-0 right-0 -mr-10 -mt-10 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-tr from-amber-600 to-yellow-400 p-0.5 shadow-lg shadow-amber-500/20 shrink-0">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center text-amber-400">
              <Trophy size={22} className={mastered ? 'animate-bounce' : ''} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                RetroAchievements
              </h2>
              {mastered && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-gradient-to-r from-amber-500 to-yellow-400 text-black uppercase tracking-wider flex items-center gap-1 shadow">
                  <Flame size={12} /> Mastered
                </span>
              )}
              {config.raHardcoreOnly !== false && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-950/70 border border-red-500/40 text-red-300 flex items-center gap-1">
                  <ShieldAlert size={12} /> Hardcore Mode
                </span>
              )}
              {(summary.source === 'romm_server' || summary.serverManaged) && (
                <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-sky-950/70 border border-sky-400/40 text-sky-300 flex items-center gap-1 shadow" title="Directly queried & hashed by RomM server using server-side RetroAchievements integration">
                  <Server size={11} /> RomM Server API
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Live in-game achievements supported natively via RetroArch & Standalone Emulators
            </p>
          </div>
        </div>

        {/* Unlocked / Points Summary */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col items-end">
            <div className="flex items-baseline gap-1.5">
              <span className="text-base font-black text-amber-400">{numUnlocked}</span>
              <span className="text-xs text-slate-400">/ {numAchievements} Unlocked</span>
              <span className="text-xs font-mono font-bold text-slate-300 ml-1">({pct}%)</span>
            </div>
            <span className="text-xs font-mono text-amber-300/80">
              {pointsEarned} / {pointsTotal} Points
            </span>
          </div>

          <button
            data-focusable
            onClick={() => {
              soundService.playTick();
              setExpanded(!expanded);
            }}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300"
            title={expanded ? 'Collapse achievements' : 'Expand achievements'}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-3 h-2 rounded-full bg-slate-900 border border-white/10 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-300 transition-all duration-300 shadow-[0_0_12px_rgba(245,158,11,0.5)]"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Filter and Account bar */}
      {expanded && (
        <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
            {/* Filter buttons */}
            <div className="flex items-center gap-1.5 bg-black/40 p-1 rounded-xl border border-white/5 text-xs">
              <button
                data-focusable
                onClick={() => {
                  soundService.playTick();
                  setFilter('all');
                }}
                className={`px-3 py-1 rounded-lg font-bold transition-all ${
                  filter === 'all'
                    ? 'bg-amber-500 text-black shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({numAchievements})
              </button>
              <button
                data-focusable
                onClick={() => {
                  soundService.playTick();
                  setFilter('unlocked');
                }}
                className={`px-3 py-1 rounded-lg font-bold transition-all ${
                  filter === 'unlocked'
                    ? 'bg-emerald-500 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Unlocked ({numUnlocked})
              </button>
              <button
                data-focusable
                onClick={() => {
                  soundService.playTick();
                  setFilter('locked');
                }}
                className={`px-3 py-1 rounded-lg font-bold transition-all ${
                  filter === 'locked'
                    ? 'bg-slate-700 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Locked ({numAchievements - numUnlocked})
              </button>
            </div>

            {/* Account hint / settings link */}
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {config.raUsername ? (
                <span className="text-slate-400 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Linked as <strong className="text-white">{config.raUsername}</strong>
                </span>
              ) : (
                <span className="text-slate-400 hidden sm:inline">
                  Public community achievements set
                </span>
              )}

              <button
                data-focusable
                id="ra-sync-romm-btn"
                onClick={handleSyncRomm}
                disabled={syncingRomm}
                className="px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-200 font-bold text-[11px] flex items-center gap-1 transition-colors disabled:opacity-50"
                title="Pull linked RetroAchievements profile and credentials from RomM server"
              >
                {syncingRomm ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                <span>{syncingRomm ? 'Syncing...' : 'Sync from RomM'}</span>
              </button>

              <button
                data-focusable
                id="ra-link-id-btn"
                onClick={() => {
                  soundService.playTick();
                  setIdInput(String(retroAchievementsService.getCustomRaId(game.id) || summary.gameId || game.raId || ''));
                  setShowIdModal(true);
                }}
                className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/30 text-amber-200 font-semibold text-[11px] flex items-center gap-1"
                title="View or change linked RetroAchievements Game ID"
              >
                <Link2 size={11} />
                <span>RA #{summary.gameId}</span>
              </button>

              {onOpenSettings && (
                <button
                  data-focusable
                  onClick={() => {
                    soundService.playTick();
                    onOpenSettings();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 font-semibold text-[11px]"
                >
                  {config.raUsername ? 'RA Account' : 'Link RA Account'}
                </button>
              )}
            </div>
          </div>

          {/* Achievement Tiles Grid */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
            {filteredAchievements.map((ach) => {
              const isUnlocked = ach.unlocked;
              return (
                <div
                  key={ach.id}
                  data-focusable
                  id={`retro-achievement-${ach.id}`}
                  onClick={() => handleAchievementClick(ach)}
                  className={`group relative flex items-start gap-3 p-3 rounded-xl border transition-all text-left select-none cursor-pointer ${
                    isUnlocked
                      ? 'bg-slate-900/90 border-amber-500/40 hover:border-amber-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/50'
                      : 'bg-black/40 border-white/5 opacity-70 hover:opacity-100 hover:border-white/20 focus:border-sky-400 focus:ring-2 focus:ring-sky-400/50'
                  }`}
                >
                  {/* Badge Icon */}
                  <div className="relative shrink-0 mt-0.5">
                    <div
                      className={`h-11 w-11 rounded-xl p-0.5 flex items-center justify-center overflow-hidden border ${
                        isUnlocked
                          ? 'border-amber-400/80 bg-gradient-to-tr from-amber-500 to-yellow-300 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                          : 'border-white/10 bg-slate-950 grayscale'
                      }`}
                    >
                      <img
                        src={ach.badgeUrl}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover rounded-[9px]"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                    {isUnlocked ? (
                      <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow">
                        <CheckCircle2 size={11} />
                      </div>
                    ) : (
                      <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-slate-800 text-slate-400 border border-white/10 flex items-center justify-center">
                        <Lock size={10} />
                      </div>
                    )}
                  </div>

                  {/* Text details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        className={`text-xs font-bold truncate ${
                          isUnlocked ? 'text-amber-200' : 'text-slate-300'
                        }`}
                        title={ach.title}
                      >
                        {ach.title}
                      </h3>
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] shrink-0 ${
                          isUnlocked
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                            : 'bg-white/5 text-slate-400'
                        }`}
                      >
                        +{ach.points} PTS
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 leading-snug">
                      {ach.description}
                    </p>

                    <div className="mt-1 flex items-center justify-between text-[10px]">
                      {ach.type && ach.type !== 'standard' ? (
                        <span className="capitalize font-semibold text-slate-400">
                          {ach.type.replace('_', ' ')}
                        </span>
                      ) : <span />}

                      {isUnlocked && ach.unlockedDate && (
                        <span className="font-mono text-emerald-400/90">
                          Earned {ach.unlockedDate.split(' ')[0]}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Selected Achievement Details Modal */}
      {selectedAchievement && (
        <div
          className="fixed inset-0 z-[250] bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setSelectedAchievement(null)}
        >
          <div
            className="w-full max-w-md p-6 rounded-2xl bg-gradient-to-b from-[#131b2e] to-[#0c121e] border border-amber-500/50 shadow-2xl flex flex-col items-center text-center relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`h-20 w-20 rounded-2xl p-1 mb-4 flex items-center justify-center border ${
                selectedAchievement.unlocked
                  ? 'border-amber-400 bg-gradient-to-tr from-amber-500 to-yellow-300 shadow-[0_0_20px_rgba(245,158,11,0.4)]'
                  : 'border-white/20 bg-slate-900 grayscale'
              }`}
            >
              <img
                src={selectedAchievement.badgeUrl}
                alt=""
                className="w-full h-full object-cover rounded-xl"
              />
            </div>

            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
                +{selectedAchievement.points} POINTS
              </span>
              {selectedAchievement.unlocked ? (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                  <CheckCircle2 size={12} /> Unlocked
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-800 text-slate-300 border border-white/10 flex items-center gap-1">
                  <Lock size={12} /> Locked
                </span>
              )}
            </div>

            <h3 className="text-lg font-extrabold text-white mt-1 mb-2">
              {selectedAchievement.title}
            </h3>

            <p className="text-sm text-slate-300 leading-relaxed mb-6">
              {selectedAchievement.description}
            </p>

            <div className="w-full flex items-center justify-between gap-3 pt-4 border-t border-white/10">
              <button
                data-focusable
                onClick={() => {
                  handleToggleAchievement(selectedAchievement);
                  setSelectedAchievement((prev) => (prev ? { ...prev, unlocked: !prev.unlocked } : null));
                }}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-slate-200 border border-white/10 transition-colors"
              >
                {selectedAchievement.unlocked ? 'Mark as Locked' : 'Test Unlock (Earn)'}
              </button>

              <button
                data-focusable
                id="close-achievement-detail"
                onClick={() => setSelectedAchievement(null)}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs shadow-lg transition-transform active:scale-95"
              >
                Close (B)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom RetroAchievements ID Override Modal */}
      {showIdModal && renderCustomIdModal()}
    </section>
  );
};
