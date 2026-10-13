import { Platform } from '../types';

export interface PlatformFamily {
  id: string;
  name: string;
  color: string;
  platforms: Platform[];
  totalGameCount: number;
}

export function getPlatformFamilyInfo(p: Platform): { id: string; name: string; color: string; order: number } {
  const m = (p.manufacturer || '').toLowerCase().trim();
  const slug = (p.slug || '').toLowerCase().trim();
  const name = (p.name || '').toLowerCase().trim();

  // Nintendo (NES, SNES, N64, GameCube, Wii, Wii U, Switch, GB, GBC, GBA, NDS, 3DS, etc.)
  if (
    m.includes('nintendo') ||
    slug === 'nes' || slug === 'snes' || slug === 'n64' || slug === 'gamecube' || slug === 'gc' ||
    slug === 'wii' || slug === 'wiiu' || slug === 'switch' || slug === 'gb' || slug === 'gbc' ||
    slug === 'gba' || slug === 'nds' || slug === '3ds' || slug === 'virtualboy' || slug === 'vb' ||
    slug.includes('famicom') || slug.includes('game-boy') || slug.includes('gameboy') ||
    name.includes('nintendo') || name.includes('game boy') || name.includes('gamecube')
  ) {
    return { id: 'nintendo', name: 'Nintendo', color: '#ef4444', order: 1 };
  }

  // Sega (Master System, Genesis, Sega CD, Game Gear, Saturn, Dreamcast, 32X, etc.)
  if (
    m.includes('sega') ||
    slug === 'genesis' || slug === 'megadrive' || slug === 'dreamcast' || slug === 'dc' ||
    slug === 'saturn' || slug === 'segacd' || slug === 'megacd' || slug === 'gamegear' ||
    slug === 'gg' || slug === 'mastersystem' || slug === 'sms' || slug === '32x' || slug === 'sg1000' ||
    name.includes('sega') || name.includes('genesis') || name.includes('dreamcast') ||
    name.includes('saturn') || name.includes('game gear') || name.includes('master system')
  ) {
    return { id: 'sega', name: 'Sega', color: '#0284c7', order: 2 };
  }

  // Sony (PlayStation / PS1, PS2, PS3, PS4, PSP, PS Vita)
  if (
    m.includes('sony') ||
    slug === 'psx' || slug === 'ps1' || slug === 'playstation' || slug === 'ps2' ||
    slug === 'ps3' || slug === 'ps4' || slug === 'psp' || slug === 'psvita' || slug === 'vita' ||
    name.includes('sony') || name.includes('playstation') || name.includes('psp')
  ) {
    return { id: 'sony', name: 'Sony', color: '#3b82f6', order: 3 };
  }

  // Microsoft (Xbox, Xbox 360, Xbox One)
  if (
    m.includes('microsoft') ||
    slug === 'xbox' || slug === 'xbox360' || slug === 'x360' || slug === 'xbox-one' ||
    name.includes('xbox') || name.includes('microsoft')
  ) {
    return { id: 'microsoft', name: 'Microsoft', color: '#10b981', order: 4 };
  }

  // Arcade / SNK (Arcade, MAME, Neo-Geo, Neo-Geo Pocket, CPS)
  if (
    m.includes('arcade') || m.includes('snk') ||
    slug === 'arcade' || slug === 'mame' || slug === 'neogeo' || slug === 'ngp' ||
    slug === 'ngpc' || slug === 'fbneo' || slug === 'cps1' || slug === 'cps2' || slug === 'cps3' ||
    name.includes('arcade') || name.includes('mame') || name.includes('neo geo') || name.includes('neogeo')
  ) {
    return { id: 'arcade', name: 'Arcade / SNK', color: '#eab308', order: 5 };
  }

  // NEC (TurboGrafx-16 / PC Engine, PC Engine CD, SuperGrafx)
  if (
    m.includes('nec') ||
    slug === 'tg16' || slug === 'pce' || slug === 'pc-engine' || slug === 'turbografx-16' ||
    slug === 'turbografx' || slug === 'pcecd' || slug === 'supergrafx' ||
    name.includes('turbografx') || name.includes('pc engine')
  ) {
    return { id: 'nec', name: 'NEC', color: '#f97316', order: 6 };
  }

  // Atari (2600, 5200, 7800, Lynx, Jaguar)
  if (
    m.includes('atari') ||
    slug.startsWith('atari') || slug === 'lynx' || slug === 'jaguar' ||
    name.includes('atari')
  ) {
    return { id: 'atari', name: 'Atari', color: '#dc2626', order: 7 };
  }

  const fallbackName = p.manufacturer || p.name || 'Other';
  return {
    id: fallbackName.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    name: fallbackName,
    color: p.color || '#6b7280',
    order: 10,
  };
}

// Chronological preference sort within platforms of the same family
const SYSTEM_CHRONO_ORDER: Record<string, number> = {
  // Sega
  gamegear: 1,
  gg: 1,
  mastersystem: 2,
  sms: 2,
  genesis: 3,
  megadrive: 3,
  segacd: 4,
  megacd: 4,
  '32x': 5,
  saturn: 6,
  dreamcast: 7,
  dc: 7,

  // Nintendo
  nes: 1,
  famicom: 1,
  gb: 2,
  snes: 3,
  gbc: 4,
  n64: 5,
  gba: 6,
  gamecube: 7,
  gc: 7,
  nds: 8,
  wii: 9,
  '3ds': 10,
  wiiu: 11,
  switch: 12,

  // Sony
  psx: 1,
  ps1: 1,
  playstation: 1,
  ps2: 2,
  psp: 3,
  ps3: 4,
  psvita: 5,

  // Microsoft
  xbox: 1,
  xbox360: 2,
  x360: 2,
};

export function sortSystemsInFamily(platforms: Platform[]): Platform[] {
  return [...platforms].sort((a, b) => {
    const orderA = SYSTEM_CHRONO_ORDER[a.slug.toLowerCase()] ?? 99;
    const orderB = SYSTEM_CHRONO_ORDER[b.slug.toLowerCase()] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Groups platforms into families.
 * Families with multiple systems (> 1) are marked for dropdown menus.
 */
export function groupPlatformsByFamily(platforms: Platform[]): PlatformFamily[] {
  const map = new Map<string, { info: ReturnType<typeof getPlatformFamilyInfo>; platforms: Platform[] }>();

  for (const p of platforms) {
    const info = getPlatformFamilyInfo(p);
    const existing = map.get(info.id);
    if (existing) {
      existing.platforms.push(p);
    } else {
      map.set(info.id, { info, platforms: [p] });
    }
  }

  const families: PlatformFamily[] = [];
  for (const [, item] of map) {
    const sortedPlatforms = sortSystemsInFamily(item.platforms);
    const totalCount = sortedPlatforms.reduce((acc, p) => acc + (p.gameCount || 0), 0);
    families.push({
      id: item.info.id,
      name: item.info.name,
      color: item.info.color,
      platforms: sortedPlatforms,
      totalGameCount: totalCount,
    });
  }

  return families.sort((a, b) => {
    const orderA = getPlatformFamilyInfo(a.platforms[0]).order;
    const orderB = getPlatformFamilyInfo(b.platforms[0]).order;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}
