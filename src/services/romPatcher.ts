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
  {
    id: 'mother3_en',
    title: 'Mother 3 (GBA) - English Fan Translation v1.3',
    description: 'The acclaimed full English translation by Tomato and Clyde Mandelin.',
    platformSlug: 'gba',
    gameTitleKeywords: ['mother 3', 'mother3'],
    patchUrl: 'https://raw.githubusercontent.com/tomatotranslations/mother3-patch/main/mother3_english.ips',
    patchType: 'ips',
    author: 'Tomato / Clyde Mandelin',
    category: 'Translation',
  },
  {
    id: 'pokemon_red_dx',
    title: 'Pokémon Red (GB) - Full Color DX Patch',
    description: 'Upgrades original Game Boy Pokémon Red with full GBC color palette & sprites.',
    platformSlug: 'gb',
    gameTitleKeywords: ['pokemon red', 'pokémon red'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/pokemon-red-color/main/pokemon_red_dx.ips',
    patchType: 'ips',
    author: 'eikei / Community',
    category: 'Colorization',
  },
  {
    id: 'ct_uncensored',
    title: 'Chrono Trigger (SNES) - Retranslation & Uncensored',
    description: 'Restores original Japanese script nuances, uncensors sprites and names.',
    platformSlug: 'snes',
    gameTitleKeywords: ['chrono trigger'],
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
    gameTitleKeywords: ['final fantasy iii', 'final fantasy 3', 'final fantasy vi', 'final fantasy 6'],
    patchUrl: 'https://raw.githubusercontent.com/romhacks/snes-patches/main/ff6_woolsey_uncensored.ips',
    patchType: 'ips',
    author: 'Rodimus Primal',
    category: 'QoL',
  },
  {
    id: 'smw_widescreen',
    title: 'Super Mario World (SNES) - Widescreen 16:9 Patch',
    description: 'Expands the rendering viewport for 16:9 widescreen display in supported emulators.',
    platformSlug: 'snes',
    gameTitleKeywords: ['super mario world'],
    patchUrl: 'https://raw.githubusercontent.com/VitorVilela/SMW-Widescreen/master/smw_widescreen.bps',
    patchType: 'bps',
    author: 'Vitor Vilela',
    category: 'Widescreen',
  },
];

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
