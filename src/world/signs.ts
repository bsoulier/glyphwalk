export const SIGN_TEXTS: readonly string[] = [
  'NOODLES', 'HOTEL', 'BAR', '24H', 'ARCADE', 'OPEN', 'SUSHI', 'CLUB', 'RAMEN', 'PAWN',
  'DATA', 'KARAOKE', 'CAFE', 'TAXI', 'VIDEO', 'GAMES', 'NEON', 'SAKE', 'BANK', 'BOOKS',
  'DINER', 'MOTEL', 'LIVE', 'PHARMACY', 'DANCE', 'PIZZA', 'REPAIR', 'CYBER',
  'UDON', 'SOBA', 'IZAKAYA', 'PACHINKO', 'MANGA', 'TEA', 'YAKITORI', 'ONSEN', 'TOFU',
  'BRASSERIE', 'BOULANGERIE', 'PHARMACIE', 'BISTRO', 'LIBRAIRIE', 'FROMAGERIE', 'TABAC', 'PATISSERIE',
  'TAVERN', 'BAKERY', 'INN', 'APOTHECARY', 'CANDLES', 'ANTIQUES', 'BUTCHER', 'CLOCKS',
  'DOCK 7', 'FREIGHT', 'CUSTOMS', 'BONDED', 'PIER 3', 'GATE B',
  'STOP', 'WALK', 'LOBBY', 'LIFT', 'OFFICE',
];

export const TEXT_STOP = SIGN_TEXTS.indexOf('STOP');
export const TEXT_WALK = SIGN_TEXTS.indexOf('WALK');
export const TEXT_OPEN = SIGN_TEXTS.indexOf('OPEN');
export const TEXT_HOTEL = SIGN_TEXTS.indexOf('HOTEL');
export const TEXT_LOBBY = SIGN_TEXTS.indexOf('LOBBY');
export const TEXT_LIFT = SIGN_TEXTS.indexOf('LIFT');
export const TEXT_OFFICE = SIGN_TEXTS.indexOf('OFFICE');

function signSet(...words: string[]): readonly number[] {
  return words.map((w) => {
    const k = SIGN_TEXTS.indexOf(w);
    if (k < 0) throw new Error(`unknown sign text ${w}`);
    return k;
  });
}

export const SIGNS_DOWNTOWN = signSet('HOTEL', 'BAR', '24H', 'ARCADE', 'CLUB', 'DATA', 'BANK', 'LIVE', 'DANCE', 'CYBER', 'PIZZA', 'DINER', 'VIDEO', 'GAMES', 'NEON', 'TAXI');
export const SIGNS_JAPAN = signSet('RAMEN', 'SUSHI', 'SAKE', 'KARAOKE', 'UDON', 'SOBA', 'IZAKAYA', 'PACHINKO', 'MANGA', 'TEA', 'YAKITORI', 'ONSEN', 'TOFU', 'HOTEL', 'NOODLES');
export const SIGNS_PARIS = signSet('CAFE', 'BRASSERIE', 'BOULANGERIE', 'PHARMACIE', 'BISTRO', 'LIBRAIRIE', 'FROMAGERIE', 'TABAC', 'PATISSERIE', 'HOTEL');
export const SIGNS_OLDTOWN = signSet('TAVERN', 'BAKERY', 'INN', 'APOTHECARY', 'CANDLES', 'ANTIQUES', 'BUTCHER', 'CLOCKS', 'BOOKS');
export const SIGNS_DOCKS = signSet('DOCK 7', 'FREIGHT', 'CUSTOMS', 'BONDED', 'PIER 3', 'GATE B', 'DINER', 'BAR');

/** Horizontal sign, in sign units (metres at scale 1). */
export const SIGN_CHAR_W = 0.9;
export const SIGN_PAD = 0.5;
export const SIGN_H = 1.8;
export const SIGN_BAND_PAD = 0.25;

/** Vertical blade sign: one letter per 0.9 m box, read top to bottom. */
export const VSIGN_W = 1.0;
export const VSIGN_CHAR_H = 0.9;
export const VSIGN_PAD = 0.4;

export type RGB = readonly [number, number, number];

export const NEON: readonly RGB[] = [
  [255, 60, 200], [60, 230, 255], [90, 255, 130], [255, 150, 50],
  [255, 70, 70], [255, 230, 90], [170, 120, 255],
];
export const WARM_SIGNS: readonly RGB[] = [[255, 210, 120], [255, 235, 190], [240, 180, 90]];
export const DOCK_SIGNS: readonly RGB[] = [[255, 160, 60], [200, 220, 255], [255, 220, 90]];

/** Sign sizes relative to a shop sign; the small ones are pedestrian signal plates. */
export const SIGN_SCALES: readonly number[] = [1, 2, 3, 4, 0.5, 0.25];

/** seed = text | flicker << 8 | scale index << 11. Flicker 0 buzzes at random; any other value is steady. */
export function signSeed(text: number, flicker: number, scale: number): number {
  const k = Math.max(0, SIGN_SCALES.indexOf(scale));
  return text | ((flicker & 7) << 8) | (k << 11);
}
