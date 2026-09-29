# Rampart Remake — design and open work

A multiplayer-only recreation of the 1990 Atari arcade game _Rampart_, condensed to a
single game mode, with online play, AI opponents, and fully procedural visual assets.

This file describes **the game as it is now, and what is left to do**. How each decision
was arrived at — with the measurements, and the attempts that were reverted — is in
[`ARCHIVE.md`](./ARCHIVE.md). Where the two disagree, this file is right.

**Values are not repeated here.** Every tunable lives in `config/*.json` behind a strict
schema; quoting numbers in prose only guarantees they drift. This file says what is
configurable and why it matters.

---

## 1. The game

### 1.1 Match structure

2–8 players, free-for-all or in equal teams (§1.8). Empty seats are filled by AI. Three
and four players are the focus. **Every match is a team match internally**: free-for-all
is teams of one, so a rule written for teams is the free-for-all rule too.

Every phase is simultaneous and real-time, and each is preceded by an **intermission**,
during which nothing is playable: shots still in the air land, then a pause, then the
announcement for the next phase crosses the screen. The next phase begins only once it
has left.

```
LOBBY
-> CASTLE_SELECT   pick one of the castles on your island
-> [a wall ring is auto-built around it]
-> CANNON_PLACE    place your opening cannons inside that ring
-> COMBAT          click targets; cannons lob shots at enemy walls
-> BUILD           place wall pieces on your island
-> [enclosure resolved; points banked; a player with no enclosed castle spends a life or is out]
-> CANNON_PLACE    place the cannons you earned, ending early once done
-> COMBAT ...
-> GAME_OVER       last player standing, or the best score at the round cap;
                   simultaneous elimination is a draw
```

Phase durations are in `ruleset.phases`. The intermission is not decoration: its length
is part of match timing, so every client has to agree on it.

### 1.2 Map

One island is drawn inside a rectangular box from the seed, **trimmed to its actual
land**, and stamped into N placements by translation and mirroring. Both transforms are
exact on a square grid, so every island is pixel-identical at every player count.

- **The map's size is measured, not configured.** It falls out of the island and the
  pattern, so two players get a small map and eight get a large one without either being
  cramped or swimming in ocean.
- `terrain.patterns` gives one arrangement per player count: a **grid** at 2, 4, 6 and 8,
  a **ring** at 3, 5 and 7. A ring puts every player the same distance from the same two
  neighbours; a grid is tighter but gives edge and middle seats different neighbourhoods.
  Exact fairness is not required — the higher counts exist for team modes, which rebalance
  by how the teams are drawn — so where the two differ the tighter map wins.
- Islands are separated by a channel of `island.minWaterGapTiles`, guaranteed by
  construction rather than tested for. **The channel must be measured from the land, not
  from the generation box**: an island fills about two thirds of its box, and spacing the
  boxes leaves an ocean between the players. Flight time scales with distance, so an ocean
  means slow artillery and matches that will not end.
- The generation box needs real slack over the target area. An island that nearly fills it
  has its coastline pinned by the frame rather than by the noise, and **every seed then
  produces the same map** — which generates perfectly and is caught only by a determinism
  test. The config validator refuses it.
- Each island carries the same number of castles, and **the starting ring is 8x8 around a
  6x6 interior**, as in the original. A castle sits centred in it, so the free band is
  exactly two tiles wide and a 2x2 cannon spans it: opening cannons _must_ touch the wall.
  That is geometry, not a bot failing.
- No fog of war; every island is fully visible to everyone.

### 1.3 Walls and enclosure

- Walls may only be placed on free land of your own island. You cannot build in or
  interfere with an opponent's territory.
- **The shoreline does not count as wall.** Enclosure is a flood from the map border
  across every non-wall tile — water included — and any castle not reached is enclosed.
- **The wall must turn its corners.** The escape flood is 8-connected while the wall is
  not, so the sea slips between two blocks meeting at a point: a diagonal join does not
  seal.
- A single sealed region containing K castles counts as K castles. Separate regions stack.
  This is the central tradeoff: a wide loop earns more cannons but leaves far more
  perimeter to repair each round.
- **A pocket — sealed ground with no castle in it — is territory for every purpose** (guns
  stand and fire there, its tiles score) **while its player holds a sealed castle
  somewhere**, as in the original (`enclosure.castlelessRegionsCount`). It is the island's
  player's alone, never a teammate's by way of their castle, and it never keeps anyone in
  the round: a player whose only sealed ground is pockets has failed, and loses the pockets
  with their last castle.
- **Orphaned wall is swept** between build and combat, in one pass: every block with fewer
  than two orthogonal wall neighbours is marked against the board as it stands, then the
  marked blocks go together. A run of three keeps its middle; a spur loses only its tip.
  Cascading instead takes far too much and means half-built wall can never carry across a
  round. Stranded wall is left standing as an obstacle. Orthogonal deliberately: that is
  the connectivity which makes a wall a wall, and it means **a loop enclosing anything can
  never be swept**.

### 1.4 Cannons

- 2x2 footprint, placed inside your own enclosed territory, including the opening ones.
  The game builds your starting ring, but every cannon you own you placed yourself.
- **Indestructible.** Only walls are damaged; castles and cannons are not.
- Reward per build phase is in `ruleset.cannons`: a fixed number for the first enclosed
  castle and more for each additional one.
- A cannon **not inside its owner's territory** (a castle's region or a counting pocket,
  §1.3) at a resolution is **inert**: it cannot fire,
  is not destroyed, and reactivates if re-enclosed. Breaching a leader's wall silences
  their guns. This is the game's main corrective and the source of most bot trouble.
- Firing: click a target; the nearest ready cannon fires. A cannon is ready only when it
  has no shot in flight — **there is no separate reload, so flight time _is_ the rate of
  fire**. Tune it against shots per cannon in round one, not against a match average.
- Flight time scales with distance. Unlimited range. A shot destroys exactly the tile it
  hits; wider craters remain available through `shots.craterPattern`.
- **Only an opponent's wall can be damaged.** `fire()` refuses a target on your own
  island, and an impact clears a wall only if a live opponent owns it — so a wide crater
  cannot reach your own, and an eliminated player's unowned rubble is indestructible.
  `shots.damagesOwnWalls` turns this off; self-inflicted damage never scores either way.

### 1.5 Continues

Failing to seal a castle spends a life rather than ending the match. The island is wiped —
cannons, shots in the air, and the wall itself — a castle is chosen again during the
coming cannon phase, a fresh ring goes up, and the player places the opening count plus
one cannon for each life already spent. Out of lives, failing is final.

A continue also **rewinds that player's piece schedule to round one**, so somebody
starting again gets the small pieces they need to close a ring while whoever has survived
longest goes on drawing the wide ones. That makes the schedule a personal difficulty ramp
keyed to how long you have held on — and it is why `build.sharedPieceSequence` is false.
The schema refuses the two being true together.

A player who lets the cannon phase run out without choosing gets a castle and guns picked
for them from a seeded stream, so hesitating does not cost a second life.

