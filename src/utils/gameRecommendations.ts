import { Game } from '../types';

export interface SeriesMatchResult {
  seriesName: string;
  games: Game[];
}

export interface SimilarGameRecommendation {
  game: Game;
  score: number;
  reasons: string[];
}

/**
 * Common series keywords and franchise name roots to match across retro games.
 */
const KNOWN_FRANCHISES = [
  'Super Mario',
  'Mario Kart',
  'Mario Party',
  'Paper Mario',
  'Mario',
  'The Legend of Zelda',
  'Zelda',
  'Pokemon',
  'Pokémon',
  'Metroid',
  'Castlevania',
  'Mega Man',
  'Rockman',
  'Final Fantasy',
  'Dragon Quest',
  'Chrono',
  'Resident Evil',
  'Biohazard',
  'Silent Hill',
  'Crash Bandicoot',
  'Spyro',
  'Sonic',
  'Sonic the Hedgehog',
  'Donkey Kong',
  'Kirby',
  'Metal Gear',
  'Tekken',
  'Street Fighter',
  'Mortal Kombat',
  'Gran Turismo',
  'Need for Speed',
  'Ridge Racer',
  'WipEout',
  'Burnout',
  'Virtua Tennis',
  'Virtua Fighter',
  'Tony Hawk',
  'Tomb Raider',
  'Kingdom Hearts',
  'God of War',
  'Devil May Cry',
  'Grand Theft Auto',
  'GTA',
  'Persona',
  'Shin Megami Tensei',
  'Phantasy Star',
  'Breath of Fire',
  'Golden Sun',
  'Advance Wars',
  'Fire Emblem',
  'Star Fox',
  'F-Zero',
  'Rayman',
  'Banjo-Kazooie',
  'Ape Escape',
  'Sly Cooper',
  'Jak and Daxter',
  'Ratchet & Clank',
  'Twisted Metal',
  'Armored Core',
  'Ace Combat',
  'Time Crisis',
  'House of the Dead',
  'Klonoa',
  'Suikoden',
  'Xenogears',
  'Xenosaga',
  'Valkyrie Profile',
  'Wild Arms',
  'Front Mission',
  'Legacy of Kain',
  'Soulcalibur',
  'Soul Edge',
  'Bloody Roar',
  'Dead or Alive',
  'Fatal Frame',
  'Parasite Evil',
  'Parasite Eve',
  'Dino Crisis',
  'Clock Tower',
  'Tenchu',
  'Monster Hunter',
  'Disgaea',
  'Seiken Densetsu',
  'Mana',
  'EarthBound',
  'Mother',
  'Super Smash Bros',
  'F-Zero',
  'Bomberman',
  'Worms',
  'Lemmings',
  'Tetris',
  'Puyo Puyo',
  'Crazy Taxi',
  'Shenmue',
  'Jet Set Radio',
  'Skies of Arcadia',
  'Grandia',
  'Tales of',
  'Ys',
  'Ys ',
  'Star Wars',
  'Spider-Man',
  'Batman',
  'X-Men',
  'Marvel',
];

/**
 * Normalizes title by removing region codes, version tags, and extension tags.
 */
