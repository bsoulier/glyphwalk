import { toast } from './toast';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

export function standalone(): boolean {
  return matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Offline play and installing to the home screen. Chrome and Edge fire `beforeinstallprompt`, which the
 * Install button replays; iOS has no prompt, so it gets a line explaining the Share menu route instead.
 */
export function setupPwa(installBtn: HTMLButtonElement, iosHint: HTMLElement): void {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Offline cache unavailable', err));
  }
  if (standalone()) return;
  let deferred: InstallPromptEvent | null = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', () => {
    installBtn.blur();
    if (!deferred) return;
    void deferred.prompt();
    deferred = null;
    installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    toast('Installed: Glyphwalk now opens full screen and works offline');
  });
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) iosHint.hidden = false;
}
