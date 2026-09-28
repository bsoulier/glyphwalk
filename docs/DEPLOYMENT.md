# Deployment

Glyphwalk is a static site. It is published with GitHub Pages at <https://bsoulier.github.io/glyphwalk/> from the
`gh-pages` branch of <https://github.com/bsoulier/glyphwalk>.

## Branches

| Branch | Contents |
|---|---|
| `main` | Source code. All work lands here. |
| `gh-pages` | The built site only: a single commit, replaced on every deploy. Never edit it by hand. |

GitHub Pages is configured to serve `gh-pages` from its root (Settings > Pages > Deploy from a branch).

## Deploying

```sh
npm test && npm run build     # make sure main is green first
git push origin main
npm run deploy                # build and publish to gh-pages
```

`npm run deploy` runs [`scripts/deploy.sh`](../scripts/deploy.sh), which:

1. builds into `dist/`,
2. adds a `.nojekyll` file so Pages serves the files exactly as built,
3. creates a throwaway git repository inside `dist/`, commits everything as `Deploy <main commit>` using this
   repository's git identity, and
4. force-pushes it as the `gh-pages` branch of `origin` (or of the remote name or URL given as an argument:
   `npm run deploy -- <remote-or-url>`).

GitHub rebuilds the site within a minute. Deploying needs push access to `bsoulier/glyphwalk`.

To roll back, check out an older commit of `main` and run `npm run deploy` again.

### Why not GitHub Actions

Deploying from a workflow would rebuild the site on every push, but pushing files under `.github/workflows/` requires a
token with the `workflow` scope, which the current credentials do not have. To switch later: add a workflow that runs
`npm ci && npm run build` and publishes `dist/` with `actions/upload-pages-artifact` and `actions/deploy-pages`, then set
Settings > Pages > Source to "GitHub Actions".

## How the build works on Pages

- **Relative URLs.** `vite.config.ts` sets `base: './'`, so every asset URL is relative and the same build works at the
  project path `/glyphwalk/`, at a domain root, or from any folder.
- **Offline play.** The `offline()` plugin in `vite.config.ts` writes `dist/sw.js` at build time with a precache list of
  every emitted file plus everything in `public/`. The cache name is a hash of that list, and asset names carry content
  hashes, so each deploy that changes anything gets a new cache and the old one is deleted when the new worker
  activates.
  - Pages are fetched network-first (updates arrive as soon as someone is online); assets are served from the cache.
  - Cache lookups ignore `Vary`, because module scripts send an `Origin` header the precache requests did not.
  - Every file in `public/` is precached, and one failed download aborts the worker's install. Only put files there
    that the host actually serves (no dotfiles).
- **Installable app.** `public/manifest.webmanifest` and the icons in `public/` make it installable on Android and
  desktop; iOS uses the `apple-touch-icon` and meta tags in `index.html`.

## Build settings

[`.env.production`](../.env.production) holds the two settings baked into the published build. Both are public (they
end up in the page); left empty, the feature is off.

| Setting | What it turns on |
|---|---|
| `VITE_ONLINE_URL` | Playing online, through the server in `server/` ([ONLINE.md](ONLINE.md) covers deploying it). |
| `VITE_GOATCOUNTER` | Usage counts on [GoatCounter](https://www.goatcounter.com). |

### Usage counts (GoatCounter)

GoatCounter counts visits without cookies or personal data, so no consent banner is needed. The game does not load
GoatCounter's script: [`src/ui/analytics.ts`](../src/ui/analytics.ts) requests their counting endpoint directly.

1. Sign up at <https://www.goatcounter.com> and pick a code, e.g. `glyphwalk` (the dashboard is then
   `https://glyphwalk.goatcounter.com`).
2. Set `VITE_GOATCOUNTER=glyphwalk` in `.env.production`, commit, and `npm run deploy`.

It counts one visit per page load and, as events, the first time in a visit that someone enters each district, uses
each camera mode, rides a taxi, finds a cat, saves a photo or GIF, shares a link, starts the tour, goes online, or
sends an emote. Nothing is counted in development, on `localhost`, in automated browsers, or when the browser sends
Do Not Track or Global Privacy Control.

## Checking a deploy

```sh
curl -sI https://bsoulier.github.io/glyphwalk/ | head -1          # HTTP/2 200
curl -s https://bsoulier.github.io/glyphwalk/sw.js | head -3      # new cache name after a change
```

Then open the site, and after one visit reload with the network off: it should still load. `npm run test:e2e` runs the
same checks locally against a production build.

## Commit identity

Every commit on this repository, including the `gh-pages` deploy commit, must be authored and committed as
`Benjamin Soulier <benjamin.soulier@gmail.com>`. It is set in this repository's local git config:

```sh
git config user.name "Benjamin Soulier"
git config user.email benjamin.soulier@gmail.com
```

The deploy script reads that identity, so a different global git identity on the machine is never used for the site.
