# Roster import format

The spec for a registration site exporting its field to the broadcast tool.

**CSV or JSON — either works.** The format is detected from the file's contents,
not its extension. Pick whichever is easier to produce; there is no advantage to
one over the other.

Working examples sit next to this file — both import cleanly, so they're a good
thing to diff an export against:

- `registration-template.csv`
- `registration-template.json` — its three players deliberately use the three
  different decklist shapes, so you can see which one best fits your data.

---

## The fields

Only the player's name is required.

| Field       | Required | Contents                                         |
|-------------|----------|--------------------------------------------------|
| Player      | **yes**  | Player's name. A row with no name is skipped.    |
| Deck        | no       | Deck name — "Dorinthea", "Aggro Rhinar". Defaults to the hero's name. |
| Decklist    | no       | The card-pool: hero, weapons, equipment and deck cards. One card per line. |
| Sideboard   | no       | Only if your site keeps one separately. One card per line. |
| Pronouns    | no       | Shown on the overlays with the player's name.    |

**Leave placement out.** There is a `Place` field, but it's only for re-importing
an already-finished tournament. At a live event nobody has a placement yet, and
standings are edited in the panel as the event plays out.

---

## CSV

Standard CSV. **Header row required.** One row per player.

```csv
Player,Deck,Decklist
Kestrel,Dorinthea,"Hero / Weapon / Equipment
1x Dorinthea Ironsong
1x Dawnblade
1x Braveforge Bracers
Pitch 1
3x Driving Blade (red)
Pitch 3
3x Steelblade Shunt (blu)"
```

The decklist is a normal multi-line cell: wrapped in double quotes, real
newlines inside. This is standard CSV — any serializer does it correctly, and no
special handling is needed. A literal double quote inside a cell is escaped by
doubling it (`""`), per spec.

### Column names

Matched loosely — case, spaces and punctuation are ignored, and each column
accepts several spellings:

| Column      | Also accepted                                      |
|-------------|----------------------------------------------------|
| `Player`    | `Player Name`, `Name`, `Full Name`, `Display Name` |
| `Deck`      | `Deck Name`, `Archetype`, `Hero`                   |
| `Decklist`  | `Main Deck`, `Maindeck`, `Main`                    |
| `Sideboard` | `Side`, `SB`                                       |
| `Pronouns`  | `Pronoun`                                          |

**Do not put the decklist in a column called `Deck`.** That's the deck-name
column; a decklist there is read as a name. Use `Decklist`.

---

## JSON

An array of players — or an object wrapping one under `players`, `roster` or
`data`.

The decklist may be **a string** (exactly the text a CSV cell would hold):

```json
[
  {
    "name": "Kestrel",
    "deck": "Dorinthea",
    "decklist": "Hero / Weapon / Equipment\n1x Dorinthea Ironsong\n1x Dawnblade\nPitch 1\n3x Driving Blade (red)"
  }
]
```

...**or a structured array**, which is usually the natural shape if the site
already stores decks as records:

```json
[
  {
    "name": "Marlowe",
    "deck": "Bravo",
    "decklist": [
      { "count": 1, "name": "Bravo, Showstopper" },
      { "count": 1, "name": "Anothos" },
      { "count": 3, "name": "Crippling Crush (red)" },
      { "count": 3, "name": "Sloggism (blue)" }
    ]
  }
]
```

A plain array of strings (`["1x Bravo, Showstopper", "3x Crippling Crush (red)"]`)
works too.

### Key names

Matched with the same loose rules as CSV columns, so `playerName`, `player_name`
and `Player Name` are all the player.

| Field     | Keys accepted                                          |
|-----------|--------------------------------------------------------|
| Player    | `name`, `player`, `playerName`, `fullName`, `displayName` |
| Deck      | `deck`, `deckName`, `archetype`, `hero`                |
| Decklist  | `decklist`, `maindeck`, `mainboard`, `main`, `cards`   |
| Sideboard | `sideboard`, `side`, `sb`                              |
| Pronouns  | `pronouns`, `pronoun`                                  |

In a structured decklist, each card's count may be `count`, `quantity`, `qty` or
`n`, and its name may be `name`, `card` or `cardName`.

---

## Decklist layout

The best export is **the official one** — the text on a fabtcg.com decklist
page, or GEM's "Import to GEM" text. Paste or export it unchanged:

```
Hero / Weapon / Equipment
1x Teklovossen, Esteemed Magnate
1x Teklo Leveler
1x Viziertronic Model i
Pitch 1
3x Command and Conquer (red)
Pitch 2
2x Sigil of Solace (yel)
Pitch 3
1x Evo Beta Base Arms (blu)
```

It's the player's whole card-pool (up to 80 cards in Classic Constructed, 55 in
Silver Age, 52 in Blitz) — that's what a FaB decklist is, since players choose
what to present after seeing the opposing hero.

**Sections decide where a card goes.** Everything under "Hero / Weapon /
Equipment" starts in the arena; everything under a "Pitch" header is a deck
card. That matters for cards like Evos — Equipment by type, but played from the
deck, and printed under their pitch on the official list.

Other labels are understood too: `Hero:` (with the hero inline), `Weapons:`,
`Equipment:` (inline, comma-separated is fine), `Deck:` / `Main Deck:`,
`Sideboard:` / `Inventory:`.

**Unlabelled lists work.** Lines with no header above them are sorted by card
type: the hero is recognised, weapons and pitch-less equipment go to the arena,
everything else to the deck.

The hero becomes the player's hero card on the matchup overlay and sets their
starting life the moment they're seated.

---

## Card lines

Each card line is `<count>x <name> (<pitch>)`:

```
3x Command and Conquer (red)
2x Sigil of Solace (yel)
1x Teklo Leveler
```

- The `x` is optional: `3 Command and Conquer (red)` works.
- **Pitch is part of the card's identity.** "Snatch (red)" and "Snatch (blue)"
  are different cards. Write it as `(red)` / `(yel)` / `(blu)` — the official
  spelling — or `(yellow)` / `(blue)`. Cards that only exist in one version
  (heroes, weapons, most equipment) need no pitch.
- A name that exists in several pitches but is written **without** one is
  reported as unresolved, listing each version — the importer won't guess.
- `// comments` and blank lines are ignored.

### Card names

Names are matched against the open Flesh and Blood card dataset, which is
forgiving about punctuation, casing, accents and small typos — "Jarl Vetreidi"
finds "Jarl Vetreiði". Cards from a set newer than the dataset are looked up in
Legend Story Studios' official card database automatically.

**Export names exactly as the player submitted them.** A well-meaning cleanup
pass (stripping punctuation, re-casing, dropping the pitch) is more likely to
turn a good name into a wrong one than to help. Anything that can't be resolved
at all is reported with suggestions, not silently dropped.

---

## Encoding

**UTF-8.** Card and player names contain accents ("Jarl Vetreiði",
"Riches of Trōpal-Dhani"), and Latin-1 will mangle them. Either line ending
(LF or CRLF) is fine.
