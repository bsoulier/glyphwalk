# AGENTS.md

Context for coding agents working on Glyphwalk: a browser game that renders an endless procedural city as a grid of
text characters. Live at <https://bsoulier.github.io/glyphwalk/>; see [README.md](README.md) for what it does.

## Commands

```sh
npm run dev          # Vite dev server (debug hooks on window.glyphwalk)
npm test             # unit tests, Vitest, Node environment, ~1 s
npm run test:e2e     # Playwright against the production build on port 4173 (first run: npx playwright install chromium)
npm run build        # tsc --noEmit (src and tests) + vite build into dist/
npm run deploy       # build and publish dist/ to the gh-pages branch (see docs/DEPLOYMENT.md)
```

Before committing: `npm test && npm run build`. For anything visible or touching input, also `npm run test:e2e`.

## Layout

| Path | What lives there |
|---|---|
| `src/main.ts` | Wiring: settings, input, main loop, HUD, photo/GIF, sharing, tour, resume. The only file that knows about everything. |
| `src/render/` | Frame buffer, camera, rasterizer (`raster.ts`), per-material shading (`materials.ts`, `facades.ts`, `interiors.ts`), ground and sky (`ground.ts`, `background.ts`), lighting and fog (`surface.ts`, `daylight.ts`), presenters (`presenter.ts`), rain and snow. |
| `src/world/` | City generation (`city.ts`, `build.ts`, `styles/*` per district), districts (`hoods.ts`), interiors and furniture, traffic, pedestrians, signals, monorail, cats, night market, fireworks, event schedule (`events.ts`). |
| `src/audio/` | `sound.ts` (all ambience and effects) and `radio.ts` (generated music), Web Audio only. |
| `src/game/` | Player and camera modes, keyboard/mouse input, touch controls, auto tour. |
| `src/ui/` | HUD panel, settings persistence, quality ladder, photo mode, GIF encoder, share links, resume, PWA install, toasts. |
| `public/` | Manifest and icons; copied to the build and precached by the service worker. |
| `tests/unit/` | Vitest tests. `storage.ts` stubs `localStorage`. |
| `tests/e2e/` | Playwright smoke tests (desktop, plus `@phone`-tagged tests on a phone profile). |
| `vite.config.ts` | `base: './'`, the service-worker generator plugin, Vitest config. |
| `scripts/deploy.sh` | Publishes `dist/` as the single commit of `gh-pages`. |

## How a frame is made

1. `renderScene` (`src/render/scene.ts`) collects visible blocks front to back and rasterizes their faces, then props,
   poles and lights, then moving actors (`world.drawActors`).
2. `drawBackground` fills only cells nothing covered (depth 0): ground where the ray points down, sky elsewhere.
3. Fireworks draw after the sky (they add light to it), rain and snow last.
4. The presenter uploads two `cols x rows` textures and the GPU draws glyphs from an atlas.

Frame buffer cells pack `glyph << 24 | b << 16 | g << 8 | r` in `fg` and `bg`; `depth` holds `1/z` (0 = empty). Surface
colour goes through `put()` in `surface.ts`, which applies time-of-day light and fog; pass `emissive = 1` for things that
glow (lamps, signs, windows at night).

## Rules that keep the world consistent

- **Determinism.** Everything placed in the city is a pure function of `(block i, block j, worldSeed)`. Never add
  `rng()` calls to an existing builder stream: that reshuffles every later building in the block. Use a separate stream
  (`B.alt()`, or `mulberry32(hash3(i, j, worldSeed ^ SALT))`) or a hash of the position, as cats, market stalls and sign
  ids do.
- **Sign seeds** live in `Float32Array` face data, so they must stay below 2^24 (see `signSeed` in `world/signs.ts`).
  Add new sign texts only at the end of `SIGN_TEXTS`, and only with characters that exist in `world/font.ts`; a unit
  test checks this.
- **Events.** Showpieces must not run all the time by default. Fireworks and neon glitches follow `world/events.ts`:
  every 5 minutes by default, with "Non-stop" and "Off" in the settings.
- **Sound.** Everything is synthesized; do not add audio files. Route each new sound through a kind bus
  (`this.outside(kind)` or `this.inside(kind)` in `sound.ts`) so it can be switched off in the panel; outdoor sounds go
  through the muffle filter that makes interiors sound enclosed.
- **Settings.** New persistent options go in `Settings` and `DEFAULTS` in `ui/settings.ts`, validated in
  `loadSettings` if they are enums, shown in `index.html` + `ui/hud.ts`, and wired in `main.ts`. Storage keys:
  `glyphwalk.settings.v1`, `glyphwalk.cats.v1`, `glyphwalk.view.v1`. URL parameters (`hood`, `cam`, `mode`, `floor`,
  `time`, `hour`, `weather`, `seed`, `tour`) override saved state.
- **Performance.** The main loop runs at up to 120 fps. Avoid allocations in per-cell and per-face code, cull with
  `sphereVisible` before drawing actors, and check changes on a throttled CPU; `ui/quality.ts` trades cell size and draw
  distance when frames run long.
- **No runtime dependencies.** The game ships only its own code; keep it that way.

## Testing notes

- Unit tests run in Node: stub browser globals with `vi.stubGlobal` (see `tests/unit/share.test.ts`) or
  `stubLocalStorage()`. Modules that touch `document` do so only inside functions, so they can be imported.
- `tests/unit/gif.test.ts` checks the GIF encoder against its own small decoder; keep that independent of `src/`.
- E2E tests clear storage on first load of each test and read state through the DOM (`#stats`, `#nerds-body`,
  selects), because the production build has no `window.glyphwalk`.

## Git, publishing and privacy

- **Commit identity is mandatory:** every commit must be authored and committed as
  `Benjamin Soulier <benjamin.soulier@gmail.com>`. This repository's local git config sets it; check with
  `git log -1 --format='%an <%ae> | %cn <%ce>'` before pushing. Never commit with another identity.
- **No co-author trailers.** Commit messages must not carry `Co-authored-by:` lines (GitHub would show a second author).
  Cursor adds one to agent commits unless Cursor Settings > Git & PRs > Attribution is off; this clone also has a local
  `.git/hooks/commit-msg` that strips it. Check with `git log -1 --format=%B` before pushing.
- `origin` is <https://github.com/bsoulier/glyphwalk> (public). Only `main` and `gh-pages` exist; do not push other
  branches or tags without being asked.
- After pushing `main`, publish with `npm run deploy` and check the site (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).
- Keep the repository free of personal or employer information, credentials and tokens, and of material or names from
  other projects. Commit messages describe the change in plain language.

## Code style

- TypeScript, strict mode, ES modules, no framework. Small modules with plain functions and classes.
- Comments explain constraints and reasons the code cannot show, not what the next line does. Doc comments on exported
  functions and non-obvious fields.
- Match the surrounding code: naming, units (metres, seconds, radians), and the existing idioms for colours (`RGB`
  tuples) and packed data (`*_STRIDE` flat arrays).
