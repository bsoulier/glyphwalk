import { vi } from 'vitest';

/** In-memory stand-in for window.localStorage, which Node does not provide. */
export function stubLocalStorage(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (n: number) => [...data.keys()][n] ?? null,
    get length() {
      return data.size;
    },
  });
  return data;
}
