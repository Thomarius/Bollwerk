# Special towers — design and plan

A match may let each player bring one **special tower**: a cannon with an ability of its own,
bought in the cannon phase by giving up two or three ordinary cannons. Each tower makes for a
different way to play — more damage, sturdier walls, a faster tempo — at the price of guns, and
of the points those guns would have scored. This file is the design as discussed with the user
(2026-10-11, its open questions settled 2026-10-14) and the plan to build it in work packages.
**Nothing of it is built yet.** Like PLAN.md it says what is configurable and why and leaves the
values to `config/*.json`; when a package is done its summary moves to ARCHIVE.md and this file
keeps only what is open.

---

## 1. What was decided

- **All towers available from the start.** No experience points or unlocks for now: Bollwerk is
  played among friends of very different skill, and unlocks earned by playing would give the
  stronger player more options as well as more skill. Unlocks may come back later as variety,
  never as power.
- **An on/off switch** for special towers among the match settings, beside lives and rounds:
  classic matches stay possible, and a test session can compare both. **Off by default** until
  ST4 has balanced the towers, then on. A tournament's setup has the same switch (§3.3).
- **Each player chooses one tower for the match** (or none), each their own. A person's choice is
  remembered in their preferences ("none" the first time). **Bots draw theirs at random** from the
  seed — never "none" — and the draw is shown in the lobby, as the map is.
- **Bought in the cannon phase only** — the one phase without hurry — by exchanging ordinary
  cannon placements. **At most one special tower a round**, **at most three standing on the
  island**, and **never in the opening placement** after a castle is chosen (the match's start, or
  after a continue). A continue wipes the island, its towers with it, and so frees the count.
  Buying is always optional.
- **Placement is switched with the right mouse button**, unused in the cannon phase today: normal
  cannon or the special tower. Mouse only, as every action.
- **Firing uses the left button only** (the user's design, 2026-10-14): a ready special tower
  whose shot does something on impact is always first in line, the nearest of them if several are
  ready. Its readiness is shown by a second reload ring and a glow on the aiming cursor (§2.2).
- **A tower counts as one gun for the points** (`gunPoints`), whatever it cost: trading three
  cannons for one tower costs two guns' points every round it stands. That is meant — a decision
  with a price, and a lever for balance.
- **The graphics are each style's own cannon with an emblem** for the tower's kind — one shared
  mark in every style, as the main castle's crown is — and generic, palette-tinted effects for
  its shots. Custom tower art for a few styles stays possible later, never promised for all
  nineteen.
- **The first version brings three towers**: **Big Bertha** (offence, cost 3), **Architect**
  (defence, cost 2), **Rapid Cannon** (tempo, cost 2). Each is deterministic without new
  randomness, simple in the rules, and gives the bots a clear placement rule. More may follow (§4).
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
  for the whole match (its loadout). People choose in the lobby; bots' are drawn from the seed when
  the table is set (§3.5).
- In a cannon phase that is not the player's opening one (`owesCastleChoice` was false when the
  phase began), a player holding at least the tower's **cost** in cannons to place, with fewer
  than `maxOwned` towers on their island, may place their tower instead of that many cannons, once
  a round. It is placed like a cannon: on free land inside their own sealed territory
  (`canPlaceCannon`'s rules, which already keep every gun on its owner's island — a teammate's
  island takes walls, never guns), with the tower's own footprint — 2×2 like a cannon, or 3×3
  where the tower's balance wants placement to be harder.