### 1.6 Build pieces

Tetromino-like wall pieces, drawn from a bag that **widens by round** (`build.sizeSchedule`)
— small pieces early, large ones late. That is the game's difficulty ramp.
`pieceAt(ruleset, seed, round, index)` is a pure function, so a client regenerates its own
queue rather than receiving it, and the match state stays a fixed size however long a
match runs.

Note the consequence: **one-cell pieces stop being dealt after the early rounds**, so a
one-tile gap with no free neighbour cannot be filled at all.

**Overtime.** When the build clock runs out, every player may still place the one piece
they are holding, within `build.overtimeMs` (3 s); no further piece is dealt, and the
window closes early once everyone still in has used it. Added after human play: a piece
being lined up as the clock hit zero was simply lost, which was frustrating out of all
proportion to what it decided. It gives everyone slightly more wall per round, which the
elimination baseline of 11.2 will be measured with. That is why a cannon jammed
against its own wall is a defensive problem and not merely an ugly one.

### 1.7 Scoring and the round cap

A match ends at the resolution of round `scoring.maxRounds` (default 10; a host picks 5
to 20), or earlier when one player is left. **The cap is the main win condition, not a
tie-breaker**: most matches reach it, so the scoring formula is the game's balance and
elimination the exception. At the cap the highest score among those still in wins, and a
tie is a shared win — which is not a draw. **A player who is out cannot win however many
points they had**, which keeps attacking worth it for somebody behind. Simultaneous
elimination is a draw whatever the scores.

Points are banked at each build-phase resolution, after the sweep, by every player holding
a sealed castle:

- `wallPoints` for each **opponent's** wall tile they destroyed that round;
- `tilePoints` × **total enclosed tiles × total enclosed castles**, across every region
  they hold. Totals, not per region: two one-castle loops of 30 tiles score 120, as one
  loop around both would. An enclosed tile is `territory === id + 1`, castle and cannon
  footprints included, so placing a gun never costs points — and pockets included
  (§1.3), which count for area but not as castles.

Failing to seal forfeits the round's points, damage included
(`scoreDamageOnFailedRound` turns that off), and spends a life as usual — in the final
round too. The HUD shows banked scores only, never a running tally that could still be
forfeited. `maxRounds: null` lifts the cap for tests; no host can choose it.

### 1.8 Teams

- **Equal teams only**: a team size needs at least two teams, so within 2–8 players size
  2 allows 4, 6 or 8; size 3 only 6; size 4 only 8. Odd counts are free-for-all.
- **No attacking a teammate in any way**: `fire()` refuses a teammate's island, an impact
  never clears a teammate's wall, bots never target one.
- **A shared score**, the sum of each member's own (their tiles × their castles, plus
  their damage).
- **Pooled lives**: a team starts with the sum of its members' continues; a member who
  fails spends one, and their own island is wiped as in §1.5. **A member failing with the
  pool empty puts the whole team out**, sealed members included. The continue bonus counts
  the team's lives spent, capped by `elimination.maxExtraCannons` (3).
- **Helping build**: a player may place pieces on a teammate's island, from their own
  queue. `teams.crossIslandBuild` says who may — `humans` by default, since a bot laying
  wall against a person's plan would be infuriating. The wall belongs to the island's
  owner, not the placer, so every other rule treats it as theirs. Cannons stay on your own
  territory.
- **Teams belong to seats; the host chooses who sits where.** Teams are seats in order
  (teams of two: seats 1–2 are Team A, 3–4 Team B), shown as one column each, and the host
  picks the occupant of every seat — a bot or any person at the table, by name — swapping
  with whoever sat there (`configure.move`). A bot keeps its skill when it moves. There is
  no per-seat team choice: moving one seat's team always unbalanced them, so it could only
  ever be refused. Which island each seat gets is shuffled at the start (§6), and the
  lobby's map shows the deal. Random islands were measured to decide nothing (ARCHIVE 10u).
- **Shown** by colour families — each team one hue, each member a shade — plus a team letter
  over every island, a roster grouped by team, and team wording on banners and the end
  screen. **The letter is the lobby's**: `denseTeams` numbers the host's labels in label
  order, so Team A in the lobby is Team A in play whichever seats the shuffle dealt where.

---

## 2. Technology

| Layer      | Choice                                                          | Rationale                                                                                                       |
| ---------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Language   | TypeScript 5.9.3, end to end                                    | One simulation shared by server, client, AI and tests. Pinned below 6 while `typescript-eslint` requires it     |
| Client     | Vite + PixiJS v8                                                | WebGL batching and filters for shots, explosions, water                                                         |
| Server     | Node + `ws`                                                     | Tiny protocol surface; a hand-rolled room layer beats fighting a framework's state-schema system on a tile grid |
| Transport  | WebSocket, JSON v1                                              | Input is about one message per second per player; binary is unnecessary                                         |
| Validation | zod, server-side                                                | Never trust a client message                                                                                    |
| Tests      | vitest                                                          | Fast, TS-native                                                                                                 |
| Packaging  | npm workspaces                                                  | Internal packages export TypeScript source, so there is no build step between them                              |
| Deploy     | Docker, one process serving the static client and the WebSocket | Fly.io / Railway / self-host                                                                                    |

Authoritative server, **no rollback netcode needed**: both phases are simultaneous but not
twitchy, and a shot's flight time absorbs RTT entirely.

---

## 3. Repository layout

```
RampartRemake/
├── config/            every tunable, as JSON behind a strict schema
├── assets/audio/      audio cues, committed — the image builds from a clean checkout
├── packages/
│   ├── config/        zod schemas, typed defaults, cross-file validation
│   ├── sim/           deterministic core — no DOM, no Node, no I/O
│   ├── protocol/      wire messages and validators
│   ├── ai/            bot logic
│   ├── analysis/      per-round match statistics, shared by the server and the harness
│   ├── server/        authoritative match server, and the recorder of every match
│   └── client/        renderer, UI, procedural asset generators
├── tools/headless/    bot-vs-bot harness for balance tuning and soak tests, and replays
├── recordings/        recorded matches and their statistics (git-ignored; §9)
└── Dockerfile         build the client, bundle the server, ship three directories
```

---

## 4. Configuration

**No rule is hardcoded.** Every tunable lives in `config/*.json` behind a strict schema —
an unknown key is an error, not a silently ignored one. The ruleset travels in the match
snapshot, because a client on different rules would desync rather than merely look wrong.

