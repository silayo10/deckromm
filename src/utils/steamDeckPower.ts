export type PowerTier = 'ultra-low' | 'balanced' | 'performance' | 'heavy';

export interface DeckPowerProfile {
  tier: PowerTier;
  label: string;
  recommendedTdpWatts: number;
  tdpRange: string;
  estimatedBatteryHours: string;
  oledBatteryHours: string;
  targetFps: number;
  targetRefreshHz: number;
  gpuClockMhz?: string;
  badgeColor: string;
  accentBg: string;
  accentBorder: string;
  textColor: string;
  quickAccessGuide: string[];
  explanation: string;
}

const PLATFORM_POWER_MAP: Record<string, PowerTier> = {
  // 8-bit / 16-bit / Handheld 2D -> Ultra-low (3W - 5W TDP)
  gb: 'ultra-low',
  gbc: 'ultra-low',
  gba: 'ultra-low',
  nes: 'ultra-low',
  snes: 'ultra-low',
  segaMD: 'ultra-low',
  megadrive: 'ultra-low',
  genesis: 'ultra-low',
  segaMS: 'ultra-low',
  mastersystem: 'ultra-low',
  segaGG: 'ultra-low',
  gamegear: 'ultra-low',
  ngp: 'ultra-low',
  ngpc: 'ultra-low',
  ws: 'ultra-low',
  wsc: 'ultra-low',
  pce: 'ultra-low',
  tg16: 'ultra-low',
  atari2600: 'ultra-low',
  atari7800: 'ultra-low',
  lynx: 'ultra-low',
  arcade: 'ultra-low',

  // 32-bit / 64-bit / Dual-Screen -> Balanced (6W - 8W TDP)
  psx: 'balanced',
  ps1: 'balanced',
  n64: 'balanced',
  nds: 'balanced',
  ds: 'balanced',
  segaCD: 'balanced',
  saturn: 'balanced',
  vb: 'balanced',
  jaguar: 'balanced',
  pcecd: 'balanced',
  cps1: 'balanced',
  cps2: 'balanced',
  cps3: 'balanced',

  // 6th Gen / Demanding 3D / PSP -> Performance (9W - 11W TDP)
  ps2: 'performance',
  gc: 'performance',
  gamecube: 'performance',
  dreamcast: 'performance',
  dc: 'performance',
  psp: 'performance',
  n3ds: 'performance',
  '3ds': 'performance',

  // Heavy 7th Gen / Modern APU -> Heavy (12W - 15W TDP)
  ps3: 'heavy',
  xbox: 'heavy',
  xbox360: 'heavy',
  wiiu: 'heavy',
  switch: 'heavy',
  wii: 'performance',
};

