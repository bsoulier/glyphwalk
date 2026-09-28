const KEY = 'glyphwalk.online.v1';

/** A random id, which is also where the player's name comes from (net/names.ts). */
export function newOnlineId(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0) || 1;
}

/** The same id every visit, so friends keep seeing the same name; drawn on first use. */
export function loadOnlineId(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { id?: unknown } | null;
    const id = saved?.id;
    if (typeof id === 'number' && Number.isInteger(id) && id > 0 && id < 2 ** 32) return id;
  } catch {
    // Unreadable: draw a new one.
  }
  const id = newOnlineId();
  saveOnlineId(id);
  return id;
}

export function saveOnlineId(id: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ id }));
  } catch {
    // Storage refused: the id lasts for this visit.
  }
}
