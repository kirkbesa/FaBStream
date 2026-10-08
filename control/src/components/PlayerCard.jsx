import React, { useState } from 'react'
import { api } from '../store.js'
import DecklistImport from './DecklistImport.jsx'
import DeckSummary from './DeckSummary.jsx'
import CardPicker from './CardPicker.jsx'
import { heroOptions } from '../fab.jsx'

const GAMES_TO_WIN = 2
const DEFAULT_LIFE = 40   // until a hero is set — matches server/state.js

export default function PlayerCard({ player: p, mi, pi, bestOf = 1 }) {
  const [importing, setImporting] = useState(false)

  const patch = (patch) => api.patchPlayer(mi, pi, patch).catch(() => {})
  const bump  = (counter, delta) => api.adjustCounter(mi, pi, counter, delta).catch(() => {})

  const rec   = p.record ?? { w: 0, l: 0, d: 0 }
  const deck  = p.decklist
  const life  = p.life ?? DEFAULT_LIFE
  const start = p.hero?.life ?? DEFAULT_LIFE
  const games = p.gameScore ?? 0

  return (
    <div className="card player-card">
      <div className="pc-head">
        <span className="pc-role">Player {pi + 1}</span>
        {/* Games won only matter in a best-of-three — FaB matches are a single
            game unless the event says otherwise. */}
        {bestOf === 3 && (
          <span className="pc-score">
            Games
            <button className="tiny" onClick={() => patch({ gameScore: Math.max(0, games - 1) })}>−</button>
            <b>{games} / {GAMES_TO_WIN}</b>
            <button className="tiny" onClick={() => patch({ gameScore: Math.min(GAMES_TO_WIN, games + 1) })}>+</button>
          </span>
        )}
      </div>

      <input
        className="pc-name"
        placeholder="Player name"
        value={p.name ?? ''}
        onChange={e => patch({ name: e.target.value })}
      />

      <div className="row">
        <label className="field">
          <span>Handle</span>
          <input value={p.handle ?? ''} onChange={e => patch({ handle: e.target.value })} placeholder="@handle" />
        </label>
        <label className="field">
          <span>Pronouns</span>
          <input value={p.pronouns ?? ''} onChange={e => patch({ pronouns: e.target.value })} placeholder="they/them" />
        </label>
      </div>

      <div className="row">
        <label className="field sm">
          <span>W</span>
          <input type="number" value={rec.w} onChange={e => patch({ record: { ...rec, w: +e.target.value } })} />
        </label>
        <label className="field sm">
          <span>L</span>
          <input type="number" value={rec.l} onChange={e => patch({ record: { ...rec, l: +e.target.value } })} />
        </label>
        <label className="field grow">
          <span>Deck / Archetype</span>
          <input
            value={p.deckName ?? ''}
            onChange={e => patch({ deckName: e.target.value })}
            placeholder="Teklovossen"
          />
        </label>
      </div>

      {/* ── Life ────────────────────────────────────────────────
          The live game — the matchup overlay's centrepiece. ±1 for a hit,
          ±5 for the big swings, and a reset back to the hero's printed life. */}
      <div className="life">
        <div className={`life-val${life <= 0 ? ' dead' : ''}`}>
          <button className="step-btn" onClick={() => bump('life', -5)}>−5</button>
          <button className="step-btn" onClick={() => bump('life', -1)}>−1</button>
          <div className="life-num"><b>{life}</b><span>life</span></div>
          <button className="step-btn" onClick={() => bump('life', +1)}>+1</button>
          <button className="step-btn" onClick={() => bump('life', +5)}>+5</button>
        </div>
        <button
          className="btn sm life-reset"
          onClick={() => api.setCounter(mi, pi, 'life', start).catch(() => {})}
          disabled={life === start}
          title="Back to the hero's starting life"
        >
          Reset to {start}
        </button>
      </div>

      {/* ── Hero ────────────────────────────────────────────────
          Picking a hero sets the starting life (the server does that, so the
          table page and roster seating behave the same). */}
      <div className="pickers single">
        <CardPicker
          label="Hero"
          value={p.hero ?? null}
          typeFilter="Hero"
          options={heroOptions(deck)}
          placeholder="Set hero"
          onPick={(card) => patch({ hero: card })}
        />
      </div>

      {/* ── Decklist ────────────────────────────────────────────── */}
      <div className="deck-block">
        <div className="deck-head">
          <span>Decklist</span>
          <button className="btn sm" onClick={() => setImporting(v => !v)}>
            {importing ? 'Cancel' : deck ? 'Re-import' : 'Import…'}
          </button>
        </div>

        {importing ? (
          <DecklistImport
            onDone={(resolved) => {
              // A decklist names its hero, so importing one sets it (and with
              // it, the starting life).
              patch({ decklist: resolved, ...(resolved.hero && { hero: resolved.hero }) })
              setImporting(false)
            }}
            onCancel={() => setImporting(false)}
          />
        ) : (
          <DeckSummary deck={deck} />
        )}
      </div>
    </div>
  )
}
