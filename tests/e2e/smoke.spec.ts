import { expect, test, type Page } from '@playwright/test';

/** Collects uncaught errors and console errors so every test can assert the page stayed clean. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

const stat = (page: Page, key: string) => page.locator('#stats').evaluate((el, k) => el.textContent?.match(new RegExp(`${k}\\s+(.*)`))?.[1] ?? '', key);

test.beforeEach(async ({ page }) => {
  // Each test starts from a first visit: no saved settings, position or cats.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      sessionStorage.setItem('seeded', '1');
    }
  });
});

test('renders the city and keeps running', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?hood=japantown&time=night&weather=rain');
  await expect.poll(() => stat(page, 'SECTOR')).toBe('JAPANTOWN');
  await page.keyboard.press('KeyI');
  const nerds = page.locator('#nerds-body');
  await expect(nerds).toBeVisible();
  await expect.poll(async () => Number((await nerds.textContent())?.match(/Frame rate\s+(\d+)/)?.[1] ?? 0)).toBeGreaterThan(5);
  await expect.poll(async () => Number((await nerds.textContent())?.match(/Drawn\s+(\d+) faces/)?.[1] ?? 0)).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('share link reopens the same view, hour and weather', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = watchErrors(page);
  await page.goto('./?hood=oldtown&time=dusk&weather=snow');
  await expect.poll(() => stat(page, 'SECTOR')).toBe('OLD TOWN');
  await page.keyboard.press('KeyL');
  await expect(page.locator('#toast')).toContainText('Link copied');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain('cam=');
  expect(url).toContain('weather=snow');
  const other = await context.newPage();
  await other.goto(url);
  await expect.poll(() => stat(other, 'SECTOR')).toBe('OLD TOWN');
  await expect.poll(() => stat(other, 'WEATHER')).toBe('SNOW');
  expect(errors).toEqual([]);
});

test('remembers settings and position across a reload', async ({ page }) => {
  await page.goto('./');
  await expect.poll(() => stat(page, 'SECTOR')).toBe('DOWNTOWN');
  await page.selectOption('#sel-hood', '3');
  await page.selectOption('#sel-weather', 'fog');
  await page.selectOption('#sel-events', 'off');
  await expect.poll(() => stat(page, 'SECTOR')).toBe('LE MARAIS');
  await page.waitForTimeout(2500);
  await page.reload();
  await expect.poll(() => stat(page, 'SECTOR')).toBe('LE MARAIS');
  await expect(page.locator('#sel-weather')).toHaveValue('fog');
  await expect(page.locator('#sel-events')).toHaveValue('off');
});

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('./');
  const cached = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    return keys.length ? (await (await caches.open(keys[0])).keys()).length : 0;
  });
  expect(cached).toBeGreaterThan(5);
  await page.reload();
  await context.setOffline(true);
  await page.goto('./?hood=docklands');
  await expect.poll(() => stat(page, 'SECTOR')).toBe('DOCKLANDS');
});

test('Enter hails a taxi, rides in the back and gets out on the sidewalk', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?hood=seafront&time=day');
  await expect.poll(() => stat(page, 'SECTOR')).toBe('SEAFRONT');
  await page.keyboard.press('Enter');
  await expect.poll(() => stat(page, 'MODE')).toContain('TAXI');
  await expect(page.locator('#osd')).toContainText('FARE $');
  await page.keyboard.press('Enter');
  await expect.poll(() => stat(page, 'MODE')).toContain('WALK');
  await expect(page.locator('#toast')).toContainText('Paid $');
  expect(errors).toEqual([]);
});

test('phone gets touch controls and a photo mode with its own buttons @phone', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('./?hood=downtown&time=night');
  const bar = page.locator('#touch .t-bar .t-btn');
  await expect(bar).toHaveText(['MODE', 'NEXT', 'PHOTO', 'MAP', 'AREA', 'TILT', 'SOUND', 'MENU']);
  await page.locator('#touch .t-btn', { hasText: 'PHOTO' }).tap();
  await expect(page.locator('#touch .t-ctx .t-btn')).toHaveText(['SAVE', 'GIF', 'COPY', 'LINK', 'EXIT']);
  await expect(page.locator('#hud')).toBeHidden();
  expect(errors).toEqual([]);
});
