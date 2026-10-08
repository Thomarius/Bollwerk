# Bollwerk — design and open work

A multiplayer-only recreation of the 1990 Atari arcade game _Rampart_, condensed to a
single game mode, with online play, AI opponents, and fully procedural visual assets.

It is called **Bollwerk** (renamed 2026-10-02, ARCHIVE 11zw): Rampart is a trademark of
Warner Bros. Entertainment, and the game names it only to say what it is inspired by. In
this file "the original" means Rampart.

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
- `terrain.patterns` gives one arrangement per player count: a **grid** at 2, 4, 5, 6, 7
  and 8, a **ring** at 3. A ring puts every player the same distance from the same two
  neighbours; a grid is tighter but gives edge and middle seats different neighbourhoods.
  A grid's short last row — five players on three by two, seven on four by two — is centred
  under the row above. Five and seven were rings until 2026-09-30, and made considerably
  larger maps; on a grid five share six's footprint and seven eight's.
- **The island is cut from a rounded rectangle** (`island.cornerRadiusTiles`), its coast
  moved by noise (`coastlineRoughness`, `noiseFrequency`). Rounder and rougher reads less
  boxy but turns neighbours' facing coasts into points with open sea between — at three
  players the strip of water shared by two islands fell from about 120 tiles to under 20 —
  which §1.2's rule on channels forbids. The setting is the roundest that kept it.
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
- Reward per build phase is in `ruleset.cannons`: a fixed number for the **main castle**
  — the one the player chose, afresh after each continue — while it is sealed, and fewer
  for every other sealed castle, as in the original (`firstRewardForMainCastle`,
  `cannonReward`). A player holding other castles with the main one breached earns one
  a castle. The main castle wears a crown in every style, sealed or not.
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
measurements of 11.2 will be taken with. That is why a cannon jammed
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
| Desktop    | Electron, a portable file for Windows and Linux                 | A host needs no Node or terminal; built on demand for major versions (CLAUDE.md, Making a release)              |

Authoritative server, **no rollback netcode needed**: both phases are simultaneous but not
twitchy, and a shot's flight time absorbs RTT entirely.

---

## 3. Repository layout

```
Bollwerk/
├── config/            every tunable, as JSON behind a strict schema
├── assets/audio/      audio cues, committed — the image builds from a clean checkout
├── packages/
│   ├── config/        zod schemas, typed defaults, cross-file validation
│   ├── sim/           deterministic core — no DOM, no Node, no I/O
│   ├── protocol/      wire messages and validators
│   ├── ai/            bot logic
│   ├── analysis/      per-round match statistics, shared by the server and the harness
│   ├── server/        authoritative match server, and the recorder of every match
│   ├── client/        renderer, UI, procedural asset generators
│   └── desktop/       the desktop app for releases: the server behind a window
├── tools/headless/    bot-vs-bot harness for balance tuning and soak tests, and replays
├── recordings/        recorded matches and their statistics (git-ignored; §9)
├── .github/workflows/ CI, and release builds of the desktop app on demand
├── CREDITS.md         the attribution and the audio's credits, made from the manifest
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
| `ai.default.json`      | Bot skill as a table of levels (pace, aim, judgement, sloppiness, carelessness) interpolated between anchors, and the personality traits: risk, targeting, cannon space               |
| `art.default.json`     | Palettes, per-player colour ramps and each style's own over them, sprite generator parameters                                                                                         |
| `audio.manifest.json`  | Cue names to files, and a credit for every file; see `assets/audio/README.md` for what fires each one                                                                                 |
| `server.default.json`  | Ports, room limits, rate limits, the delay before a bot takes a dropped seat, and the bounds of what a host may set in the lobby                                                      |

`validateConfigBundle` checks what a single file cannot: that there are at least as many
player palettes as allowed players, that every playable count has a pattern, that a cannon
fits inside a starting ring, that the island does not fill its generation box, that the
lobby's round bounds include the ruleset's own cap, and that every audio cue in code exists
in the manifest, and that every credit names a file a cue loads.

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
- Clients run one tick behind the server's confirmed tick and apply committed actions,
  and **catch up at once on anything beyond two ticks** (`CATCH_UP_MARGIN_TICKS`): a
  backlog played only at the page's own clock never shrinks, and the second spent
  building the board as a match opens stayed as a delay on every click (ARCHIVE 11zg).
- **The connection is shown beside Pause** in an online match (`network.ts`): a dot and a
  word, green "Online" with the round trip, amber for a slow one or a page falling behind,
  red for a bad one or "Out of sync" (`art.hud.network`). It was 11 px of grey in the
  HUD's far corner, and nobody saw it say the hosts were behind.
- A dropped seat is handed to a bot after a few seconds (`reconnect.botTakeoverDelayMs`), so
  the match does not stall; the player gets their seat back whenever they reconnect, for the
  rest of the match. A two-minute limit on that was configured and never applied, and was
  removed rather than enforced (2026-10-07).
- **Anyone at the table may pause a running match, and anyone resume it** — Esc, or the
  button beside the Sound switch; an overlay names who paused. Every timer is in ticks, so
  a paused room simply steps none: bots, phase clocks and a bot's takeover of a dropped seat all wait, and a
  recording gains nothing. Moves sent while paused are dropped, not queued. A pause made
  by somebody who then drops holds until anyone resumes. Offline, the local match is not
  advanced.
- Rooms are found by a short code from an alphabet chosen to avoid ambiguous characters,
  or from **the open games browser** in the menu: rooms are **public by default**, listed
  while being set with a seat free, and a **Public / Private switch beside Play** decides as
  the table is made — a private room is joined by its code alone, which is how to play
  alone undisturbed. The menu polls `/api/rooms` over plain HTTP every few seconds (it has
  no socket open), and hides the list without a server or on another protocol. A room
  that filled or started before a Join from the list lands says so, back in the menu,
  whose list is fresh as it opens.
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
  `teamSize` exist. Game speed will not join them (decided 2026-10-01): the game is
  played at one speed.

---

## 7. `packages/client`

Eighteen visual styles — Minimal (`flat`), Medieval (`pixel`: named Pixel art until the other
styles made the name mean nothing), Night, Cyberpunk, Blueprint, Parchment, Toy bricks
(`bricks`), Stained glass (`glass`), Chocolate (`chocolate`), Halloween (`halloween`), Sakura (`sakura`), Oktoberfest (`oktoberfest`), Opera (`opera`), Office (`office`), Under the sea (`undersea`), Electric (`electric`), Cartoon (`cartoon`) and Christmas (`christmas`) — behind one `Theme` interface: the scene owns the camera, the layer stacks,
dirty tracking and input mapping; a theme owns only what things look like. Adding a style
is a name in `ArtStyleSchema`, the looks it is made for in `STYLE_LOOKS`, a `Theme`, a
case in `createTheme`, a menu title in `titles.ts` and a banner class in `hud.ts`; the
types refuse a style missing any of them. All
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
tint on the ground and sea under the walls, so no player's colour moves, and the shadows
follow it (`shadowCast`): long and leaning west in the morning, short at noon, longest
and leaning east at sunset. Walls and castles on a south coast lie mirrored faintly in
the sea below, rippling, a sealed castle's warm with torchlight at Night. Each match has
weather drawn from its seed: clear, overcast (more clouds, darker, a grey cast), snow
(overcast, with flakes drifting down and white lying on the tops of walls and castles),
rain
(streaks and rings on the sea, as well) or fog (pale banks drifting where the clouds'
shadows would). In rain, distant thunder now and then flickers faintly over the whole
board (`thunderEveryMs`, `thunderAlpha`): weather, never a flash at one spot, which is
what an impact is. Cyberpunk has thin rain of its own, and a wall hit's flash splits into
its colours for a moment.

**Rules every style keeps**, so the looks can swap mid-match:

- **A player keeps their hue across the look swap.** If red became magenta under the
  banner, nobody could follow who is who. A theme may restyle a player's colour — neon,
  ink, pastel — but not change it; the eight colours and the team families must stay
  distinguishable in every theme.
- **Information stays readable**: the flood of newly sealed ground, where your own
  shots will land, the overtime border, the aiming cursor. These are shared helpers in
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

**Every audio file is credited** in the manifest — title where known, author, licence,
source, what was changed — by its own path or by its folder's (a key ending in `/`: the
sound effects are all CC0, which asks for no attribution, so `sfx/` is one line rather than
thirty). The menu's Credits and `CREDITS.md` are both made from it (`npm run credits`); a
test fails when the file is stale, and `npm run check` fails on any file without a credit.

**The HUD is dressed in the look on screen** (`HUD_SKIN` in `hud.ts`, a record over every
style): a flat bar under a hard gold rule for Minimal, near black under a glowing cyan
rule with the phase in magenta neon for Cyberpunk, a gridded title block ruled double for
Blueprint, a strip of paper lettered in ink for Parchment, a blue baseplate under a yellow rule for Toy bricks, and the dark bar with gold for
Medieval and Night. The cannon count takes it too; the piece box and the line of hints
at the bottom were removed after the test sessions, since nobody had time to look down
there, and the summary is opaque with its grey lifted, for contrast. It is a
set of CSS variables on `#hud`; the HUD takes the arriving look's as a banner starts,
since the bar is at the top and above the line is always the new look. The bar is exactly
`HUD_BAR_PX` tall, its rule inside, so a solid skin never overhangs the board.

