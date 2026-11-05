import React from 'react';
import { BatteryCharging, Zap } from 'lucide-react';
import { getDeckPowerProfile, PowerTier } from '../utils/steamDeckPower';

interface DeckPowerBadgeProps {
  platformSlug: string;
  size?: 'sm' | 'md' | 'lg';
  showBatteryEstimate?: boolean;
  onClick?: () => void;
  className?: string;
}

export const DeckPowerBadge: React.FC<DeckPowerBadgeProps> = ({
  platformSlug,
  size = 'md',
  showBatteryEstimate = true,
  onClick,
  className = '',
}) => {
  const profile = getDeckPowerProfile(platformSlug);

  const sizeClasses = {
    sm: 'text-[10px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3.5 py-1.5 gap-2',
  }[size];

  const iconSizes = {
    sm: 11,
    md: 13,
    lg: 16,
  }[size];

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={`Steam Deck Power Profile: ${profile.label} (${profile.tdpRange}). Expected battery: ${profile.estimatedBatteryHours}`}
      className={`inline-flex items-center font-bold rounded-lg border transition-all ${profile.badgeColor} ${sizeClasses} ${
        onClick ? 'cursor-pointer hover:brightness-110 active:scale-95' : ''
      } ${className}`}
    >
      <Zap size={iconSizes} className="shrink-0 fill-current opacity-90" />
      <span className="font-mono">{profile.tdpRange}</span>
      {showBatteryEstimate && (
        <>
          <span className="opacity-40">•</span>
          <span className="font-normal opacity-90 flex items-center gap-1">
            <BatteryCharging size={iconSizes} className="shrink-0" />
            <span>~{profile.estimatedBatteryHours.split('–')[0].trim()}h</span>
          </span>
        </>
      )}
    </div>
  );
};