export function cleanGameTitle(rawTitle: string): string {
  if (!rawTitle) return '';
  return rawTitle
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ') // Strip (USA), [!], (En,Fr), etc.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Attempts to extract the series/franchise name from a game's title.
 */
export function detectFranchiseName(rawTitle: string): string | null {
  const clean = cleanGameTitle(rawTitle);
  if (!clean) return null;

  // 1. Check known franchise list (longest match first)
  for (const franchise of KNOWN_FRANCHISES) {
    const regex = new RegExp(`(^|\\b)${franchise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|:|-|–|—|\\d|\\s)`, 'i');
    if (regex.test(clean)) {
      return franchise;
    }
  }

  // 2. Split on subtitle delimiters like ":", " - ", " – ", " — "
  const subtitleDelimiters = [':', ' - ', ' – ', ' — ', ' ~ '];
  for (const delim of subtitleDelimiters) {
    if (clean.includes(delim)) {
      const prefix = clean.split(delim)[0].trim();
      // Remove trailing numbers or roman numerals
      const root = prefix.replace(/\s+(?:[0-9]+|[IVXLCDM]+)$/i, '').trim();
      if (root.length >= 3) {
        return root;
      }
    }
  }

  // 3. Remove sequel numbers / Roman numerals at the end of the title
  // E.g. "Tekken 3" -> "Tekken", "Crash Bandicoot 2" -> "Crash Bandicoot", "Final Fantasy VII" -> "Final Fantasy"
  const strippedNumber = clean.replace(/\s+(?:[0-9]+|[IVXLCDM]+)$/i, '').trim();
  if (strippedNumber !== clean && strippedNumber.length >= 3) {
    return strippedNumber;
  }

  return null;
}

/**
 * Find other games in the same series that are in the user's library ("we have").
 */
export function findSeriesGames(currentGame: Game, allGames: Game[]): SeriesMatchResult {
  const franchise = detectFranchiseName(currentGame.title);
  if (!franchise) {
    return { seriesName: '', games: [] };
  }

  const franchiseLower = franchise.toLowerCase();
  const currentClean = cleanGameTitle(currentGame.title).toLowerCase();

  const matched = allGames.filter((g) => {
    // Exclude current game
    if (String(g.id) === String(currentGame.id)) return false;

    const candidateClean = cleanGameTitle(g.title).toLowerCase();
    // Cannot be identical string if ID differed
    if (candidateClean === currentClean) return false;

    // Check if candidate matches franchise
    const candFranchise = detectFranchiseName(g.title);
    if (candFranchise && candFranchise.toLowerCase() === franchiseLower) {
      return true;
    }

    const regex = new RegExp(`(^|\\b)${franchise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|:|-|–|—|\\d|\\s)`, 'i');
    return regex.test(candidateClean);
  });

  // Sort by release year ascending, or title
  matched.sort((a, b) => {
    if (a.releaseYear && b.releaseYear && a.releaseYear !== b.releaseYear) {
      return a.releaseYear - b.releaseYear;
    }
    return a.title.localeCompare(b.title);
  });

  return {
    seriesName: franchise,
    games: matched,
  };
}

/**
 * Find similar games in the user's library ("we have") based on genre overlap,
 * developer/publisher match, and platform era.
 */
export function findSimilarGames(
  currentGame: Game,
  allGames: Game[],
  excludedIds: Set<string | number> = new Set()
): SimilarGameRecommendation[] {
  const currentGenres = new Set((currentGame.genres || []).map((g) => g.toLowerCase().trim()));
  const currentDev = (currentGame.developer || '').toLowerCase().trim();
  const currentPub = (currentGame.publisher || '').toLowerCase().trim();
  const currentPlatform = (currentGame.platformSlug || '').toLowerCase().trim();

  const results: SimilarGameRecommendation[] = [];

  for (const candidate of allGames) {
    const candId = String(candidate.id);
    if (candId === String(currentGame.id)) continue;
    if (excludedIds.has(candidate.id) || excludedIds.has(candId)) continue;

    let score = 0;
    const reasons: string[] = [];

    const candGenres = (candidate.genres || []).map((g) => g.toLowerCase().trim());
    const candDev = (candidate.developer || '').toLowerCase().trim();
    const candPub = (candidate.publisher || '').toLowerCase().trim();
    const candPlatform = (candidate.platformSlug || '').toLowerCase().trim();

    // 1. Check Genre matches
    const sharedGenres = candGenres.filter((g) => currentGenres.has(g));
    if (sharedGenres.length > 0) {
      const topGenre = sharedGenres[0];
      const capitalized = topGenre.charAt(0).toUpperCase() + topGenre.slice(1);
      score += sharedGenres.length * 12;
      reasons.push(sharedGenres.length > 1 ? `${capitalized} & ${sharedGenres.length - 1} more` : capitalized);
    }

    // 2. Check Developer match
    if (currentDev && candDev && (currentDev === candDev || candDev.includes(currentDev) || currentDev.includes(candDev))) {
      score += 25;
      reasons.push(`By ${candidate.developer}`);
    }

    // 3. Check Publisher match
    if (currentPub && candPub && currentPub !== currentDev && (currentPub === candPub || candPub.includes(currentPub) || currentPub.includes(candPub))) {
      score += 15;
      if (!reasons.some((r) => r.startsWith('By '))) {
        reasons.push(`Published by ${candidate.publisher}`);
      }
    }

    // 4. Platform era match
    if (currentPlatform && candPlatform && currentPlatform === candPlatform) {
      score += 4;
    }

    // 5. Rating bonus (good games recommended higher)
    if (candidate.rating && candidate.rating >= 80) {
      score += Math.round((candidate.rating - 70) / 5);
    }

    // Must have at least a meaningful similarity (genre or developer match)
    if (score >= 12 && reasons.length > 0) {
      results.push({
        game: candidate,
        score,
        reasons,
      });
    }
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score || (b.game.rating || 0) - (a.game.rating || 0));

  // Return top 10 recommendations
  return results.slice(0, 10);
}