| File                   | Governs                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ruleset.default.json` | Phase lengths, cannon rewards and footprint, shot flight and damage, the piece catalogue and its size schedule, enclosure rules, elimination and continues, scoring and the round cap |
| `terrain.default.json` | Island size and shape, the generation box, castle placement, the starting ring, the per-player-count pattern table                                                                    |
| `ai.default.json`      | One profile per bot tier: pace and aim in milliseconds and human units, and playstyle switches                                                                                        |
| `art.default.json`     | Palettes, per-player colour ramps and each style's own over them, sprite generator parameters                                                                                         |
| `audio.manifest.json`  | Cue names to files; see `assets/audio/README.md` for what fires each one                                                                                                              |
| `server.default.json`  | Ports, room limits, rate limits, reconnect grace, and the bounds of what a host may set in the lobby                                                                                  |

`validateConfigBundle` checks what a single file cannot: that there are at least as many
player palettes as allowed players, that every playable count has a pattern, that a cannon
fits inside a starting ring, that the island does not fill its generation box, that the
lobby's round bounds include the ruleset's own cap, and that every audio cue in code exists
in the manifest.

---

## 5. `packages/sim` — the deterministic core

### 5.1 Determinism is not negotiable

`(seed, ruleset, ordered input log)` must always produce one identical match. The server
sends **actions and the tick they landed on**, not board state, and every client replays
them — so any nondeterminism is a desync, not a cosmetic bug.

- `Math.random`, `Date.now` and `performance` are banned in `sim` and `ai` by lint rule.
- `Math.sin/cos/sqrt` are implementation-approximated per spec, so `trig.ts` and `math.ts`
  provide exact replacements.
- Every tile layer is a typed array sized `width * height`; no floats in state.
- Every 30 ticks the server sends a state hash and clients check it.

Anything the sim must choose for a player — the fallback castle when somebody runs the
clock out, for instance — comes from `streamFor(seed, name)`, a pure function, so a replay
reproduces it like any other choice.

### 5.2 Core algorithms

- **Terrain**: noise inside a box, thresholded to a target area, eroded, largest component
  kept, castles placed by farthest-point sampling, then trimmed and stamped into the
  pattern.
- **Enclosure**: 8-connected flood from the border across non-wall tiles. What it does not
  reach is enclosed. Re-run whenever wall changes.
- **Sweep**: one marking pass over the wall graph, described in 1.3.
- **Shots**: flight ticks from distance; on impact the target tile is cleared if it is
  wall. The shooter is known; the wall's owner must be read _before_ it is cleared.
- **Resolution of a round**: resolve enclosure, award cannons, spend lives or eliminate,
  strip the eliminated, re-apply enclosure, sweep, re-apply enclosure, bank points, then
  check for the end of the match — one player left, or the round cap.

---

## 6. Netcode

The server owns the match. Clients send intents; the server validates, stamps a tick, and
broadcasts. **The server overwrites the `player` field of every incoming action with the
sender's seat**, so a client cannot act for someone else.

- **Nothing derivable is transmitted.** Terrain and the piece queue are regenerated from
  the seed; the snapshot carries only what cannot be derived.
- Clients run one tick behind the server's confirmed tick and apply committed actions.
- A dropped seat is handed to a bot so the match does not stall; the player gets their seat
  back on reconnect within the grace period.
- **Anyone at the table may pause a running match, and anyone resume it** — Esc, or the
  button beside the Sound switch; an overlay names who paused. Every timer is in ticks, so
  a paused room simply steps none: bots, phase clocks and reconnect grace all wait, and a
  recording gains nothing. Moves sent while paused are dropped, not queued. A pause made
  by somebody who then drops holds until anyone resumes. Offline, the local match is not
  advanced.
- Rooms are found by a short code from an alphabet chosen to avoid ambiguous characters.
- **One lobby for online and offline.** The lobby is one screen (`lobbyMarkup`) fed by a
  room when a server answers with a welcome within two seconds, and by a table held in the
  browser when not. Both change the table through one rule, `reshapeTable` in config. A
  room nobody else joined is played locally when the host starts it. Solo play never needs
  a network.
- **Seats are shuffled onto islands at the start**, seeded from the match seed, server and
  local alike. The sim's invariant that player p owns island p + 1 is untouched — it is
  the seats that move, and the server tells each connection which player it has become.
- **The seed is fixed when the table is set, not when the match starts**: a room draws it
  at creation and a local table from the browser's entropy as the lobby opens, and the
  host may draw another or type one (`configure.seed`; `?seed=N` for testing). Since
  terrain and the seat shuffle follow from the seed alone, the lobby shows the map that
  will be played and which island each seat gets, in the colour it will play.
- **Seats are held where the host put them** until the start: a newcomer takes the lowest
  free seat, somebody leaving moves nobody, a shrinking table brings anyone beyond it into
  a free seat, and whoever is moved is sent a fresh `welcome` with their new seat.
- **The host may put a bot in their own seat** (`configure.hostBot`) and watch: the server
  marks the seat a bot's, ignores the host's actions, and keeps it the bot's if they
  reconnect. With nobody else at the table that is a match of bots alone, which replaced
  the separate "watch the bots" button.
- **Lobby settings are a mechanism, not a special case**: an explicit list of typed
  settings (`config/src/settings.ts`), bounded by `server.lobbySettings`, accepted only
  from the host before the start, refused whole when out of bounds, and applied over the
  server's ruleset — which is re-validated and travels in the snapshot. `maxRounds` and
  `teamSize` exist; game speed is meant to join them.

---

## 7. `packages/client`

Six visual styles — Minimal (`flat`), Pixel art, Night, Cyberpunk, Blueprint and
Parchment — behind one `Theme` interface: the scene owns the camera, the layer stacks,
dirty tracking and input mapping; a theme owns only what things look like. Adding a style
is a name in `ArtStyleSchema`, the looks it is made for in `STYLE_LOOKS`, a `Theme`, a
case in `createTheme`, a menu title in `decor.ts` and a banner class in `hud.ts`; the
types refuse a style missing any of them. One more is planned, Toy bricks (11.11 W8). All
sprites are generated at boot from `art.default.json` plus the match seed — nothing binary
is committed except audio.

**Night is torchlit** (`art.night`): two torches flank the gate of every sealed castle
with a warm pool of light on the ground round them, doused with a puff of smoke by a
breach and lit again by sealing, so lit reads as sealed across the map; muzzle flashes
light the ground round a gun, shots glow as burning shot, and a smouldering breach
glows. The light on the ground is drawn in the territory layer, under the walls, so it
never colours them. On the sea, a path of moonlight shimmers down the deeper band of
open ocean, a lighthouse stands off the outward corner of every island with its beam
turning over the water (lit into the ground, like the pools), and fireflies wink over the
land.

**The pixel style's day and weather** (`pixel/atmosphere.ts`, `art.pixel`): the light
follows the round, morning gold at the first, plain at noon, sunset at the last, as a
tint on the ground and sea under the walls, so no player's colour moves. Each match has
weather drawn from its seed: clear, overcast (more clouds, darker, a grey cast), rain
(streaks and rings on the sea, as well) or fog (pale banks drifting where the clouds'
shadows would). Cyberpunk has thin rain of its own, and a wall hit's flash splits into
its colours for a moment.

**Rules every style keeps**, so the looks can swap mid-match:

- **A player keeps their hue across the look swap.** If red became magenta under the
  banner, nobody could follow who is who. A theme may restyle a player's colour — neon,
  ink, pastel — but not change it; the eight colours and the team families must stay
  distinguishable in every theme.
- **Information stays readable**: the flood of newly sealed ground, the red mark over
  your own wall, the overtime border, the aiming cursor. These are shared helpers in
  `theme.ts`; a theme restyles them only where it keeps them legible.
- **Land, sea, wall and sealed ground tell apart at a glance**, including in a dark
  theme.

**Each style has colours of its own** (`stylePalettes`): any palette entries, and the
player ramps and team families whole, laid over the shared ones by `artForStyle`, which is
what every theme is handed. What a style leaves out it shares, and a style may be an
existing theme under new colours — **Night** is the pixel theme under its own palette. **A style may restyle a
player's colour but not move its hue** more than `MAX_STYLE_HUE_SHIFT`, since the looks
swap mid-match; the schema refuses it, and ramps that drop, reorder or rename players. The
HUD, menu and lobby keep the shared colours. Each look fills the window behind the board
with its own sea, so a wipe splits the margins as it splits the board.

Audio is driven by simulation events, so what a player hears is what the server actually
did. Missing files are silent by design, which is what lets the game ship before the audio
does. **A missing file cannot be told from its HTTP status** — the static handler answers
an unknown path with `index.html` and a 200 — so absence is detected by failure to decode,
and a corrupt file is silent rather than noisy.

**Each banner is drawn in the look it brings** (`BANNER_CLASS` in `hud.ts`, a record
over every style): flat gold for Minimal, a neon strip that flickers on for Cyberpunk, a
title block of deeper blue paper ruled double for Blueprint, an inked ribbon with forked
ends for Parchment, and the dark band with gold for Pixel art and Night.

**Two looks, swapped by the banners, as in the original** (`transition.ts`). Each player
chooses a style for building and one for combat (`art.styles`: flat and pixel by
default). Combat is drawn in the combat look, everything else in the build look, and the
banners either side of combat change one for the other as they cross the board — above
the banner's middle already the new look, below it still the old. The banner after the
build phase carries the sweep instead: the sim sweeps at the resolution, and the client
keeps drawing the swept blocks until the banner's line passes their row, when each
crumbles. The banner's position is a pure function of the sim clock, so the wipe is
always exactly beneath it. Both themes live for the whole match in separate layer stacks
under masked roots; the hidden one is only marked stale, and redrawn as a wipe reveals
it. The same style for both looks is one theme, and a banner then changes nothing.

**Anything in the client that depends on the clock cannot be verified headlessly.** A
watched match is still on round 0 after two minutes of virtual time, because the render
loop is barely driven; headless Chrome catches a crash on load and nothing else. The
pattern that works is to pull the decision out into a pure function and test that —
`bannersFor` in `banners.ts`, `lobbyMarkup` in `lobby.ts`, the score text in `scores.ts`.

**The menu and lobby** are dressed in the game's own art (`decor.ts`): **every style has
a title of its own**, the same 5x7 letters in its look — stone threaded with gold for
Pixel art, flat blocks in the players' colours for Minimal, moonlit stone with a halo
and stars for Night, a neon sign that flickers on for Cyberpunk. **The menu shows both
chosen looks at once** (`SplitTitle`): the build look's title above a banner's gold line
and the combat look's below, the letters coinciding, since `titleLayout` sizes every
title so they stand in one place whatever room its glow needs. The line sweeps across as
the menu opens, as either choice changes, and every `menu.titleSweepEveryMs` — a round in
miniature, each banner bringing the arriving look above it as on the board: down out of
the word, a combat banner across it, a build banner back to the middle. Still under
reduced motion; one title and no line when both looks are one style. Behind the panel the pixel
sea drifts. The lobby shows the map the table will play (`preview.ts`) — each island in the colour its seat will play and numbered
for it, the viewer's own ringed — beside seat cards that carry the same number and
colour, a rank badge per bot tier, and columns per team. A newcomer's card flashes as they
sit down.

**The end of a round and of a match** (V6). Points banked at a resolution count up in the
island's banner, total and all, while a glow sweeps the island's territory outward from
its castles, both over `effects.tallyMs`. A lost life takes the island's wall down outward
from its middle over `effects.lifeCrumbleMs` instead of clearing it in a frame (the
cannons, removed from the state outright, still go at once). Once the match is over,
fireworks burst over the winners' islands in their colours for as long as the screen
stays up, and **the summary** (`summary.ts`) gives each player — each team, in a team
match — the wall they destroyed, the most castles held at once and the lives lost, with
every score charted round by round, the viewer's line heaviest. It is kept from the
events as they arrive, so a client that joined part-way charts from where it came in,
and one that saw no resolution shows the standings alone.

**Territory holds through combat, as in the original, and is drawn as the board stands
everywhere else.** The client recomputes the enclosure for display whenever structures
change — not the sim's own, which is refreshed at placements and resolutions but not
when shots land, and which left a castle breached in combat shaded into the build phase,
where it read as the sea counting as wall. But a breach counts for nothing until then,
so **the combat look shows the enclosure as combat began** (`holdsCombatEnclosure`),
through combat and the landing of its last shots: territory and everything that says
"sealed" — flags, Cyberpunk's cores, Night's torches, Parchment's seals, Blueprint's
keeps — stay up while the walls come down. The build look always shows the board as it
stands, so the "Rebuild" banner reveals what was lost as it crosses; with one style for
both looks the switch comes as building begins. The roster's castle count holds with the
combat look and updates as building begins.

**Combat aids** (`ReloadRings`, `drawAimLine`, shared by every style). A ring round
each of the player's own guns fills as its shot flies and flashes off the gun as it
lands, since flight time is the reload and nothing else says which guns can fire; ready
guns carry none. While aiming, a dotted arc runs from the gun a click would fire —
chosen by `findReadyCannon`, the rule `fire` uses — to the cursor, lifted as the shot
will be, with a ring round that gun; only where a click would fire.

**Before the match.** The lobby's map is drawn in the chosen build look's colours, its
seat numbers and ring in the shared ink. The castles a player may choose breathe in the
accent (`drawSelectable`), and every choice, anyone's, sets off rings in the chooser's
colour from the castle (`drawChoices`). The menu's **Effects** setting, high, full or
reduced (`motion.ts`): reduced does what the system's reduced-motion setting does — no
flicker, no beat, no slide, no title sweep, no rain — and also stops the board's shake;
either one reduces. High is full with the glow of Night and Cyberpunk bloomed by a real
blur filter, asked for rather than given since it costs frame rate at eight players.

**The roster** is kept across frames rather than rebuilt, so its entries can move:
free-for-all is in standing, best first, and a change of places slides; scores count up
as they bank, over `effects.tallyMs`, as the island banners do; a team match keeps team
order. Past four players in free-for-all an entry is icons — ♜ castles, ⊙ guns, the
lives pips — with the words on hover, so eight fit one line at 1280 pixels wide. The big
timer beats on each of the last three seconds, with the clock's tick.

**Feedback a player builds by.** While nothing of yours is sealed, your castles are
outlined (`hints.ts`). The menu's **Sealing preview**, off by default (`sealPreview.ts`),
washes and outlines the ground the piece in hand would seal, by the sim's own enclosure
with the piece stood in as wall; it is for testers to judge, since it carries information.
The held piece casts a soft shadow and swings as it turns (`GhostMotion`); a placed gun
settles as a piece does; a knocked-out island's castles burn and then smoke for the rest
of the match (`RuinSmoke`), and in Pixel art and Night fly their flags at half-mast. Wall
shot away throws chunks that bounce once and lie as rubble while the breach smoulders, and
Blueprint smudges where the block was erased and sketches over a piece before inking it. The gap itself used to be marked too, and was removed after the
first human play: the marks were hard to tell from the piece ghost and from laid wall, and
read as the only way to repair it when any closing shape will do. Points float up from
each island as they are banked. **The time left** runs as a bar under the HUD and, in
large faint figures, in open water near the middle of the map (`timerSpot.ts`: the
largest all-water square close to the centre, 3x3 to 5x5, found once per match). **The
aiming cursor** says whether a click will fire — a bright crosshair when a gun is ready,
a small grey ring struck through when none is — with the number ready beside it; it
appears as "Fire!" is announced, though a click does nothing until the phase opens. When
placing cannons the same badge counts the guns still to place. The points an island
banked hold over it with the new total for the whole intermission
(`hud.pointsBannerMs`). A lost life lands as a banner over the island, red on the last; a
knockout stamps the island and greys it for the rest of the match.

**The build phase, felt** (`seal.ts`, `art.effects`). Sealing is drawn as ground being
taken: whenever the board's enclosure gains territory — a breach closed, a castle chosen,
a loop widened — the new ground floods outward from the castle, or from the edge of what
was already held, with a bright front running ahead of the paving. Every sealed castle
hoists a flag, in both styles, from the foot of its pole. A placed piece settles onto its
tiles from slightly large and bright, and in pixel style kicks up dust from its outer
edges. In pixel style the piece in hand is drawn as the wall it would make, joined to
itself and to the wall standing, and outlined in valid or invalid ink round its outside.
Overtime rings the board in a pulsing red border. All shared effects are drawn alike in
both styles where they carry information.

**Combat, in pixel style.** Barrels turn to their target, recoil and flash; destroyed
wall throws debris in its owner's colour; shots trail; the board shakes, but only when a
shot breaks your own wall. The flat style stays plain, as the one to debug against.

**The pixel style is the cinematic one**, since it is the default combat look. Light falls
from the north: a wall block with nothing to its south shows a dark front face under a
light lip, and walls, castles and guns cast a shadow onto the ground south of them. Sealed
ground is paved in the owner's colour rather than tinted. Castles are a curtain wall
round a paved court, a round tower at each corner and a keep under a hipped roof, its
windows lit while the castle is sealed; guns stand in a stone pit on a wooden carriage
that turns and runs back with the barrel, the wood untinted and the iron in the owner's
colour. The coast is a beach of its own sprite, tinted only faintly so it reads as sand,
rounded where the land turns outward and filled in where it turns in (`coast.ts`) — never
across a diagonal join, which the sea passes. The sea darkens with distance from land,
surf breathes along the coasts, its tiles come in variants so it shows no grid, glints
wink on it and crests drift on open water, and clouds' shadows pass over the board
(`art.pixel`; none at Night, glints and crests none under reduced motion). A shot on land leaves a scorch mark that
fades over `fx.craterRounds`; the blocks either side of a breach crack for the rest of the
round. An eliminated player's wall is rubble, and an inert gun slumps its barrel and
smoulders instead of being struck through.

**Combat, felt.** In pixel style a shot grows toward the top of its arc as its shadow
shrinks and fades; what it hits decides how it lands — a plume and rings in the sea, a
blast and dust on open ground, a blast on a wall that leaves the breach smouldering with
dark smoke and embers for `fx.smoulderMs` — and each gun puffs smoke from its muzzle as it
fires. In both styles the mark where a shot will land pulses ever faster as it nears, and
turns red and thick when it is coming down on the watching player's own wall; and a
breached castle's flag is lowered, struck in a darker shade, rather than vanishing.

**Cyberpunk** (`cyberpunk.ts`), for either look. The board as a circuit at night: **brightness means structure and colour ownership**. Walls are a neon line round
the outside of each run's top in the owner's colour, over a body with each block's cell
faint in it, so a thick wall still shows the block a shot takes. **Walls stand up as the
pixel style's do, to the same height** (`frontFacePx`), so the two agree as the banner
swaps them: a block with nothing to its south shows a darker front face with a strip of
light, and the owner's colour spills onto the ground in front, where a shadow would vanish
on a board this dark. Castles have faces too, in the pixel keep's proportion, and guns
stand on a mount whose side shows; land is a dark grid
tinted faintly by owner; the sea is near black, crossed by seeded circuit traces kept
clear of the coast and fading toward it, with pulses running along them. Castles are
housings with a core that blazes and breathes while sealed and dims when breached, and
fly a hologram flag that flickers on and flickers out as it is lowered. Sealed ground is
a lit grid floor. Shots are plasma tracers with a point on the ground below; an impact
is a flash, a ring and a moment of glitch; a breach shorts out in arcs that die away;
guns throw sparks instead of smoke and flicker as they lose or regain power. Glow is a
wider shape on an additive layer under each bright line, not a bloom filter. Its player
ramps are neon restylings of the shared ones, the same hues with each team family's
order of lightness kept, so teammates still tell apart.

While building, the piece in hand is drawn as the wall it will make — joined to the
wall standing, faces and all, outlined in the valid ink — and where it does not fit as a
hollow red outline: a wall in red would be the crimson player's own colour, so the
difference is in form, not hue. A gun being placed is its lit ring, struck through where
it cannot go. A placed piece throws sparks off its outer edges.

**Blueprint** (`blueprint.ts`), for either look: an architect's plan in ink on blue
paper. A drafting grid over the whole sheet, heavier every few tiles; the sea hatched as
a plan marks water, the coast a bold white contour. Walls are outlined and hatched
inside, as walls are on a plan, and stand up to the pixel style's height; castles are a
keep in plan with round corner towers, filled in while sealed and flying a pennant;
guns are survey marks with an arrowhead barrel, silenced ones a dashed ring in the owner's ink. Sealed
ground is cross-hatched in the owner's ink inside a dashed boundary. Shots are a
projectile symbol riding a dashed trajectory; a block shot away is crossed out in red
for as long as the pixel breach would smoulder. The piece in hand is dashed, as proposed
construction is — hatched where it fits, crossed out where it does not. Player colours
are the shared hues washed toward white, so they read on blue.

**Parchment** (`parchment.ts`), for either look, and the one light style: an old map in
ink and watercolour. Generated paper grain, a few stains and darkened edges; a sea
washed a faded grey-green against the warm paper of the land, a bold ink coast with an
engraver's contour rippling out from it, wave strokes on the open sea, and a compass rose
in the sea's bottom-right corner, clear of the HUD and the big timer (`roseSpot`). Walls are inked stone, their faces cross-hatched,
casting a shadow on the paper; castles are drawn with battlements and a gate. Sealed
ground is an uneven watercolour wash pooling at its edge, inside a dotted border, and a
sealed castle bears **a wax seal in its owner's colour**, pressed on as it seals and
cracking in two when it is breached. Shots are ink dots on a dotted course and leave ink
stains that fade over `fx.craterRounds`. Its colours are ink dark enough to read on
paper, `uiInk` included, which the shared helpers draw their warnings in.

The three shape-drawn styles share `walls.ts`: the wall geometry (tops, faces, rim), and
hatching laid on one lattice so neighbouring tiles hatch as one fill.

**Scenery on open land** (`scenery.ts`, `art.scenery`), in every style: copses of trees and
pines with bushes at their edges, and a few lone trees, bushes and boulders, placed from
the seed alone so every look puts them on the same tiles — only a step in from the coast,
and not on or beside a castle. Each style draws its own: trees in Pixel art and Night, a
landscape plan's scalloped canopies in Blueprint, inked trees in Parchment, dim nodes in
Cyberpunk, a faint dot in Minimal. **It must never read as wall**, nor as a gun or a
shot: Blueprint's trees were first a circle with a cross, a gun's survey mark in small,
and Pixel art's boulders a round grey rock, a cannonball's double. A tile once built on or
sealed is cleared for the rest of the match, so nothing grows back through a breach; a
piece landing on scenery knocks it flat with a puff, told to the looks on screen only.
The pixel style also keeps **life on the outer ocean** (`pixel/ocean.ts`): a boat under
sail now and then, gulls wheeling, a fish jumping — outside the box round all the land,
where no shot ever flies, and none of it under reduced motion.

**Looking at it.** `tools/screenshots.sh` captures fixed states against the dev server —
in real time through Playwright, which renders fine where virtual time does not — using
`&snapshot`, `&round`, `&idle` and a wait. Anything lasting under a second (debris, the
shake) still has to be seen by a person.

---

## 8. `packages/ai`

Bots play through the same validated action API as a person, so they cannot cheat by
construction, and the soak asserts they never ask for a move the rules refuse.

- **Sealing is a minimum cut.** Enclosure is an escape flood, so sealing is cutting every
  path: buildable tiles get capacity one, everything else infinity, and the minimum cut
  between border and castle is the smallest wall that works. Built over the bot's own
  island alone, which is exact and far faster than the whole grid.
- **A minimum cut is the _tightest_ wall that works** — which is exactly the wall with
  nowhere to put a gun, and the most fragile one. Nearly every bot problem traces back to
  this. Once sealed, `widestAffordable` asks for room first and gives it up a tile at a
  time until the plan fits the phase's budget.
- **But when breached, the tightest wall that keeps the guns comes first**, and room is
  bought once something is sealed. Asking for room first is what lost a quarter of all
  rounds 1–3 cells short (ARCHIVE 10s). A bot counts its sealed castles with
  `computeEnclosure`, never from `enclosedCastles`, which landing shots do not refresh.
- **Cannons are never pinned when there is any alternative**: a spot beside a wall block
  with nothing buildable beyond it is where one shot makes a hole only a one-cell piece
  fits. Then clearance from wall and shore, then range.
- **Attacking is a 0-1 BFS** from the border, free across open ground and one per wall
  block, which finds the thinnest part of a defence. One shot per tile: a shot destroys
  exactly the tile it hits, so a second is always wasted.
- **Pace is in human units** — milliseconds per placement, scaling with piece size — so a
  bot slows as the piece schedule widens, for the same reason a person does.
- A bot **does not idle while anything is worth building**. Choices are tried in turn —
  the plan, thickening, the next castle (up to every castle on the island), more room,
  and finally any tile against the outside of its wall — skipping tiles already found
  unreachable, and a failed fit falls through to the next rather than pausing.
  Affordability governs whether to commit to a plan over staying alive; it does not govern
  spending time nobody else wants.

**Teammates are never targets**, and cannons face the other teams' castles. Bots build
only on their own island, so they never help a teammate, whatever the rule allows.

Four tiers: **recruit**, **gunner** and **marshal** differ in aim, target choice, ambition,
replanning rate and pace; **baron** has marshal's skill with a different playstyle —
reaching for the next castle the moment it holds one (`expandsWhenSealed`, `maxCastles`
4). It is as strong as marshal, not stronger, and exists for variety. Measured 2026-09-25
at three players, both seats: marshal beats two gunners 29 of 40, baron 28; gunner beats
two recruits 9 of 12. Records in the archive from before 10l are historical.

---

## 9. Testing

- **Unit** — enclosure golden cases, sweep geometry, placement validation, crater
  application, reward maths, scoring.
- **Determinism** — `(seed, ruleset, input log) -> state hash` must be stable; recorded
  logs are replayed in CI.
- **Property/fuzz** — random valid input streams; assert invariants.
- **Terrain** — generated maps satisfy every fairness constraint across many seeds at
  every player count, and **vary between seeds**, which is a different question from
  fitting.
- **Server integration** — in-process fake sockets: join, reconnect, rejected inputs,
  bot takeover, a full table.
- **Headless harness** — `tools/headless` runs bot-vs-bot matches without rendering.
  `--stats FILE` writes a row per player per round at each resolution; prefer it to
  watching. Watching is for forming the hypothesis.
- **Recorded human play** — every match is recorded to `recordings/` as it runs: the
  server writes its rooms' matches, and a local match sends its lines to the server that
  served the page. When a match ends the server writes its statistics beside it
  (`<id>.stats.csv`); `--replay FILES|DIRS` does the same by hand, and checks each replay
  exact. `recordings.enabled` in the server config turns it all off. Recordings replay exactly
  only against the code that made them, so **the server stamps every header with its
  commit** (`-dirty` with uncommitted changes; `RAMPART_COMMIT` in the image, which has no
  repository), and `--replay` names it, and says to check it out when a replay diverges.
  A person's seat has no pieces budget, and its cell in the table is left empty.

Tests state expectations as ASCII pictures where the subject is geometric
(`stateFromAscii`, with an optional island overlay for walls and castles that belong to
someone other than island 1). A test that asserts "failing to seal ends your match" needs
`withoutContinues`, and so does anything measuring the piece-size ramp; anything about
elimination or long matches needs `withoutRoundCap`. Enclosure in real play is checked at
every resolution against an independent search, not only on unit pictures.

---

## 10. Milestones

| #   | Goal                                                      | State                   |
| --- | --------------------------------------------------------- | ----------------------- |
| M0  | Scaffold, config schemas, CI                              | Done                    |
| M1  | Simulation core                                           | Done                    |
| M2  | Playable locally, placeholder art                         | Done                    |
| M3  | Style abstraction, then procedural art                    | Done                    |
| M4  | Online multiplayer                                        | Done                    |
| M5  | AI opponents                                              | Done                    |
| M6  | Full scope: 2–8 players, audio, lobby, Docker, deployment | Done, one sound to come |
| M7  | Balance pass                                              | **In progress**         |
| M8  | Team mode, and one lobby for online and offline           | Done                    |
| M9  | Visual pass: phase themes, banner wipe, effects, lobby    | Done (ARCHIVE 11h)      |
| M10 | Alternative visual themes: Night, Blueprint, Cyberpunk…   | Done (ARCHIVE 11h)      |
| M11 | UI and effects polish: roster, combat aids, summary…      | Done (ARCHIVE 11h)      |
| M12 | Second visual pass: scenery, atmosphere, Toy bricks       | **In progress** (11.11) |

---

## 11. Open work

**Where to start (2026-09-29).** The first compiled feedback from the test sessions is in
**11.12**: its small fixes are done (ARCHIVE 11n), and its three agreed items come next, in
order — castle-less pockets as territory (done, ARCHIVE 11o; it had to land before 11.2's
baseline), pause (done, ARCHIVE 11p), then **an open games browser**.

**Before that (2026-09-28).** The user is running human test sessions, and every match
is recorded with its statistics (§9, ARCHIVE 11e); the user will also send compiled
feedback. The next milestone is **11.2, elimination tuning**: its plan is ready, starts
with a baseline measurement, and can now set the bots against rounds people actually
played — `recordings/*.stats.csv`, or `--replay` over the folder. A recording replays
exactly only against the commit it was made with, which the server now writes into each
recording's header. Independent of balance: **11.6**, bots as personality × skill,
and **11.11**, the second visual pass, which runs while the sessions go on. Smaller items are
in 11.5.

Only open work is kept here. Finished packages move to `ARCHIVE.md` under their old
numbers — 11.1 scoring, 11.7 team mode, 11.8 the visual pass, 11.9 the themes, 11.10 the
UI polish, all in ARCHIVE 11h — so the open sections keep theirs.

### 11.2 Elimination tuning — planned, waiting on human play

**Agreed 2026-09-25, not started.** The user is playing test sessions first, so the
tuning is not fitted to the bots alone; those sessions are recorded (§9), and the user
will send compiled feedback.

**Changed since it was planned**: overtime shipped (§1.6), a little more wall per round
for everyone; and team matches eliminate even less than free-for-all — 5 in 180 at gunner
(ARCHIVE 10u), since a pooled life lasts a team longer. Measure 2v2 alongside three and
four players.

**Target:** at three and four players, about **half of matches end with one player left
before the cap**, under the default rules — a 10-round cap, combat and build phases as
they are. Demanding: it needs two or three players knocked out, each failing to seal
one time more than their lives allow, inside ten rounds. Today's bots manage 0 of 8.

**The weights stay.** They were taken from the original and are believed sound, and they
barely decide how often somebody is knocked out: that comes from how often walls fail
(attack against repair speed), how many lives there are, and how many rounds there are
to fail in. The weights decide who wins at the cap, and shape eliminations only through
how much risk players take. The formula already rewards size strongly — two castles in 60
tiles score 120 a round against 30 for one in 30, so the bigger wall is worth trying
unless it fails more than about 75% of the time. That the bots turtle anyway is their
risk model (affordability, never points), not the formula.

**The soak's limit.** It measures bots, and today's are careful: they forfeit about 11% of
rounds, which makes three failures in ten rounds — two continues and the last — roughly
a one-in-forty event per player. A person reaching for more ground fails more often.
Human testing is not available at scale, so the bots have to bracket human play instead.

Before this state, three gunners over eight matches, before and after bots learned to
close a breach first (10s): forfeits 22% -> 11%, territory per sealed round 80 -> 41,
castles 1.17 -> 0.92, matches won by elimination 3/8 -> 0/8. Later fixes took territory
back to 52 and castles to 1.03; eliminations stayed at zero.

**Levers agreed:** continues 2 -> 1; **a placement delay**, new; and, to be measured rather
than assumed, bot targeting. **Not levers:** the cap length, and combat and build times.

#### Steps

1. **Baseline at three and four players**, current rules — all-gunner, all-marshal, and a
   mixed table with baron. Share ending with one player left, eliminations per match,
   lives spent, forfeit rate, and the round each elimination happens in. Measurement only.
2. **An ambitious, points-driven personality**, the first piece of 11.6: it chooses plans
   by expected points rather than by affordability alone — bigger walls, more castles,
   more risk — standing in for the way people play. Every lever is then measured against
   both the careful bots and this one, and the answer should lie between them.
3. **Placement delay, `build.placementCooldownMs`**: after placing a piece, a player
   cannot place another until it has passed. Enforced by the sim for everyone, in ticks
   and per player, so it stays deterministic and is hashed and snapshotted. The client
   shows the cooldown on the piece preview. Bots wait for it, and **their budget must
   include it** — an optimistic estimate of how many pieces fit a phase is exactly what
   cost them a quarter of their rounds (10s). Per piece, a fixed time, to start with;
   scaling with piece size is the variant to try if a fixed delay is too blunt. Default 0
   until measured.
4. **A small grid**: continues 2 or 1, delay 0 and a few values up to about a second —
   measured at three and four players against both ends of the bracket, both seats.
   Choose the setting nearest half on a mixed table.
5. **Guardrails before choosing**, so the target is not bought with a worse game: hardly
   anyone out in rounds 1–2 (an early knockout feels bad, and continues exist to prevent
   it); the ladder still ordered; two players not noticeably worse (11.3).

**Targeting, a third lever to measure in step 4.** Bots that pick targets shoot the
strongest opponent, which spreads damage and keeps everyone alive — the opposite of what
this target needs. Finishing off the weakest, as a personality trait (11.6), may matter
as much as either rule.

**Recording it** (ARCHIVE 11e): every test match lands in `recordings/` with its
statistics beside it once it ends — the same per-round table the bots produce — so how often a person loses a
castle, how much of the build phase they use and what repair they leave undone are
measured, not recalled. The user's impressions come separately, as compiled feedback.

**The first human game** (2026-09-28, one person against two gunners, ten rounds, in
`recordings/`): the person won on points, 1658 to 1245 and 1062, and failed to seal in
two rounds of ten — 20%, about twice the bots' 11%. One game; the number the bracket
rests on, to be firmed up by the sessions still to come.

**What to take from the user's play first:** whether building already feels tight at
default speed, whether a delay would feel like a penalty or like the original's pace,
and how often a person actually loses a castle — the number the whole bracket rests on.

### 11.3 Two-player balance

The worst thing in the project. At gunner, over ten seeds: **33.8 rounds average, three
matches unfinished, cannon room 0.7, and only 48% of the build phase used.** Three players
is healthy by comparison at 12.3 rounds. The bots are back to cramped walls with idle guns
— the failure mode of 10h — because the smaller starting ring plus heavier incoming fire
leaves no budget for room.

Levers not yet tried: `cannons.maxTotal` (still `null`), the opening cannon count, and the
combat-to-build ratio. **Needs re-measuring before anything is tried**: that figure predates
the round cap and the bots of 10s. At the cap, eight two-player gunner matches all reached
round 10, two ending by elimination. Best done after 11.2, since the weights change what
balanced means.

### 11.4 Measurements never taken

- **Position bias** at 4, 6 and 8 players, where grids give islands structurally different
  neighbourhoods. Seats are shuffled onto islands now, so no seat is favoured, but an
  island position still could be — it would show as the player on it winning more often,
  whoever that is. At three players the gap seen in 10s was mostly a bot bug; with it fixed
  marshal wins about equally from either island.
- **The full difficulty ladder**, every pairing and more than three players. Measured so
  far only at three: marshal and baron over gunner, gunner over recruit.
- **`resetPieceScheduleOnContinue`**, against the alternative. Only the "on" setting has
  ever run.

### 11.5 Smaller

- Audio files: 18 of 19 cues supplied. Still missing: `wall_destroyed` — the user's to
  produce; the manifest names it and every trigger is wired. A test keeps the manifest and
  the folder in step.
- Islands look boxy; `coastlineRoughness` and `noiseFrequency` are config.
- Rings at 5 and 7 players make considerably larger maps than grids would. One JSON edit.
- **Bots do not help a teammate build**, even under `crossIslandBuild: all` — teaching
  one to help without wrecking a person's plan is its own question (team mode, §1.8).

### 11.6 Bots as personality and skill

Today a tier bundles two things: **skill** — pace and aim (`placement*Ms`,
`fireIntervalMs`, `aimJitter`, `replanTicks`) — and **personality** — how it plays
(`maxCastles`, `riskMargin`, `picksTarget`, `thickens`, `expandsWhenSealed`). Split them,
so a seat is a pair and the combinations make for more varied opponents. The profile fields
already fall cleanly into the two groups. Open: the set of personalities (for instance
aggressive, defensive, expander), how the lobby offers the pair, and whether
`server.botDifficulty` becomes two settings. Independent of balance, so it can run beside
11.2.

**Pockets** (§1.3, ARCHIVE 11o): bots obey the rule but never wall a pocket on purpose,
which is why turning it on moved the soak not at all. A personality that walls small gun
pockets beside its castle loop — cheap room for guns that go silent with the castle — is a
candidate, and the one way the soak would ever measure what the rule does to balance.

---

### 11.11 Second visual pass — agreed, in progress

**Agreed with the user 2026-09-28**, to run while human testing goes on. Display only,
like 11.8–11.10: no sim, protocol or ruleset change, so it cannot desync a match or move a
balance measurement. The same discipline: anything timed is a pure function with tests,
every package adds scenes to `tools/screenshots.sh`, tunables go in `art.default.json`,
and anything under a second is left for a person to see. The §7 rules every style keeps
still hold — a player keeps their hue, information stays readable, land, sea, wall and
sealed ground tell apart. Considered and dropped by the user: a timelapse replay at game
over (close to the deferred "shipped replays", §12) and an attract mode behind the menu —
too much work for too little in play. Of the new styles offered (an Arcade 1990 tribute
with a CRT filter, Winter, Terminal, High contrast, Woodblock), only Toy bricks is taken.

Packages in order; W1 first and W8 last, W7 before W8, the rest independent.

**W1 — Fixes and readability — done** (ARCHIVE 11i): Blueprint's stray line, Parchment's
sea washed apart from its land, its compass rose moved off the big timer, Blueprint's
inert guns in the owner's ink.

**W2 — Pixel art upgrade — done** (ARCHIVE 11j): castles with towers, a keep and lit
windows; guns on carriages in stone pits; beaches and a rounded coast; a sea without a
grid, with glints and crests; cloud shadows. Night took all of it but the clouds.

**W3 — Living land — done** (ARCHIVE 11k): scenery on open land in all six styles,
cleared by building and sealing; boats, gulls and fish on the outer ocean in Pixel art
and Night. Fields were left out: flat patches of colour read as sealed ground.

**W4 — Atmosphere — done** (ARCHIVE 11l): the day by round and weather per match in
Pixel art; the moon's path, lighthouses and fireflies at Night; Cyberpunk's rain and
colour split; bloom behind a new High Effects setting.

**W5 — The board, felt — done** (ARCHIVE 11m): wall chunks, Blueprint's smudges and
pencil, guns set down as pieces are, the piece's shadow and swing, knockout smoke and
half-mast flags, and the sealing preview behind a menu setting, off by default — **for
the testers to try** before it is ever on by default.

**W6 — Moments** (M).

- **"You are here"** as the match opens: a spotlight or marker on the viewer's island
  during castle choice, since seats are shuffled onto islands.
- A camera fly-in at the start and a slow push onto the winner at game over, only while
  nothing is playable; input mapping must stay exact, and reduced motion keeps it still.
- The final round marked: its own banner, a stamp, a change of light.
- A filmstrip in the summary: the board at each round's resolution, beside the chart.

**W7 — The UI in each look** (M).

- The HUD bar dressed per style, as the banners are — a record over every style, so a new
  one must bring it. The dark monospace bar sits worst over Parchment.
- The holding / next box drawn in the current look.
- The lobby's map alive: surf breathing, the castles breathing.

**W8 — Toy bricks** (M–L), a seventh style, for either look. Walls as studded plastic
bricks, which suits pieces that are already tetrominoes; pieces click down, guns are built
of bricks, the sea is a blue baseplate, player colours bright and clean. Last, so it is
built against the finished interfaces: besides the palette, title and banner every style
brings, its own scenery (W3), atmosphere (W4) and HUD skin (W7).

### 11.12 Test-session feedback, first batch — agreed 2026-09-29

Eight items from the user's compiled feedback. Five small ones are done (ARCHIVE 11n): the
lobby's Copy button over plain http, the lives count on the life-lost banner, reload rings
that can be seen, a button in place of the R key at the end of a match (with M's mute
removed too — no hidden keys), and the player's name remembered. Then, in order:

**F1 — Pockets count — done** (ARCHIVE 11o, §1.3): sealed ground without a castle is
territory while its player holds a sealed castle, behind `enclosure.castlelessRegionsCount`.

**F2 — Pause — done** (ARCHIVE 11p, §6): anyone may pause and anyone resume, by Esc or
the button beside the Sound switch; the server steps no ticks while paused.

**F3 — An open games browser (M; server, protocol, lobby).** The menu lists rooms that
have not started, with a Join button each, beside joining by code. **Rooms are public by
default**; the host may make one private when creating it, and a private room is joined
by code alone. The server answers a list request with the open public rooms (code, host,
seats taken of seats, round cap, teams).

## 12. Deferred (explicitly out of scope for v1)

Quick-match and matchmaking, accounts and persistence, ranking, mobile
and touch input, spectator mode, shipped replays, naval units, singleplayer campaign.
