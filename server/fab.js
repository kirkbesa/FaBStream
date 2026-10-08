// server/fab.js — Flesh and Blood card data, held in memory, with card images
// cached to disk. The lookup surface the rest of the server uses:
//
//   loadCards()                 → Promise — load (or first download) the dataset
//   searchCards(query, limit)   → Promise<Card[]>      (name search, for the panel)
//   getCard(identifier)         → Promise<Card | null> (by id, or by display name)
//   getCardsByNames(names)      → Promise<Map(normalizedName → Card)>
//   resolveByDisplayName(name)  → Promise<{ card, suggestions }>
//   resolveImagePath(identifier)→ '/cards/<id>' | null
//
// Two sources:
//
//   1. the-fab-cube's open dataset (github.com/the-fab-cube/flesh-and-blood-cards)
//      — every card in one JSON file. Downloaded once to .cache/cards.json and
//      refreshed in the background once it's a week old, so every lookup is
//      local and instant, and a venue with no Wi-Fi still has every card.
//   2. Legend Story Studios' official card database (cardvault.fabtcg.com),
//      asked only for names the dataset doesn't have — it lags a new set by a
//      few weeks, and those cards are exactly the ones a tournament is playing.
//      Anything found there is kept in .cache/extra-cards.json, so it's an
//      offline lookup from then on too.
//
// Card images live on LSS's public image host. Each is downloaded the first
// time a card is resolved (.cache/img/<id>.webp) and served locally after that.
//
// Pitch matters for identity: "Snatch (red)", "Snatch (yellow)" and "Snatch
// (blue)" are three different cards that share a name. Both sources have one
// entry per pitch, and so does this index — every name lookup takes the pitch
// into account, and a name given WITHOUT a pitch only resolves when exactly one
// version exists. Guessing would put the wrong card on air.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname  = dirname(fileURLToPath(import.meta.url))
const ROOT       = join(__dirname, '..')
const CACHE_DIR  = join(ROOT, '.cache')
const IMG_DIR    = join(CACHE_DIR, 'img')
const DATA_FILE  = join(CACHE_DIR, 'cards.json')
const EXTRA_FILE = join(CACHE_DIR, 'extra-cards.json')

// Overridable so an operator can point at a mirror or a pinned release.
const DATA_URL = process.env.FAB_CARDS_URL
  ?? 'https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json'
const VAULT_API = process.env.FAB_CARDVAULT_API ?? 'https://api.cardvault.fabtcg.com/carddb/api/v1'
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000

const HEADERS = { 'User-Agent': 'FaBStream/1.0 (broadcast overlay tool)', 'Accept': 'application/json' }

// Just a label for the panel and logs (each player's legality isn't enforced).
const FORMAT = process.env.FAB_FORMAT ?? 'Classic Constructed'
export function getFormat() { return FORMAT }

// ── Pitch ────────────────────────────────────────────────────────
// The three pitch colours, as the overlays draw them. Keep in step with
// overlays/fab.js and the panel's control/src/fab.jsx.
export const PITCH_COLORS = {
  Red:    '#c8312b',
  Yellow: '#e2b23a',
  Blue:   '#2f6fb5',
  '':     '#8a8f96',   // no pitch: heroes, weapons, most equipment
}
const COLOR_OF_PITCH = { 1: 'Red', 2: 'Yellow', 3: 'Blue' }

// Every way a decklist writes a pitch → the colour name.
const PITCH_WORDS = {
  red: 'Red', r: 'Red', 1: 'Red',
  yellow: 'Yellow', yel: 'Yellow', y: 'Yellow', 2: 'Yellow',
  blue: 'Blue', blu: 'Blue', b: 'Blue', 3: 'Blue',
}

// fabtcg.com's own decklist pages print some accented names with a broken
// escape — "Jarl Vetreiu00f0i" for "Jarl Vetreiði" — and operators paste those
// lists verbatim. Repair the escape back to its character. Only non-ASCII code
// points are touched, so no ordinary word can be mangled.
export function repairEscapes(s) {
  return String(s ?? '').replace(/\\?u([0-9a-f]{4})/gi, (m, hex) => {
    const code = parseInt(hex, 16)
    return code >= 0x80 ? String.fromCodePoint(code) : m
  })
}

// "Snatch (red)" / "Snatch (yel)" / "Snatch - Blue" / "Snatch: RED" / "Snatch"
// → { name: 'Snatch', color: 'Red' | … | null }. null = no pitch given.
export function splitPitch(raw) {
  const s = repairEscapes(raw).trim()
  const m = s.match(/^(.*?)\s*(?:\(\s*([a-z0-9]+)\s*\)|[-:–]\s*(red|yellow|yel|blue|blu))\s*$/i)
  if (m) {
    const color = PITCH_WORDS[(m[2] ?? m[3]).toLowerCase()]
    if (color) return { name: m[1].trim(), color }
  }
  return { name: s, color: null }
}

