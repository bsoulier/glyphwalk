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

cd server            # the online server (Cloudflare Worker), its own package: npm install once
npm run dev          # wrangler dev on ws://127.0.0.1:8787; open the game with ?online=ws://127.0.0.1:8787
npm run typecheck    # the Worker against the Cloudflare types
npm run load         # load test against a running server (see docs/ONLINE.md)
```

Before committing: `npm test && npm run build`. For anything visible or touching input, also `npm run test:e2e`. For
changes under `server/` or `src/net/`, also `cd server && npm run typecheck`.

## Layout

| Path | What lives there |
|---|---|
| `src/main.ts` | Wiring: settings, input, main loop, HUD, photo/GIF, sharing, tour, resume. The only file that knows about everything. |
| `src/render/` | Frame buffer, camera, rasterizer (`raster.ts`), per-material shading (`materials.ts`, `facades.ts`, `interiors.ts`), ground and sky (`ground.ts`, `background.ts`), lighting and fog (`surface.ts`, `daylight.ts`), presenters (`presenter.ts`), rain and snow. |
| `src/world/` | City generation (`city.ts`, `build.ts`, `styles/*` per district, the Glyph Tower in `styles/downtown.ts`), districts (`hoods.ts`), interiors and furniture, traffic and the taxi cabin you ride in (`cabin.ts`), pedestrians, signals, monorail, cats, night market, fireworks, event schedule (`events.ts`). |
| `src/audio/` | `sound.ts` (all ambience and effects) and `radio.ts` (generated music), Web Audio only. |
| `src/game/` | Player and camera modes, keyboard/mouse input, touch controls, auto tour. |
| `src/ui/` | HUD panel, settings persistence, quality ladder, photo mode, GIF encoder, share links, resume, PWA install, toasts, usage counts (`analytics.ts`). |
| `src/net/` | Playing online: the wire format shared with the server (`protocol.ts`), generated names, the client's zone connections and smoothing (`online.ts`). Other players are drawn by `world/others.ts`. |
| `server/` | The online server: a Cloudflare Worker (`src/index.ts`), the room logic (`src/zone.ts`) and the city-wide head count (`src/stats.ts`), both free of Cloudflare APIs and unit tested. See [docs/ONLINE.md](docs/ONLINE.md). |
| `.env.production` | Build settings for the published site: the online server URL and the GoatCounter code (public; empty turns them off). |
| `public/` | Manifest and icons; copied to the build and precached by the service worker. |
| `tests/unit/` | Vitest tests. `storage.ts` stubs `localStorage`. |
| `tests/e2e/` | Playwright smoke tests (desktop, plus `@phone`-tagged tests on a phone profile). |
| `vite.config.ts` | `base: './'`, the service-worker generator plugin, Vitest config. |
| `scripts/deploy.sh` | Publishes `dist/` as the single commit of `gh-pages`. |

## How a frame is made

1. `renderScene` (`src/render/scene.ts`) collects visible blocks front to back and rasterizes their faces, then props,
 poles and lights; then the Glyph Tower on its own (with its own far plane and fog) when it is past the draw
 distance; then moving actors (`world.drawActors`), other players (`world/others.ts`), and the taxi cabin when
 riding in the back of one.
2. `drawBackground` fills only cells nothing covered (depth 0): ground where the ray points down, sky elsewhere.
3. Fireworks draw after the sky (they add light to it), then other players' name tags and emotes (they set no depth,
 so the ground and sky would paint over them), rain and snow last.
4. The presenter uploads two `cols x rows` textures and the GPU draws glyphs from an atlas.

Frame buffer cells pack `glyph << 24 | b << 16 | g << 8 | r` in `fg` and `bg`; `depth` holds `1/z` (0 = empty). Surface
colour goes through `put()` in `surface.ts`, which applies time-of-day light and fog; pass `emissive = 1` for things that
glow (lamps, signs, windows at night).

## Rules that keep the world consistent

- **Determinism.** Everything placed in the city is a pure function of `(block i, block j, worldSeed)`. Never add
  `rng()` calls to an existing builder stream: that reshuffles every later building in the block. Use a separate stream
  (`B.alt()`, or `mulberry32(hash3(i, j, worldSeed ^ SALT))`) or a hash of the position, as cats, market stalls and sign
  ids do.
- **Districts.** Regions of 4x4 blocks get a district from `hoodOfRegion`. The later districts (`second: true` in
 `HOODS`) take a share of regions by a separate roll, so the first five kept their regions and old links still land
 in the same place. Add a new district to the second set (or a new set with its own roll), never by changing the
 first five's weights. The Seafront's northern row of blocks is beach (`isBeach`); the Glyph Tower's block is
 `LANDMARK_I`, `LANDMARK_J` in `world/layout.ts`.
- **Facade seeds** hold the facade kind in bits 18-21 (`facadeOf`), so there is room for 16 kinds.
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
  `glyphwalk.settings.v1`, `glyphwalk.cats.v1`, `glyphwalk.view.v1`, `glyphwalk.online.v1`. URL parameters (`hood`,
  `cam`, `mode`, `floor`, `time`, `hour`, `weather`, `seed`, `tour`) override saved state.
- **Online.** Players never send free text: names come from the id (`net/names.ts`) and speech is an index into
  `EMOTES` (`net/protocol.ts`), append only, with texts the font can draw. Keep both lists harmless. The world is never
  sent (it is a function of the seed); only position, mode, heading and emotes. Any incompatible change to the wire
  format bumps `PROTOCOL`; deploy the server before the site. Room logic stays in `server/src/zone.ts`, free of
  Cloudflare APIs, so it is tested in Node. Idle and hidden clients must keep disconnecting: they are what keeps the
  server cheap.
- **No secrets in the repository.** `.env.production` holds public values only (the online server URL and the
  GoatCounter code, both visible in the page); `tests/unit/secrets.test.ts` fails on anything else there, on files
  like `.env`, `.dev.vars` or keys, and on token-shaped strings in any tracked file. Cloudflare credentials stay in
  `wrangler login` (outside the repository); if the Worker ever needs a secret, use `wrangler secret put`.
- **Usage counts.** Only through `trackEvent` in `ui/analytics.ts` (GoatCounter's endpoint, no third-party script, no
  cookies), once per visit per event name, and never with anything personal in the name.
- **HUD.** The panel keeps only the district, time, weather, events and volume in view; everything else goes in its
  folding sections. Keys that apply only in some situations belong in `prompts()` in `main.ts` (the line at the bottom
  of the screen) and, for phones, `touchContext()`, not in the panel's key list.
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
