// control/src/fab.jsx — Flesh and Blood display primitives for the control
// panel. The pitch colours mirror server/fab.js and overlays/fab.js so the
// panel's preview of a card matches what goes to air.

export const PITCH_COLORS = {
  Red:    '#c8312b',
  Yellow: '#e2b23a',
  Blue:   '#2f6fb5',
  '':     '#8a8f96',   // no pitch: heroes, weapons, most equipment
}

// Deck sections in the order the official decklists print them.
export const PITCH_ORDER = [
  ['Red',    'Pitch 1 · Red'],
  ['Yellow', 'Pitch 2 · Yellow'],
  ['Blue',   'Pitch 3 · Blue'],
  ['',       'No pitch'],
]

export const TYPE_COLORS = {
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

export const typeColor = (t) => TYPE_COLORS[t] ?? '#8a8f96'

// A card's accent: its pitch colour when it has one, otherwise its type's.
export const cardAccent = (card) =>
  card?.color ? PITCH_COLORS[card.color] : typeColor(card?.type)

// Small numeric cost badge — a card's resource cost.
export function CostBadge({ cost, size = 15 }) {
  if (cost == null) return null
  return (
    <span
      className="cost-badge"
      style={{ width: size + 4, height: size + 4, fontSize: Math.round(size * 0.72) }}
    >
      {cost}
    </span>
  )
}

// Rows grouped by pitch, in PITCH_ORDER, skipping empty groups.
export function groupByPitch(rows) {
  return PITCH_ORDER
    .map(([color, label]) => [label, rows.filter(r => (r.color ?? '') === color), PITCH_COLORS[color]])
    .filter(([, group]) => group.length > 0)
}

// Sort a section the way a player reads their list: the 3-ofs first, then up
// the cost curve.
export const sortDeckRows = (rows) =>
  [...rows].sort((a, b) =>
    b.count - a.count || (a.cost ?? 0) - (b.cost ?? 0) || (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name)
  )

const sum = (rows) => (rows ?? []).reduce((n, r) => n + r.count, 0)

// Deck cards in the pool (not counting the hero, weapons or equipment).
export const deckCount = (deck) => sum(deck?.main)
// Weapons + equipment.
export const arenaCount = (deck) => sum(deck?.arena)

// The heroes a player's own decklist offers for the hero picker — normally
// exactly one, so picking it is a single click.
export const heroOptions = (deck) => (deck?.hero ? [deck.hero] : [])