**The skin reaches past the bar** (11.19, ARCHIVE 11zz): it is set on the page, so the
banner layer and the overlays take the look on screen too. The ready count at the cursor,
the end screen, the pause menu and the "You're out" strip are in the skin's box, edge, ink
and lettering, kept opaque where Medieval's and Night's box is see-through. **The big
timer** is drawn as each style draws — carved stone for Medieval and Night, flat for
Minimal, a neon outline, a draughtsman's outline, sepia italic, a yellow brick, gold glass
in its lead, piped icing — and **the island banners, team letters, "You are here" and the
stamps** are dressed alike: Parchment's banners a forked ribbon and its stamps pressed in
red ink, Toy bricks a studded plate, Stained glass a pane in its lead, Chocolate a bonbon
in gold foil, Cyberpunk glowing, Blueprint ruled double. The owner's colour stays on every
island banner's border. **The finish** is each style's own (`FinishLook` in `theme.ts`):
the rockets and the hoist are shared, so the timing is one, but the bursts are streaks in
Medieval and Night, neon in Cyberpunk, a draughtsman's crosses in Blueprint, ink blots in
Parchment, tumbling bricks, glass shards, candy sprinkles, in Halloween bats and little
ghosts flying up, in Sakura a chrysanthemum's bowed streaks among cherry petals, in
Oktoberfest pretzels and gingerbread hearts, in Opera roses and flowers thrown at a
curtain call, in Office sticky notes and paper clips from party poppers and in Under the sea
bubbles and little fish, in Electric forked lightning, in Cartoon stars and in Christmas snowflakes, and the
winners' flag a swallowtail, a flickering hologram on a light-beam, a pennant in plan, a
square flag of bricks, a leaded banner, a pennant on a candy-cane pole, a tattered pennant
on a crooked branch, a tall war banner (_nobori_) hung from an arm, the Bavarian lozenges
on a maypole, a pennant bearing a golden lyre, a necktie on an aluminium pole, a pennant under a bronze
trident, a bolt-cut pennant on a copper lightning rod, a pennant on a pole held up by a white glove, or a Christmas stocking on a gold pole. Minimal keeps the plain ones.

**Each banner is drawn in the look it brings** (`BANNER_CLASS` in `hud.ts`, a record
over every style): flat gold for Minimal, a neon strip that flickers on for Cyberpunk, a
title block of deeper blue paper ruled double for Blueprint, an inked ribbon with forked
ends for Parchment, a long yellow brick with a row of studs for Toy bricks, and the dark
band with gold for Medieval and Night.

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

**The ranking between rounds** (`ranking` in `scores.ts`, drawn by the HUD): the banner after
a resolution carries an entry a player — a team in a team match — with its place, shape
and name, sliding in one after another, its score counting up from the round before's,
the round's gain beside it, and a green or red arrow for a place won or lost; in the
banner's own ink, inside its crossing, adding no time.

**Choosing the looks** (`looks.ts`, ARCHIVE 12b) scales to many styles: in the menu each
look is its picture and name between two arrows, which step through the styles in place,
and the picture opens **the gallery** — every style's picture as a card, a switch at the
top saying whether a click chooses the building or the combat look, each card badged with
the look it is chosen for. The styles are in alphabetical order by name, so a new one finds
its place, and **Random** comes last, a die for its picture: **a new style at every
banner that brings its look** (`LookRotation`, ARCHIVE 12q), repeating none until every
style has been shown — both looks random share one cycle of all eighteen, one random cycles
through all but the other look's — and never the style the banner takes away, nor the one a
look last had across a cycle's end. Each next look is made a step a frame, hidden, in the
intermission after the build phase (`Scene.prepare`), and goes on screen once the look it
replaces is out of sight.
**A hovered card plays** (`galleryLive.ts`, ARCHIVE 12m): the style itself runs over its
still on the same island — the sea, the flags, and a shot from the gun every couple of
seconds, at the wall and into the sea by turns — through one renderer for the whole
gallery, its style swapped as the pointer moves; drawing only while a card is hovered, and
not at all under reduced motion. The pause menu has **Looks**, the same gallery, Random
included, which changes the looks mid-match (`Scene.replaceLooks`), starts a rotation from
the next resolution, and saves the choice as the menu's. A picture made for the
gallery over a running match must not release what every renderer shares
(`destroy(true)`): it took the match's pooled batches with it. One gallery for both looks
is the first try; two separate ones if players find it confusing (decided with the user).

**A picture of each chosen look** stands beside its choice in the menu (`stylePreview.ts`):
one fixed island — a sealed ring with guns round the crowned main castle, a second castle
outside it — drawn by the style's own theme through a real `Scene` on a canvas of its own,
once per style, kept as an image and the renderer thrown away. Built after the title's
first sweep, so it cannot stutter it.

**Around a match** (11.18): "Preparing the board" stands over the screen while a match's
looks are built, painted before that work starts. Paused, the overlay is the match's menu —
Resume, Effects, Sound, the music and sounds volumes, and Leave match, which asks once
more. A player knocked out sees "You're out — watching" with Back to menu. The menu and the
pause menu carry two volume sliders, music and sounds, over the manifest's mix (the corner
switch stays the mute), and a bot seat in the lobby shows its level as ten pips. At the end
the summary names up to **three awards** (`awards.ts`) — from Wrecker, Landlord, Castle
collector, Iron wall, Comeback, Front-runner, Photo finish, Last stand, Phoenix, Late
bloomer, Artillerist, Steady, a named Nemesis and Mason — drawn from the match's seed so
every screen shows the same, each to a different player while one is left without; and
**Rematch**, the host's online (protocol 15), brings everyone still connected back to the
lobby in their old seats with the table as it was and a new map; locally it reopens the
table.

**How to play** (`howToPlay.ts`), from a button under Play, marked until first opened:
seven pages, each a looping picture and a caption of ten words or fewer — the mouse, the
round, sealing a castle, turning corners, guns on sealed ground and the crown's two,
firing, and scoring against losing a life. Drawn in Minimal's colours; the boards of the
sealing pages are real ones judged by `computeEnclosure`, and a test holds every picture
to the rule it shows. Back, Next and Close; still at each page's key moment under
reduced motion.

**The menu and lobby** are dressed in the game's own art (`titles.ts`, `decor.ts`): **every style has
a title of its own**, the same 5x7 letters in its look — stone threaded with gold for
Medieval, flat blocks in the players' colours for Minimal, moonlit stone with a halo
and stars for Night, a neon sign that flickers on for Cyberpunk. **The menu shows both
chosen looks at once** (`SplitTitle`): the build look's title above a banner's gold line
and the combat look's below, the letters coinciding, since `titleLayout` sizes every
title so they stand in one place whatever room its glow needs. The line sweeps across as
the menu opens, as either choice changes, and every `menu.titleSweepEveryMs` — a round in
miniature, each banner bringing the arriving look above it as on the board: down out of
the word, a combat banner across it, a build banner back to the middle. **A random half
takes the rotation's next style while it is out of sight** (`titleTurn`): the combat half
once the line has left the word, the build half once the combat banner has crossed. Still under
reduced motion; one title and no line when both looks are one style. Behind the panel the pixel
sea drifts. The lobby shows the map the table will play (`preview.ts`), alive — surf
breathing along its coasts a little out of step tile to tile, the castles breathing
together (`surfAt`, `castleBreath`, `art.menu`), still under reduced motion — each island in the colour its seat will play and numbered
for it, the viewer's own ringed — beside seat cards that carry the same number and
colour, a level per bot seat, and columns per team. A newcomer's card flashes as they
sit down.

**The end of a round and of a match** (V6). Points banked at a resolution count up in the
island's banner, total and all, while a glow sweeps the island's territory outward from
its castles, both over `effects.tallyMs`. A lost life takes the island's wall down outward
from its middle over `effects.lifeCrumbleMs` instead of clearing it in a frame (the
cannons, removed from the state outright, still go at once). Once the match is over,
fireworks burst over the winners' islands in their colours for as long as the screen
stays up, a swallowtail banner in their colour is hoisted on a tall pole over each of
their castles (`WinnerBanners`, `winnerBannerRiseMs`), and **the summary** (`endScreen.ts`, its log `summary.ts`) comes up over them after
`summary.delayMs`, narrow and opaque (see-through, its grey figures could not be read). It gives each player —
each team, in a team match — the wall they destroyed, the most castles held at once and
the lives left (none once out), with every score charted round by round, the viewer's
line heaviest. It is kept from the
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
both looks the switch comes as building begins.

**Combat aids** (`drawFireReticle`, `drawAimLine`, shared by every style). **The reload
is at the cursor**, where the eye is while aiming: with no gun ready, a ring round the
cursor fills as the next gun's shot flies — the one landing first (`nextReload`), since
flight time is the reload — and at the ready crosshair's radius, so as it closes it
becomes that ring. Rings round each of the player's guns came first and were dropped
after the test sessions: nobody aiming had time to look at their own island. While aiming, a dotted arc runs from the gun a click would fire —
chosen by `findReadyCannon`, the rule `fire` uses — to the cursor, lifted as the shot
will be, with a ring round that gun; only where a click would fire.

**Before the match.** The lobby's map is drawn in the chosen build look's colours, its
seat numbers and ring in the shared ink. The castles a player may choose breathe in the
accent (`drawSelectable`), and every choice, anyone's, sets off rings in the chooser's
colour from the castle (`drawChoices`); hovering one shows faintly the ring it would
get, from the sim's own `startingRingTiles`. From then on **a crown stands on each
player's main castle** (`drawMainCastles`) — in the owner's colour while it is sealed,
stone grey and cracked once breached, as the look's own sealed castles say: one shared mark rather than the original's second tower drawn in seven
styles. The menu's **Effects** setting, Glowing, Standard or
Reduced (`motion.ts`; stored as high, full and reduced, the names until 2026-10-01, when
"Full" read as more than "High"): reduced does what the system's reduced-motion setting does — no
flicker, no beat, no slide, no title sweep, no rain — and also stops the board's shake;
either one reduces. Glowing is Standard with the glow of Night, Cyberpunk and Electric bloomed by a real
blur filter, asked for rather than given since it costs frame rate at eight players.