- **The cost meets the reward**: a sealed main castle earns 2 cannons and every other sealed
  castle 1 (`ruleset.cannons`), and cannons unplaced at the phase's end are lost — nothing is
  saved towards a tower. So a tower of cost 2 is open to anyone holding their main castle, and
  Big Bertha at cost 3 only to a player holding a second castle as well. That is meant (the
  user's design, 2026-10-14): the strongest tower carries a risk, and choosing a tower of cost 2
  or 3 is a real decision — a defensive or slower player who rarely walls a second castle may
  rather choose one of cost 2.
- **The right mouse button switches the ghost** between an ordinary cannon and the tower; the
  ghost shows the tower's footprint, emblem and cost, and turns invalid where it cannot stand,
  or when the player cannot afford it, has placed one this round, owns the most allowed, or is in
  an opening placement.

### 2.2 Living and firing

- A tower is a cannon in every other way: it stays where it stands, it goes **inert outside
  sealed ground** like any gun (so an investment outside a safe wall is a real risk — wanted:
  it rewards the big, safe enclosure people build), it is never destroyed, it scores as **one gun
  firing** at each resolution, and a continue wipes it with everything else.
- **Towers of two sorts.** A tower whose shot does something on impact — Big Bertha now, Chain
  Lightning or Scattershot later — is an **impact tower**. A tower that fires ordinary shots — the
  Architect, the Rapid Cannon, however quick its reload — is not: it changes nothing about where
  to aim, and fires as any gun.
- **Every shot is a left click**, and the sim chooses the gun (`findReadyCannon`): the nearest
  ready impact tower if any is ready, otherwise the nearest ready gun of the rest, as today. So
  the player decides where a Bertha's shot lands by when they click, not which button.
- **Two reload rings** on the cursor: the one of today for the ordinary guns, and a second for
  the impact towers, filling towards the next one to be ready. While an impact tower is ready
  **the aiming cursor glows** — one glow for every kind at first, each kind's own animation later
  (sparks for Chain Lightning). Neither shows for a player with no impact tower.
- Passive abilities (the Architect's repair, the Bastion's walls) need no firing.

### 2.3 The first three towers

Every number below is a starting value for the soaks (§6), kept in config.

**Big Bertha** — offence.

- Cost 3 cannons, footprint 2×2 (3×3 a lever if it proves too strong). An impact tower.
- Its shot clears a larger crater: `plus5` (the tile and its four neighbours), the pattern that
  already exists for ordinary shots (`craterPattern`), against an opponent's walls only, as
  every crater. Points per wall cleared as ever, so it also scores more.
- Its value is the breach, not the tiles: one shot opens a wall up to three thick, where
  ordinary guns need shots in line. Three ordinary guns take three tiles a flight; a Bertha's
  cross takes about three of a single wall and more of a thick one.
- Its flight is a factor on `flightTicks`, 1.0 at first: as quick as any gun, since at cost 3
  she already fires one shot where three cannons fire three.
- A 9-tile crater (`square9`) would break most rings with one shot: not at first.

**Architect** — defence.

- Cost 2, footprint 2×2. Less offence, more security: it fires ordinary shots like a cannon.
- **At the end of each combat phase**, before the banner, it **rebuilds the walls its owner lost
  to shots in that combat** within a radius of 2 tiles of its footprint (Chebyshev), on its own
  island. Then the repair is on the board through the intermission, where the player sees it and
  the bots plan their build on a snapshot that already holds it (ARCHIVE 13zf).
- Only where the tile is free, and only if the Architect is active — as of the last resolution,
  the same rule that lets a gun fire, since shots landing do not refresh the enclosure. The
  repaired walls are the island's own again. The attacker keeps the points for them: the shot
  did land.
- Levers: the radius (2–3), the cost (2–3). It repairs only walls lost to shots, never walls
  swept as orphans.

**Rapid Cannon** — tempo.

- Cost 2, footprint 2×2. Not an impact tower: it fires with the ordinary guns.
- An ordinary shot with a **shorter flight**, so a shorter reload — flight time is the reload: a
  factor on `flightTicks`. **It must fire more than the two cannons it costs** (the user's
  condition), so the factor starts at 0.4 — two and a half shots for one, a flight of 1600 ms
  becoming 640 ms, which a person can still follow. It also takes one gun's room for two guns'
  price, which counts for a cramped player.
- The simplest tower to build and to balance; a good first one to soak.

---

## 3. Where it lives

### 3.1 Simulation (`packages/sim`)

Built in ST1; the rules are in `sim/src/specials.ts`.

- `Cannon` and `Shot` gain `kind: CannonKind` — `'cannon' | 'bertha' | 'architect' | 'rapid'` —
  a cannon's `w`, `h` its kind's footprint. Whether a kind is an impact tower is a property of
  the kind in code (`isImpactTower`), not configuration.
- `PlayerState` gains `special` (the loadout, from the match's options, null unless towers are
  played), `specialsBought` (this cannon phase's, against `perRound`, zeroed as combat begins) and
  `openingPlacement` (set at the match's start and at a continue, cleared as combat begins — the
  castle chosen during the phase no longer tells an opening from an ordinary one).
- `MatchState.lostWalls`: the wall tiles shots cleared since the last barrage ended, noted only
  while towers are played, emptied by the repair. Everything new is in the state hash, version 3
  (`HASH_VERSION`), and so recordings are format 3; formats 1 and 2 replay against their own.
  The snapshot carries it all.
- **Actions**: `place_cannon` gains an optional `special: true` — the player's tower rather than a
  cannon; absent, a cannon, so old recordings and clients read the same. `fire` is unchanged.
  New rejections: `special_off`, `no_special`, `special_at_opening`, `special_this_round`,
  `special_cap`, `special_too_dear`, each with its text in every locale.
- `placeCannon` charges the cost against `cannonsToPlace`; `findReadyCannon` puts the nearest
  ready impact tower first (§2.2); `flightTicks` takes a factor, exact at 1; `resolveImpacts`
  takes the crater of the gun that fired (`craterOf`); the intermission before a build phase,
  once no shot is in the air, runs the Architects' repairs in seat order (`repairWalls`, a
  `walls_repaired` event); `holdingsOf` already counted a tower as one gun.
- **Determinism** holds without new randomness for the first three. The later towers that need
  chance (§4) take it from `streamFor(seed, name)`, never `Math.random`.
- Tests as ASCII pictures (`stateFromAscii` gains `B`, `A` and `R`; `withSpecials`), in
  `specials.test.ts`: a Bertha's crater on an
  opponent's wall and not on a teammate's; a ready Bertha chosen before a nearer ready cannon, the
  nearest of two ready Berthas, a cannon when the Bertha is loading; the Architect's repair inside
  its radius and not outside, nor when inert, nor over a placed block; the Rapid Cannon's flight;
  a tower scoring one gun; the cap freed by a continue; every rejection.

### 3.2 Configuration (`packages/config`, `config/*.json`)

- `ruleset.specials`, strict like everything: `perRound` (1), `maxOwned` (3; to be tried without
  a limit in a later test), and per kind its `cost`, `footprint`, and its own levers — Bertha's
  `crater` and `flightFactor`, the Architect's `repairRadius`, the Rapid Cannon's `flightFactor`.
  An unknown key is an error. Whether towers are on at all is the settings' switch.
- `MatchSettings` gains `specials: boolean`, opening as the ruleset's `specials.enabled` (off), and
  `applySettings` writes it into the ruleset (ST2).
- A seat's loadout travels with the seat (as a bot's level and personality do), not in the
  ruleset: `dealSeats` gives each player their `special` — a person's choice, a bot's draw by
  seat from the seed (`drawnSpecial`, `ai/src/seating.ts`), which every page works out itself.

