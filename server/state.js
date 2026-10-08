import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const EVENTS_DIR   = join(__dirname, '..', 'events')
const AUTOSAVE_DIR = join(__dirname, '..', 'autosave')
const OBS_DIR      = join(__dirname, '..', 'OBS')

const wsClients = new Set()

// ── Flesh and Blood scoring ─────────────────────────────────────
// Two independent counters per player:
//   life      — the live game. Starts at the hero's printed life (40 for an adult
//               Classic Constructed hero, ~20 for a young Blitz / Silver Age
//               hero) and the game ends at 0. The matchup overlay's centrepiece.
//   gameScore — games won this match. Matches are best-of-one by default (FaB
//               Tournament Rules 3.1); a match set to bestOf: 3 — World
//               Championship top 8, or anything the TO announces — shows it.
export const GAMES_TO_WIN = 2
export const DEFAULT_LIFE = 40    // until a hero is set
export const MAX_LIFE     = 99

const startingLife = (hero) => (Number.isFinite(hero?.life) ? hero.life : DEFAULT_LIFE)

const defaultPlayer = () => ({
  name: '', handle: '', pronouns: '',
  record: { w: 0, l: 0, d: 0 },
  // The player's hero: a resolved card object ({ identifier, name, life,
  // intellect, imageUrl … }) or null. Its printed life is the starting life.
  hero: null,
  deckName: '', decklist: null,
  life: DEFAULT_LIFE,
  gameScore: 0,    // 0..2 — games won, when the match is best-of-three
  notes: '',
})

// 50 minutes — a common round length; adjust per event from the Timer panel.
const defaultTimer = () => ({
  duration: 3000, running: false, startedAt: null, accumulated: 0,
})

const defaultStandings = () =>
  Array.from({ length: 8 }, () => ({ name: '', deckName: '', record: { w: 0, l: 0, d: 0 } }))

const defaultOverlay = () => ({
  // The signature full-frame matchup overlay: timer + featured card on the left
  // rail; each player's name, cam and hero on the right, with both life totals
  // between the heroes.
  matchupVisible: true,
  // The P1 / P2 camera cut-outs inside the matchup overlay. Off for events with
  // no player cams — the hero cards grow into the space.
  playerCamsVisible: true,
  // The featured card on the matchup's left rail — a card id, set from the
  // panel's Cards tab, a decklist, or the commentator page. (Named cardZoom for
  // the overlay-state key every page already uses.)
  cardZoom: null,
  decklistActive: null,
  deckRevealActive: null,
  standingsVisible: false,
  timerVisible: false,
  broadcasterVisible: false,
  panelistVisible: false,
})

const defaultBroadcaster = () => ({ name: '', handle: '', pronouns: '' })

const defaultBracket = () => ({
  active: false,
  label: 'TOP 8 BRACKET',
  rounds: [
    [
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
    ],
    [
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
    ],
    [
      { a: null, b: null, winner: null, scoreA: 0, scoreB: 0 },
    ],
  ],
})

const MATCH_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

export const defaultMatchSlot = (id = 'A') => ({
  id,
  label: `Feature Match ${id}`,
  // onThePlay: 'p1' | 'p2' | null — who went first this game.
  // bestOf: 1 | 3 — FaB matches are a single game unless announced otherwise.
  match: { round: '1', format: 'swiss', bestOf: 1, onThePlay: null, notes: '' },
  players: [defaultPlayer(), defaultPlayer()],
  timer: defaultTimer(),
})

// ── Initial state ───────────────────────────────────────────────
let state = migrate({
  activeMatchIndex: 0,
  matches: [defaultMatchSlot('A')],
  eventName: '',
  broadcasters: [defaultBroadcaster(), defaultBroadcaster()],
  panelists: [defaultBroadcaster(), defaultBroadcaster()],
  overlay: defaultOverlay(),
  standings: defaultStandings(),
  bracket: defaultBracket(),
  roster: [],
})

// The hero and decklists are stored FULLY RESOLVED — each card carries its
// name, type, pitch, stats and image URL — so
// overlays render straight from state with no lookups even if the venue network
// dies mid-match.

