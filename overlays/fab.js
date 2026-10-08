// overlays/fab.js — Flesh and Blood rendering primitives shared by the overlays
// and the commentator page.
//
// Loaded the same way as ws.js:
//   <script src="/overlays/fab.js"></script>
//
// Exposes window.FAB with:
//   PITCH_COLORS     card colour → hex (keep in step with server/fab.js)
//   PITCH_ORDER      [colour, label] in the order an official list prints them
//   typeColor(t)     accent colour for a card type
//   cardAccent(card) a card's pitch colour, or its type's when it has none
//   groupByPitch(rows), sortRows(rows)
//   curve(rows)      deck rows → cost-curve buckets
//   pitchBreakdown(rows) → card counts per pitch colour
//   deckCount(deck), arenaCount(deck)
//   MAX_COPIES       copies of one card a Classic Constructed deck may run

;(function () {
  const PITCH_COLORS = {
    Red:    '#c8312b',
    Yellow: '#e2b23a',
    Blue:   '#2f6fb5',
    '':     '#8a8f96',
  }

  const PITCH_ORDER = [
    ['Red',    'Pitch 1 · Red'],
    ['Yellow', 'Pitch 2 · Yellow'],
    ['Blue',   'Pitch 3 · Blue'],
    ['',       'No pitch'],
  ]

  const TYPE_COLORS = {
    'Hero':              '#c9a45c',
    'Demi-Hero':         '#c9a45c',
    'Weapon':            '#b04a3c',
    'Equipment':         '#7f8a96',
    'Attack Action':     '#c8312b',
    'Non-Attack Action': '#d07b2c',
    'Instant':           '#2f6fb5',
    'Attack Reaction':   '#a33d6e',
    'Defense Reaction':  '#3f8f6a',
    'Block':             '#5f7f9a',
    'Token':             '#8b6f47',
  }

  const MAX_COPIES = 3

  const typeColor  = (t) => TYPE_COLORS[t] ?? '#8a8f96'
  const cardAccent = (c) => (c?.color ? PITCH_COLORS[c.color] : typeColor(c?.type))

  // [label, rows, colour] per pitch, in PITCH_ORDER, skipping empty groups.
  function groupByPitch(rows) {
    return PITCH_ORDER
      .map(([color, label]) => [label, rows.filter(r => (r.color ?? '') === color), PITCH_COLORS[color]])
      .filter(([, group]) => group.length > 0)
  }

  // How a player reads their own list: the 3-ofs first, then up the cost curve.
  const sortRows = (rows) =>
    [...rows].sort((a, b) =>
      b.count - a.count || (a.cost ?? 0) - (b.cost ?? 0) ||
      (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name))

  // Cost curve over the deck. Cards with no cost (most equipment) are left
  // out rather than piled into the 0 bucket; 6+ is one bucket.
  function curve(rows) {
    const buckets = [0, 0, 0, 0, 0, 0, 0]   // index = cost, 6 = "6+"
    for (const r of rows) {
      if (r.cost == null) continue
      buckets[Math.min(Math.max(0, Math.round(r.cost)), 6)] += r.count
    }
    return buckets
  }

  function pitchBreakdown(rows) {
    const out = {}
    for (const r of rows) {
      const label = r.color || 'No pitch'
      out[label] = (out[label] ?? 0) + r.count
    }
    return out
  }

  const sum        = (rows) => (rows ?? []).reduce((n, r) => n + r.count, 0)
  const deckCount  = (deck) => sum(deck?.main)
  const arenaCount = (deck) => sum(deck?.arena)

  window.FAB = {
    PITCH_COLORS, PITCH_ORDER, TYPE_COLORS, MAX_COPIES,
    typeColor, cardAccent, groupByPitch, sortRows, curve, pitchBreakdown, deckCount, arenaCount,
  }
})()