### 3.3 Protocol, rooms and recordings

Built in ST2, the client's controls for it to come in ST5.

- **Protocol 25**: the settings' switch (`configure`'s `settings.specials`, the host's), a person's
  own tower (the `special` message, anyone's, before the start) and each seat's in the room's
  `seats`; bots' draws are not sent, being derivable. The action field and the snapshot's new
  state came with ST1. A v0.9.6 page cannot join a room of this one.
- **Recording format 3** (its fingerprint since ST1): each player's `special` in the header, absent
  meaning none, so a replay builds the same match (`matchOptionsOf`); `--replay` reads it so.
  `shotStats.ts` and `buildStats.ts` by kind come with ST3.
- **Server** (`room.ts`): a seat keeps its person's choice; the start deals the towers with the
  seats; a seat a bot plays — the host's, watching — brings its draw. Nothing else changes,
  actions being actions.
- **Local matches**: `LocalMatch` and `Setup` take the person's tower by seat (`specials`); the
  bot worker's mirror is created from the same options, so it needs nothing new.
- **Tournaments**: `TournamentSettings.specials`, optional — a save from before plays without —
  for every match of it (`matchSettingsOf`). When on, the field's bot teams draw towers as any
  bot does; the quick rolls between other teams ignore towers, since they roll over level
  ratings.

### 3.4 Client (`packages/client`)

- **Lobby**: the switch beside lives and rounds; when on, a tower chooser for one's own seat
  (each kind with its emblem, its cost and one line saying what it does, and "none"), the last
  choice remembered in the preferences; each bot seat shows its drawn tower.
- **Controls** (`controls.ts`): in the cannon phase the right button toggles the ghost's kind
  (today it only rotates, which means nothing there). Combat is unchanged: the left button fires.
- **HUD**: the chosen tower and whether it can be bought this round (cost against cannons left,
  "one a round", the cap, "not at the opening"). In combat the second reload ring (beside
  `nextReload`, for impact towers) and the cursor's glow while one is ready (§2.2).
- **Drawing**: each style draws its cannon as today; the tower's **emblem** — simple
  shapes readable at a tile's size: a heavy shell for Bertha, a trowel or hammer for the
  Architect, chevrons for the Rapid Cannon — is one shared mark at the cannon's foot, keyed and
  drawn once (`Memos` / a `MainCastles`-like `SpecialMarks` in `theme.ts`), every style tinting it
  in its own palette. The ghost shows it too.
- **Effects**, generic and palette-tinted in every style: Bertha's larger blast (the impact effect
  scaled to its crater), the Architect's repair (the walls coming back with a shimmer as combat
  ends), the Rapid Cannon's quicker, lower arc. Cheap by the rules of "Drawing a style cheaply"
  in CLAUDE.md.