// ── Card shape ───────────────────────────────────────────────────
// One normalised card per pitch. `type` is the single category the overlays
// group and colour by.
const TYPE_PRIORITY = [
  'Hero', 'Demi-Hero', 'Weapon', 'Equipment', 'Token',
  'Defense Reaction', 'Attack Reaction', 'Instant', 'Block', 'Resource', 'Mentor', 'Ally',
]
const SLOTS = ['Head', 'Chest', 'Arms', 'Legs', 'Off-Hand']

function primaryType(types) {
  const t = TYPE_PRIORITY.find(t => types.includes(t))
  if (t) return t
  if (types.includes('Action')) return types.includes('Attack') ? 'Attack Action' : 'Non-Attack Action'
  return types[types.length - 1] ?? ''
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))

function makeCard({ identifier, name, color, typeText, types, cost, power, defense, life,
                    intellect, text, legal, setId, landscape, img }) {
  return {
    identifier,
    name,
    color,                                        // 'Red' | 'Yellow' | 'Blue' | ''
    pitch:       { Red: 1, Yellow: 2, Blue: 3 }[color] ?? null,
    pitchColor:  PITCH_COLORS[color] ?? PITCH_COLORS[''],
    displayName: color ? `${name} (${color.toLowerCase()})` : name,

    type:        primaryType(types),
    types,
    typeText,
    slot:        SLOTS.find(s => types.includes(s)) ?? null,   // equipment slot
    young:       types.includes('Young'),

    cost, power, defense,
    life,                                         // heroes: starting life
    intellect,                                    // heroes: cards drawn per turn
    text,
    legal,
    setId,                                        // e.g. "MST131"
    orientation: landscape ? 'landscape' : 'portrait',
    imageUrl:    `/cards/${identifier}`,          // served from our cache
    _img:        img,
  }
}

// The printing whose image represents the card: a standard (non-foil,
// non-alternate-art) print where one exists, else the first with an image.
function pickPrinting(printings) {
  const withImg = printings.filter(p => p.image_url)
  return withImg.find(p => p.foiling === 'S' && !(p.art_variations ?? []).length)
      ?? withImg[0] ?? printings[0] ?? null
}

// From the open dataset.
function fromDataset(raw) {
  const print = pickPrinting(raw.printings ?? [])
  return makeCard({
    identifier: raw.unique_id,
    name:       raw.name,
    color:      raw.color ?? '',
    typeText:   raw.type_text ?? '',
    types:      raw.types ?? [],
    cost: num(raw.cost), power: num(raw.power), defense: num(raw.defense),
    life: num(raw.health), intellect: num(raw.intelligence),
    text:       raw.functional_text_plain ?? '',
    legal: {
      cc:    !!raw.cc_legal    && !raw.cc_banned,
      blitz: !!raw.blitz_legal && !raw.blitz_banned,
      ll:    !!raw.ll_legal    && !raw.ll_banned,
      sa:    !!raw.silver_age_legal && !raw.silver_age_banned,
    },
    setId:      print?.id ?? '',
    landscape:  [90, 270].includes(print?.image_rotation_degrees),
    img:        print?.image_url ?? null,
  })
}

// From the official card database. Its type line is the only type info
// ("Shadow Brute Equipment - Arms"), so the types list is read out of it.
function fromVault(r) {
  const typeText = r.printed_typebox ?? ''
  const types = typeText.replace(/\s+-\s+/, ' ').split(/\s+/).filter(Boolean)
    .reduce((acc, w, i, all) => {
      // Re-join the two-word types the dataset spells with a space.
      const two = `${w} ${all[i + 1] ?? ''}`
      if (['Defense Reaction', 'Attack Reaction'].includes(two)) { acc.push(two); all[i + 1] = '' }
      else if (w) acc.push(w)
      return acc
    }, [])
  const img = r.faces?.[0]?.image ?? {}
  return makeCard({
    identifier: `cv-${r.card_id}`,
    name:       r.printed_name,
    color:      COLOR_OF_PITCH[r.printed_pitch] ?? '',
    typeText, types,
    cost: num(r.printed_cost), power: num(r.printed_power), defense: num(r.printed_defense),
    life: num(r.printed_life), intellect: num(r.printed_intellect),
    text:       String(r.printed_rules_text ?? '').replace(/\{br\}/g, '\n').replace(/[*_]/g, ''),
    legal:      null,                              // not in the search payload
    setId:      r.print_id ?? '',
    landscape:  r.orientation === 'horizontal',
    img:        img.large ?? img.normal ?? img.small ?? null,
  })
}

// ── Index ────────────────────────────────────────────────────────
const byId   = new Map()   // identifier → Card
const byName = new Map()   // normalize(name) → Card[] (one per pitch)
let   extras = []          // cards found in the official database, persisted

