/**
 * Usage counts through GoatCounter (https://www.goatcounter.com): no cookies, no script of theirs, only
 * a request to their counting endpoint. Off unless the build sets VITE_GOATCOUNTER to the site code,
 * and never counted in development, in automated browsers, or when the browser asks not to be tracked.
 */
const CODE = (import.meta.env.VITE_GOATCOUNTER as string | undefined)?.trim() ?? '';

function allowed(): boolean {
  if (!CODE || import.meta.env.DEV || navigator.webdriver) return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl || navigator.doNotTrack === '1') return false;
  return !/^(localhost|127\.|\[::1\])/.test(location.hostname);
}

const on = allowed();
const sent = new Set<string>();

function count(path: string, title: string, event: boolean): void {
  const q = new URLSearchParams({
    p: path,
    t: title,
    e: String(event),
    s: `${screen.width},${screen.height},${window.devicePixelRatio || 1}`,
    rnd: Math.random().toString(36).slice(2, 8),
  });
  if (!event && document.referrer) q.set('r', document.referrer);
  // Campaign tags only; the rest of the query is camera positions and would split the page into thousands.
  const campaign = new URLSearchParams([...new URLSearchParams(location.search)].filter(([k]) => k === 'ref' || k.startsWith('utm_')));
  if (!event && campaign.size > 0) q.set('q', `?${campaign}`);
  new Image().src = `https://${CODE}.goatcounter.com/count?${q}`;
}

/** Counts the visit, once per page load. */
export function trackVisit(): void {
  if (on && !sent.has('/')) {
    sent.add('/');
    count(location.pathname, document.title, false);
  }
}

/** Counts that something happened (e.g. `taxi`, `district-medina`), at most once per visit per name. */
export function trackEvent(name: string): void {
  if (!on || sent.has(name)) return;
  sent.add(name);
  count(name, name, true);
}