- **Sound**: one cue per tower's firing or repair, CC0 from OpenGameArt, credited in
  `config/audio.manifest.json` like every file.
- **Texts** in every locale file (English and German), and a **How to play** page for the towers.
- **Screenshots** (`tools/screenshots.sh`): the ghost in each kind, an emblem in a few styles, a
  Bertha blast, an Architect's repair, the two rings and the glow.

### 3.5 Bots (`packages/ai`)

- **Loadout**: drawn at random from `streamFor(seed, …)` per seat when the table is set, among the
  towers only (never none), and shown in the lobby. By personality or set by the host may come
  later.
- **Buying** (`Siting`): buy when the tower's cost leaves enough cannons for the room it has, never
  at the opening, and only on sealed ground likely to stay sealed (inside the main enclosure, not
  a pocket); `wallValue` counts a tower as one gun. **Placing**: Big Bertha and the Rapid Cannon
  where an ordinary cannon would go, nearest the rivals it will shoot (`rivalDistanceExponent`);
  the Architect beside the stretch of its own wall breached most often — its weakest wall
  (`weakestWall` of its own island) or the tiles lost last round.
- **Firing** (`Gunner`): the sim picks the gun, so the Gunner asks which gun its next shot will
  come from. When it is a Bertha it aims where the crater takes most wall tiles (a sum over
  `plus5` on the weakest wall's blocks), as the weakest-wall breach does today, and subject to the
  same misses by level (`ai.aim`). Otherwise it aims as now.
- The worker, the thread driver and the harness need nothing new: a bot's actions are actions.

### 3.6 Measuring

- `shotStats.ts`: shots and walls cleared by cannon kind; `buildStats.ts`: towers bought, walls
  repaired; the headless harness: `--specials on|off` and a seat's tower (`--special bertha,none,…`
  beside `--level` and `--personality`; `random` draws as a match does).

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
  arc in every style, and sparks on the aiming cursor while it is ready. An impact tower.