// ── Migration ───────────────────────────────────────────────────
function migrate(s) {
  if (!Array.isArray(s.matches) || s.matches.length === 0) {
    s.matches = [defaultMatchSlot('A')]
    s.activeMatchIndex = 0
  }

  for (const slot of s.matches) {
    if (!slot.timer)                           slot.timer         = defaultTimer()
    if (!slot.match)                           slot.match         = defaultMatchSlot(slot.id).match
    if (!slot.match.round)                     slot.match.round   = '1'
    if (slot.match.format       == null)       slot.match.format  = 'swiss'
    if (slot.match.notes        === undefined) slot.match.notes   = ''
    if (slot.match.onThePlay    === undefined) slot.match.onThePlay = null
    if (![1, 3].includes(slot.match.bestOf))    slot.match.bestOf  = 1

    if (!Array.isArray(slot.players)) slot.players = [defaultPlayer(), defaultPlayer()]
    while (slot.players.length < 2)   slot.players.push(defaultPlayer())

    for (const p of slot.players) {
      if (p.gameScore == null) p.gameScore = 0
      if (p.notes     == null) p.notes     = ''
      if (p.deckName  == null) p.deckName  = ''
      if (p.hero === undefined) p.hero = null
      if (!Number.isFinite(p.life)) p.life = startingLife(p.hero)
      if (!p.record)           p.record    = { w: 0, l: 0, d: 0 }
      if (p.record.d  == null) p.record.d  = 0
    }
  }

  if (!s.overlay) s.overlay = defaultOverlay()
  if (s.overlay.matchupVisible    == null) s.overlay.matchupVisible    = true
  if (s.overlay.playerCamsVisible == null) s.overlay.playerCamsVisible = true
  if (s.overlay.cardZoom          === undefined) s.overlay.cardZoom    = null
  if (Array.isArray(s.overlay.decklistActive)) {
    s.overlay.decklistActive = s.overlay.decklistActive.length
      ? s.overlay.decklistActive[s.overlay.decklistActive.length - 1]
      : null
  } else if (!Number.isFinite(s.overlay.decklistActive)) {
    s.overlay.decklistActive = null
  }
  if (s.overlay.deckRevealActive  === undefined) s.overlay.deckRevealActive = null
  if (s.overlay.standingsVisible  == null) s.overlay.standingsVisible  = false
  if (s.overlay.timerVisible      == null) s.overlay.timerVisible      = false
  if (s.overlay.broadcasterVisible == null) s.overlay.broadcasterVisible = false
  if (s.overlay.panelistVisible    == null) s.overlay.panelistVisible    = false

  if (!s.broadcasters) s.broadcasters = [defaultBroadcaster(), defaultBroadcaster()]
  while (s.broadcasters.length < 2) s.broadcasters.push(defaultBroadcaster())
  for (const b of s.broadcasters) {
    if (b.name     == null) b.name     = ''
    if (b.handle   == null) b.handle   = ''
    if (b.pronouns == null) b.pronouns = ''
  }

  if (!s.panelists) s.panelists = [defaultBroadcaster(), defaultBroadcaster()]
  while (s.panelists.length < 2) s.panelists.push(defaultBroadcaster())
  for (const p of s.panelists) {
    if (p.name     == null) p.name     = ''
    if (p.handle   == null) p.handle   = ''
    if (p.pronouns == null) p.pronouns = ''
  }

  if (s.eventName === undefined) s.eventName = ''
  if (!Array.isArray(s.roster)) s.roster = []

  if (!Array.isArray(s.standings)) s.standings = defaultStandings()
  for (const row of s.standings) {
    if (row.deckName  == null) row.deckName  = ''
    if (!row.record)           row.record    = { w: 0, l: 0, d: 0 }
    if (row.record.d  == null) row.record.d  = 0
  }

  if (!s.bracket) s.bracket = defaultBracket()
  if (s.bracket.label  == null) s.bracket.label  = 'TOP 8 BRACKET'
  if (s.bracket.active == null) s.bracket.active = false
  if (!Array.isArray(s.bracket.rounds) || s.bracket.rounds.length < 3) {
    s.bracket.rounds = defaultBracket().rounds
  }
  for (const round of s.bracket.rounds) {
    for (const match of round) {
      if (match.scoreA == null) match.scoreA = 0
      if (match.scoreB == null) match.scoreB = 0
    }
  }

  return s
}

