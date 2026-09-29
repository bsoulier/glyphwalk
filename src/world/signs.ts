export const SIGN_TEXTS: readonly string[] = [
  'NOODLES', 'HOTEL', 'BAR', '24H', 'ARCADE', 'OPEN', 'SUSHI', 'CLUB', 'RAMEN', 'PAWN',
  'DATA', 'KARAOKE', 'CAFE', 'TAXI', 'VIDEO', 'GAMES', 'NEON', 'SAKE', 'BANK', 'BOOKS',
  'DINER', 'MOTEL', 'LIVE', 'PHARMACY', 'DANCE', 'PIZZA', 'REPAIR', 'CYBER',
  'UDON', 'SOBA', 'IZAKAYA', 'PACHINKO', 'MANGA', 'TEA', 'YAKITORI', 'ONSEN', 'TOFU',
  'BRASSERIE', 'BOULANGERIE', 'PHARMACIE', 'BISTRO', 'LIBRAIRIE', 'FROMAGERIE', 'TABAC', 'PATISSERIE',
  'TAVERN', 'BAKERY', 'INN', 'APOTHECARY', 'CANDLES', 'ANTIQUES', 'BUTCHER', 'CLOCKS',
  'DOCK 7', 'FREIGHT', 'CUSTOMS', 'BONDED', 'PIER 3', 'GATE B',
  'STOP', 'WALK', 'LOBBY', 'LIFT', 'OFFICE',
  'GYOZA', 'DANGO', 'MOCHI', 'CREPES', 'VIN', 'MIEL', 'OLIVES', 'FLEURS', 'CIDER', 'PIES', 'SOUP', 'MEAD',
  'NUTS', 'TACOS', 'BAO', 'PHO', 'BBQ', 'BOBA', 'JUICE',
  'GROCERY', 'DONUTS', 'LAUNDRY', 'HARDWARE', 'ICE CREAM', 'LEMONADE', 'HOT DOGS', 'PRETZELS', 'CORN',
  'MANOR', 'VILLA', 'ESTATE', 'PRIVATE',
  'OCEAN', 'SURF', 'BEACH', 'PALMS', 'MARLIN', 'CASINO', 'GELATO', 'SUNSET', 'LIDO', 'TIKI', 'RUM', 'CABANA',
  'FLAMINGO', 'CORAL', 'COCONUT', 'CHURROS',
  'SOUK', 'SPICES', 'DATES', 'SAFFRON', 'HAMMAM', 'RIAD', 'TAGINE', 'CARPETS', 'LAMPS', 'BRASS', 'MINT', 'KEBAB',
  'SKYDECK', 'GLYPH TOWER',
  'DOWNTOWN', 'JAPANTOWN', 'OLD TOWN', 'LE MARAIS', 'DOCKLANDS', 'MAPLE HEIGHTS', 'SILVER HILLS', 'SEAFRONT', 'MEDINA',
  'GATE', 'SQUARE', 'PARK', 'CROSS', 'MARKET', 'HILL', 'BRIDGE', 'CENTRAL', 'MIND THE GAP',
];

