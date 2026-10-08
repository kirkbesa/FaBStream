import React, { useEffect, useRef, useState } from 'react'
import { api } from '../store.js'
import { cardAccent } from '../fab.jsx'

// A compact "search the card database → pick one card" control, used for a
// player's hero. `value` is a resolved
// card object (or null); `onPick(card | null)` stores the pick on the player.
//
// `typeFilter` optionally narrows results to a card type (e.g. 'Hero'), so the
// hero picker doesn't surface attack actions.
//
// `options` — the cards the player's own decklist offers for this slot. When
// given, the slot is a dropdown of those (setting the player's hero is one
// click), and searching the full pool is the fallback for anything off-list.
// A pick from search that isn't in the deck stays selectable, marked (custom).
const SEARCH = '__search__'

export default function CardPicker({ label, value, onPick, typeFilter, placeholder, options = [] }) {
  const [open, setOpen]       = useState(false)
  const [q, setQ]             = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy]       = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    if (!open || !q.trim()) { setResults([]); return }
    timer.current = setTimeout(async () => {
      setBusy(true)
      try {
        let cards = await api.searchCards(q)
        if (typeFilter) cards = cards.filter(c => c.type === typeFilter)
        setResults(cards.slice(0, 12))
      } catch { setResults([]) }
      setBusy(false)
    }, 250)
    return () => clearTimeout(timer.current)
  }, [q, open, typeFilter])

  const pick = (card) => {
    onPick(card)
    setOpen(false)
    setQ('')
    setResults([])
  }

  const isCustom = value && !options.some(c => c.identifier === value.identifier)

  const onSelect = (id) => {
    if (id === SEARCH) { setOpen(true); return }   // controlled — the select snaps back to value
    pick(id ? options.find(c => c.identifier === id) ?? value : null)
  }

  return (
    <div className="cardpicker">
      <div className="cp-label">{label}</div>

      {options.length > 0 ? (
        <div className="cp-current" style={{ borderColor: value ? cardAccent(value) : undefined }}>
          {value?.imageUrl
            ? <img src={value.imageUrl} alt={value.name} className="cp-thumb" />
            : <div className="cp-thumb ph">◆</div>}
          <select className="cp-select" value={value?.identifier ?? ''} onChange={e => onSelect(e.target.value)}>
            <option value="">— {placeholder ?? `Set ${label.toLowerCase()}`} —</option>
            <optgroup label="From decklist">
              {options.map(c => <option key={c.identifier} value={c.identifier}>{c.displayName ?? c.name}</option>)}
            </optgroup>
            {isCustom && <option value={value.identifier}>{value.displayName ?? value.name} (custom)</option>}
            <option value={SEARCH}>Search all cards…</option>
          </select>
          <button className="tiny" title="Search all cards" onClick={() => setOpen(o => !o)}>⌕</button>
        </div>
      ) : value ? (
        <div className="cp-current" style={{ borderColor: cardAccent(value) }}>
          {value.imageUrl
            ? <img src={value.imageUrl} alt={value.name} className="cp-thumb" />
            : <div className="cp-thumb ph">◆</div>}
          <div className="cp-current-meta">
            <span className="cp-name">{value.displayName ?? value.name}</span>
            <span className="cp-sub">{[value.typeText, value.life != null && `${value.life} life`].filter(Boolean).join(' · ')}</span>
          </div>
          <button className="tiny" title="Change" onClick={() => setOpen(o => !o)}>✎</button>
          <button className="tiny" title="Clear" onClick={() => pick(null)}>✕</button>
        </div>
      ) : (
        <button className="cp-empty" onClick={() => setOpen(o => !o)}>
          + {placeholder ?? `Set ${label.toLowerCase()}`}
        </button>
      )}

      {open && (
        <div className="cp-search">
          <input
            className="search"
            autoFocus
            placeholder={`Search ${typeFilter ? typeFilter.toLowerCase() + 's' : 'cards'}…`}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {busy && <div className="muted">Searching…</div>}
          <div className="cp-results">
            {results.map(c => (
              <button key={c.identifier} className="cp-result" onClick={() => pick(c)} title={c.text}>
                {c.imageUrl
                  ? <img src={c.imageUrl} alt={c.name} loading="lazy" />
                  : <div className="cp-result-ph">◆</div>}
                <div className="cp-result-bar" style={{ background: cardAccent(c) }} />
                <span className="cp-result-name">{c.displayName ?? c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}