// ── Exports ─────────────────────────────────────────────────────
export function getState() {
  return state
}

export function getLiveState() {
  const { roster, ...live } = state
  return live
}

export function getRoster() {
  return state.roster
}

export function setState(newState) {
  state = migrate(newState)
  broadcast()
  broadcastRoster()
  writeObsFiles(state.bracket)
}

// ── Per-slot patches ─────────────────────────────────────────────
export function patchMatchAt(matchIndex, patch) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  slot.match = { ...slot.match, ...patch }
  broadcast()
}

export function patchPlayerAt(matchIndex, playerIndex, patch) {
  const slot = state.matches[matchIndex]
  if (!slot || playerIndex < 0 || playerIndex > 1) return
  const prev = slot.players[playerIndex]
  const next = { ...prev, ...patch }
  // A new hero means a new starting life — unless the patch sets life itself.
  if ('hero' in patch && patch.hero?.identifier !== prev.hero?.identifier && !('life' in patch)) {
    next.life = startingLife(next.hero)
  }
  slot.players[playerIndex] = next
  broadcast()
}

export function patchTimerAt(matchIndex, action, value) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  if (!slot.timer) slot.timer = defaultTimer()
  const t = slot.timer, now = Date.now()
  switch (action) {
    case 'start':    if (!t.running) { t.running = true; t.startedAt = now } break
    case 'pause':    if (t.running)  { t.accumulated += (now - t.startedAt) / 1000; t.running = false; t.startedAt = null } break
    case 'reset':    t.running = false; t.startedAt = null; t.accumulated = 0; break
    case 'setDuration': t.duration = Math.max(60, Math.round(Number(value))); t.running = false; t.startedAt = null; t.accumulated = 0; break
  }
  broadcast()
}

export function resetMatchAt(matchIndex) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  state.matches[matchIndex] = { ...defaultMatchSlot(slot.id), label: slot.label }
  broadcast()
}

export function swapPlayersAt(matchIndex) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  slot.players = [{ ...slot.players[1] }, { ...slot.players[0] }]
  broadcast()
}

// ── Counters (life / gameScore) ──────────────────────────────────
// life is floored at 0 (the game is over) and capped well above any hero's
// printed life, since gaining life is common; gameScore is games won.
const COUNTERS = {
  life:      { min: 0, max: MAX_LIFE },
  gameScore: { min: 0, max: GAMES_TO_WIN },
}

function clampCounter(counter, v) {
  const c = COUNTERS[counter]
  return Math.max(c.min, Math.min(c.max, v))
}

// Relative adjustment, because a life tap arrives as "-3" from a table-side
// tap. Sending an absolute total instead would race two simultaneous taps.
export function adjustCounterAt(matchIndex, playerIndex, counter, delta) {
  if (!COUNTERS[counter]) return
  const slot = state.matches[matchIndex]
  if (!slot || playerIndex < 0 || playerIndex > 1) return
  const p = slot.players[playerIndex]
  p[counter] = clampCounter(counter, (p[counter] ?? 0) + Number(delta))
  broadcast()
}

export function setCounterAt(matchIndex, playerIndex, counter, value) {
  if (!COUNTERS[counter]) return
  const slot = state.matches[matchIndex]
  if (!slot || playerIndex < 0 || playerIndex > 1) return
  const v = Number(value)
  if (!Number.isFinite(v)) return
  slot.players[playerIndex][counter] = clampCounter(counter, v)
  broadcast()
}

// Start the next game: both players back to their hero's starting life, and
// the play/draw marker cleared. Names, heroes, decklists, records and the game
// score persist across games within a match.
export function newGameAt(matchIndex) {
  const slot = state.matches[matchIndex]
  if (!slot) return
  for (const p of slot.players) p.life = startingLife(p.hero)
  slot.match.onThePlay = null
  broadcast()
}

export function patchOverlay(patch) {
  state.overlay = { ...state.overlay, ...patch }
  broadcast()
}

export function setStandings(standings) {
  state.standings = standings
  broadcast()
}

export function setBracket(bracket) {
  state.bracket = bracket
  broadcast()
  writeObsFiles(bracket)
}

export function patchEventName(name) {
  state.eventName = name
  broadcast()
}

