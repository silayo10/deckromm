import { Game } from '../types';

export interface LanguageOption {
  id: string;
  label: string;
  shortLabel: string;
  flag?: string;
}

export const PRESET_LANGUAGES: LanguageOption[] = [
  { id: 'all', label: 'All Languages', shortLabel: 'All', flag: '🌐' },
  { id: 'no-ja', label: 'Hide Japanese (Exclude JP)', shortLabel: 'No JP', flag: '🇯🇵' },
  { id: 'en', label: 'English Only', shortLabel: 'EN', flag: '🇺🇸' },
  { id: 'ja', label: 'Japanese Only', shortLabel: 'JA', flag: '🇯🇵' },
  { id: 'fr', label: 'French Only', shortLabel: 'FR', flag: '🇫🇷' },
  { id: 'de', label: 'German Only', shortLabel: 'DE', flag: '🇩🇪' },
  { id: 'es', label: 'Spanish Only', shortLabel: 'ES', flag: '🇪🇸' },
  { id: 'it', label: 'Italian Only', shortLabel: 'IT', flag: '🇮🇹' },
];

/** Check if game has an English fan translation or translation patch tag. */
export function isEnglishFanTranslation(game: Game): boolean {
  const fn = (game.fileName || '').toLowerCase();
  const title = (game.title || '').toLowerCase();

  const hasTransTag = Boolean(
    game.tags?.some((t) => {
      const s = t.toLowerCase();
      return s.includes('translation') || s.includes('english') || s.includes('fan-trans');
    })
  );

  const hasTransFileName =
    /\[t[-_]?(?:en|eng)\b/i.test(fn) ||
    /\[t\+(?:en|eng)\b/i.test(fn) ||
    /\(en(?:g)?\s*trans(?:lation)?\)/i.test(fn) ||
    /\[english\s*trans(?:lation)?\]/i.test(fn);

  const hasTransTitle =
    /\b(?:english translation|retranslation|fan translation)\b/i.test(title);

  return hasTransTag || hasTransFileName || hasTransTitle;
}

/** Check if game is a Japanese-language release (excluding English translations). */
export function isJapaneseGame(game: Game): boolean {
  // If translated to English, it's playable in English
  if (isEnglishFanTranslation(game)) return false;

  const fn = (game.fileName || '').toLowerCase();
  const title = (game.title || '').toLowerCase();
  const reg = (game.region || '').toLowerCase();

  // Explicit Japanese language tag
  const hasJaLang = Boolean(
    game.languages?.some((l) => {
      const s = String(l).toLowerCase().trim();
      return s === 'ja' || s === 'jp' || s === 'jpn' || s === 'japanese' || s === '日本語';
    })
  );

  // Explicit Japan region
  const hasJaRegion =
    reg.includes('japan') || reg === 'jp' || reg === 'jpn';

  // Standard ROM tags: (Japan), (J), (Jpn), (Ja), [J]
  const hasJaFile =
    /\(japan\b/i.test(fn) ||
    /\((?:j|jp|jpn|ja)\)/i.test(fn) ||
    /\[(?:j|jp|jpn|ja)\]/i.test(fn) ||
    /\bjapan\b/i.test(fn);

  const hasJaTitle = /\(japan\)/i.test(title);

  // Kanji / Hiragana / Katakana characters in title
  const hasJapaneseChars = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(game.title || '');

  // Check if it also has explicit English in the same release (e.g. World release, En,Ja multi-language)
  const hasMultiEnglish =
    /\(en[,\s]/i.test(fn) ||
    /,(?:en|usa|world)\)/i.test(fn) ||
    (game.languages && game.languages.some((l) => String(l).toLowerCase().includes('en')));

  if ((hasJaLang || hasJaRegion || hasJaFile || hasJaTitle || hasJapaneseChars) && !hasMultiEnglish) {
    return true;
  }

  return false;
}

/** Check if game has English text/audio. */
export function isEnglishGame(game: Game): boolean {
  if (isEnglishFanTranslation(game)) return true;

  const fn = (game.fileName || '').toLowerCase();
  const reg = (game.region || '').toLowerCase();

  const hasEnLang = Boolean(
    game.languages?.some((l) => {
      const s = String(l).toLowerCase().trim();
      return s === 'en' || s === 'eng' || s === 'english';
    })
  );

  if (hasEnLang) return true;

  const hasEnRegion =
    reg.includes('usa') ||
    reg.includes('north america') ||
    reg.includes('europe') ||
    reg.includes('world') ||
    reg.includes('uk') ||
    reg.includes('australia');

  if (hasEnRegion) return true;

  const hasEnFile =
    /\(usa\b/i.test(fn) ||
    /\((?:u|us)\)/i.test(fn) ||
    /\(europe\b/i.test(fn) ||
    /\(e\)/i.test(fn) ||
    /\(world\b/i.test(fn) ||
    /\(en\b/i.test(fn) ||
    /\(uk\b/i.test(fn);

  if (hasEnFile) return true;

  // If not explicitly Japanese or other foreign language, default to English friendly
  if (!isJapaneseGame(game) && !/\((?:france|germany|spain|italy)\b/i.test(fn)) {
    return true;
  }

  return false;
}

/** Match game against active language filter. */
export function matchGameLanguage(game: Game, filter: string): boolean {
  if (!filter || filter === 'all') return true;

  const f = filter.toLowerCase().trim();

  if (f === 'no-ja' || f === 'exclude-ja' || f === 'hide-ja') {
    return !isJapaneseGame(game);
  }

  if (f === 'en' || f === 'english') {
    return isEnglishGame(game);
  }

  if (f === 'ja' || f === 'japanese') {
    return isJapaneseGame(game);
  }

  if (f === 'fr' || f === 'french') {
    const fn = (game.fileName || '').toLowerCase();
    const hasLang = game.languages?.some((l) => ['fr', 'french'].includes(l.toLowerCase()));
    return Boolean(hasLang || /\(france\b/i.test(fn) || /\(fr\)/i.test(fn));
  }

  if (f === 'de' || f === 'german') {
    const fn = (game.fileName || '').toLowerCase();
    const hasLang = game.languages?.some((l) => ['de', 'german'].includes(l.toLowerCase()));
    return Boolean(hasLang || /\(germany\b/i.test(fn) || /\(de\)/i.test(fn) || /\(g\)/i.test(fn));
  }

  if (f === 'es' || f === 'spanish') {
    const fn = (game.fileName || '').toLowerCase();
    const hasLang = game.languages?.some((l) => ['es', 'spanish'].includes(l.toLowerCase()));
    return Boolean(hasLang || /\(spain\b/i.test(fn) || /\(es\)/i.test(fn) || /\(s\)/i.test(fn));
  }

  if (f === 'it' || f === 'italian') {
    const fn = (game.fileName || '').toLowerCase();
    const hasLang = game.languages?.some((l) => ['it', 'italian'].includes(l.toLowerCase()));
    return Boolean(hasLang || /\(italy\b/i.test(fn) || /\(it\)/i.test(fn) || /\(i\)/i.test(fn));
  }

  return true;
}

/** Helper to parse languages and region from standard ROM file name. */
export function parseRomFileName(name: string): { languages: string[]; region?: string } {
  const languages: string[] = [];
  let region: string | undefined;

  const lower = name.toLowerCase();

  if (/\(japan\b|\((?:j|jp|jpn)\)/i.test(lower)) {
    region = 'Japan';
    languages.push('Japanese');
  } else if (/\(usa\b|\((?:u|us)\)/i.test(lower)) {
    region = 'North America';
    languages.push('English');
  } else if (/\(europe\b|\(e\)/i.test(lower)) {
    region = 'Europe';
    languages.push('English');
  } else if (/\(world\b/i.test(lower)) {
    region = 'World';
    languages.push('English');
  } else if (/\(germany\b|\(de\)/i.test(lower)) {
    region = 'Europe';
    languages.push('German');
  } else if (/\(france\b|\(fr\)/i.test(lower)) {
    region = 'Europe';
    languages.push('French');
  } else if (/\(spain\b|\(es\)/i.test(lower)) {
    region = 'Europe';
    languages.push('Spanish');
  } else if (/\(italy\b|\(it\)/i.test(lower)) {
    region = 'Europe';
    languages.push('Italian');
  }

  if (/\[t[-_]?(?:en|eng)\b/i.test(lower) && !languages.includes('English')) {
    languages.push('English');
  }

  return { languages, region };
}
