import React, { useState } from 'react'
import { api } from '../store.js'
import { CostBadge, groupByPitch, deckCount, arenaCount } from '../fab.jsx'

const PLACEHOLDER = `Paste a decklist — the official fabtcg.com / GEM text works as-is:

Hero / Weapon / Equipment
1x Dorinthea Ironsong
1x Dawnblade
1x Braveforge Bracers
Pitch 1
3x Driving Blade (red)
Pitch 3
3x Sink Below (blu)

"Hero:", "Weapons:", "Equipment:", "Deck:" and "Sideboard:" labels work too.`

export default function DecklistImport({ onDone, onCancel }) {
  const [text, setText]       = useState('')
  const [result, setResult]   = useState(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  async function resolve() {
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      setResult(await api.resolveDeck(text))
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  const sideCount = result ? result.side.reduce((n, r) => n + r.count, 0) : 0

  const Rows = ({ rows }) => rows.map((r, i) => (
    <div key={i} className="rev-row">
      <span className="rev-count">{r.count}</span>
      <span className="rev-name">{r.displayName ?? r.name}</span>
      <CostBadge cost={r.cost} size={11} />
      <span className="rev-type">{r.type}</span>
    </div>
  ))

  return (
    <div className="import">
      {!result && (
        <>
          <textarea
            className="import-ta"
            placeholder={PLACEHOLDER}
            value={text}
            onChange={e => setText(e.target.value)}
            rows={10}
            autoFocus
          />
          <div className="row">
            <button className="btn primary" onClick={resolve} disabled={busy || !text.trim()}>
              {busy ? 'Resolving cards…' : 'Resolve'}
            </button>
            <button className="btn" onClick={onCancel}>Cancel</button>
            {error && <span className="err">{error}</span>}
          </div>
        </>
      )}

      {result && (
        <>
          {/* Review before committing. Name matching forgives typos and missing
              accents, which is what makes messy player-submitted lists
              importable — but it also means a mangled line can resolve to the
              WRONG card. Showing every resolved name (with its pitch) is how that
              gets caught before it hits the deck reveal on air. */}
          <div className="import-summary">
            <b>{result.hero?.name ?? 'No hero'}</b> · <b>{deckCount(result)}</b> deck ·{' '}
            <b>{arenaCount(result)}</b> weapons &amp; equipment
            {sideCount > 0 && <> · <b>{sideCount}</b> sideboard</>}
            {result.unresolved.length > 0 && (
              <span className="warn"> · {result.unresolved.length} unresolved</span>
            )}
          </div>

          <div className="import-review">
            {result.unresolved.length > 0 && (
              <div className="rev-section bad">
                <div className="rev-title">Unresolved — these will be missing</div>
                {result.unresolved.map((u, i) => (
                  <div key={i} className="rev-row">
                    <span className="rev-count">{u.count}</span>
                    <span className="rev-name">{u.rawName}</span>
                    <span className="rev-sugg">
                      {u.suggestions.length ? `Did you mean: ${u.suggestions.join(', ')}` : 'No match'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* The hero first — it becomes the player's hero card on air and sets
                their starting life, so a wrong one here is a wrong card on stream. */}
            <div className="rev-section">
              <div className="rev-title">Hero / Weapon / Equipment</div>
              <div className="rev-row">
                <span className="rev-count">H</span>
                <span className="rev-name">
                  {result.hero ? result.hero.name : <span className="warn">no hero found</span>}
                </span>
                {result.hero && <span className="rev-type">{result.hero.life} life · {result.hero.intellect} intellect</span>}
              </div>
              <Rows rows={result.arena} />
            </div>

            {groupByPitch(result.main).map(([label, rows]) => (
              <div key={label} className="rev-section">
                <div className="rev-title">{label}</div>
                <Rows rows={rows} />
              </div>
            ))}

            {result.side.length > 0 && (
              <div className="rev-section">
                <div className="rev-title">Sideboard</div>
                <Rows rows={result.side} />
              </div>
            )}
          </div>

          <div className="row">
            <button className="btn primary" onClick={() => onDone(result)}>
              Use this decklist
            </button>
            <button className="btn" onClick={() => setResult(null)}>Back to paste</button>
            <button className="btn" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}