export const TEXT_STOP = SIGN_TEXTS.indexOf('STOP');
export const TEXT_WALK = SIGN_TEXTS.indexOf('WALK');
export const TEXT_OPEN = SIGN_TEXTS.indexOf('OPEN');
export const TEXT_HOTEL = SIGN_TEXTS.indexOf('HOTEL');
export const TEXT_LOBBY = SIGN_TEXTS.indexOf('LOBBY');
export const TEXT_LIFT = SIGN_TEXTS.indexOf('LIFT');
export const TEXT_OFFICE = SIGN_TEXTS.indexOf('OFFICE');
export const TEXT_SKYDECK = SIGN_TEXTS.indexOf('SKYDECK');
export const TEXT_TOWER = SIGN_TEXTS.indexOf('GLYPH TOWER');

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
export const STALLS_JAPAN = signSet('RAMEN', 'GYOZA', 'DANGO', 'MOCHI', 'SAKE', 'UDON', 'SUSHI', 'TEA');
export const STALLS_PARIS = signSet('CREPES', 'VIN', 'CAFE', 'MIEL', 'OLIVES', 'FLEURS');
export const STALLS_OLDTOWN = signSet('CIDER', 'PIES', 'SOUP', 'MEAD', 'NUTS', 'BAKERY');
export const STALLS_DOWNTOWN = signSet('TACOS', 'BAO', 'PHO', 'BBQ', 'BOBA', 'JUICE', 'PIZZA');
export const SIGNS_SUBURB = signSet('GROCERY', 'DONUTS', 'LAUNDRY', 'HARDWARE', 'ICE CREAM', 'PIZZA', 'DINER', 'VIDEO', 'BAKERY', 'PHARMACY');
export const SIGNS_ESTATES = signSet('MANOR', 'VILLA', 'ESTATE', 'PRIVATE');
export const SIGNS_SEAFRONT = signSet('HOTEL', 'OCEAN', 'SURF', 'BEACH', 'PALMS', 'MARLIN', 'CASINO', 'GELATO', 'SUNSET', 'LIDO', 'TIKI', 'CABANA', 'FLAMINGO', 'CORAL', 'BAR', 'CLUB', 'DANCE');
/** Names that run down the fin of a Seafront hotel. */
export const HOTELS_SEAFRONT = signSet('OCEAN', 'PALMS', 'MARLIN', 'SUNSET', 'LIDO', 'FLAMINGO', 'CORAL', 'CABANA', 'HOTEL', 'CASINO');
export const SIGNS_MEDINA = signSet('SOUK', 'SPICES', 'TEA', 'DATES', 'SAFFRON', 'HAMMAM', 'RIAD', 'TAGINE', 'CARPETS', 'LAMPS', 'BRASS', 'OLIVES', 'BAKERY');
export const STALLS_SUBURB = signSet('LEMONADE', 'HOT DOGS', 'PRETZELS', 'CORN', 'DONUTS', 'ICE CREAM', 'PIES');
export const STALLS_SEAFRONT = signSet('GELATO', 'COCONUT', 'CHURROS', 'JUICE', 'TACOS', 'RUM', 'LEMONADE');
export const STALLS_MEDINA = signSet('SPICES', 'TEA', 'DATES', 'MINT', 'TAGINE', 'OLIVES', 'SAFFRON', 'KEBAB');
/** Stalls that cook, so they get a steaming pot. */
export const STEAMY = signSet('RAMEN', 'GYOZA', 'UDON', 'SOUP', 'PHO', 'BAO', 'BBQ', 'CREPES', 'PIES', 'HOT DOGS', 'CORN', 'CHURROS', 'TAGINE', 'KEBAB', 'TEA');

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
/** Miami pastels in neon: pink, aqua, mint, lilac, peach. */
export const DECO_NEON: readonly RGB[] = [[255, 90, 190], [80, 240, 255], [130, 255, 190], [200, 140, 255], [255, 170, 120]];
export const BRASS_SIGNS: readonly RGB[] = [[255, 200, 110], [240, 220, 170], [120, 220, 200]];

/** Sign sizes relative to a shop sign; the small ones are pedestrian signal plates. */
export const SIGN_SCALES: readonly number[] = [1, 2, 3, 4, 0.5, 0.25];

/**
 * seed = text | flicker << 8 | scale index << 11 | id << 14. Flicker 0 buzzes at random; any other value is
 * steady. `id` tells apart street signs with the same text (0 for signs that must never fail, like signals),
 * so they flicker, stutter and lose letters independently.
 */
export function signSeed(text: number, flicker: number, scale: number, id = 0): number {
  const k = Math.max(0, SIGN_SCALES.indexOf(scale));
  return text | ((flicker & 7) << 8) | (k << 11) | ((id & 255) << 14);
}
