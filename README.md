# Glyphwalk

**Walk, ride and fly through an endless city drawn entirely in text characters.**

[![Play Glyphwalk](https://img.shields.io/badge/%E2%96%B6%20play%20now-bsoulier.github.io%2Fglyphwalk-7dffb0?style=for-the-badge&labelColor=03140b)](https://bsoulier.github.io/glyphwalk/)

Runs in the browser on desktop and phone. No install, no sign-up, and after the first visit it works offline.

![A rainy night market in Japantown](docs/images/hero-market.gif)

Every frame is a grid of characters. A software rasterizer draws the city at glyph resolution, choosing a character, a
foreground and a background colour for each cell, and the GPU turns the grid into pixels. There are no textures,
models, fonts or sound files: the city, its lighting and its soundtrack are all generated as you move through it, in
about 70 kB of gzipped JavaScript.

## Things to do

- **Explore five districts**, each with its own architecture, street life and sound: Downtown towers, Japantown
  shophouses and pagodas, the gabled lanes of Old Town, Parisian boulevards in Le Marais, and the Docklands.
- **Find the 45 hidden cats**, nine per district: in shops, on sidewalks and up on the roofs. Listen for meows; their
  eyes glow at night. Progress is saved.
- **Go inside**: shops, cafes, noodle bars, arcades and offices, with furniture, customers and a lift up the building.
- **Ride along** in a taxi or a sky taxi, take the monorail, flick through street cameras, or just fly.
- **Stay up late**: the clock runs from dusk to dawn, windows light up, street markets open on each district's main
  street, and every five minutes there are fireworks over the docks.
- **Change the weather**: rain with thunder, snow that settles on the roofs, or fog.
- **Tune the taxi radio** to one of four stations composed on the fly: lo-fi, synthwave, jazz and ambient.
- **Take pictures**: photo mode freezes the city and saves a PNG, records a looping GIF, or copies the frame as plain
  text you can paste anywhere.
- **Share the exact view**: one key copies a link that opens the game at the same spot, hour and weather.
- **Put it on your phone**: touch controls, tilt-to-look, and "Add to Home Screen" for full-screen offline play.

| | |
|---|---|
| ![Old Town under snow](docs/images/snow.jpg) | ![Downtown skyline in the rain at dusk](docs/images/skyline.jpg) |
| ![Inside a cafe](docs/images/interior.jpg) | ![Night market stalls](docs/images/market.jpg) |
| ![Fireworks over the docks](docs/images/fireworks.gif) | ![Touch controls on a phone](docs/images/phone.jpg) |

## Controls

| Keyboard | Action |
|---|---|
| Click, then mouse | Look around (Esc frees the mouse) |
| `W` `A` `S` `D` / arrows, `Shift` | Move, run |
| `V` or `1`-`6` | Camera: walk, fly, street cameras, taxi, sky taxi, monorail |
| `N` | Next camera or vehicle |
| `E` / `Q` | Lift up / down, fly up / down, or change radio station in a cab |
| `B` / `M` | Next district / map (mini, full, off; click the full map to jump) |
| `P` | Photo mode: `Enter` PNG, `G` GIF, `C` copy as text |
| `L` | Copy a link to this exact view |
| `R` / `Y` | Weather / time of day |
| `U` / `I` | Sound on or off / stats for nerds |
| `G` / `T` / `F` | Colour style / scanlines / full screen |
| `[` `]` | Bigger or smaller character cells |
| `O` / `H` | Auto tour (also starts after 45 s idle) / settings panel |

On a phone the left half of the screen is a joystick (push further to run) and the right half drags the view. The
buttons on the right switch camera, take photos, open the map and the settings, and extra buttons appear when they are
useful: rise and sink when flying, the lift, the radio, and the photo actions.

The settings panel lets you pick the district, time of day, weather, how often fireworks and neon glitches happen,
radio station, sound levels (each kind of sound can be switched off), cell size, draw distance and more. Everything is
remembered, including where you were.

### Links that open a specific view

| Parameter | Example | |
|---|---|---|
| `hood` | `?hood=japantown` | Start in a district (`downtown`, `japantown`, `oldtown`, `lemarais`, `docklands`) |
| `time` | `?time=night` | `cycle`, `dusk`, `night`, `dawn`, `day` |
| `weather` | `?weather=snow` | `clear`, `rain`, `snow`, `fog` |
| `tour` | `?tour=1` | Start the auto tour right away |
| `seed` | `?seed=42` | A different city |
| `cam`, `mode`, `floor`, `hour` | | Written by the share link |

## How it works

- **Rendering** (`src/render/`): a scanline rasterizer fills a frame buffer with one glyph, foreground, background and
  depth per cell. Materials pick characters by how many cells a surface covers, so walls gain window frames and signs
  switch from a glowing bar to real letters to a block font as you get closer. A WebGL2 presenter draws the grid through
  a glyph atlas in a single pass (with a Canvas2D fallback).
- **World** (`src/world/`): the city is infinite and procedural. Each block is a pure function of its coordinates and
  the world seed, generated when it comes into view and forgotten when it is far away, so the same street always looks
  the same and nothing needs to be stored. Traffic, pedestrians, signals, interiors, cats, market stalls and fireworks
  are layered on top.
- **Sound** (`src/audio/`): everything is synthesized with the Web Audio API from oscillators and noise, including the
  radio stations, which are composed a fraction of a second ahead of the audio clock.
- **Quality** (`src/ui/quality.ts`): cell size, draw distance and pixel density adjust themselves to hold the target
  frame rate, so it stays smooth on slower phones.
- **Offline**: the build generates a service worker that precaches every file.

## Run it locally

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests against the production build (Playwright)
npm run build        # type check and build into dist/
```

The first `npm run test:e2e` may ask for `npx playwright install chromium`.

Deployment to GitHub Pages is described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and notes for coding agents are
in [AGENTS.md](AGENTS.md).