export function patchBroadcaster(index, patch) {
  if (index < 0 || index > 1) return
  state.broadcasters[index] = { ...state.broadcasters[index], ...patch }
  broadcast()
}

export function patchPanelist(index, patch) {
  if (index < 0 || index > 1) return
  state.panelists[index] = { ...state.panelists[index], ...patch }
  broadcast()
}

// ── Multi-match management ───────────────────────────────────────
export function setActiveMatchIndex(index) {
  if (index < 0 || index >= state.matches.length) return
  state.activeMatchIndex = index
  state.overlay.decklistActive   = null
  state.overlay.deckRevealActive = null
  state.overlay.cardZoom         = null
  broadcast()
}

export function addMatch() {
  const used    = new Set(state.matches.map(m => m.id))
  const id      = MATCH_IDS.find(x => !used.has(x)) ?? `Match${state.matches.length + 1}`
  state.matches.push(defaultMatchSlot(id))
  broadcast()
  return id
}

export function removeMatch(index) {
  if (state.matches.length <= 1) return
  state.matches.splice(index, 1)
  if (state.activeMatchIndex >= state.matches.length) {
    state.activeMatchIndex = state.matches.length - 1
  }
  broadcast()
}

export function renameMatch(index, label) {
  if (!state.matches[index]) return
  state.matches[index].label = label
  broadcast()
}

// ── Roster (the tournament field) ────────────────────────────────
export function setRoster(players) {
  state.roster = players
  broadcastRoster()
}

export function clearRoster() {
  state.roster = []
  broadcastRoster()
}

export function seatPlayer(matchIndex, playerIndex, rosterIndex) {
  const slot = state.matches[matchIndex]
  const r    = state.roster[rosterIndex]
  if (!slot || !r || playerIndex < 0 || playerIndex > 1) return

  slot.players[playerIndex] = playerFromRoster(r)
  broadcast()
}

function playerFromRoster(r) {
  return {
    ...defaultPlayer(),
    name:        r.name        ?? '',
    handle:      r.handle      ?? '',
    pronouns:    r.pronouns    ?? '',
    deckName:    r.deckName    ?? '',
    decklist:    r.decklist    ?? null,
    hero:        r.hero        ?? null,
    life:        startingLife(r.hero),
    record:      r.record      ?? { w: 0, l: 0, d: 0 },
  }
}

export function castBracketMatch(roundIndex, matchIndex, targetMatchIndex) {
  const m    = state.bracket?.rounds?.[roundIndex]?.[matchIndex]
  const slot = state.matches[targetMatchIndex]
  if (!m || !slot) return

  ;['a', 'b'].forEach((side, pi) => {
    const entry = m[side]
    if (!entry) return

    const r = Number.isFinite(entry.rosterIndex) ? state.roster[entry.rosterIndex] : null
    slot.players[pi] = r
      ? playerFromRoster(r)
      : { ...defaultPlayer(), name: entry.name ?? '', deckName: entry.deckName ?? '' }
  })

  // Carry the bracket's game score over so a cast match doesn't reset 1-0 to 0-0.
  slot.players[0].gameScore = m.scoreA ?? 0
  slot.players[1].gameScore = m.scoreB ?? 0

  broadcast()
}

const TOP8_PAIRS = [[1, 8], [4, 5], [3, 6], [2, 7]]

export function seedBracketFromRoster() {
  const bySeed = new Map()
  for (let i = 0; i < state.roster.length; i++) {
    const r = state.roster[i]
    if (Number.isFinite(r.place) && r.place >= 1 && r.place <= 8) {
      bySeed.set(r.place, { ...bracketSlot(r), rosterIndex: i })
    }
  }
  if (bySeed.size === 0) return

  const fresh = defaultBracket()
  fresh.label  = state.bracket.label
  fresh.active = state.bracket.active

  TOP8_PAIRS.forEach(([seedA, seedB], i) => {
    fresh.rounds[0][i].a = bySeed.get(seedA) ?? null
    fresh.rounds[0][i].b = bySeed.get(seedB) ?? null
  })

  state.bracket = fresh
  broadcast()
  writeObsFiles(state.bracket)
}

