/**
 * Pure TypeScript ROM patcher supporting IPS and BPS patch formats.
 * Runs in browser and Node/Electron environments without native dependencies.
 */

export interface PatchOption {
  id: string;
  title: string;
  description: string;
  platformSlug: string;
  gameTitleKeywords: string[];
  patchUrl: string;
  patchType: 'ips' | 'bps';
  author?: string;
  category: 'Translation' | 'Colorization' | 'Widescreen' | 'QoL' | 'Hack';
}

/** Featured community patch presets for popular games. */
export const FEATURED_COMMUNITY_PATCHES: PatchOption[] = [
  // GBA
  {
    id: 'mother3_en',
    title: 'Mother 3 (GBA) - English Fan Translation v1.3',
    description: 'The acclaimed full English translation by Tomato and Clyde Mandelin.',
    platformSlug: 'gba',
    gameTitleKeywords: ['mother 3', 'mother3', 'earthbound 2', 'earthbound2'],
    patchUrl: 'https://raw.githubusercontent.com/tomatotranslations/mother3-patch/main/mother3_english.ips',
    patchType: 'ips',
    author: 'Tomato / Clyde Mandelin',
    category: 'Translation',
  },
  {
    id: 'pokemon_emerald_qol',
    title: 'Pokémon Emerald (GBA) - National Dex & Modern QoL',
    description: 'Enables National Dex from start, re-usable TMs, physical/special split, and running indoors.',
    platformSlug: 'gba',
    gameTitleKeywords: ['pokemon emerald', 'pokémon emerald', 'emerald'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/pokemon-emerald-qol/main/emerald_qol.ips',
    patchType: 'ips',
    author: 'DizzyEgg / Community',
    category: 'QoL',
  },
  {
    id: 'castlevania_aria_recolored',
    title: 'Castlevania: Aria of Sorrow (GBA) - Uncensored & Color Restored',
    description: 'Restores original Japanese dark color palette, uncensors blood and cross graphics.',
    platformSlug: 'gba',
    gameTitleKeywords: ['aria of sorrow', 'castlevania'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/gba-patches/main/castlevania_aria_recolored.ips',
    patchType: 'ips',
    author: 'Pate',
    category: 'Colorization',
  },
  {
    id: 'zelda_minish_dpad',
    title: 'Legend of Zelda: The Minish Cap (GBA) - D-Pad Quick Item Switch',
    description: 'Assigns shield and Pegasus boots to dedicated buttons for smoother gameplay.',
    platformSlug: 'gba',
    gameTitleKeywords: ['minish cap', 'zelda'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/gba-patches/main/zelda_minish_qol.ips',
    patchType: 'ips',
    author: 'm4a',
    category: 'QoL',
  },

  // SNES
  {
    id: 'smw_widescreen',
    title: 'Super Mario World (SNES) - Widescreen 16:9 Patch',
    description: 'Expands the rendering viewport for 16:9 widescreen display in supported emulators.',
    platformSlug: 'snes',
    gameTitleKeywords: ['super mario world', 'mario world', 'smw'],
    patchUrl: 'https://raw.githubusercontent.com/VitorVilela/SMW-Widescreen/master/smw_widescreen.bps',
    patchType: 'bps',
    author: 'Vitor Vilela',
    category: 'Widescreen',
  },
  {
    id: 'ct_uncensored',
    title: 'Chrono Trigger (SNES) - Retranslation & Uncensored',
    description: 'Restores original Japanese script nuances, uncensors sprites and names.',
    platformSlug: 'snes',
    gameTitleKeywords: ['chrono trigger', 'chrono'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/snes-patches/main/chrono_trigger_uncensored.ips',
    patchType: 'ips',
    author: 'Kain Stryder',
    category: 'Translation',
  },
  {
    id: 'ff6_woolsey_uncensored',
    title: 'Final Fantasy VI (SNES) - Woolsey Uncensored Edition',
    description: 'Cleans up dialogue, fixes bugged stats (evasion bug), and restores censored art.',
    platformSlug: 'snes',
    gameTitleKeywords: ['final fantasy iii', 'final fantasy 3', 'final fantasy vi', 'final fantasy 6', 'ff3', 'ff6'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/snes-patches/main/ff6_woolsey_uncensored.ips',
    patchType: 'ips',
    author: 'Rodimus Primal',
    category: 'QoL',
  },
  {
    id: 'super_metroid_redux',
    title: 'Super Metroid (SNES) - Redux & Modern Controls',
    description: 'Adds fast weapon cycling, GBA-style missile toggles, map markers, and physics tweaks.',
    platformSlug: 'snes',
    gameTitleKeywords: ['super metroid', 'metroid 3', 'metroid iii'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/snes-patches/main/super_metroid_redux.ips',
    patchType: 'ips',
    author: 'ShadowOne333',
    category: 'QoL',
  },
  {
    id: 'zelda_alttp_redux',
    title: 'Legend of Zelda: A Link to the Past (SNES) - Redux & Quick Items',
    description: 'Adds L/R item swapping, fast text, widescreen support, and heart warning sound mute.',
    platformSlug: 'snes',
    gameTitleKeywords: ['link to the past', 'alttp', 'zelda 3', 'zelda iii'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/snes-patches/main/zelda_alttp_redux.ips',
    patchType: 'ips',
    author: 'ShadowOne333',
    category: 'QoL',
  },
  {
    id: 'dragon_quest_5_en',
    title: 'Dragon Quest V (SNES) - English Fan Translation',
    description: 'Full English translation of the classic SNES Dragon Quest V.',
    platformSlug: 'snes',
    gameTitleKeywords: ['dragon quest 5', 'dragon quest v', 'dragon warrior 5'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/snes-patches/main/dragon_quest_5_en.ips',
    patchType: 'ips',
    author: 'DeJap',
    category: 'Translation',
  },
  {
    id: 'seiken_3_en',
    title: 'Trials of Mana / Seiken Densetsu 3 (SNES) - English Translation',
    description: 'Complete English localization for the legendary 3-character action RPG.',
    platformSlug: 'snes',
    gameTitleKeywords: ['seiken densetsu 3', 'trials of mana', 'secret of mana 2'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/snes-patches/main/sd3_english.ips',
    patchType: 'ips',
    author: 'LNF Translations',
    category: 'Translation',
  },

  // GB / GBC
  {
    id: 'pokemon_red_dx',
    title: 'Pokémon Red (GB) - Full Color DX Patch',
    description: 'Upgrades original Game Boy Pokémon Red with full GBC color palette & sprites.',
    platformSlug: 'gb',
    gameTitleKeywords: ['pokemon red', 'pokémon red', 'pokemon'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/pokemon-red-color/main/pokemon_red_dx.ips',
    patchType: 'ips',
    author: 'eikei / Community',
    category: 'Colorization',
  },
  {
    id: 'sml2_dx',
    title: 'Super Mario Land 2 (GB) - DX Full Color Patch',
    description: 'Colorizes Super Mario Land 2: 6 Golden Coins with full Game Boy Color palettes & Luigi playability.',
    platformSlug: 'gb',
    gameTitleKeywords: ['super mario land 2', 'mario land 2', '6 golden coins'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/gb-patches/main/sml2_dx.ips',
    patchType: 'ips',
    author: 'toruzz',
    category: 'Colorization',
  },
  {
    id: 'metroid2_dx',
    title: 'Metroid II: Return of Samus (GB) - Colorization DX',
    description: 'Full color conversion for Metroid II on Game Boy with updated Samus suit sprites.',
    platformSlug: 'gb',
    gameTitleKeywords: ['metroid ii', 'metroid 2', 'return of samus'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/gb-patches/main/metroid2_dx.ips',
    patchType: 'ips',
    author: 'EJRTQ',
    category: 'Colorization',
  },
  {
    id: 'tetris_rosy',
    title: 'Tetris (GB) - Rosy Retrospection QoL & Hard Drop',
    description: 'Adds modern Tetris features: Hard drop, ghost piece, hold piece, and NES music.',
    platformSlug: 'gb',
    gameTitleKeywords: ['tetris'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/gb-patches/main/tetris_rosy.ips',
    patchType: 'ips',
    author: 'Onett',
    category: 'QoL',
  },

  // NES
  {
    id: 'smb_snes_palette',
    title: 'Super Mario Bros. (NES) - SNES Enhanced Color Palette',
    description: 'Updates NES Super Mario Bros. colors to match Super Mario All-Stars SNES palette.',
    platformSlug: 'nes',
    gameTitleKeywords: ['super mario bros', 'mario bros', 'smb1'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/nes-patches/main/smb1_snes_palette.ips',
    patchType: 'ips',
    author: 'DarkSamus',
    category: 'Colorization',
  },
  {
    id: 'metroid_map_nes',
    title: 'Metroid (NES) - In-Game Minimap & Battery Save System',
    description: 'Adds an on-screen map HUD, battery save (no password needed), and beam stacking.',
    platformSlug: 'nes',
    gameTitleKeywords: ['metroid'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/nes-patches/main/metroid_map.ips',
    patchType: 'ips',
    author: 'Snarfblam',
    category: 'QoL',
  },
  {
    id: 'castlevania3_vrc6',
    title: 'Castlevania III (NES) - Japanese VRC6 Audio & Uncensored',
    description: 'Restores Japanese expanded VRC6 audio channels, uncensored crosses, and Grant attack style.',
    platformSlug: 'nes',
    gameTitleKeywords: ['castlevania iii', 'castlevania 3', 'dracula\'s curse'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/nes-patches/main/cv3_vrc6.ips',
    patchType: 'ips',
    author: 'Inu',
    category: 'QoL',
  },
  {
    id: 'ff1_restored',
    title: 'Final Fantasy I (NES) - Restored Script & Bug Fixes',
    description: 'Fixes broken spell bugs (TMPR/SABR), restores Japanese enemy art and expanded item names.',
    platformSlug: 'nes',
    gameTitleKeywords: ['final fantasy', 'ff1', 'final fantasy 1'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/nes-patches/main/ff1_restored.ips',
    patchType: 'ips',
    author: 'Astral',
    category: 'QoL',
  },

  // N64
  {
    id: 'sm64_60fps',
    title: 'Super Mario 64 (N64) - 60 FPS & 16:9 Widescreen',
    description: 'Patches Super Mario 64 engine for smooth 60 FPS animation and native 16:9 display.',
    platformSlug: 'n64',
    gameTitleKeywords: ['super mario 64', 'mario 64', 'sm64'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/n64-patches/main/sm64_60fps.bps',
    patchType: 'bps',
    author: 'Kaze Emanuar',
    category: 'Widescreen',
  },
  {
    id: 'oot_dpad_items',
    title: 'Zelda: Ocarina of Time (N64) - D-Pad Quick Items & Fast Text',
    description: 'Assigns 4 extra item slots to the D-Pad, speeds up text boxes and climb speeds.',
    platformSlug: 'n64',
    gameTitleKeywords: ['ocarina of time', 'zelda 64', 'oot'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/n64-patches/main/oot_dpad.bps',
    patchType: 'bps',
    author: 'KinstA',
    category: 'QoL',
  },

  // Genesis / Mega Drive
  {
    id: 'sonic2_knuckles_dx',
    title: 'Sonic the Hedgehog 2 (Genesis) - Knuckles in Sonic 2 DX',
    description: 'Play as Knuckles with gliding and wall climbing across all Sonic 2 stages.',
    platformSlug: 'genesis',
    gameTitleKeywords: ['sonic the hedgehog 2', 'sonic 2'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/genesis-patches/main/sonic2_knuckles.ips',
    patchType: 'ips',
    author: 'SEGA / Stealth',
    category: 'Hack',
  },
  {
    id: 'bare_knuckle_3_en',
    title: 'Streets of Rage 3 (Genesis) - Bare Knuckle III Restoration & English',
    description: 'Restores uncensored Japanese Bare Knuckle III graphics, lower difficulty, and original colors.',
    platformSlug: 'genesis',
    gameTitleKeywords: ['streets of rage 3', 'bare knuckle 3', 'sor3'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/genesis-patches/main/bk3_restoration.ips',
    patchType: 'ips',
    author: 'Czar',
    category: 'Translation',
  },

  // PS1
  {
    id: 'ff7_beacause',
    title: 'Final Fantasy VII (PS1) - Beacause English Retranslation',
    description: 'Replaces flawed original localization with an accurate, nuanced English retranslation.',
    platformSlug: 'psx',
    gameTitleKeywords: ['final fantasy vii', 'final fantasy 7', 'ff7'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/psx-patches/main/ff7_beacause.ips',
    patchType: 'ips',
    author: 'DLPB',
    category: 'Translation',
  },
  {
    id: 'persona2_is_en',
    title: 'Persona 2: Innocent Sin (PS1) - English Fan Translation',
    description: 'Full English translation for the original PS1 release of Persona 2: Innocent Sin.',
    platformSlug: 'psx',
    gameTitleKeywords: ['persona 2', 'innocent sin'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/psx-patches/main/p2is_english.ips',
    patchType: 'ips',
    author: 'Gemini / Maya',
    category: 'Translation',
  },
];

/** Search and filter community patches by query, category, or platform. */
export function searchCommunityPatches(
  query = '',
  category = 'all',
  platformSlug?: string
): PatchOption[] {
  const q = query.trim().toLowerCase();

  return FEATURED_COMMUNITY_PATCHES.filter((patch) => {
    // Category match
    if (category !== 'all' && patch.category.toLowerCase() !== category.toLowerCase()) {
      return false;
    }

    // Platform match (optional)
    if (platformSlug && platformSlug !== 'all' && patch.platformSlug !== platformSlug) {
      // If user typed a search query, search across all platforms even if platform mismatch
      if (!q) return false;
    }

    // Query match
    if (!q) return true;

    return (
      patch.title.toLowerCase().includes(q) ||
      patch.description.toLowerCase().includes(q) ||
      patch.platformSlug.toLowerCase().includes(q) ||
      (patch.author && patch.author.toLowerCase().includes(q)) ||
      patch.gameTitleKeywords.some((kw) => kw.toLowerCase().includes(q))
    );
  });
}

/** CRC32 computation utility. */
export function calculateCrc32(data: Uint8Array): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i++) {
    let byte = data[i];
    for (let j = 0; j < 8; j++) {
      const code = (crc ^ byte) & 1;
      crc = (crc >>> 1) ^ (code ? 0xedb88320 : 0);
      byte >>>= 1;
    }
  }
  return (crc ^ -1) >>> 0;
}

/**
 * Apply an IPS format patch to a base ROM byte array.
 */
export function applyIpsPatch(source: Uint8Array, patch: Uint8Array): Uint8Array {
  if (patch.length < 8) throw new Error('Invalid IPS patch: file too short');
  
  // Verify header "PATCH"
  if (
    patch[0] !== 0x50 || // P
    patch[1] !== 0x41 || // A
    patch[2] !== 0x54 || // T
    patch[3] !== 0x43 || // C
    patch[4] !== 0x48    // H
  ) {
    throw new Error('Invalid IPS patch: missing "PATCH" header');
  }

  // Work on a copy of the source buffer, expanded if needed
  let output = new Uint8Array(source.length);
  output.set(source);

  let offset = 5;
  while (offset < patch.length) {
    // Check for "EOF" (0x45, 0x4F, 0x46)
    if (
      patch[offset] === 0x45 &&
      patch[offset + 1] === 0x4f &&
      patch[offset + 2] === 0x46
    ) {
      break;
    }

    if (offset + 5 > patch.length) break;

    // Read 3-byte offset
    const destOffset = (patch[offset] << 16) | (patch[offset + 1] << 8) | patch[offset + 2];
    // Read 2-byte size
    const size = (patch[offset + 3] << 8) | patch[offset + 4];
    offset += 5;

    if (size > 0) {
      // Standard block
      if (offset + size > patch.length) throw new Error('Truncated IPS patch file');

      // Expand output buffer if patch writes beyond current length
      if (destOffset + size > output.length) {
        const expanded = new Uint8Array(destOffset + size);
        expanded.set(output);
        output = expanded;
      }

      output.set(patch.subarray(offset, offset + size), destOffset);
      offset += size;
    } else {
      // RLE block
      if (offset + 3 > patch.length) throw new Error('Truncated IPS patch RLE block');
      const rleSize = (patch[offset] << 8) | patch[offset + 1];
      const rleByte = patch[offset + 2];
      offset += 3;

      if (destOffset + rleSize > output.length) {
        const expanded = new Uint8Array(destOffset + rleSize);
        expanded.set(output);
        output = expanded;
      }

      output.fill(rleByte, destOffset, destOffset + rleSize);
    }
  }

  return output;
}

/** Variable-length integer decoder for BPS patches. */
function decodeBpsVli(patch: Uint8Array, offset: { index: number }): number {
  let result = 0;
  let shift = 0;

  while (offset.index < patch.length) {
    const byte = patch[offset.index++];
    result += (byte & 0x7f) << shift;
    if (byte & 0x80) break;
    shift += 7;
    result += 1 << shift;
  }

  return result;
}

/**
 * Apply a BPS format patch to a base ROM byte array.
 */
export function applyBpsPatch(source: Uint8Array, patch: Uint8Array): Uint8Array {
  if (patch.length < 12) throw new Error('Invalid BPS patch: file too short');

  // Verify header "BPS1"
  if (
    patch[0] !== 0x42 || // B
    patch[1] !== 0x50 || // P
    patch[2] !== 0x53 || // S
    patch[3] !== 0x31    // 1
  ) {
    throw new Error('Invalid BPS patch: missing "BPS1" header');
  }

  const offset = { index: 4 };

  const _sourceSize = decodeBpsVli(patch, offset);
  const targetSize = decodeBpsVli(patch, offset);
  const _metadataSize = decodeBpsVli(patch, offset);

  // Skip metadata bytes
  offset.index += _metadataSize;

  const target = new Uint8Array(targetSize);
  let outputOffset = 0;
  let sourceRelativeOffset = 0;
  let targetRelativeOffset = 0;

  const patchEnd = patch.length - 12; // 12 footer bytes (source CRC, target CRC, patch CRC)

  while (offset.index < patchEnd && outputOffset < targetSize) {
    const data = decodeBpsVli(patch, offset);
    const mode = data & 3;
    const length = (data >> 2) + 1;

    switch (mode) {
      case 0: { // SourceRead
        for (let i = 0; i < length; i++) {
          target[outputOffset] = source[outputOffset];
          outputOffset++;
        }
        break;
      }
      case 1: { // TargetRead
        for (let i = 0; i < length; i++) {
          target[outputOffset++] = patch[offset.index++];
        }
        break;
      }
      case 2: { // SourceCopy
        const offsetData = decodeBpsVli(patch, offset);
        sourceRelativeOffset += (offsetData & 1 ? -1 : 1) * (offsetData >> 1);
        for (let i = 0; i < length; i++) {
          target[outputOffset++] = source[sourceRelativeOffset++];
        }
        break;
      }
      case 3: { // TargetCopy
        const offsetData = decodeBpsVli(patch, offset);
        targetRelativeOffset += (offsetData & 1 ? -1 : 1) * (offsetData >> 1);
        for (let i = 0; i < length; i++) {
          target[outputOffset++] = target[targetRelativeOffset++];
        }
        break;
      }
    }
  }

  return target;
}

/**
 * Automatically detect format (IPS or BPS) and apply patch to source ROM bytes.
 */
export function applyRomPatch(source: Uint8Array, patch: Uint8Array): Uint8Array {
  if (patch.length >= 4 && patch[0] === 0x42 && patch[1] === 0x50 && patch[2] === 0x53 && patch[3] === 0x31) {
    return applyBpsPatch(source, patch);
  }
  if (patch.length >= 5 && patch[0] === 0x50 && patch[1] === 0x41 && patch[2] === 0x54 && patch[3] === 0x43 && patch[4] === 0x48) {
    return applyIpsPatch(source, patch);
  }
  // Default fallback to IPS
  return applyIpsPatch(source, patch);
}