**The roster** is kept across frames rather than rebuilt, so its entries can move:
free-for-all is in standing, best first, and a change of places slides; scores count up
as they bank, over `effects.tallyMs`, as the island banners do; a team match keeps team
order. **It shows only points and lives** (11.15): castles and guns went, since the
board shows both, and each entry is a card — the player's colour down its edge, the name
small over a large score and large pips, the last life red and glowing, "out" in their
place for a player knocked out. A team heads its members' names with its letter, score
and pooled lives, one pip and a count once the pool is too large for pips. One layout at
every count: eight entries fit at 1024 pixels wide with room to spare, names are cut
short to their card, and nothing is ever drawn past the edge. **The figures are as large as
the bar allows** (2026-10-03, testers found them small): sized by the width each entry
gets (`--entries`), up to what the 64-pixel bar holds, a name over a score — large at three
players, as large as fits at eight. **The team tags** over the islands ("Team A") are large
for the same reason, on the top corner of each island farther from the big timer, kept on
screen and below the bar. **A shape per player** (`shapes.ts`, `art.playerShapes`), beside the colour, so eight
players and colour-blind ones tell islands apart: circle, square, triangle, diamond, star,
plus, hexagon, inverted triangle — by player in free-for-all, by team in a team match,
where teammates share one as they share a hue. On the roster's figures, the island
banners, the "You are here" marker, the lobby's seat cards and map, the summary's table
and the ends of its chart's lines; **never on the board**, which it would clutter. Drawn
from one set of paths as SVG and on the lobby's canvas, not from a font, whose ▲ and ★
differ on every system. **The clock's end is heard, then seen**: the countdown ticks
over the last five seconds of a phase, louder each time (`clock.ts`), and the big timer
beats and turns red over the last three. In overtime there is no clock at all — it
stops at 0 and goes, and the red border carries the overtime; a second countdown from 3
read as the build phase starting over.

**Feedback a player builds by.** While nothing of yours is sealed, your castles are
outlined (`hints.ts`), and over the countdown's last five seconds a red frame flashes
round them on every tick (`countdownBeat`). **The sealing preview** (`sealPreview.ts`) washes and outlines the
ground the piece in hand would seal, by the sim's own enclosure with the piece stood in as
wall. A menu setting, off by default, until the test sessions found it helpful: always on
since 2026-10-01, and the switch is gone.
The held piece casts a soft shadow and swings as it turns (`GhostMotion`); a placed gun
settles as a piece does; a knocked-out island's castles burn and then smoke for the rest
of the match (`RuinSmoke`), and in Medieval and Night fly their flags at half-mast. Wall
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
banked hold over it with the new total and the guns the round earned for the whole intermission
(`hud.pointsBannerMs`). A lost life lands as a banner over the island, red on the last; a
knockout stamps the island and greys it for the rest of the match.

**The build phase, felt** (`seal.ts`, `art.effects`). Sealing is drawn as ground being
taken: whenever the board's enclosure gains territory — a breach closed, a castle chosen,
a loop widened — the new ground floods outward from the castle, or from the edge of what
was already held, with a bright front running ahead of the paving. **Ground lost runs out the same way in
reverse** (`drainsFrom`): as the "Rebuild" banner reveals the board as it stands, what a
player held when combat began and holds no longer is washed dark red, and the wash drains
out through the breach at `drainTilesPerSecond` — each island as the banner's line
reaches it, or as building begins when one style draws both looks. Every sealed castle
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
fires. In every style the mark where one of your own shots will land pulses ever faster
as it nears — **only your own**: nobody sees where anyone else's will come down, their
own wall included, though every ball in flight shows (11.14); and a breached
castle's flag is lowered, struck in a darker shade, rather than vanishing.

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

**Toy bricks** (`bricks.ts`, `art.bricks`), for either look: the board built of studded
plastic bricks on baseplates, green under the land and blue under the sea, whose studs
are faint so the sea stays calm behind the game. Walls are bricks in the owner's colour,
each carrying a stud in its lighter shade, with seams between them so a shot visibly
takes one, standing up to the pixel style's height; sealed ground is smooth tiles laid
over the studs. Castles are a brick tower with a keep on it flying a square flag; guns
a grey brick mount banded in the owner's colour, with a round barrel that turns and
kicks. A piece clicks down with a flash off its studs, a hit knocks bricks loose to
tumble and bounce, the sweep pops them off, and shots are round bricks lobbed over their
shadows. Its scenery is built of bricks too — stacked round plates for trees, stepped
plates for pines, round plates for bushes and one in two a red or yellow flower, a grey
sloped brick for a boulder — its banner a long yellow brick with a row of studs, its HUD
a blue baseplate under a yellow rule, its title the word in bricks, each letter a
player's colour. It uses the shared player colours: bright and clean already. Named toy
bricks and never after any maker's trademark.

**Stained glass** (`glass.ts`, `art.glass`), for either look: the board as a church window.
Land and sea are cut into irregular panes a few tiles each (`panes.ts`: the tiles round a
jittered grid of points, never across the coast), each its own shade, held in near-black
lead, with a heavier came along every coast and light falling through as a sheen in each
pane's corner; one pane a tile, tried first, read as a mosaic. Sealed ground lights the
same panes in the owner's colour. Walls are blocks of the owner's glass leaded one by one,
so a shot visibly takes one, standing to the pixel style's height; castles are rose
windows, guns grey glass mounts ringed in the owner's colour, shots glowing beads; a hit
throws shards and a piece set down catches a glint. A glass ship and a leaping fish on the
sea, a title of leaded panes, a banner of jewel panes, a HUD of lead under a strip of
coloured glass. Its palette is a sapphire sea, emerald land and warm gold; the player
colours are the shared ones.

