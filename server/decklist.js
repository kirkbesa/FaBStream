// server/decklist.js — parse a pasted Flesh and Blood decklist into resolved
// sections: the hero, their arena cards (weapons + equipment), the deck, and a
// sideboard.
//
// The official decklists on fabtcg.com — and GEM's "Import to GEM" text —
// look like this:
//
//   Hero / Weapon / Equipment
//   1x Teklovossen, Esteemed Magnate
//   1x Teklo Leveler
//   1x Viziertronic Model i
//   Pitch 1
//   3x Command and Conquer (red)
//   Pitch 2
//   2x Sigil of Solace (yel)
//   Pitch 3
//   1x Evo Beta Base Arms (blu)
//
// Other exports label things differently, so all of these are understood:
//
//   Hero: Dorinthea Ironsong        ← inline, one card
//   Weapons: Dawnblade              ← inline, comma-separated is fine too
//   Equipment:  /  Arena:  /  Deck:  /  Main Deck:  /  Sideboard:  /  Inventory:
//   Pitch 0 / Pitch 1 / Pitch 2 / Pitch 3
//
// SECTIONS DECIDE where a card goes — not card type. Evo cards are Equipment by
// type, but Teklovossen plays them from the deck, and the official list prints
// them under their pitch. Only the hero is picked out by type (it's one card,
// and always type Hero). Lines with no header above them fall back to type:
// Hero → hero, Weapon or pitch-less Equipment → arena, everything else → deck.
//
// Each card line is "<count>x <name> (<pitch>)": the "x" is optional, and the
// pitch may be (red)/(yel)/(blu), (yellow)/(blue), or missing for cards that
// only come in one version. Pitch is part of a card's identity — see fab.js.
//
// An official list is the player's whole card-pool (up to 80 in Classic
// Constructed), with no main/sideboard split: what they present each game is
// chosen after seeing the opposing hero. So `main` here is "deck cards in the
// pool", and `side` only fills when a list labels a sideboard explicitly.

import { resolveByDisplayName, resolveLocal, getCardsByNames, normalize } from './fab.js'

const SECTION_HEADERS = [
  ['hero',  /hero\s*\/\s*weapons?\s*\/\s*equipment/],      // official combined header
  ['hero',  /heroes|hero/],
  ['arena', /weapons?|equipment|arena(?:\s*cards?)?/],
  ['side',  /side\s*-?\s*board|sideboard|inventory|side/],
  ['main',  /pitch\s*[0-3]|main\s*-?\s*(?:board|deck)?|deck(?:\s*cards?)?|cards/],
]
const RE_HEADER = new RegExp(
  `^(?:\\/\\/\\s*)?(${SECTION_HEADERS.map(([, re]) => `(${re.source})`).join('|')})\\s*(?:\\(\\d+\\))?\\s*(?::\\s*(.*))?$`,
  'i',
)
const RE_SKIP = /^(\/\/\s*)?(name|format|about|deck\s*name|class|talent)\s*:/i
const RE_LINE = /^(\d+)\s*x?\s+(.+?)\s*$/i

function matchHeader(line) {
  const m = line.match(RE_HEADER)
  if (!m) return null
  const section = SECTION_HEADERS.find((_, i) => m[i + 2] !== undefined)?.[0]
  return section ? { section, inline: (m[SECTION_HEADERS.length + 2] ?? '').trim() } : null
}

// A card line, or — inline after a header — bare names meaning 1 copy each.
function parseEntries(body, { allowBare = false } = {}) {
  const m = body.match(RE_LINE)
  if (m) return [{ count: parseInt(m[1], 10), rawName: m[2].trim() }]
  if (!allowBare || !body) return []
  // "Weapons: Dawnblade, Hatchet of Body" — but a single card name may itself
  // contain a comma ("Dorinthea, Quicksilver Prodigy"), so only split when every
  // piece resolves on its own; otherwise keep it whole.
  const parts = body.split(/\s*,\s*/)
  if (parts.length > 1 && !resolveLocal(body).card && parts.every(p => resolveLocal(p).card)) {
    return parts.map(p => ({ count: 1, rawName: p }))
  }
  return [{ count: 1, rawName: body }]
}

export function parseDecklist(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(l => l.trim())

  // Cards before the first header are sorted by type ('auto'). That covers a
  // fully unlabelled list, and the common "plain list, then a Sideboard
  // header" shape — the only header there says nothing about the lines above.
  const sections = { hero: [], arena: [], main: [], side: [], auto: [] }
  let section = 'auto'

  for (const line of lines) {
    if (!line || line.startsWith('//') || line.startsWith('#')) continue
    if (RE_SKIP.test(line)) continue

    const header = matchHeader(line)
    if (header) {
      section = header.section
      sections[section].push(...parseEntries(header.inline, { allowBare: true }))
      continue
    }

    // Unparseable lines are skipped rather than failing the import. Unlabelled
    // lists ('auto') are sorted by card type after resolution.
    sections[section].push(...parseEntries(line))
  }

  return sections
}

const toRow = (count, card) => ({
  count,
  identifier:  card.identifier,
  name:        card.name,
  displayName: card.displayName,
  color:       card.color,
  pitch:       card.pitch,
  pitchColor:  card.pitchColor,
  type:        card.type,
  typeText:    card.typeText,
  slot:        card.slot,
  cost:        card.cost,
  power:       card.power,
  defense:     card.defense,
  imageUrl:    card.imageUrl,
})

// Returns the fully-resolved decklist that gets stored directly in state:
//
//   { hero,        — full card object (the same shape the panel's hero picker
//                    stores), or null
//     arena,       — weapons + equipment the hero starts with, as rows
//     main, side,  — { count, …card } rows
//     unresolved } — lines that didn't resolve, with suggestions — kept rather
//                    than dropped, because a silently missing card is worse on
//                    air than a visible error
export async function resolveDecklist(text) {
  const parsed = parseDecklist(text)
  const byName = await getCardsByNames(Object.values(parsed).flat().map(e => e.rawName))

  const out = { hero: null, arena: [], main: [], side: [], unresolved: [] }

  const place = (section, count, card) => {
    if (card.type === 'Hero') {           // the hero, wherever the list put it
      out.hero ??= card
      return
    }
    if (section === 'auto') {
      section = card.type === 'Weapon' || (card.type === 'Equipment' && !card.color) ? 'arena' : 'main'
    }
    if (section === 'hero') section = 'arena'   // the official combined header
    out[section].push(toRow(count, card))
  }

  for (const [section, entries] of Object.entries(parsed)) {
    for (const { count, rawName } of entries) {
      const card = byName.get(normalize(rawName))
      if (card) { place(section, count, card); continue }
      const { suggestions } = await resolveByDisplayName(rawName)
      out.unresolved.push({ count, rawName, section, suggestions })
    }
  }

  return out
}