const bracketSlot = (r) => ({
  name:     r.name     ?? '',
  deckName: r.deckName ?? '',
  seed:     Number.isFinite(r.place) ? r.place : null,
})

export function seedStandingsFromRoster() {
  const placed = state.roster
    .filter(r => Number.isFinite(r.place))
    .sort((a, b) => a.place - b.place)
    .slice(0, state.standings.length)

  if (placed.length === 0) return

  state.standings = state.standings.map((row, i) => {
    const r = placed[i]
    if (!r) return { name: '', deckName: '', record: { w: 0, l: 0, d: 0 } }
    return {
      name:     r.name     ?? '',
      deckName: r.deckName ?? '',
      record:   r.record   ?? { w: 0, l: 0, d: 0 },
    }
  })
  broadcast()
}

// ── WebSocket clients ───────────────────────────────────────────
export function addClient(ws) {
  wsClients.add(ws)
  ws.send(JSON.stringify({ type: 'state', data: getLiveState(), clientCount: wsClients.size }))
}

export function removeClient(ws) {
  wsClients.delete(ws)
  broadcast()
}

export function broadcast() {
  const msg = JSON.stringify({ type: 'state', data: getLiveState(), clientCount: wsClients.size })
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg)
  }
}

export function broadcastRoster() {
  broadcastEvent('roster', getRoster())
}

export function broadcastEvent(type, data) {
  const msg = JSON.stringify({ type, data })
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg)
  }
}

// ── Event file persistence ──────────────────────────────────────
export function saveEvent(name) {
  ensureEventsDir()
  const id    = slugify(name) + '-' + Date.now()
  const event = { id, name, savedAt: new Date().toISOString(), state: getState() }
  writeFileSync(join(EVENTS_DIR, `${id}.json`), JSON.stringify(event, null, 2))
  return event
}

export function listEvents() {
  ensureEventsDir()
  return readdirSync(EVENTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const ev = JSON.parse(readFileSync(join(EVENTS_DIR, f), 'utf8'))
        return { id: ev.id, name: ev.name, savedAt: ev.savedAt }
      } catch { return null }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
}

export function loadEvent(id) {
  ensureEventsDir()
  const path = join(EVENTS_DIR, `${id}.json`)
  if (!existsSync(path)) return null
  const ev = JSON.parse(readFileSync(path, 'utf8'))
  state = migrate(ev.state)
  broadcast()
  broadcastRoster()
  writeObsFiles(state.bracket)
  return ev
}

export function deleteEvent(id) {
  const path = join(EVENTS_DIR, `${id}.json`)
  if (existsSync(path)) unlinkSync(path)
}

// ── Auto-save ────────────────────────────────────────────────────
export function autoSave(kind) {
  try {
    if (!existsSync(AUTOSAVE_DIR)) mkdirSync(AUTOSAVE_DIR, { recursive: true })
    const now      = new Date()
    const ts       = now.toISOString().replace(/T/, '_').replace(/:/g, '-').slice(0, 19)
    const filename = kind === 'short'
      ? 'AutoSave-FaBBroadcast_latest.json'
      : `AutoSave-FaBBroadcast_${ts}.json`
    const payload  = { name: 'AutoSave', savedAt: now.toISOString(), kind, state: getState() }
    writeFileSync(join(AUTOSAVE_DIR, filename), JSON.stringify(payload, null, 2))
    return filename
  } catch (err) {
    console.error('[autosave] Failed:', err.message)
    return null
  }
}

function ensureEventsDir() {
  if (!existsSync(EVENTS_DIR)) mkdirSync(EVENTS_DIR, { recursive: true })
}

// ── OBS text-file sync ──────────────────────────────────────────
function writeObsFiles(bracket) {
  try {
    if (!existsSync(OBS_DIR)) mkdirSync(OBS_DIR, { recursive: true })
    const finalMatch = bracket?.rounds?.[2]?.[0]
    const champ      = finalMatch?.winner ? finalMatch[finalMatch.winner] : null
    writeFileSync(join(OBS_DIR, 'champion.txt'),      champ?.name     ?? '', 'utf8')
    writeFileSync(join(OBS_DIR, 'champion-deck.txt'), champ?.deckName ?? '', 'utf8')
  } catch (err) {
    console.error('[OBS] Failed to write champion files:', err.message)
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}