**Chocolate** (`chocolate.ts`, `art.chocolate`), for either look, the one whose material
moves: a sweet-shop land on a river of milk chocolate, kept light so it is never near Night
or Cyberpunk. The river flows — swirls ride one current east across the whole map, redrawn
each frame in the terrain layer, its shallows rounded round the coast — and pours over a
chocolate fall between banks of meringue in the corner Parchment gives its compass rose.
Land is mint sugar grass with tufts and glints of sugar, edged in biscuit crumb. Walls are a
bar of chocolate: each block a scored square under a glossy coating in the owner's colour,
standing to the pixel style's height, its face the bar cut through — coating, a layer of
filling, chocolate — and here and there a drip of coating down it; a shine slides across a
player's walls now and then, each on their own beat. Castles are a two-tier cake iced in the
owner's colour with a fountain's gold basin on top, and **sealed is the chocolate flowing**:
it fills the basin and glazes the cake, dripping over both tiers, started by sealing and
stopped by a breach as a flag is hoisted and lowered (`FlagHoist`); a breached cake shows
bare icing and an empty bowl. Guns are cupcakes in a pleated case of the owner's colour
with a candy-cane barrel, puffing cocoa as they fire, the frosting slumped and the cane
drooping when silenced. Shots are bonbons in foil of the owner's colour, their twisted ends
spinning. A hit snaps the square off, flipping, with crumbs, and leaves bite marks on its
neighbours for the rest of the round; in the river a slow crown of drops and a lazy ring; on
open ground a splat that fades over `fx.craterRounds`. The sweep melts its blocks into a
puddle; a player who is out has their wall turn grey-white with sugar bloom. Sealed ground is
iced in a pastel of the owner's colour, edged with piped dollops and sprinkled. The piece in
hand is an empty mould, cracked where it does not fit; a piece set down is poured from above
and wobbles as it sets. In a snowy match (the pixel style's weather from the seed) sprinkles
fall and lie on the wall tops; in overtime and the final round dark chocolate melts down
from the top of the board. Scenery is lollipops, soft meringue swirls, candy floss and
cookies; on the outer river a paddle-boat, marshmallows bobbing on the current and a
whirlpool under a glass pipe's mouth. Its banner is a bar opened out of gold foil, its HUD a
bar of milk chocolate scored into squares under a gold rule, its title the word piped in
chocolate with drips. The player colours are the shared ones. Named after the material,
never the film it was inspired by.

**Halloween** (`halloween.ts`, `art.halloween`), for either look: a haunted land round a
bog, cute-spooky — more ghosts and pumpkins than bones, no gore (the user's brief). Night
is dark and torchlit; Halloween is purple dusk, murky green and pumpkin orange, and its
idea is a board **haunted**: things appear, drift and vanish. The sea is a bog, lighter
near the shore, bubbles rising and popping in it; the land dusky purple dead grass strewn
with autumn leaves, edged in mud and roots; ground fog drifts over everything in soft
banks, and a full moon hangs in the corner Parchment gives its compass rose, bats wheeling
across it. Walls are crypt stone with a cast of the owner's colour, **the mortar glowing
with spirit-light** in the owner's light, a crack or a cobweb here and there, standing to
the shared height. Castles are crooked haunted houses with the roof in the owner's colour,
and **sealed is the house lit up**: the porch jack-o'-lantern grinning, the windows
glowing, smoke from the chimney — lit and put out by `FlagHoist`. Guns are cauldrons of the
owner's potion, aimed by a ladle, bubbling while live, cold when silenced; shots are
spectral fireballs trailing wisps. **A hit on a wall sets a little ghost free**, rising and
fading; the bog splashes slime; open ground keeps a scorch with embers. The sweep sinks its
blocks into the ground like graves; a player who is out has grey stone thick with webs.
Sealed ground is tinted and warded by candles along its edge, flickering. The piece in hand
is a spectral wall, its outline wavering, cracked where it does not fit; set down, it
materialises out of mist. In the witching hour — overtime and the final round — pairs of
eyes open in the dark at the screen's edges and blink. Weather from the seed: fog doubles
the fog, snow falls as autumn leaves. Scenery is dead trees, pumpkins (never lit: only a
sealed house's grins), toadstools, headstones and now and then a small skull; on the outer
sea a ghost ship, a flock of bats and a will-o'-wisp. Its banner is a tattered purple
cloth lettered in glowing orange, its HUD dark purple under a glowing orange rule with a
cobweb in the corner, its timer pumpkin-glow figures, its island banners coffin plaques,
its title the word carved in lit pumpkin. The player colours are the shared ones.

**Sakura** (`sakura.ts`, `art.sakura`), for either look: an Edo castle town by the sea as a
woodblock print, in the manner of Hokusai and Hiroshige — flat colour in bold ink outline,
colour fading across the sea as a printer wipes the block. Named for the blossom, never the
country. The sea is Prussian blue, paling toward the coast, under the waves' fish-scale
pattern (_seigaiha_), crests rising, curling over and breaking in claws of foam on the open
water (`ukiyo.ts`, shared with its sea life); the land flat pale green edged with surf and
sand; **Mount Fuji** stands in the corner Parchment gives its compass rose, snow down its
gullies and a band of mist across its foot. Walls are a Japanese castle's: **a tiled cap in
the owner's colour**, a seam at every block, over white plaster on fitted stone, standing to
the shared height. Castles are keeps (_tenshu_), two storeys under roofs in the owner's
colour with up-turned eaves and gold on the ridge, and **sealed is a carp streamer
(_koinobori_) in the owner's colour** hoisted up the pole beside the keep, swimming on the
wind, brought down hanging limp by a breach (`FlagHoist`). **Sealed ground is raked gravel**
(`rakeLines`): lines following its edge, one ring a tile in, raked round the keeps as round
the stones of a garden. Guns are bronze on a black lacquered stand, rimmed in gold and
banded in the owner's colour, smoke curling from the muzzle; a silenced one droops under a
cloth thrown over it. Shots trail one tapering brush stroke; **a hit on a wall throws roof
tiles and a curled cloud**, the prints' swirl, which is also its smoke and the puff of a
piece pressed down; a shot on land leaves a splash of ink; the sweep scatters blocks into
petals; a player who is out has walls weathered grey with moss on them. The piece in hand is
outlined in one brush stroke, and where it does not fit the stroke breaks up dry and frayed.
**Cherry petals drift over everything**, and in overtime and the final round **the season
turns**: they fall as maple leaves. Weather from the seed: fog is drifting bands of mist,
rain Hiroshige's slanting streaks, snow falls and whitens the caps. Scenery is cherry trees,
gnarled pines, bamboo and garden rocks, one in three a stone lantern — no torii or red
lanterns, which would read as the crimson player; on the outer sea a boat under a square
sail, a line of cranes and now and then a great wave rolling across. Its banner is a scroll
of paper between two wooden rods, lettered in ink with the news in vermilion; its HUD black
lacquer under a gold rule with a hemp-leaf pattern (_asanoha_) fading in at the right; its
timer brushed figures; its island banners wooden votive plaques (_ema_) and its stamps a
vermilion seal; its title the word brushed on a scroll and signed with a red seal.
Vermilion is kept off the board. The player colours are the shared ones.

**Oktoberfest** (`oktoberfest.ts`, `art.oktoberfest`, `wiesn.ts`), for either look: the beer
festival, and a friendly joke at its expense — the user's brief, "we are German, we deserve a
good joke about this fair". **The sea is beer**: golden lager in the shallows, amber out deep,
bubbles rising through it and a head of foam round every coast. **Walls are stacked beer
crates** in the owner's colour, four crown caps showing in each, a handle slot in the side;
a player who is out is left with grey crates of **empties**. Castles are beer tents, their
roofs striped in the owner's colour and white, and **sealed is the giant Maß on the ridge
full to the brim, foam and all** (`FlagHoist`): a breach drinks it dry. **Sealed ground is
the Bavarian lozenges** in white and the owner's colour, each tile's top and bottom quarter
so the diamonds run on across tiles. Guns are kegs on a brewer's dray, hooped in the owner's
colour, the brass tap their muzzle, and **they fire pretzels**, spinning, a ring of the
owner's colour round each; a silenced keg rolls onto its side and drips into a puddle. A hit
on a wall throws foam, bottles and crown caps; a shot on land spills a puddle of beer; the
sweep returns a crate for its **deposit**, a coin flipping up where it stood; a crate set
down clinks. In overtime and the final round **the band plays**: notes rise from every
sealed tent. A **Ferris wheel** turns in the corner Parchment gives its compass rose, its
rim lit and its gondolas hanging level. Scenery is beer-garden chestnut trees, tables with
their benches — so a copse of them is a beer garden — gingerbread hearts dropped on their
ribbons, a Maß knocked over, and one boulder in three **a reveller asleep in the grass**,
snoring; no pretzel lies about, since pretzels fly. On the outer sea a Maß floats past, a
reveller drifts by asleep on a lilo, and a Weißwurst swims in circles. It rains, as it does
at the Wiesn, and now and then snows. Its banner is a long gingerbread piped in icing, its
HUD the dark wood of a beer-tent bench over a band of lozenges, its timer figures beer with
a head of foam, its island banners gingerbread hearts and its stamps a beer mat; its title
the word in gingerbread, piped and dotted with sugar. The player colours are the shared
ones.

**Opera** (`opera.ts`, `art.opera`, `music.ts`), for either look: a night at the opera,
built of music itself — every other style is built of a material, this one of the score.
The sea is midnight blue, and **its waves are staves**: five gold lines swelling across the
water, broken off short of every coast, notes riding them as the melody runs on. Every
coast is the gilded edge of a stage with **its footlights lit**, the land a polished stage
floor. **Walls are piano keys** in the owner's colour, the black keys across the seams in a
keyboard's true pattern — none between E and F, or B and C — along a row at the keys' back
and down a column at their left, so a wall reads as a keyboard whichever way it runs.
Castles are opera houses — steps, a colonnade, a gilded cornice, a dome in the owner's
colour with a golden lyre on top — and **sealed is the house playing** (`FlagHoist`): its
windows lit and notes rising from its dome; a breach stops the music, and a rest hangs
where the notes were as the light goes down. **Sealed ground is a page of the score**,
ruled in staves of the owner's colour on one lattice, bar lines across them and a melody
written in from the seed. Guns are **brass horns** coiled on a stand in the owner's colour,
the bell turned to the target and notes bursting from it as they fire; a silenced horn is
**muted**, a mute stuffed in its bell. Shots are notes in the owner's colour, rocking as
they fly. A hit on a wall knocks a key out with **a sour note**, crooked and cracked; a shot
at sea spreads rings of sound, on land an ink blot; the sweep runs off in **a glissando**; a
piece set down lands as **a chord**; the piece in hand is sketched in pencil and crossed out
where it does not fit. **A conductor** stands on his podium in the corner Parchment gives
its compass rose, his baton beating time in four, quicker over a phase's last seconds and
in overtime. In **the finale** — overtime and the final round — the staves swell and
quicken and **two spotlights** sweep the board. Scenery is golden harps, music stands with
their chairs — a copse of them a section of the orchestra — singers of the choir in black
robes, mouths open, metronomes, and one boulder in three a grand piano with its lid up; on
the outer sea swans glide in circles, a gondolier sings his way across, and now and then
the Flying Dutchman's dark ship passes. Its banner is **the stage curtain**, red velvet in
deep folds with a gold fringe, lettered in gold italic; its HUD a black lacquered piano lid
with a keyboard for its rule; its timer gold italic figures; its island banners gilded
cartouches and its stamps a torn ticket; its title the word in noteheads on a five-line
staff behind a treble clef. The player colours are the shared ones.

**Office** (`office.ts`, `art.office`), for either look: an open-plan office at war with
itself, every department taking it deadly seriously — the user's idea, "weird and funny",
and silly by their choice. **The sea is the carpet**, charcoal tiles of two by two laid in
alternating directions so it shows a faint checker, flecked, an old stain here and there;
the land each department's pale linoleum, edged in aluminium skirting. **Walls are cubicle
partitions**: fabric panels in the owner's colour, flecked, an aluminium cap along the top, a
seam between panels and a kick plate at each face's foot, a memo pinned on now and then,
standing to the shared height; a player who is out has theirs under grey dust sheets.
Castles are **corner offices** seen across the desk — an executive chair in the owner's
colour, monitor, angled lamp, mug, phone and a nameplate — and **sealed is the office
working** (`FlagHoist`): the screen on with a bar chart climbing, the lamp lighting the desk,
the coffee steaming; a breach puts **a sad face** on the screen as it goes dark. **Sealed
ground is booked**: the owner's carpet tiles over the linoleum inside a border of floor tape
striped in the owner's colour and white — the owner's colour rather than yellow, which would
read as the amber player's. Guns are **photocopiers on the five-star base of an office
chair**, banded in the owner's colour, turning to their target, kicking back and flashing the
scan light as they fire; **a silenced one has "out of order" taped on**, crossed in red. Shots
are **paper planes** in the owner's colour, nose along their course. A hit on a wall throws
sheets fluttering down, paper clips and a bit of the panel; a plane on the carpet lies there
crumpled; on the linoleum it leaves **a coffee ring** that fades over `fx.craterRounds`. The
sweep **shreds** its panels; a piece set down **unfolds out of its flat-pack**; the piece in
hand is **a selection with marching ants**, a "not allowed" sign over it where it does not
fit. **A water cooler** stands in the corner Parchment gives its compass rose, glugging a
bubble now and then, two colleagues gossiping beside it under a balloon of "…". In **the
deadline** — overtime and the final round — the fluorescent tubes at the screen's edges
flicker and **every desk's phone rings**. Weather from the seed: snow is shredded paper from
the vents, rain the ceiling leaking into grey pails, fog the haze of burnt popcorn. Scenery is
potted ficus, open-plan desks with their computers — a copse of them a cluster — snake plants
and a cactus on a filing cabinet, and for boulders an abandoned swivel chair, archive boxes or,
one in three, a printer with a sheet jammed in it; on the outer carpet robot vacuums wander,
a stray paper plane glides across and now and then **a colleague races past on an office
chair, spinning**. Its banner is **continuous printer paper**, green bars and feed holes,
typed; its HUD the grey front of a filing cabinet under a rule of yellow and black floor tape;
its timer a desk clock's liquid crystal; its island banners **name stickers**; its stamps a
red rubber stamp; its title the word on sticky notes, a letter to each; and its finish sticky
notes and paper clips from the poppers, the winners' flag **a necktie** on an aluminium pole.
Named for the place, never after a programme or a product. The player colours are the shared
ones.

**Under the sea** (`undersea.ts`, `art.undersea`, `reef.ts`), for either look: the board on the
seabed, a colourful reef — the user's idea and choices, ARCHIVE 12u. **Each island is a sunlit
reef plateau** of pale sand, rippled by the current, and **the sea round it is the deep**:
turquoise at the plateau's edge, darkening tile by tile to ink, the drop-off curving round the
coast, the plateau's lip a rocky edge. **Light ripples over the sand** — caustics, two sets of
wavy lines drawn once and only slid, each its own way, through a mask of the land — **shafts of
light** slant down from the surface over everything, drifting and breathing, and **marine snow**
drifts down always. Walls are **coral** in the owner's colour, a brain coral's grooves winding
over each block and polyps dotted along them, a crevice between blocks so a shot visibly takes
one, the face its pitted rocky foot, standing to the shared height; a player who is out has
theirs **bleached** white. Castles are **shell palaces**, a conch standing on its end, whorl on
whorl to its spire, the bands and spire in the owner's colour, arched windows and a door; and
**sealed is the giant clam at the door open on a glowing pearl** (`FlagHoist`), a bubble rising
from it now and then; a breach shuts it. **Sealed ground is a meadow of seagrass** in the
owner's colour, blades leaning with the current, an anemone here and there, its edge in the
owner's light. Guns are **pufferfish** on a nest of rock, turned to their target, **puffing up
round** with every spine out as they fire and spitting bubbles after the shot; **a silenced one
hangs deflated and limp**, turned aside, a slow bubble rising. Shots are **sea urchins** in the
owner's colour, spinning, a trail of bubbles behind. A hit on a wall breaks off coral chips that
sink and settle, and **the little fish living in it dart away**; a shot into the deep sends up a
ring and a column of bubbles; on the sand a cloud of silt billows up and leaves a dimple that
fades over `fx.craterRounds`. The sweep crumbles its lumps to sand; a piece set down settles with
a puff of sand; the piece in hand is **outlined in a string of bubbles**, which have burst into
little stars of spray where it does not fit. **A shipwreck** lies in the corner Parchment gives
its compass rose, its bow rising from a mound of sand, portholes along it, weed hanging and a
bubble now and then — and **an octopus draped over the bow**, its arms swaying, blinking, which
blanches pale and dark by turns and curls its arms quicker while the clock presses. As **the
deep comes up** — overtime and the final round — the light dims, the water darkens toward the
screen's edges, **anglerfish lures** glow and bob there over the fish barely seen below, and
now and then **a whale's shadow** passes over the whole board. Weather from the seed: snow is
thick marine snow, rain the surface far above pocked by it, rings spreading faintly and the
shafts flickering, fog a plankton bloom greening the water. Scenery is kelp with its floats,
tube sponges, starfish, scallop shells, rocks crusted with barnacles, pale anemones, and one
boulder in three an anchor or a bottle with a message in it — **no coral**, which is the wall,
and no urchin, which is a shot; on the outer deep schools of silver fish wheel and turn as one,
jellyfish drift pulsing, and now and then a sea turtle or a manta ray glides across, hidden
behind the wreck. Its banner is a plank of bleached driftwood with barnacles at its ends; its
HUD a submarine's riveted hull under a riveted brass rule; its timer figures of bubbles; its
island banners scallop shells and its stamps a label tied on with rope; its title the word in
bubbles, and its finish bubbles and little fish in the winners' colours, the winners' flag a
pennant under a bronze **trident**. Named for the place, never the film the phrase is also a
song of: no mermaid, no singing crab. The player colours are the shared ones; the octopus is
taupe and the light white, so nothing on the board is a player's colour.

**Electric** (`electric.ts`, `art.electric`, `spark.ts`), for either look: **a storm laboratory**
— the user's own love of electricity, lightning and thunderstorms, and their choices, ARCHIVE
12v. Where Cyberpunk is digital neon, this is the analogue force and the apparatus that tamed it:
brass, copper, porcelain and glass on dark rock in a slate sea, under a thunderstorm. **White
lightning is the storm's; lightning in a player's colour means it is theirs, and live.** The sea
is near black, lighter where it breaks on the rock, whitecaps leaning on the wind; the land dark
slate, flagged and cracked, surf white along it. Walls are **a Faraday cage**: a mesh in the
owner's light over the owner's dark, each block framed thin in the owner's colour, the faces
barred in copper, standing to the shared height; now and then **current crackles along a
player's walls**, block to block; a player who is out has theirs green with verdigris. Castles
are **plasma globes** on brass pedestals banded in the owner's colour, and **sealed is the globe
lit** (`FlagHoist`), filaments dancing from the electrode to the glass in the owner's light, a
halo round it; a breach makes it sputter out; a player's who is out is cracked. **Sealed ground
is a charged floor**: deck plates washed in the owner's colour, a grid in the owner's light
between them with a stud where four plates meet, and **pulses of current running along every
other grid line**, each its own way (stamps, so they cost a placing each). Guns are **Tesla
towers** built in levels, after the C&C towers the user likes without copying them: a squat drum
of riveted plates in the owner's colour, a band of vents lit from inside, a brass collar, a rod
through three copper rings smaller as they rise, and a steel sphere on top; **firing, an arc
leaps from the sphere** toward the target, and a live tower throws a little crackle now and
then; **a silenced one is grounded**, vents dark, rings and sphere dull, a cable hanging slack
from it, smoking. Shots are **ball lightning** in the owner's colour,
tendrils licking off it. **A hit on a wall chains through the cage** to the blocks beside it,
sparks flying and smoke rising; on the rock a strike leaves a dark Lichtenberg burn that fades
over `fx.craterRounds` — soot, never the owner's glow, so it is not taken for sealed ground; in
the sea a ball fizzes out with a ring, sparks skating and steam. Every strike flashes white
where it lands, the one flash at a spot there is. The sweep shorts its blocks out with a pop; a
piece set down is **welded in** with a flash and sparks; the piece in hand is **a live wire**,
pulses of current gliding round it calmly, and where it does not fit **a short circuit**, the
wire broken and arcs jumping the gaps, changing shape a few times a second rather than every
frame — faster, the user found it hectic and unnerving. **A Jacob's ladder** stands in the corner Parchment gives its compass
rose, the arc climbing between its rods and snapping at the top, quicker while the clock
presses. **The storm overhead**: now and then a bolt forks down onto the outer sea in three
strokes, the sky flickering faintly over the whole screen with it — **only on outer sea at
least five tiles off the land**, so neither the bolt nor a branch crosses an island, where a
flash at a spot is an impact; none under reduced motion. As **the storm breaks** — overtime and
the final round — the bolts come far more often and the rain thickens. Weather from the seed:
rain slants on the wind, overcast is a drizzle, "snow" is hail bouncing, fog an ionised mist with
St. Elmo's fire on the towers, and a clear match has only heat lightning's flicker until the storm
breaks. Scenery is trees split and charred by lightning, telegraph poles with porcelain
insulators, fulgurites, lightning rods on stones, slate, and one boulder in three a Wimshurst
machine on its crate; on the outer sea electric eels leap, crackling as they arc out and strike
the water, a ship crosses with St. Elmo's fire on its masts, and a gull is blown past, all hidden
behind the ladder. Its banner is a marble switchboard, a brass knife switch at each end; its HUD
black bakelite over a copper bus bar riveted in brass; its timer **Nixie tubes**; its island
banners navy enamel plates and its stamps a scorched fuse label; its title the word written in
arcs between copper electrodes, flickering on; and its finish forked lightning in the winners'
colours, the winners' flag a bolt-cut pennant on a copper lightning rod, sparking at its point.
Under "Glowing" the arcs' halos are bloomed, at half resolution as Cyberpunk's are. The player
colours are the shared ones; the storm's lightning is white with a cool halo, and nothing else
on the board is a player's colour.

**Cartoon** (`cartoon.ts`, `art.cartoon`, `toon.ts`), for either look: **a 1930s rubber-hose
cartoon reel** — the user's idea, after the old cartoons and the games drawn like them, and their
choices, ARCHIVE 12zb. **Black ink on paper white, and the only colour a player's**: whatever
has colour is someone's. Named for the era's conventions alone — pie-cut eyes, white
four-fingered gloves, hose limbs, squash and stretch — and no character of any studio's.
**Everything alive moves on one beat** (`beatMs`, quicker while the clock presses,
`hurriedBeatMs`) **and in steps**, twelve drawings a second (`framesPerSecond`), "on twos", as
the cartoons did: a figure hops between beats and lands squashed. The sea is grey, lighter
along the coast, white wave crests bobbing on it, half up as half go down; the land paper white,
inked round thick, its shadow cast on the sea. Walls are **cartoon bricks** in the owner's
colour, two courses a block, the face a shade darker, a white shine on each, inked round; a
player's who is out, and rubble, grey. **Sealed ground is a dance floor**, the owner's colour
and white checkered. **Castles live**, figures stamped for each owner and mood: sealed, one
grins and dances — hops, sways, its gloved arms swapping each beat, a pennant flying and now and
then a note rising from it; unsealed it frets, brows up, arms hanging; **breached it panics**
for 2.4 s, eyes wide, sweating, arms flung up, shaking — the hoist's lowering, 550 ms, was
over before it read; a player's who is out stands grey and X-eyed, stars circling. Its face is
high on the keep, since a main castle's crown sits on its middle. Guns are **cannons with
faces**, the muzzle the mouth, on a carriage with a spoked wheel, facing their target: a live
one bounces on its wheels; firing, it squashes back, stretches out and settles, eyes screwed
shut, a puff of smoke from its muzzle; **a silenced one sleeps**, barrel drooping, Zs rising —
in a build phase a gun outside sealed ground visibly dozes until its wall is closed. Shots are
**black bombs**, turning as they fly, the fuse sparking a star in the owner's colour. A hit is a
white starburst — the one flash at a spot there is — bricks flying in the owner's colour, dust
and stars circling the hole; on the ground a crater fading over `fx.craterRounds`; in the sea a
splash. The sweep pops a block in a puff; a piece set down lands with dust puffing out under it.
**The piece in hand is carried in two white gloves**, bobbing on the beat; where it does not fit
it turns grey and shakes, and a glove wags a finger — in form, since red is a player's. **An
alarm clock on legs** dances in the corner, its hands ticking round a step each beat, and rings
wildly at the climax, overtime and the final round, hammer hammering, mouth wide. **The film**:
grain new at each step, a faint flicker, a hair now and then and scratches running down it, all
none under reduced motion, and a vignette drawn once on a small canvas and stretched over the
window (a Pixi radial gradient lost its stops' alpha). Weather from the seed: rain in short
slanting dashes of ink, snow in white flakes inked round, fog pale banks. Scenery is puffy trees
on bendy trunks, one in four with a face, toadstools, daisies with faces, tufts of grass, rocks
and haystacks, and **all of it moves on the beat from its foot**, neighbours a little out of step
(stamps, placed again at each step, the shadows left still): trees lean and squash, daisies and
grass sway further, toadstools and haystacks bounce, rocks only breathe — nothing round and black, which is a bomb; on the outer sea a fish
hops out grinning, a whale surfaces to spout and a rowing boat crosses, its oars pulling on
twos, hidden behind the clock. Its banner is a title card, grey rays bursting from its middle,
a white double rule along it, lettered fat and white, inked; its HUD a strip of film with its
sprocket holes; its timer fat white figures inked thick; its island banners white lozenges and
its stamps a black title card in a double rule, in italics, as "The End" was; under it the final
round's dusk is the film darkening and its embers white dust. Its title is the word in fat white
letters, bouncing by turns, the O looking out with pie-cut eyes; its finish stars in the
winners' colours, the winners' flag a pennant with a white star on a black pole held up by a
white glove. The player colours are the shared ones; nothing else on the board has colour.

**Christmas** (`christmas.ts`, `art.christmas`, `yule.ts`), for either look: **Christmas Eve on
snowy islands in a midnight sea** — the user's idea, its design left to us, ARCHIVE 12zc. Snow
always falls, drifting; **a blizzard**, thick, fast and slanting on the wind, in snowy weather and
at the climax, overtime and the final round. The sea is midnight blue, lighter where it laps the
ice, starlight glinting in it; the land snow, soft blue drifts and frost glints on it, an ice shelf
along the coast. Walls are **presents** wrapped in the owner's colour, a dot of their light in two
corners, white ribbon tied round each and a bow on one in three, dark seams between the boxes —
without them the ribbons ran on into a grid — and snow lying on the tops open to the sky; a
player's who is out, and rubble, plain cardboard. **Sealed ground is the owner's tartan** laid on
the snow: their colour washed over it, broad bands of their dark shade across and down every other
tile, a thin line of their light by each tile's edge. **Castles are Christmas trees** standing in a
present in the owner's colour, three tiers of fir with snow on each, a gold garland and baubles in
the owner's colours, and **sealed is the tree lit** (`FlagHoist`): warm-white fairy lights
twinkling to new brightnesses every `twinkleMs`, the star shining, each halo in an added layer; a
breach makes them sputter out; a player's who is out has a bare brown tree. **Guns are snowmen** in
the owner's scarf and hat-band, facing their target: firing, one leans into the throw, its arm
high with a snowball; **a silenced one has half melted**, slumped into a puddle, its hat over its
eyes. Trees and snowmen are stamped in one, nearest last, so a snowman north of a tree no longer
hides its top. Shots are **snowballs** trailing sparkles in the owner's colour. A hit is a white
puff of snow — the one flash at a spot — and on a wall the present bursts into scraps of wrapping
in the owner's colour and curls of ribbon; on open ground a dent in the snow fading over
`fx.craterRounds`; in the sea a splash with chips of ice. The piece in hand is **a present being
wrapped**, a bow on it; where it does not fit, grey, its edge broken into dashes, no bow. **A snow
globe** stands in the corner, a cottage with a lit window and a fir inside, its snow settling
slowly; at the climax it is shaken, rocking, its snow whirling. Scenery is snowy firs and spruces,
wooden sleds, lanterns glowing warm, igloos and snow-capped rocks — no snowman, which is a gun, and
nothing boxed, which is a wall; on the outer sea **Santa's sleigh** flies across now and then, four
reindeer and a trail of gold sparkles, its driver in a wine darker than any player's red, and ice
floes drift by with a seal or a polar bear on each, hidden behind the globe. Its banner is green
velvet edged in gold, snow along its top and fairy lights strung along its foot; its HUD the same
velvet over a string of fairy lights; its timer frosted figures rimmed in ice blue; its island
banners gift tags on a gold string and its stamps a red ribbon edged in gold. Its title is the word
as a fir garland, snow on the letters, fairy lights strung along them and a gold star on the B; its
finish snowflakes in the winners' colours, the winners' flag a Christmas stocking hung from a gold
pole with a star at its top. The player colours are the shared ones; the lights are warm white,
gold is the garlands' and the stars', and nothing else on the board is a player's colour.

The thirteen shape-drawn styles share `walls.ts`: the wall geometry (tops, faces, rim), and
hatching laid on one lattice so neighbouring tiles hatch as one fill.

**Scenery on open land** (`scenery.ts`, `art.scenery`), in every style: copses of trees and
pines with bushes at their edges, and a few lone trees, bushes and boulders, placed from
the seed alone so every look puts them on the same tiles — only a step in from the coast,
and not on or beside a castle. Each style draws its own: trees in Medieval and Night, a
landscape plan's scalloped canopies in Blueprint, inked trees in Parchment, dim nodes in
Cyberpunk, lollipops, meringue, candy floss and cookies in Chocolate, dead trees, pumpkins,
toadstools and headstones in Halloween, cherry trees, pines, bamboo, garden rocks and stone
lanterns in Sakura, chestnut trees, beer-garden tables, gingerbread hearts, dropped Maß
mugs and sleeping revellers in Oktoberfest, harps, music stands, choir singers, metronomes
and grand pianos in Opera, potted plants, open-plan desks, cacti on filing cabinets, swivel chairs, archive boxes and
jammed printers in Office, kelp, tube sponges, starfish, scallop shells, barnacled rocks,
anemones, anchors and bottles in Under the sea, split trees, telegraph poles, fulgurites,
lightning rods and Wimshurst machines in Electric, swaying trees, toadstools, daisies with
faces, haystacks and rocks in Cartoon, firs, sleds, lanterns, igloos and snowy rocks in
Christmas, a faint dot in Minimal. **It must never read as wall**, nor as a gun or a
shot: Blueprint's trees were first a circle with a cross, a gun's survey mark in small,
and Medieval's boulders a round grey rock, a cannonball's double. A tile once built on or
sealed is cleared for the rest of the match, so nothing grows back through a breach; a
piece landing on scenery knocks it flat with a puff, told to the looks on screen only.
**Every style keeps life on the outer ocean** — outside the box round all the land,
where no shot ever flies, in neutral colours so nothing passing reads as a player's, and
none of it under reduced motion. Moved by one module (`ocean.ts`: things crossing a row,
circling, or surfacing for a while), drawn by each style (`pixel/ocean.ts`,
`seaLife.ts`): in Medieval and Night a boat under sail, gulls wheeling and fish jumping;
in Parchment an engraved ship and a sea serpent's coils, kept off the compass rose; in
Blueprint a ship drawn in plan on a dashed course; in Cyberpunk drones circling with a
searchlight on the water and a hover-craft trailing light; in Toy bricks a boat of bricks,
a rubber duck and a shark's fin; in Chocolate a paddle-boat, marshmallows and a whirlpool
under a glass pipe, kept off the chocolate fall; in Halloween a ghost ship, a flock of bats
and a will-o'-wisp; in Sakura a boat under a square sail, a line of cranes and a great wave,
hidden behind Mount Fuji as they pass it; in Oktoberfest a floating Maß, a reveller asleep
on a lilo and a Weißwurst swimming circles, hidden behind the Ferris wheel; in Opera swans, a singing gondolier and the Flying
Dutchman, hidden behind the conductor; in Office robot vacuums, a stray paper plane and a
colleague racing past on an office chair; in Under the sea schools of fish, jellyfish, a sea
turtle and a manta ray, hidden behind the wreck; in Electric electric eels leaping, a ship with
St. Elmo's fire on its masts and a gull blown past; in Cartoon a fish hopping, a whale spouting and
a rowing boat; in Christmas Santa's sleigh and ice floes with seals and polar bears; in Minimal a plain boat's silhouette. Anything tall keeps
to rows whose top is clear of the HUD bar.

**A piece in the corner, in every style** (`corner.ts`, PLAN 11.24, ARCHIVE 12t): in the
sea's bottom-right corner, the one the HUD leaves alone and clear of the big timer (`roseSpot`,
`cornerSpot`), each style stands something of its own — Parchment's compass rose, Chocolate's
chocolate fall, Halloween's moon and bats, Sakura's Mount Fuji, Oktoberfest's Ferris wheel,
Opera's conductor, Office's water cooler and its gossips, Under the sea's shipwreck with an
octopus draped over its bow (ARCHIVE 12u), Electric's Jacob's ladder (ARCHIVE 12v), Cartoon's alarm clock on legs (ARCHIVE 12zb), Christmas's snow globe (ARCHIVE 12zc); Minimal's signal buoy, bobbing, its
gold light blinking; Medieval's windmill on a rocky islet, sails turning, quicker in rain, in
the day's light and mirrored in the sea; Night's fishing boat at anchor, its lanterns swaying
and lighting the water, flaring in the final round; Cyberpunk's holographic billboard, a
wireframe cube turning on a panel of light, glitching as walls are hit, a warning in its place
in overtime; Blueprint's title block — BOLLWERK, sheet N of the rounds, the scale and a north
arrow — inked anew each round and stamped "FINAL" in red for the last, lettered in the
reader's language; Toy bricks' crane on a barge, its jib swinging and a brick lowered and
lifted, a hazard light strobing white in overtime; and Stained glass's hourglass, its sand
running with the phase's clock, turned over as each phase begins. Most hurry while the clock
presses (`pressing`). Neutral colours, never a player's: a crane's yellow would be the amber
player's. The style's sea life passes behind it. Each costs well under a millisecond a frame.

**The match's moments** (`camera.ts`, `art.camera`). The match opens
close on the viewer's own island, marked **"You are here"** until they choose a castle —
seats are shuffled onto islands, so nobody knows which is theirs until told — and pulls
out to the whole map before the castle choice opens. At game over the camera pushes
slowly onto the winners' islands, about where they stand, since the middle of the screen
is the summary's. **The camera moves only while nothing is playable**, as a pure function
of the sim clock (the opening) or of time since the end, and stands still under reduced
motion; the scene maps clicks and HTML overlays through it all the same, and the wipe's
masks sit outside it, since the banner's line is in screen space. **The last round is
marked**: its banner is headed "Final round" with "Fire!" under it, a stamp lands across
the board as it opens, the round counter says so, and a faint dusk holds at the screen's
edges, embers drifting up them (`finalEmberCount`) — in every style, beside Medieval's own sunset — never over the board's middle,
so no colour moves. The summary's filmstrip, the board at every resolution, was removed
after the test sessions: it did not look good and added nothing.

**Languages** (ARCHIVE 12g): English and German. Every text a player reads is in
`config/locale/<language>.json` — flat keys, whole sentences with named placeholders, plurals
as their forms — read through `packages/config` and shown by `i18n.ts` (`t`, `ordinal`,
`formatNumber`, `listOf`, by the language's own `Intl` rules). Every language must have
exactly English's keys and placeholders, or `locale.test.ts` fails; a text a language lacks
shows in English. **A text is a key until it is shown**: tables held at module level keep
keys, so a change of language reaches them. The language is chosen in the menu and the pause
menu, saved as `bollwerk.language`, the browser's own on a first visit, and `&lang=` for
screenshots; the HUD follows at the next frame, panels built once listen for the change. It
is the page's own: nothing translated travels, and players at one table may each read their
own. The desktop window speaks the system's language. Names in a match's state ("Bot 3")
stay as the match began, since they travel; `CREDITS.md`, the README, the docs, logs and
recordings stay English.

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
  island alone, which is exact and far faster than the whole grid, and once a plan: every
  wall a plan weighs is cut on one graph and remembered for it (`SealPlanner`, ARCHIVE 12w).
- **A minimum cut is the _tightest_ wall that works** — which is exactly the wall with
  nowhere to put a gun, and the most fragile one. Nearly every bot problem traces back to
  this. Once sealed, `widestAffordable` asks for room first and gives it up a tile at a
  time until the plan fits the phase's budget.
- **But when breached, the tightest wall that keeps the guns comes first**, and room is
  bought once something is sealed. Asking for room first is what lost a quarter of all
  rounds 1–3 cells short (ARCHIVE 10s). A bot counts its sealed castles with
  `computeEnclosure`, never from `enclosedCastles`, which landing shots do not refresh.
- **A wall is never planned through a tile no piece can cover** (`markUncoverable`,
  `coverable`): a shot's hole between wall and sea or gun takes no piece once one-cell
  pieces stop, and a third of failed rounds ended on one; the plan routes round it from the
  start (BOT_LEARNING.md, A).
- **Once sealed, the wall is widened before it is thickened** (`widensWhenSealed`, `widen`):
  the most valuable wall the phase can finish — the standing wall pushed out to take in
  another castle, or a stretch of land beside it — if worth 1.1× what is held. Building
  outside a sealed wall leaves it whole, so it needs no bail-out. One such bot against two
  without won 65 of 96 at Levels 5 and 8 (BOT_LEARNING.md, B).
- **Cannons are never pinned when there is any alternative**: a spot beside a wall block
  with nothing buildable beyond it is where one shot makes a hole only a one-cell piece
  fits. Then clearance from wall and shore, then range.
- **Attacking is a 0-1 BFS** from the border, free across open ground and one per wall
  block, which finds the thinnest part of a defence. One shot per tile: a shot destroys
  exactly the tile it hits, so a second is always wasted.
- **Pace is in human units** — milliseconds per placement, scaling with piece size — so a
  bot slows as the piece schedule widens, for the same reason a person does.
- **A table's bots share their plans** (`PlanningSlots`, `ai.plansPerTick`): a wall's plan or
  a castle's choice costs about 5 ms, and a room cannot send a tick before its bots have
  thought. Everyone is dealt the same pieces, so bots of one level fell due on the same
  ticks all phase; now a bot finding none left waits a tick, and they fall out of step. They
  take their turns in player order rotated by the round (`turnOrder`), so the same ones do
  not always wait (ARCHIVE 12p); every driver takes them through `takeBotTurns`, and seats
  a table through `dealSeats` (ARCHIVE 12w).
- A bot **does not idle while anything is worth building**. Choices are tried in turn —
  the plan, thickening, the next castle (up to every castle on the island), more room,
  and finally any tile against the outside of its wall — skipping tiles already found
  unreachable, and a failed fit falls through to the next rather than pausing.
  Affordability governs whether to commit to a plan over staying alive; it does not govern
  spending time nobody else wants.

**Teammates are never targets**, and cannons face the other teams' castles. Bots build
only on their own island, so they never help a teammate, whatever the rule allows.

**A bot is a skill level and a personality** (11.6). **Skill, Level 1–10**, chosen per seat
in the lobby: pace, aim, replanning, judgement, and at low levels sloppiness — a worse fit
now and then — and carelessness, the chance of a castle taken at random or a gun placed
half by chance, fading from always at Level 1 to never at Level 5 (ARCHIVE 12h). A table of anchors in `ai.default.json`,
interpolated between (`skillAt`); Level 5 is the old gunner, 8 the marshal, 2 the recruit.
**Personality**, dealt from the seed for the whole table (`dealPersonalities`) and hidden
until the end, each trait from a bag so a table is mixed (ARCHIVE 11zi): risk (defensive thickens until no way in takes fewer than two shots, then expands;
offensive widens its wall while repairing a small breach and reaches for more castles,
the old baron) and targeting (point-maximizing, strategic, finisher, grudge, each half of
its aimed shots, the rest by the neutral rule), and cannon space (max cannons walls up to
two pockets for guns against its own wall, `pocketPlan`; secondary asks less room and
thickens first; balanced as before). `botProfile` compiles the two into what the bot
reads. Measured 2026-09-25 under the old tiers at three players, both seats: marshal beats
two gunners 29 of 40, baron 28; gunner beats two recruits 9 of 12. Records in the archive
from before 10l are historical.

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
  commit** (`-dirty` with uncommitted changes; `BOLLWERK_COMMIT` in the image, which has no
  repository), and `--replay` names it, and says to check it out when a replay diverges.
  A person's seat has no pieces budget, and its cell in the table is left empty.
  **A recording's format names its fingerprint**: format 1 (before 2026-10-07) carries
  version 1 of `hashMatchState`, which left out each player's piece schedule and a few
  counters; format 2 carries version 2. Each is checked against its own, and the ruleset
  keys removed since (`RETIRED_RULESET_KEYS`) are dropped from an old header as it is read,
  so every recording still replays exactly against the code that made it.

Tests state expectations as ASCII pictures where the subject is geometric
(`stateFromAscii`, with an optional island overlay for walls and castles that belong to
someone other than island 1). A test that asserts "failing to seal ends your match" needs
`withoutContinues`, and so does anything measuring the piece-size ramp; anything about
elimination or long matches needs `withoutRoundCap`. Enclosure in real play is checked at
every resolution against an independent search, not only on unit pictures.

---

## 10. Milestones

| #   | Goal                                                      | State               |
| --- | --------------------------------------------------------- | ------------------- |
| M0  | Scaffold, config schemas, CI                              | Done                |
| M1  | Simulation core                                           | Done                |
| M2  | Playable locally, placeholder art                         | Done                |
| M3  | Style abstraction, then procedural art                    | Done                |
| M4  | Online multiplayer                                        | Done                |
| M5  | AI opponents                                              | Done                |
| M6  | Full scope: 2–8 players, audio, lobby, Docker, deployment | Done                |
| M7  | Balance pass                                              | Done (ARCHIVE 12h)  |
| M8  | Team mode, and one lobby for online and offline           | Done                |
| M9  | Visual pass: phase themes, banner wipe, effects, lobby    | Done (ARCHIVE 11h)  |
| M10 | Alternative visual themes: Night, Blueprint, Cyberpunk…   | Done (ARCHIVE 11h)  |
| M11 | UI and effects polish: roster, combat aids, summary…      | Done (ARCHIVE 11h)  |
| M12 | Second visual pass: scenery, atmosphere, Toy bricks       | Done (ARCHIVE 11w)  |
| M13 | Bots as skill levels and personalities                    | Done (11.6)         |
| M14 | A desktop app for releases                                | Done (ARCHIVE 11zt) |
| M15 | More languages: German                                    | Done (12g)          |
| M16 | UPnP for hosting without touching the router              | Done (ARCHIVE 12j)  |

---

## 11. Open work

**Where to start (2026-10-07).** Everything planned is done and in **v0.8.3**, the latest
release: the game and online play, bots as skill levels and personalities, eighteen styles
each with its piece in the corner — Cartoon and Christmas the newest (ARCHIVE 12zb, 12zc) — random looks every round, English and German, the desktop
app, UPnP, the balance soak and the rendering work (ARCHIVE 12h–12v); the refactoring of
2026-10-07 (ARCHIVE 12w, protocol 17); and stronger bots — they route round holes no piece
can fill and widen their walls once sealed (ARCHIVE 12x, 12y). The bot learning work, item
3, is **paused** after a first learned fit (ARCHIVE 12z), its next steps in
[`BOT_LEARNING.md`](./BOT_LEARNING.md) §6. More test games come first, towards a first
feature-ready version. **Tournament mode** (decided 2026-10-08) is built — a cooperative run
of matches against a field of named bots, offline or with friends in the host's team, saved
between matches — its design and work packages in [`TOURNAMENT.md`](./TOURNAMENT.md) and
ARCHIVE 12ze–12zk; what is left of it is T8, the users' play-testing round, under way
(its first feedback in ARCHIVE 12zl, the looks' wipes smoothed in 12zm). Should the wipes still
stutter there, what is left is each style's terrain drawn whole: splitting it by island, in all
eighteen styles, would remove the last hitch a new random look costs. French is not to be
done (the user's decision, 2026-10-06). Still open:

1. **The user's manual test of UPnP**, reported back: switch on Open to the internet in the
   app, or `npm start -- --upnp`, and open the invite link from a phone on mobile data
   (ARCHIVE 12j). Whatever they find is triaged with them first.
2. **Bots that miss as people do** (the user's task, 2026-10-06; how and at which levels not
   yet decided). Bots should feel fair, and in combat they are superhumanly precise: their
   only error, `aimJitter`, chooses a worse target, never a worse shot — a jittered shot
   still lands on an opponent's wall that none of its own shots is headed for. People playing
   fast and frantic, as the game wants, hover and click as quickly as they can: the cursor
   is not on a wall at all, a double click sends two shots at one block, and now and then a
   teammate's shot gets there first. Combat is meant to stay frantic; accuracy is a skill
   players grow into. The task is an execution error beside `aimJitter` — say a share of
   shots landing a tile or two off, or a second shot at the block just fired at — scaled by
   level, then a soak to keep the ladder in order, since it weakens every level it touches.
   That soak covers one change already made without one (2026-10-07): a sloppy bot's
   "worse fit" was often the very placement it had chosen, a square's four turns or one
   anchor reached twice counting as alternatives, so Levels 1–4 now slip for real.

   **The yardstick** is the recordings of 2026-09-30 to 10-05 (five team matches of the two
   testers against L3–L5 bots, replayed exactly; sparse, so tendencies only). **Thomas is a
   good player but not a pro, Mausica a casual one**, and the bots should be balanced with
   both in mind. Where each shot went, as it landed:

   |            | on a wall | wall already gone | bare ground or sea |
   | ---------- | --------- | ----------------- | ------------------ |
   | L3–L5 bots | 91–94%    | 6–9%              | 0%                 |
   | Thomas     | 72%       | 18%               | 10%                |
   | Mausica    | 57%       | 25%               | 18%                |

   **The build phase** can be judged from the same data, and there the bots are within human
   range: pieces a build phase L3 13.6, L4 13.4, L5 14.2, against Thomas 16.2 and Mausica 12.8;
   median time between pieces L5 1.5 s, Thomas 1.1 s, Mausica 1.5 s; overtime used for 5–7% of
   pieces by everyone. What is not human is reaction: bots choose their castle, lay their
   first piece and fire their first shot at once, and place their guns in about 0.5 s
   (people 3–4 s, up to 10). Bots at L3–L4 also leave about half their guns inert outside
   sealed ground (L5 a fifth, people almost none), and fade late — L5 banked about 216 points
   a round in rounds 4–7 and 104 in 8–10, where both testers rose. Of the five matches the
   testers won both six-player ones (L4, L5) and the two-against-two against L3, and lost
   both two-against-two against L5 by knockout in rounds 7 and 8, where every bot shot is at
   them.

3. **Stronger bots by valuing options, then learning the weights** (the user's goal,
   2026-10-07; also to learn how ML fits a game): the plan, its steps and its progress are
   in [`BOT_LEARNING.md`](./BOT_LEARNING.md) — first the testers' recordings, then a "go big
   while a bail-out remains" rule, then a scoring function trained by the cross-entropy
   method. Read it before changing how bots build. Steps 1 and 2 are done (ARCHIVE 12x,
   12y); step 3's first run learned a fit about as good as the hand-made one (ARCHIVE 12z),
   and the work is **paused** (2026-10-07), its next steps in BOT_LEARNING.md §6.

Only open work is kept here. Finished packages move to `ARCHIVE.md` under their old
numbers — 11.1 scoring, 11.7 team mode, 11.8 the visual pass, 11.9 the themes, 11.10 the
UI polish, all in ARCHIVE 11h; 11.11 the second visual pass and 11.12 the first
test-session feedback, in ARCHIVE 11w; 11.5 the small items and 11.6 the bots, in ARCHIVE
11zd; 11.14 the second test-session feedback, in ARCHIVE 11ze; 11.15 the third visual pass,
11.16 help for new players, the menu and the sea, and 11.17 the desktop app, in ARCHIVE
11zt; 11.18 the fourth visual pass, in ARCHIVE 11zv; 11.19 every style to the edges, in
ARCHIVE 11zz; 11.20 more languages, in ARCHIVE 12g; 11.21 UPnP, in ARCHIVE 12j; 11.2 points decide, 11.3 two players,
11.4 measurements never taken and 11.13 the bots' loose ends, closed by the weekend soak, in ARCHIVE 12h; 11.22 rendering performance, in ARCHIVE 12n, its bots planning on the same ticks in ARCHIVE 12p; 11.23 random looks every round, in ARCHIVE 12q; Cyberpunk under Glowing, in ARCHIVE 12r; the slow plan late in a build phase, in ARCHIVE 12s; 11.24 a piece in the corner for every style, in ARCHIVE 12t; Under the sea and Electric, in ARCHIVE 12u and 12v; Cartoon and Christmas, in ARCHIVE 12zb and 12zc; the refactoring of 2026-10-07, in ARCHIVE 12w — so the open sections keep theirs.

## 12. Deferred (explicitly out of scope for v1)

Quick-match and matchmaking, accounts and persistence, ranking, mobile
and touch input, spectator mode, shipped replays, naval units, singleplayer campaign.

**Signing the Windows app** (explained 2026-10-06, not pursued for now): unsigned, Windows
warns of an unknown publisher; a signature names the publisher, though SmartScreen still
warns until downloads build reputation, and since 2023 the key must live in hardware or a
cloud service. The free routes are **SignPath Foundation** (free signing for open-source
projects such as this MIT one, from GitHub Actions, the publisher shown as SignPath
Foundation) and the **Microsoft Store** (free for individual developers; the Store signs and
installs it, with a review, an age rating and a privacy policy). Certificates (about 50–400
euros a year) and Azure Trusted Signing (monthly) cost money.

**Declined for budget** (2026-10-03, the user's: a fan project without one): **macOS builds**,
since an unsigned app is refused by Gatekeeper and signing needs the paid Apple Developer
Program — Mac players can still join a hosted game in the browser; and **a hosted public
server or relay**, which would make online play work without any router setting but costs
money every month (11.21 is the free part of that).
