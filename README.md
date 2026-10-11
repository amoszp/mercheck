<p align="center">
  <img src="public/pwa-512x512.png" width="120" alt="Mercheck icon" />
</p>

<h1 align="center">Mercheck</h1>

<p align="center">
  A calm, glassy, mobile-first home for every checklist you keep in your head.
</p>

## What it's for

Most list apps assume you only need one kind of list. Mercheck doesn't — it's a home for **all** of them, side by side, each one just a tap away:

- 🛒 **The weekly supermarket run** — check items off as you drop them in the cart
- 🏠 **Things the house needs** — light bulbs, batteries, whatever's run out
- ✈️ **Packing for a trip** — never re-derive "did I bring a charger?" at the airport again
- 🐾 **Supplies for your pets** — food, litter, meds, on their own list
- 📋 **Literally anything else** — Mercheck doesn't care what's on the list, it just makes it fast to capture, check off, and come back to

The value isn't any single list — it's not having to juggle five different notes apps, or a sticky note that gets lost, to hold them all. Pin the lists you use constantly, tuck away the ones you don't, and everything is right there next time you open the app.

## How it works

- **Multiple lists, one place** — create as many as you need, named however you like
- **Pin your regulars** — keep the lists you touch weekly at the top
- **Inline editing** — rename lists and items in place, no separate edit screen
- **Installable PWA** — add it to your home screen and it opens like a native app, icon and all
- **Everything stays on your device** — data lives in the browser's local storage; no account, no server, no sign-up

## Stack

- **React 18** + **Vite 6** for the app shell and build
- **Tailwind CSS** for styling
- **Framer Motion** for the list/item animations
- **Lucide React** for icons
- **vite-plugin-pwa** — installable PWA with an auto-updating service worker and manifest (standalone display, portrait orientation)
- Data is persisted in `localStorage` (see `src/lib/storage.js` and `src/lib/useLists.js`)

## Project structure

```
src/
  App.jsx              — root component
  components/          — ActionMenu, Dock, InlineEdit, ItemRow, ListCard, SettingsMenu, Toast
  lib/                  — ids, settings, storage, useDismiss, useLists
  initialData.js        — default lists/items on first run
```

## Development

```bash
npm install
npm run dev       # start the dev server
npm run build     # production build to dist/
npm run preview   # preview the production build locally
```

## Deployment

A multi-stage `Dockerfile` is included: it builds the app with Node and serves the static output from `dist/` via Nginx (`EXPOSE 80`).

Every push to `main` builds the image with GitHub Actions and publishes it to GitHub Container Registry. `docker-compose.yml` runs that prebuilt image:

```bash
docker compose pull
docker compose up -d
```

The app is then served on port `1102` (change the left side of `ports` to use another). Pair it with a container auto-updater such as Watchtower to pick up new images automatically.
