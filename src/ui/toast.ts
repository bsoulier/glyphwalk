let el: HTMLElement | null = null;
let timer = 0;

/** A short message at the top of the screen. */
export function toast(text: string, ms = 2600): void {
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(timer);
  timer = window.setTimeout(() => el?.classList.remove('on'), ms);
}
