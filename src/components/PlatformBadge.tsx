import React from 'react';

interface PlatformBadgeProps {
  slug?: string;
  platformSlug?: string;
  shortName?: string;
  platformName?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const PLATFORM_COLORS: Record<string, { bg: string; text: string; border: string; accent: string }> = {
  snes: { bg: 'bg-purple-950/70', text: 'text-purple-300', border: 'border-purple-500/40', accent: '#a855f7' },
  gba: { bg: 'bg-indigo-950/70', text: 'text-indigo-300', border: 'border-indigo-500/40', accent: '#6366f1' },
  n64: { bg: 'bg-rose-950/70', text: 'text-rose-300', border: 'border-rose-500/40', accent: '#f43f5e' },
  psx: { bg: 'bg-sky-950/70', text: 'text-sky-300', border: 'border-sky-500/40', accent: '#0ea5e9' },
  genesis: { bg: 'bg-emerald-950/70', text: 'text-emerald-300', border: 'border-emerald-500/40', accent: '#10b981' },
  nes: { bg: 'bg-amber-950/70', text: 'text-amber-300', border: 'border-amber-500/40', accent: '#f59e0b' },
  nds: { bg: 'bg-pink-950/70', text: 'text-pink-300', border: 'border-pink-500/40', accent: '#ec4899' },
  gb: { bg: 'bg-teal-950/70', text: 'text-teal-300', border: 'border-teal-500/40', accent: '#14b8a6' },
  gbc: { bg: 'bg-cyan-950/70', text: 'text-cyan-300', border: 'border-cyan-500/40', accent: '#06b6d4' },
  ps2: { bg: 'bg-blue-950/70', text: 'text-blue-300', border: 'border-blue-500/40', accent: '#3b82f6' },
  psp: { bg: 'bg-violet-950/70', text: 'text-violet-300', border: 'border-violet-500/40', accent: '#8b5cf6' },
  gamecube: { bg: 'bg-fuchsia-950/70', text: 'text-fuchsia-300', border: 'border-fuchsia-500/40', accent: '#d946ef' },
  dreamcast: { bg: 'bg-orange-950/70', text: 'text-orange-300', border: 'border-orange-500/40', accent: '#f97316' },
  dc: { bg: 'bg-orange-950/70', text: 'text-orange-300', border: 'border-orange-500/40', accent: '#f97316' },
  saturn: { bg: 'bg-cyan-950/70', text: 'text-cyan-300', border: 'border-cyan-500/40', accent: '#0284c7' },
  ps3: { bg: 'bg-blue-950/70', text: 'text-blue-300', border: 'border-blue-500/40', accent: '#2563eb' },
  wii: { bg: 'bg-sky-950/70', text: 'text-sky-300', border: 'border-sky-500/40', accent: '#06b6d4' },
  '3ds': { bg: 'bg-red-950/70', text: 'text-red-300', border: 'border-red-500/40', accent: '#dc2626' },
  wiiu: { bg: 'bg-sky-950/70', text: 'text-sky-300', border: 'border-sky-500/40', accent: '#0284c7' },
  switch: { bg: 'bg-rose-950/70', text: 'text-rose-300', border: 'border-rose-500/40', accent: '#e11d48' },
  xbox: { bg: 'bg-emerald-950/70', text: 'text-emerald-300', border: 'border-emerald-500/40', accent: '#107c10' },
  xbox360: { bg: 'bg-green-950/70', text: 'text-green-300', border: 'border-green-500/40', accent: '#52b043' },
  segacd: { bg: 'bg-teal-950/70', text: 'text-teal-300', border: 'border-teal-500/40', accent: '#059669' },
  gamegear: { bg: 'bg-blue-950/70', text: 'text-blue-300', border: 'border-blue-500/40', accent: '#3b82f6' },
  tg16: { bg: 'bg-orange-950/70', text: 'text-orange-300', border: 'border-orange-500/40', accent: '#f97316' },
  arcade: { bg: 'bg-yellow-950/70', text: 'text-yellow-300', border: 'border-yellow-500/40', accent: '#eab308' },
};

export const PlatformBadge: React.FC<PlatformBadgeProps> = ({
  slug,
  platformSlug,
  shortName,
  platformName,
  size = 'sm',
  className = '',
}) => {
  const actualSlug = platformSlug || slug || 'retro';
  const normSlug = actualSlug.toLowerCase();
  const theme = PLATFORM_COLORS[normSlug] || {
    bg: 'bg-slate-800/80',
    text: 'text-slate-300',
    border: 'border-slate-600/40',
    accent: '#64748b',
  };

  const label = shortName || platformName || actualSlug.toUpperCase();
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px] tracking-wider',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-xs tracking-wide font-bold',
  }[size];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded font-extrabold uppercase backdrop-blur border shadow-sm ${theme.bg} ${theme.text} ${theme.border} ${sizeClasses} ${className}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: theme.accent }}
      />
      <span>{label}</span>
    </span>
  );
};
