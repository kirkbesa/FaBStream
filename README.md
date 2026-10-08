# FaBStream

A local broadcast production tool for **Flesh and Blood** tournaments.
Card data comes from the open **[FaB card dataset](https://github.com/the-fab-cube/flesh-and-blood-cards)**,
with Legend Story Studios' **[official card database](https://cardvault.fabtcg.com)**
filling in cards from sets newer than the dataset. Everything is cached to disk,
so no card assets ship with this app — and once a deck has been imported, the
venue Wi-Fi dropping can't blank an overlay.

Built around how a FaB match reads on stream: each player's hero, both life
totals, the round timer, a featured card, and — for best-of-three matches — the
games score.

---

## Requirements

**Node.js 18 or higher** — download from https://nodejs.org (choose the LTS version).
An internet connection is needed on the first run (to download the card data,
about 25 MB) and the first time each card image is shown; after that it's all
served from the local cache.

---

## Setup & running

- **Mac**: double-click `start.command` (first time: right-click → Open)
- **Windows**: double-click `start.bat`

On first launch the script installs dependencies (~30 seconds). The control panel
opens at **http://localhost:3001**.

To run on another port (e.g. next to another stream tool on 3001):

```
PORT=3002 npm start               # Mac / Linux / Git Bash
$env:PORT=3002; npm start         # Windows PowerShell
```

The panel, overlays and LAN pages all follow whichever port the server is on.

For panel development with hot-reload (panel on :5173, server on :3001):

```
npm start      # terminal 1 — server
npm run dev    # terminal 2 — Vite panel with HMR
```

After editing anything under `control/`, rebuild the panel: `npm run build`.
Overlays are plain HTML and hot-reload in OBS automatically on save.

---

## OBS Browser Sources

All at 1920×1080, transparent background:

| Overlay      | URL                                        | What it is |
|--------------|--------------------------------------------|------------|
| **Matchup**  | http://localhost:3001/overlays/matchup     | **The full-frame layout.** Left rail: round timer, games score (best-of-three only) and the featured card. Right rail, mirrored to match the table: P1 name · cam · hero card, both life totals, P2 hero card · cam · name. The centre is clear for the overhead table feed. |
| Decklist     | http://localhost:3001/overlays/decklist    | One player's list as a text sidebar, right of screen |
| Deck Reveal  | http://localhost:3001/overlays/deckreveal  | Full-screen deck reveal — card grid by pitch, cost curve, type + pitch breakdown |
| Standings    | http://localhost:3001/overlays/standings   | Top-8 standings table |
| Timer        | http://localhost:3001/overlays/timer       | Standalone round timer, for scenes without the matchup |
| Broadcaster  | http://localhost:3001/overlays/broadcaster | Caster lower-third |
| Panelists    | http://localhost:3001/overlays/panelists   | Panel / desk lower-third |
| Bracket      | http://localhost:3001/overlays/bracket     | Top-8 single-elim bracket |

`OBS/FaBStream-scene-collection.json` has all of these set up as one scene: in
OBS, **Scene Collection → Import**, pick the file, then select it from the Scene
Collection menu.

The **Matchup** overlay reserves a `P1 Cam` / `P2 Cam` box in the right rail — put
your player video sources *behind* the overlay and line them up with those
cut-outs (crop them to 2:1). No player cams? Switch **Player cams** off in the
panel's On-air bar and the hero cards grow into the space.

Share these over the venue LAN (the panel header shows the IP):

| Page           | Who for                          |
|----------------|----------------------------------|
| `/commentator` | Casters — both decklists, life totals, feature a card on stream |
| `/table`       | Players & judge — tap life (and games) from the table |

---

## Running a match

On the **Match tab**:

- **Match** — *Best of 1* (the default for FaB events) or *Best of 3* (World
  Championship top 8, or any event that announces it). Best of 3 shows the games
  score on the overlay and the games counters in the panel and table page.
- **Hero** — once the player has a decklist, their hero is one click from the
  dropdown; **Search all cards…** finds any other. Setting a hero sets the
  starting life from the card (40 for an adult hero, ~20 for a young one).
- **Life** — `−5 −1 +1 +5`, and **Reset** back to the hero's starting life.
  Adjustable from the panel or the table page.
- **Featured card** — click any card in a decklist, the Cards tab, or the
  commentator page to put it on the matchup's left rail. **Clear featured card**
  in the On-air bar takes it down.

**New Game** puts both players back to their hero's starting life and clears the
play/draw marker, keeping names, heroes, decklists, records and the games score.
**Reset Match** clears the slot entirely.

---

## Decklists & roster

Paste a decklist per player (Match tab → **Import**), or bulk-import a whole
tournament field on the **Roster tab** (CSV / JSON / text — format auto-detected).
Every card line is resolved before it goes live and shown for review.

The official decklist text — from a fabtcg.com decklist page, or GEM's "Import to
GEM" — works unchanged: a `Hero / Weapon / Equipment` section, then cards under
`Pitch 1` / `Pitch 2` / `Pitch 3`, each written like `3x Command and Conquer (red)`.
Pitch is part of a card's identity, so keep the `(red)` / `(yel)` / `(blu)`.
See `samples/IMPORT-FORMAT.md` for every accepted shape.

`samples/` also holds two real events to test with (kept out of git — they're
real players): **Calling: Kansas City 2026** (Classic Constructed, top 8 + 4) and
**Sunday Showdown: Bilbao 2026** (Silver Age).

---

## Card data

| Source | Used for |
|---|---|
| [the-fab-cube/flesh-and-blood-cards](https://github.com/the-fab-cube/flesh-and-blood-cards) | Every card — downloaded once to `.cache/cards.json`, refreshed in the background weekly |
| [cardvault.fabtcg.com](https://cardvault.fabtcg.com) | Cards from sets newer than the dataset, looked up by name when the dataset misses; kept in `.cache/extra-cards.json` |

Environment variables override the defaults (see `server/fab.js`):

```
FAB_CARDS_URL=…        # point the dataset download at a mirror or pinned release
FAB_CARDVAULT_API=…    # the official database's API base
FAB_FORMAT=Blitz       # label shown in the panel/logs
```

---

## Card cache

Card data and images are cached in `.cache/` (`cards.json`, `extra-cards.json`,
`img/*.webp`). Importing decklists *before* the event caches every card image the
broadcast will show, which makes it resilient to the venue Wi-Fi dropping.
Deleting `.cache/` is always safe; it just re-downloads.

---

## Folder structure

```
FaBStream/
├── .cache/         ← Card data + image cache (auto-created)
├── events/         ← Saved event files (auto-created)
├── autosave/       ← 5-min rolling + 30-min timestamped auto-saves
├── samples/        ← Roster import spec + templates (+ real events, git-ignored)
├── server/
│   ├── fab.js        Card data: dataset index, official-database fallback, image cache
│   ├── decklist.js   Decklist parsing → hero / weapons + equipment / deck / sideboard
│   ├── roster.js     Bulk tournament import
│   ├── state.js      Broadcast state + event persistence
│   └── index.js      HTTP + WebSocket
├── overlays/       ← OBS overlay pages (matchup is the main one)
├── commentator/    ← Casters' page
├── table/          ← Players' & judge's life-tracking page
├── control/        ← Control panel source (React)
├── dist/control/   ← Built control panel — run `npm run build` after editing
├── OBS/            ← Importable OBS scene collection
├── start.command   ← Mac launcher
└── start.bat       ← Windows launcher
```

---

## Stopping the server

Press **Ctrl+C** in the terminal window, or close it.