const TIER_PROFILES: Record<PowerTier, Omit<DeckPowerProfile, 'tier'>> = {
  'ultra-low': {
    label: 'Ultra-Low Power',
    recommendedTdpWatts: 4,
    tdpRange: '3W – 5W TDP',
    estimatedBatteryHours: '7.5 – 9.0 hrs',
    oledBatteryHours: '9.0 – 11.5 hrs',
    targetFps: 60,
    targetRefreshHz: 60,
    gpuClockMhz: '400 MHz (or Auto)',
    badgeColor: 'text-emerald-400 bg-emerald-950/60 border-emerald-500/40',
    accentBg: 'bg-emerald-950/30',
    accentBorder: 'border-emerald-500/30',
    textColor: 'text-emerald-300',
    quickAccessGuide: [
      'Press (...) Quick Access button on right side of Deck',
      'Navigate to Battery / Performance tab (battery icon)',
      'Enable "TDP Limit" toggle and set slider to 4 Watts',
      'Set "Manual GPU Clock" to 400 MHz or leave Auto',
      'Keep Framerate Limit at 60 FPS / 60 Hz for perfect retro frame pacing',
    ],
    explanation: '2D & 16-bit retro architecture requires minimal compute. Capping TDP at 4W provides maximum battery life with zero frame drops.',
  },
  balanced: {
    label: 'Balanced Efficiency',
    recommendedTdpWatts: 7,
    tdpRange: '6W – 8W TDP',
    estimatedBatteryHours: '5.0 – 6.5 hrs',
    oledBatteryHours: '6.5 – 8.0 hrs',
    targetFps: 60,
    targetRefreshHz: 60,
    gpuClockMhz: '600 – 800 MHz',
    badgeColor: 'text-sky-400 bg-sky-950/60 border-sky-500/40',
    accentBg: 'bg-sky-950/30',
    accentBorder: 'border-sky-500/30',
    textColor: 'text-sky-300',
    quickAccessGuide: [
      'Press (...) Quick Access button on right side of Deck',
      'Navigate to Battery / Performance tab (battery icon)',
      'Enable "TDP Limit" toggle and set slider to 7 Watts',
      'Optionally set internal resolution scaling in emulator to 2x or 3x for crisp 1280x800 presentation',
      'Framerate Limit at 60 FPS / 60 Hz',
    ],
    explanation: 'Early 3D and dual-screen systems run effortlessly under a 7W APU cap, allowing high-resolution rendering while conserving battery.',
  },
  performance: {
    label: 'Performance Mode',
    recommendedTdpWatts: 10,
    tdpRange: '9W – 11W TDP',
    estimatedBatteryHours: '3.5 – 4.5 hrs',
    oledBatteryHours: '4.5 – 5.5 hrs',
    targetFps: 60,
    targetRefreshHz: 60,
    gpuClockMhz: '1000 – 1200 MHz',
    badgeColor: 'text-amber-400 bg-amber-950/60 border-amber-500/40',
    accentBg: 'bg-amber-950/30',
    accentBorder: 'border-amber-500/30',
    textColor: 'text-amber-300',
    quickAccessGuide: [
      'Press (...) Quick Access button on right side of Deck',
      'Navigate to Battery / Performance tab (battery icon)',
      'Enable "TDP Limit" toggle and set slider to 10–11 Watts',
      'If playing a 30 FPS locked title, consider setting Gamescope refresh to 40 Hz / 40 FPS for super smooth frame delivery and cooler temps',
      'GPU Clock: Leave on Auto for dynamic boost during heavy scenes',
    ],
    explanation: '6th-generation 3D consoles (PS2, GameCube, Dreamcast) use vector units and complex shaders. A 10W TDP ensures locked 60 FPS with 2x/3x scaling.',
  },
  heavy: {
    label: 'High Power (Full APU)',
    recommendedTdpWatts: 14,
    tdpRange: '12W – 15W TDP',
    estimatedBatteryHours: '2.0 – 2.8 hrs',
    oledBatteryHours: '2.5 – 3.5 hrs',
    targetFps: 60,
    targetRefreshHz: 60,
    gpuClockMhz: 'Auto (up to 1600 MHz)',
    badgeColor: 'text-purple-400 bg-purple-950/60 border-purple-500/40',
    accentBg: 'bg-purple-950/30',
    accentBorder: 'border-purple-500/30',
    textColor: 'text-purple-300',
    quickAccessGuide: [
      'Press (...) Quick Access button on right side of Deck',
      'Navigate to Battery / Performance tab (battery icon)',
      'Disable TDP limit (allow 14W–15W) or set to 13W',
      'Enable "Allow Tearing" if experiencing input lag in demanding emulators',
      'Plug into 45W charger or high-output battery bank for extended sessions',
    ],
    explanation: 'Modern console emulation (PS3, Xbox, Switch) demands the full 15W Van Gogh APU. Frame rate capping to 40Hz is recommended where supported.',
  },
};

/** Get the recommended Steam Deck power & battery profile for any platform. */
export function getDeckPowerProfile(platformSlug: string): DeckPowerProfile {
  const norm = (platformSlug || '').toLowerCase().trim();
  const tier = PLATFORM_POWER_MAP[norm] || 'balanced';
  const data = TIER_PROFILES[tier];
  return {
    tier,
    ...data,
  };
}