// Folds accents and punctuation, so "Jarl Vetreiði" and "jarl vetreidi" meet.
export function normalize(str) {
  return repairEscapes(str).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/æ/g, 'ae').replace(/ø/g, 'o')
    .toLowerCase().replace(/[^a-z0-9]/g, '')
}

function add(card) {
  byId.set(card.identifier, card)
  const key = normalize(card.name)
  const list = byName.get(key) ?? []
  // One card per name + pitch — a later source doesn't duplicate an earlier one.
  if (!list.some(c => c.color === card.color)) list.push(card)
  byName.set(key, list)
}

function index(rawCards) {
  byId.clear(); byName.clear()
  for (const raw of rawCards) add(fromDataset(raw))
  for (const card of extras) add(card)
}

async function download() {
  const res = await fetch(DATA_URL, { headers: HEADERS })
  if (!res.ok) throw new Error(`card data ${res.status}`)
  const text = await res.text()
  const cards = JSON.parse(text)                  // validate before replacing
  writeFileSync(DATA_FILE + '.tmp', text, 'utf8')
  renameSync(DATA_FILE + '.tmp', DATA_FILE)
  return cards
}

// Loads the dataset from disk when there is one (instant, offline-safe), and
// downloads it when there isn't — the first run needs the network once. A copy
// older than a week is used as-is and refreshed in the background, so a new set
// arrives without ever making startup wait on the network.
let ready = Promise.resolve()   // settles once the data is loaded — lookups wait on it

export function loadCards() {
  ready = load()
  return ready
}

async function load() {
  for (const d of [CACHE_DIR, IMG_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true })
  try { extras = JSON.parse(readFileSync(EXTRA_FILE, 'utf8')) } catch { extras = [] }

  if (existsSync(DATA_FILE)) {
    index(JSON.parse(readFileSync(DATA_FILE, 'utf8')))
    console.log(`[fab] ${byId.size} cards loaded (${extras.length} from the official database) · ${FORMAT}`)
    if (Date.now() - statSync(DATA_FILE).mtimeMs > REFRESH_AFTER_MS) {
      download()
        .then(cards => { index(cards); console.log(`[fab] card data refreshed — ${byId.size} cards`) })
        .catch(err => console.warn('[fab] background refresh failed (keeping current data):', err.message))
    }
    return
  }

  console.log('[fab] no card data yet — downloading (one time, ~25 MB)…')
  index(await download())
  console.log(`[fab] ${byId.size} cards downloaded · ${FORMAT}`)
}

// ── Official database fallback ───────────────────────────────────
// Asked only when a name isn't in the index. `name=` is a substring search, so
// the results are filtered to the exact name before anything is kept.
const vaultMisses = new Set()   // names already asked about and not found