- **Scattershot**: three more shots land at random beside the target. Random tiles chosen on the
  island hit, so the extra shots are not mostly wasted on the sea. An impact tower.
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
round, the cap, not at the opening), the impact towers first in line, the three towers' effects,
a tower as one gun in the points; the state hashed; ASCII tests for each rule and each rejection.
No client, no protocol yet: the harness can already play matches with towers.

### ST2 — Settings, protocol and recordings

`MatchSettings.specials`, a seat's loadout in local and room setups (bots' drawn from the seed),
protocol 25, recording format 3, the server's checks, `--replay` reading the new header, the
tournament's switch in its settings and save.

### ST3 — Bots

Buying and placing in `Siting`, aiming a Bertha's shot in `Gunner`; the harness's `--specials`
and `--special`; `shotStats.ts` and `buildStats.ts` by kind. Tested in tables of bots before any
person plays it.

### ST4 — Balance

Soaks per tower to the user's goal (§6): costs, footprints and each tower's levers tuned in config;
the level ladder checked with towers on and off; and whether costs of 2 and 3 side by side work, or
every tower should be balanced to one cost. Recorded in ARCHIVE with the figures.

### ST5 — The client: lobby, controls, HUD

The switch and the tower chooser in the lobby and in the tournament's setup, the right button in
the cannon phase, the ghost, the HUD's state, the second reload ring and the cursor's glow, every
text in English and German.

### ST6 — The client: emblems, effects, sound

The emblem in every style (one shared mark), the generic effects, the cues and their credits,
checked by screenshots in every style and by `&perf=1` at eight players.

### ST7 — Help and documentation

The How to play page, the screenshot scenes, CLAUDE.md, PLAN and ARCHIVE.

### ST8 — Play-testing

The testers' matches with towers on, triaged with them; then the decision on §4's next tower, and
a test without the cap of three.

---

## 6. Balance

- **The goal**: a player using a special tower wins **55–65%** against an equal player using none.
- **Measured** as this session's soaks were (ARCHIVE 13t–13v): two-player tables of equal bots,
  one with the tower and one without, seats alternating, 96 matches a tower at Levels 3, 5 and 8;
  and four-player tables, one bot with the tower against three without, wins against the fair
  share and points against the others, seats rotating — always beside a control on the same seeds,
  since 48 matches read ±4 wins of noise.
- **The levers**, coarse to fine: the cost (2 or 3), the footprint (2×2 or 3×3), each tower's own
  values (crater, flight factors, repair radius), and the gun points a tower forgoes.
- **Watch**: failed rounds (an Architect may make turtles — ARCHIVE 10s found a turtle very hard to
  kill), match length, how often Bertha is affordable at all (it needs two castles sealed) and by
  whom, and the people's yardsticks (`shotStats.ts`, `buildStats.ts`).
- **Costs that differ** (2 and 3) are the design for now. If the soaks show a tower of cost 3 is
  bought too rarely to matter, or one of cost 2 dominates, the alternative is one cost for all,
  balanced by each tower's own levers (the user's, 2026-10-14).

---

## 7. Decisions before ST1

All settled with the user on 2026-10-14: firing by the left button with impact towers first
(§2.2); the Architect's repair at combat's end; three towers on the island, a continue freeing the
count; the cap of `cannons.maxTotal` counting a tower as one (it is unset by default); bots'
towers drawn at random, never none, shown in the lobby; a tournament switch; a tower as one gun
for the points; the costs 3, 2 and 2, with nothing saved towards a tower; the flight factors 1.0
for Big Bertha and 0.4 for the Rapid Cannon. Nothing is open before ST1.

---

## 8. Risks

- **Bots must use towers well**, or the feature is a person's advantage only and the balance goal
  cannot be measured. ST3 comes before the client for that reason.
- **Turtles**: a defensive tower may make a player very hard to put out, and matches long. Watch
  match length and eliminations in ST4.
- **Readability**: an emblem must read at a tile's size in every style, including the busy ones
  (Opera, Sakura, Noir). ST6 checks it by screenshots; so too the second ring and the glow.
- **Old recordings** replay unchanged: ordinary cannons and absent fields mean what they meant.
