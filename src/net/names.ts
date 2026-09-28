import type { RGB } from '../world/signs';

/**
 * Players never type a name: it comes from their id, so there is nothing to moderate. Both lists are
 * plain words that stay harmless in any pairing; keep it that way when editing them.
 */
const ADJECTIVES = [
  'NEON', 'RAINY', 'QUIET', 'SWIFT', 'SLEEPY', 'LUCKY', 'MISTY', 'SUNNY', 'COSMIC', 'PIXEL', 'VELVET', 'AMBER',
  'COPPER', 'SILVER', 'JADE', 'CORAL', 'INDIGO', 'MINT', 'OLIVE', 'TEAL', 'MAPLE', 'LUNAR', 'SOLAR', 'ARCTIC',
  'DUSKY', 'BRIGHT', 'GENTLE', 'CLEVER', 'BRAVE', 'CALM', 'JOLLY', 'NIMBLE',
];
const ANIMALS = [
  'FOX', 'OWL', 'OTTER', 'HERON', 'BADGER', 'PANDA', 'KOALA', 'LYNX', 'CRANE', 'FINCH', 'GECKO', 'HARE',
  'IBIS', 'KIWI', 'LLAMA', 'MOTH', 'NEWT', 'ORCA', 'PUFFIN', 'QUAIL', 'RAVEN', 'SEAL', 'TAPIR', 'WREN',
  'YAK', 'ZEBRA', 'BISON', 'CORGI', 'EGRET', 'FERRET', 'MOOSE', 'TOUCAN',
];

export function playerName(id: number): string {
  const n = id >>> 0;
  return `${ADJECTIVES[n % ADJECTIVES.length]} ${ANIMALS[Math.floor(n / ADJECTIVES.length) % ANIMALS.length]}`;
}

/** Bright shirts, so other players stand out from the people walking the streets. */
const COLORS: readonly RGB[] = [
  [255, 90, 90], [255, 170, 60], [250, 230, 80], [120, 240, 110], [70, 220, 200], [90, 170, 255],
  [170, 120, 255], [250, 110, 220], [255, 255, 255], [180, 255, 60],
];

export function playerColor(id: number): RGB {
  return COLORS[Math.floor((id >>> 0) / 1024) % COLORS.length];
}

export function allNameWords(): readonly string[] {
  return [...ADJECTIVES, ...ANIMALS];
}