async function fromOfficialDatabase(name) {
  const key = normalize(name)
  if (vaultMisses.has(key)) return []
  try {
    const res = await fetch(`${VAULT_API}/advanced-search/?name=${encodeURIComponent(name)}&page_size=50`, { headers: HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const cards = ((await res.json()).results ?? [])
      .filter(r => r.is_published !== false && normalize(r.printed_name) === key)
      .map(fromVault)
    if (!cards.length) { vaultMisses.add(key); return [] }
    for (const card of cards) {
      if ((byName.get(key) ?? []).some(c => c.color === card.color)) continue
      add(card)
      extras.push(card)
    }
    writeFileSync(EXTRA_FILE, JSON.stringify(extras), 'utf8')
    console.log(`[fab] "${name}" — from the official card database (newer than the dataset)`)
    return byName.get(key) ?? []
  } catch (err) {
    console.warn(`[fab] official database lookup for "${name}" failed:`, err.message)
    return []
  }
}

// ── Image caching ────────────────────────────────────────────────
const IMG_CONCURRENCY = 4
const imgInFlight = new Set()
const imgQueue = []
let imgActive = 0

const imgPath = (id) => join(IMG_DIR, `${id}.webp`)

// Fetch a card's image in the background so the next request is served
// locally. Called whenever a card is resolved (decklists, pickers).
export function cacheImage(card) {
  const id = card?.identifier
  if (!id || !card._img || existsSync(imgPath(id)) || imgInFlight.has(id)) return
  imgInFlight.add(id)
  imgQueue.push(card)
  pumpImageQueue()
}

function pumpImageQueue() {
  while (imgActive < IMG_CONCURRENCY && imgQueue.length > 0) {
    const card = imgQueue.shift()
    imgActive++
    downloadImage(card).finally(() => {
      imgActive--
      imgInFlight.delete(card.identifier)
      pumpImageQueue()
    })
  }
}

async function downloadImage(card) {
  try {
    const res = await fetch(card._img, { headers: { 'User-Agent': HEADERS['User-Agent'] } })
    if (!res.ok) return
    writeFileSync(imgPath(card.identifier), Buffer.from(await res.arrayBuffer()))
  } catch (err) {
    console.warn(`[fab] image cache failed for ${card.displayName}:`, err.message)
  }
}

export function getCachedImagePath(id) {
  const p = imgPath(id)
  return existsSync(p) ? p : null
}

export function getRemoteImageUrl(id) {
  return byId.get(id)?._img ?? null
}

// ── Public lookup API ────────────────────────────────────────────
// Name search for the panel. Every pitch of a matching name is its own result,
// ranked exact → word-start → substring. A search that finds nothing locally
// asks the official database, so a brand-new card is still findable.
export async function searchCards(query, limit = 40) {
  await ready.catch(() => {})
  const q = normalize(query)
  if (!q) return []
  let hits = localSearch(query, q)
  if (hits.length === 0) {
    await fromOfficialDatabase(splitPitch(query).name)
    hits = localSearch(query, q)
  }
  return hits.slice(0, limit)
}

function localSearch(query, q) {
  const wordStart = new RegExp(`\\b${escapeRe(String(query).trim())}`, 'i')
  const score = (c) => (normalize(c.name) === q ? 0 : wordStart.test(c.name) ? 1 : 2)
  const hits = []
  for (const [key, cards] of byName) if (key.includes(q)) hits.push(...cards)
  return hits.sort((a, b) =>
    score(a) - score(b) || a.name.localeCompare(b.name) || (a.pitch ?? 0) - (b.pitch ?? 0))
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

export async function getCard(identifier) {
  if (!identifier) return null
  await ready.catch(() => {})
  return byId.get(identifier) ?? (await resolveByDisplayName(identifier)).card
}

// Pick the right pitch out of one name's versions.
//   • a pitch given → that version
//   • no pitch, one version → it
//   • no pitch, several versions → unresolved, suggesting each one
function pickPitch(cards, color) {
  if (color) {
    const hit = cards.find(c => c.color === color)
    return hit ? { card: hit, suggestions: [] } : { card: null, suggestions: cards.map(c => c.displayName) }
  }
  return cards.length === 1
    ? { card: cards[0], suggestions: [] }
    : { card: null, suggestions: cards.map(c => c.displayName) }
}

// Local-only resolution — instant, no network. Exact name, else a near miss
// (a typo or a dropped accent) when one name is clearly closest.
export function resolveLocal(rawName) {
  const { name, color } = splitPitch(rawName)
  const key = normalize(name)
  if (!key) return { card: null, suggestions: [], found: false }

  const exact = byName.get(key)
  if (exact) return { ...pickPitch(exact, color), found: true }

  let best = null, bestScore = Infinity
  for (const [k, cards] of byName) {
    const d = editDistance(k, key, 2)
    if (d < bestScore) { best = cards; bestScore = d }
  }
  if (best && bestScore <= 2) return { ...pickPitch(best, color), found: true }
  return { card: null, suggestions: [], found: false }
}

// Resolve a decklist name like "Command and Conquer (red)": the local index
// first, then the official database for names it doesn't have.
export async function resolveByDisplayName(rawName) {
  await ready.catch(() => {})
  const local = resolveLocal(rawName)
  if (local.found) return remember(local)

  const { name, color } = splitPitch(rawName)
  const official = await fromOfficialDatabase(name)
  if (official.length) return remember(pickPitch(official, color))

  return { card: null, suggestions: suggest(name) }
}

function remember({ card, suggestions }) {
  if (card) cacheImage(card)
  return { card, suggestions }
}

// Suggestions for a name nothing matched: the names sharing the most words
// with it (at least one), longest shared words first.
function suggest(name) {
  const words = new Set(repairEscapes(name).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2))
  if (!words.size) return []
  const scored = []
  for (const cards of byName.values()) {
    const shared = cards[0].name.toLowerCase().split(/[^a-z0-9]+/).filter(w => words.has(w))
    if (shared.length) scored.push([shared.reduce((n, w) => n + w.length, 0), cards[0].name])
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, n]) => n)
}

// Levenshtein distance, giving up (returning cap + 1) once it exceeds `cap` —
// only small distances matter here, and it runs against every name.
function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      rowMin = Math.min(rowMin, cur[j])
    }
    if (rowMin > cap) return cap + 1
    prev = cur
  }
  return prev[b.length]
}

// Resolve many decklist names → Map(normalize(rawName) → Card). Local names
// resolve instantly; the rest go to the official database one at a time.
export async function getCardsByNames(names) {
  const found = new Map()
  for (const name of new Set(names)) {
    const { card } = await resolveByDisplayName(name)
    if (card) found.set(normalize(name), card)
  }
  return found
}

export function resolveImagePath(identifier) {
  return identifier && byId.has(identifier) ? `/cards/${identifier}` : null
}
