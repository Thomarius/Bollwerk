# Special towers — design and plan

A match may let each player bring one **special tower**: a cannon with an ability of its own,
bought in the cannon phase by giving up two or three ordinary cannons. Each tower makes for a
different way to play — more damage, sturdier walls, a faster tempo — at the price of guns. This
file is the design as discussed with the user (2026-10-11) and the plan to build it in work
packages, for a later session. **Nothing of it is built yet.** Like PLAN.md it says what is
configurable and why and leaves the values to `config/*.json`; when a package is done its summary
moves to ARCHIVE.md and this file keeps only what is open.

---

## 1. What was decided

- **All towers available from the start.** No experience points or unlocks for now: Bollwerk is
  played among friends of very different skill, and unlocks earned by playing would give the
  stronger player more options as well as more skill. Unlocks may come back later as variety,
  never as power.
- **An on/off switch** for special towers among the match settings, beside lives and rounds:
  classic matches stay possible, and a test session can compare both.
- **Each player chooses one tower for the match** (or none), each their own.
- **Bought in the cannon phase only** — the one phase without hurry — by exchanging ordinary
  cannon placements: two or three, never more. **At most one special tower a round**, and
  **never in the opening placement** after a castle is chosen (the match's start, or after a
  continue). Buying is always optional.
- **Placement is switched with the right mouse button**, unused in the cannon phase today: normal
  cannon or the special tower. Mouse only, as every action.
- **The graphics are each style's own cannon with an emblem** for the tower's kind — one shared
  mark in every style, as the main castle's crown is — and generic, palette-tinted effects for
  its shots. Custom tower art for a few styles stays possible later, never promised for all
  nineteen.
- **The first version brings three towers**: **Big Bertha** (offence), **Architect** (defence),
  **Rapid Cannon** (tempo). Each is deterministic without new randomness, simple in the rules,
  and gives the bots a clear placement rule. More may follow (§4).
