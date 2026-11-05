import React, { useState } from 'react';
import { BatteryCharging, Zap, Gauge, Sliders, Info, Check, HelpCircle } from 'lucide-react';
import { getDeckPowerProfile } from '../utils/steamDeckPower';
import { soundService } from '../services/soundService';

interface DeckPowerCardProps {
  platformSlug: string;
  platformName?: string;
}

export const DeckPowerCard: React.FC<DeckPowerCardProps> = ({ platformSlug, platformName }) => {
  const [showGuide, setShowGuide] = useState(false);
  const profile = getDeckPowerProfile(platformSlug);

  return (
    <section
      data-focusable
      tabIndex={-1}
      className={`p-5 rounded-2xl border transition-all ${profile.accentBg} ${profile.accentBorder} flex flex-col gap-4 shadow-sm`}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2.5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-black/40 border border-deck-line flex items-center justify-center text-amber-400 shrink-0 shadow-inner">
            <Zap size={20} className="fill-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-black uppercase tracking-wider text-deck-accent flex items-center gap-1.5">
                <span>Steam Deck Battery & TDP Optimizer</span>
              </h2>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${profile.badgeColor}`}>
                {profile.label}
              </span>
            </div>
            <div className="text-xs text-deck-dim mt-0.5">
              Recommended Gamescope power profile for {platformName || platformSlug.toUpperCase()}
            </div>
          </div>
        </div>

        <button
          data-focusable
          onClick={() => {
            soundService.playTick();
            setShowGuide((v) => !v);
          }}
          className="text-xs font-bold text-deck-dim hover:text-white bg-deck-panel-2 px-3 py-1.5 rounded-xl border border-deck-line flex items-center gap-1.5 transition-colors"
        >
          <HelpCircle size={14} className="text-deck-accent" />
          <span>{showGuide ? 'Hide Guide' : 'How to apply (...) ?'}</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {/* Recommended TDP */}
        <div className="bg-black/40 border border-deck-line/80 rounded-xl p-3 flex flex-col">
          <span className="text-[10px] uppercase font-bold text-deck-dim flex items-center gap-1">
            <Zap size={11} className="text-amber-400" /> TDP Limit
          </span>
          <span className="text-xl font-black text-white mt-1 font-mono">{profile.recommendedTdpWatts} W</span>
          <span className="text-[10px] text-deck-dim mt-0.5 font-medium">{profile.tdpRange}</span>
        </div>

        {/* Battery Life (LCD) */}
        <div className="bg-black/40 border border-deck-line/80 rounded-xl p-3 flex flex-col">
          <span className="text-[10px] uppercase font-bold text-deck-dim flex items-center gap-1">
            <BatteryCharging size={11} className="text-emerald-400" /> LCD Battery
          </span>
          <span className="text-xl font-black text-emerald-300 mt-1 font-mono">
            {profile.estimatedBatteryHours}
          </span>
          <span className="text-[10px] text-deck-dim mt-0.5">40Wh standard pack</span>
        </div>

        {/* Battery Life (OLED) */}
        <div className="bg-black/40 border border-deck-line/80 rounded-xl p-3 flex flex-col">
          <span className="text-[10px] uppercase font-bold text-deck-dim flex items-center gap-1">
            <BatteryCharging size={11} className="text-sky-400" /> OLED Battery
          </span>
          <span className="text-xl font-black text-sky-300 mt-1 font-mono">{profile.oledBatteryHours}</span>
          <span className="text-[10px] text-deck-dim mt-0.5">50Wh + 6nm efficiency</span>
        </div>

        {/* Frame Target & GPU */}
        <div className="bg-black/40 border border-deck-line/80 rounded-xl p-3 flex flex-col">
          <span className="text-[10px] uppercase font-bold text-deck-dim flex items-center gap-1">
            <Gauge size={11} className="text-purple-400" /> Frame Target
          </span>
          <span className="text-xl font-black text-white mt-1 font-mono">
            {profile.targetFps} FPS <span className="text-xs font-normal text-deck-dim">/ {profile.targetRefreshHz}Hz</span>
          </span>
          <span className="text-[10px] text-deck-dim mt-0.5 truncate" title={profile.gpuClockMhz}>
            GPU: {profile.gpuClockMhz}
          </span>
        </div>
      </div>

      {/* Explanation Banner */}
      <div className="text-xs text-deck-dim leading-relaxed bg-black/25 p-3 rounded-xl border border-deck-line/40 flex items-start gap-2">
        <Info size={15} className="text-deck-accent shrink-0 mt-0.5" />
        <div>
          <strong className="text-white font-semibold">Why this profile? </strong>
          <span>{profile.explanation}</span>
        </div>
      </div>

      {/* Step-by-Step Gamescope Quick Access Guide */}
      {showGuide && (
        <div className="p-4 rounded-xl bg-deck-panel-2 border border-deck-line flex flex-col gap-2.5 animate-in fade-in duration-200">
          <div className="text-xs font-extrabold text-white flex items-center gap-2">
            <Sliders size={15} className="text-deck-accent" />
            <span>Gamescope Quick Access Menu Instructions (In-Game)</span>
          </div>
          <ol className="space-y-1.5 text-xs text-deck-text/90 pl-1">
            {profile.quickAccessGuide.map((step, idx) => (
              <li key={idx} className="flex items-start gap-2.5">
                <span className="h-5 w-5 rounded-full bg-deck-accent/20 border border-deck-accent/40 text-deck-accent font-mono font-bold text-[10px] flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <div className="text-[11px] text-deck-dim italic pt-1 border-t border-deck-line/60">
            Tip: Enable &ldquo;Use per-game profile&rdquo; in the Quick Access Menu so your Steam Deck automatically remembers this 4W/7W/10W cap whenever you launch this game!
          </div>
        </div>
      )}
    </section>
  );
};
