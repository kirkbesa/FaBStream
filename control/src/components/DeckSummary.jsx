import React from 'react'
import { api } from '../store.js'
import { CostBadge, groupByPitch, sortDeckRows, deckCount, arenaCount, typeColor } from '../fab.jsx'

// Compact read-only view of a stored decklist: hero, weapons + equipment, then
// the deck grouped by pitch the way the official lists print it. Clicking a card
// makes it the featured card on the matchup overlay — the fastest path from
// "caster mentions a card" to "card is on screen".
export default function DeckSummary({ deck }) {
  if (!deck || ((deck.main ?? []).length === 0 && !deck.hero)) {
    return <div className="deck-empty">No decklist imported</div>
  }

  const feature = (identifier) => api.overlay({ cardZoom: identifier }).catch(() => {})
  const sideCount = (deck.side ?? []).reduce((n, r) => n + r.count, 0)

  const Row = ({ r, count = r.count }) => (
    <button className="ds-row" onClick={() => feature(r.identifier)} title="Feature on stream">
      <span className="ds-count">{count}</span>
      <span className="ds-name">{r.displayName ?? r.name}</span>
      <CostBadge cost={r.cost} size={11} />
    </button>
  )

  return (
    <div className="deck-summary">
      <div className="ds-counts">
        {deckCount(deck)} deck · {arenaCount(deck)} weapons &amp; equipment
        {sideCount > 0 && ` · ${sideCount} side`}
        {deck.unresolved?.length > 0 && (
          <span className="warn"> · {deck.unresolved.length} unresolved</span>
        )}
      </div>

      <div className="ds-scroll">
        {(deck.hero || deck.arena?.length > 0) && (
          <div className="ds-group">
            <div className="ds-group-title" style={{ color: typeColor('Hero') }}>
              Hero / Weapon / Equipment
            </div>
            {deck.hero && <Row r={deck.hero} count="H" />}
            {sortDeckRows(deck.arena ?? []).map(r => <Row key={r.identifier} r={r} />)}
          </div>
        )}

        {groupByPitch(deck.main ?? []).map(([label, rows, color]) => (
          <div key={label} className="ds-group">
            <div className="ds-group-title" style={{ color }}>
              {label} ({rows.reduce((n, r) => n + r.count, 0)})
            </div>
            {sortDeckRows(rows).map(r => <Row key={r.identifier} r={r} />)}
          </div>
        ))}

        {sideCount > 0 && (
          <div className="ds-group">
            <div className="ds-group-title" style={{ color: 'var(--gold)' }}>Sideboard ({sideCount})</div>
            {sortDeckRows(deck.side).map(r => <Row key={r.identifier} r={r} />)}
          </div>
        )}
      </div>
    </div>
  )
}