- **The balance goal** (the user's): a player using a special tower should win 55–65% against an
  equal player using none.
- **Dropped**: the Magma Thrower (a burning tile blocking placement can make a ring unsealable —
  a forced lost life, the most frustrating loss there is) and the Spotter (where opponents' shots
  will land gives no real advantage). **Shelved**: the Keep (a tower counting as a castle; very
  hard to balance).

---

## 2. The rules

### 2.1 Choosing and buying

- With special towers switched on, every seat — person or bot — has a **chosen tower or none**
  for the whole match (its loadout). People choose in the lobby; bots by personality (§5.6).
- In a cannon phase that is not the player's opening one (`owesCastleChoice` was false when the
  phase began), a player holding at least the tower's **cost** in cannons to place may place
  their tower instead of that many cannons, once a round. It is placed like a cannon: on free
  land inside their own sealed territory (`canPlaceCannon`'s rules), with the tower's own
  footprint — 2×2 like a cannon, or 3×3 where the tower's balance wants placement to be harder.
- **The right mouse button switches the ghost** between an ordinary cannon and the tower; the
  ghost shows the tower's footprint, emblem and cost, and turns invalid where it cannot stand,
  or when the player cannot afford it, has placed one this round, or is in an opening placement.
- An unspent phase loses nothing new: cannons left unplaced at the phase's end are lost as today.

### 2.2 Living and firing

- A tower is a cannon in every other way: it stays where it stands, it goes **inert outside
  sealed ground** like any gun (so an investment outside a safe wall is a real risk — wanted:
  it rewards the big, safe enclosure people build), it is never destroyed, and a continue wipes
  it with everything else. Towers bought in earlier rounds stay; a player may own several.
- **Firing a special tower is the player's choice: the right mouse button fires it in combat**
  (unused there today), the left button the ordinary guns as now. Today the sim picks the nearest
  ready gun for a shot (`findReadyCannon`); a left click never picks a special tower that has a
  shot effect of its own, a right click picks the nearest ready special tower. The Rapid Cannon
  is the exception: its ability is its tempo, so it fires with the ordinary guns, from either
  button.
- Passive abilities (the Architect's repair, the Bastion's walls) need no firing; the Architect
  also fires ordinary shots with the left button, like a cannon.

### 2.3 The first three towers

Every number below is a starting value for the soaks (§6), kept in config.

**Big Bertha** — offence.

- Cost 2 cannons, footprint 2×2 (3×3 a lever if it proves too strong).
- Its shot clears a larger crater: `plus5` (the tile and its four neighbours), the pattern that
  already exists for ordinary shots (`craterPattern`), against an opponent's walls only, as
  every crater. Points per wall cleared as ever, so it also scores more.
- Its flight is slower (a factor on `flightTicks`, say 1.3), so it fires fewer times a phase.
- A 9-tile crater (`square9`) would break most rings with one shot: not at first.

**Architect** — defence.

- Cost 2, footprint 2×2.
- As each build phase opens, it **rebuilds the walls its owner lost this round** within a radius
  of 2 tiles of its footprint (Chebyshev), before anyone builds: a predictable tool rather than a
  repair during combat. The repaired walls are the island's own again. Only where the tile is
  free and buildable, and only if the Architect is active (inside sealed ground).
- It also fires ordinary shots (left button).
- Levers: the radius (2–3), the cost (2–3), and whether it repairs only walls lost to shots this
  round (yes at first; never walls swept as orphans).

**Rapid Cannon** — tempo.

- Cost 2, footprint 2×2.
- An ordinary shot with a **shorter flight**, so a shorter reload — flight time is the reload: a
  factor on `flightTicks` (say 0.6). More shots of the same kind.
- Fires with the ordinary guns (either button).
- The simplest tower to build and to balance; a good first one to soak.

---

## 3. Where it lives

### 3.1 Simulation (`packages/sim`)

- `Cannon` gains `kind: CannonKind` — `'cannon' | 'bertha' | 'architect' | 'rapid'` at first —
  and keeps `w`, `h` per kind. Every existing cannon is `'cannon'`.
- `PlayerState` gains `special: CannonKind | null` (the loadout, from the match's options) and
  `specialRound: number` (the round its tower was last bought, for "one a round"), and remembers
  whether the current cannon phase is an opening one.
- `MatchState` gains, for the Architect, the walls each island lost to shots this round (cleared
  at each build phase's start, after the repair). Everything new is hashed (`hashMatchState`).
- **Actions**: `place_cannon` gains an optional `kind` (absent means an ordinary cannon, so old
  recordings and clients read the same); `fire` gains an optional `special: true`. New rejections:
  `special_off`, `not_your_special`, `special_too_dear`, `special_this_round`,
  `special_at_opening`.
- `placeCannon` charges the cost against `cannonsToPlace`; `fire` picks among ready cannons by
  the rule of §2.2; `flightTicks` takes the cannon's kind for its factor; `resolveImpacts` takes
  the crater pattern of the cannon that fired; the build phase's start runs the Architects'
  repairs, in seat order, before any placement.
- **Determinism** holds without new randomness for the first three. The later towers that need
  chance (§4) take it from `streamFor(seed, name)`, never `Math.random`.
- Tests as ASCII pictures (`stateFromAscii` gains a glyph per tower kind): a Bertha's crater on an
  opponent's wall and not on a teammate's; the Architect's repair inside its radius and not
  outside, nor when inert, nor over a placed block; the Rapid Cannon's flight; every rejection.

### 3.2 Configuration (`packages/config`, `config/*.json`)

- `ruleset.specials`, strict like everything: `perRound` (1), and per kind its `cost`,
  `footprint`, and its own levers — Bertha's `crater` and `flightFactor`, the Architect's
  `repairRadius`, the Rapid Cannon's `flightFactor`. An unknown key is an error.
- `MatchSettings` gains `specials: boolean`, with its default, and `applySettings` writes it into
  the ruleset — the schema's own comment foresaw "special weapons" joining the settings.
- A seat's loadout travels with the seat (as a bot's level and personality do), not in the
  ruleset: the match's options give each player their `special`.

### 3.3 Protocol, rooms and recordings

- **Protocol 22**: the settings' switch, a seat's chosen tower in the lobby (people choose their
  own; the host sets bots'), the new action fields. A v0.9 page cannot join a room of this one.
- **Recording format 3**: each player's `special` in the header, so a replay builds the same
  match; `--replay`, `shotStats.ts` and `buildStats.ts` read it.
- **Server** (`room.ts`, `MatchRunner`): the switch and the loadouts in a room's setup, checked
  against the settings' bounds; nothing else changes, actions being actions.
- **Local matches** (`LocalMatch`, the bot worker's `BotTable`): the same.
- **Tournaments**: off at first — a tournament's matches keep the classic rules until the towers
  have been played. A later decision whether the field's teams bring towers (an archnemesis with
  a signature tower would suit the story).

### 3.4 Client (`packages/client`)

- **Lobby**: the switch beside lives and rounds; when on, a tower chooser for one's own seat
  (each kind with its emblem, its cost and one line saying what it does), and the host's choice
  for each bot seat (or "by personality").
- **Controls** (`controls.ts`): in the cannon phase the right button toggles the ghost's kind
  (today it only rotates, which means nothing there); in combat it fires the special tower.
- **HUD**: the chosen tower and whether it can be bought this round (cost against cannons left,
  "one a round", "not at the opening"); in combat whether it is ready.
- **Drawing**: each style draws its cannon as today; the tower's **emblem** — simple
  shapes readable at a tile's size: a heavy shell for Bertha, a trowel or hammer for the
  Architect, chevrons for the Rapid Cannon — is one shared mark at the cannon's foot, keyed and
  drawn once (`Memos` / a `MainCastles`-like `SpecialMarks` in `theme.ts`), every style tinting it
  in its own palette. The ghost shows it too.
- **Effects**, generic and palette-tinted in every style: Bertha's larger blast (the impact effect
  scaled to its crater), the Architect's repair (the walls coming back with a shimmer as the build
  phase opens), the Rapid Cannon's quicker, lower arc. Cheap by the rules of "Drawing a style
  cheaply" in CLAUDE.md.
- **Sound**: one cue per tower's firing or repair, CC0 from OpenGameArt, credited in
  `config/audio.manifest.json` like every file.
- **Texts** in every locale file (English and German), and a **How to play** page for the towers.
- **Screenshots** (`tools/screenshots.sh`): the ghost in each kind, an emblem in a few styles, a
  Bertha blast, an Architect's repair.

### 3.5 Bots (`packages/ai`)

- **Loadout**: chosen by personality where the host leaves it to them — defensive the Architect,
  offensive Big Bertha, balanced the Rapid Cannon — or set in the lobby.
- **Buying** (`Siting`): buy when the tower's cost leaves enough cannons for the room it has, never
  at the opening, and only on sealed ground likely to stay sealed (inside the main enclosure, not
  a pocket). **Placing**: Big Bertha and the Rapid Cannon where an ordinary cannon would go, nearest
  the rivals it will shoot (`rivalDistanceExponent`); the Architect beside the stretch of its own
  wall breached most often — its weakest wall (`weakestWall` of its own island) or the tiles lost
  last round.
- **Firing** (`Gunner`): Big Bertha at the opponent's wall where its crater takes most wall tiles
  (a sum over `plus5` on the weakest wall's blocks), as the weakest-wall breach does today, and
  subject to the same misses by level (`ai.aim`). The Rapid Cannon as any gun.
- The worker, the thread driver and the harness need nothing new: a bot's actions are actions.

### 3.6 Measuring

- `shotStats.ts`: shots and walls cleared by cannon kind; `buildStats.ts`: towers bought, walls
  repaired; the headless harness: `--specials on|off` and a seat's tower (`--special bertha,none,…`
  beside `--level` and `--personality`).

---

## 4. Towers for later

In the order the user liked them; each to be designed in detail and agreed before it is built.

- **Bastion** (liked): the walls within a radius of 2 need two hits to fall — a crack on the
  first, cleared on the second; cracks heal as each build phase opens. Defensive, simple in the
  rules (a cracked flag per tile, hashed), and it blunts the minimum-cut problem — a thin wall
  stops being fatal. Drawn as a crack on the wall, in every style. The next tower after the first
  three.
- **Chain Lightning**: after a hit, a random opponent wall within 3 tiles is hit too, and once
  more from there — two bonus hits, even when the first shot misses. Strong (every wall is
  points); the chain's reach and length are its levers. Randomness from `streamFor`. A lightning
  arc in every style.
- **Scattershot**: three more shots land at random beside the target. Random tiles chosen on the
  island hit, so the extra shots are not mostly wasted on the sea.
- **Siege Mortar** (experimental): fires itself, once a combat phase, at a target's weakest point.
  It helps players who aim less well — the casual side of the gap — but it takes control away;
  the user is curious whether people like that. To try in a test session before it is kept.
- **Keep** (shelved): a 3×3 tower counting as a castle for sealing — an extra castle where one
  builds it. Very hard to balance; not planned.

---

## 5. Work packages

In order. Each ends with `npm run check` passing and the user's go-ahead to commit.

### ST1 — The rules in the simulation

`CannonKind`, the loadout on the player, `ruleset.specials` with its schema, buying (cost, once a
round, not at the opening), firing a special tower, and the three towers' effects; the state
hashed; ASCII tests for each rule and each rejection. No client, no protocol yet: the harness can
already play matches with towers.

### ST2 — Settings, protocol and recordings

`MatchSettings.specials`, a seat's loadout in local and room setups, protocol 22, recording
format 3, the server's checks, `--replay` reading the new header. Tournaments keep the towers off.

### ST3 — Bots

Loadout by personality, buying and placing in `Siting`, firing Big Bertha in `Gunner`; the harness's
`--specials` and `--special`; `shotStats.ts` and `buildStats.ts` by kind. Tested in tables of bots
before any person plays it.

### ST4 — Balance

Soaks per tower to the user's goal (§6): costs, footprints and each tower's levers tuned in config;
the level ladder checked with towers on and off. Recorded in ARCHIVE with the figures.

### ST5 — The client: lobby, controls, HUD

The switch and the tower chooser in the lobby, the right button's two uses, the ghost, the HUD's
state, every text in English and German.

### ST6 — The client: emblems, effects, sound

The emblem in every style (one shared mark), the generic effects, the cues and their credits,
checked by screenshots in every style and by `&perf=1` at eight players.

### ST7 — Help and documentation

The How to play page, the screenshot scenes, CLAUDE.md, PLAN and ARCHIVE.

### ST8 — Play-testing

The testers' matches with towers on, triaged with them; then the decision on §4's next tower.

---

## 6. Balance

- **The goal**: a player using a special tower wins **55–65%** against an equal player using none.
- **Measured** as this session's soaks were (ARCHIVE 13t–13v): two-player tables of equal bots,
  one with the tower and one without, seats alternating, 96 matches a tower at Levels 3, 5 and 8;
  and four-player tables, one bot with the tower against three without, wins against the fair
  share and points against the others, seats rotating — always beside a control on the same seeds,
  since 48 matches read ±4 wins of noise.
- **The levers**, coarse to fine: the cost (2 or 3), the footprint (2×2 or 3×3), each tower's own
  values (crater, flight factors, repair radius).
- **Watch**: failed rounds (an Architect may make turtles — ARCHIVE 10s found a turtle very hard to
  kill), match length, and the people's yardsticks (`shotStats.ts`, `buildStats.ts`).

---

## 7. Open questions, to decide before ST1

1. **Firing a special tower with the right button in combat** (§2.2) — or should a special tower
   fire as the nearest gun, like any other, with no choice?
2. **The Architect's timing**: repair as the build phase opens (proposed), or at the end of
   combat, before the banner?
3. **Several towers over a match**: one bought a round, kept for the match — so a long match may
   field five or six. Or a cap on towers owned (one or two)?
4. **Towers and `cannons.maxTotal`**: does a tower count as one cannon against the cap, or as its
   cost?
5. **Bots' loadout in rooms with people**: by personality always, or chosen by the host per seat?
6. **Tournaments**: off at first (proposed); towers for the field later?

---

## 8. Risks

- **Bots must use towers well**, or the feature is a person's advantage only and the balance goal
  cannot be measured. ST3 comes before the client for that reason.
- **Turtles**: a defensive tower may make a player very hard to put out, and matches long. Watch
  match length and eliminations in ST4.
- **Readability**: an emblem must read at a tile's size in every style, including the busy ones
  (Opera, Sakura, Noir). ST6 checks it by screenshots.
- **Old recordings** replay unchanged: ordinary cannons and absent fields mean what they meant.
