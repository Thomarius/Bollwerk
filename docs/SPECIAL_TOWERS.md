# Special towers — design and plan

A match may let each player bring one **special tower**: a cannon with an ability of its own,
bought in the cannon phase by giving up two or three ordinary cannons. Each tower makes for a
different way to play — more damage, sturdier walls, a faster tempo — at the price of guns, and
of the points those guns would have scored. This file is the design as discussed with the user
(2026-10-11, its open questions settled 2026-10-14, every tower at two costs 2026-10-16) and the
plan to build it in work packages. **ST1–ST3, ST3b, ST5 and ST6 are built**, with the users'
first feedback, the tower menu and its preview (ARCHIVE 13zm, 13zn); ST4's first balance is
measured (13zk, the Architect's circle 13zl). Open: the rest of ST4, ST7 and ST8 (§5). Like PLAN.md it says what is configurable and why and leaves the
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
- **A tower scores as the cannons it cost** (`gunPoints`, `gunsWorth`; the user's balance after
  ST3, 2026-10-14): a variant of cost 3 as three guns firing, one of cost 2 as two. At
  first it counted as one gun, which made a tower of cost 3 cost two guns' points every round it
  stood — and Bertha won 3 of 12 in a first look. For the gun cap it still counts as one.
- **The graphics are each style's own cannon with an emblem** for the tower's kind — one shared
  mark in every style, as the main castle's crown is — and generic, palette-tinted effects for
  its shots. Custom tower art for a few styles stays possible later, never promised for all
  nineteen.
- **The first version brings three towers**: **Big Bertha** (offence), **Architect** (defence),
  **Rapid Cannon** (more guns in less room). Each is deterministic without new randomness, simple
  in the rules, and gives the bots a clear placement rule. More may follow (§4).
- **Every tower comes at two costs, 2 and 3 cannons** (the user's, 2026-10-16): a player chooses
  the tower and the cost that suits them — a variant (§2.3). The cost-3 variant is the stronger
  tower, since it is bought only in rounds its owner holds a second castle. Never a cost of 1. A
  variant that cannot be balanced may be left out in config, so a tower can come at one cost.
  The later towers (§4) are designed with both costs in mind, each by its own lever.
- **The balance goal** (the user's, loosened 2026-10-16 — the towers are a fun, wacky addition,
  not a tournament standard): each variant wins **50–70%** against an equal player using none, and
  a tower's two variants **40–60%** head to head.
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
  saved towards a tower. So a variant of cost 2 is open to anyone holding their main castle, and
  one of cost 3 only to a player holding a second castle as well. That is meant (the user's
  design, 2026-10-14, every tower at both costs 2026-10-16): the stronger variant carries a risk,
  and the cost is a real decision — a defensive or slower player who rarely walls a second castle
  may rather choose cost 2. Two things tilt it, for the soaks to weigh: how often a player holds
  two castles differs by level, so a pair even at one level may not be at another; and with the
  cap of three a cost-2 player reaches it sooner and gives up 6 cannons for it against 9, so
  match length counts a little.
- **The right mouse button switches the ghost** between an ordinary cannon and the tower; the
  ghost shows the tower's footprint, emblem and cost, and turns invalid where it cannot stand,
  or when the player cannot afford it, has placed one this round, owns the most allowed, or is in
  an opening placement.

### 2.2 Living and firing

- A tower is a cannon in every other way: it stays where it stands, it goes **inert outside
  sealed ground** like any gun (so an investment outside a safe wall is a real risk — wanted:
  it rewards the big, safe enclosure people build), it is never destroyed, it scores as **the cannons
  it cost** at each resolution, and a continue wipes it with everything else.
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

Every number below is kept in config, as ST4's first soaks left them (ARCHIVE 13zk and 13zl, the
starting values in brackets). Each tower has a variant at cost 2 and one at cost 3 (§1), told
apart by levers of their own — the thing that defines the tower stays the same in both.

| Tower        | Cost 2                | Cost 3                     | What stays                     |
| ------------ | --------------------- | -------------------------- | ------------------------------ |
| Big Bertha   | flight factor 1 (1.5) | flight factor 0.85 (1)     | the `plus5` crater             |
| Architect    | reach 2.2, 16 tiles   | reach 2.6, 24 tiles        | an ordinary gun in combat      |
| Rapid Cannon | 2 barrels, flight 1   | 3 barrels, flight 1.15 (1) | each barrel an ordinary cannon |

**Big Bertha** — offence.

- Cost 3 or 2, footprint 2×2 (3×3 a lever if it proves too strong). An impact tower.
- Its shot clears a larger crater: `plus5` (the tile and its four neighbours), the pattern that
  already exists for ordinary shots (`craterPattern`), against an opponent's walls only, as
  every crater. Points per wall cleared as ever, so it also scores more.
- Its value is the breach, not the tiles: one shot opens a wall up to three thick, where
  ordinary guns need shots in line. Three ordinary guns take three tiles a flight; a Bertha's
  cross takes about three of a single wall and more of a thick one.
- Its flight is a factor on `flightTicks`. At cost 2 the crater stays — it is what she is — and
  the user's idea was a longer flight (2026-10-16), 1.5 to start against 1 at cost 3: a combat
  phase of 10 s holds 4–5 flights of an ordinary gun, so each step of the factor is about one
  breach a phase more or less. The soaks put both quicker (ARCHIVE 13zk): at full accuracy a
  Bertha of cost 3 at a gun's flight did about what her three cannons would, and gained nothing
  above Level 3 — so 0.85 at cost 3 and 1 at cost 2. A cooldown after landing instead was considered and kept in reserve, should the
  slow shell feel wrong in play: it would be a new rule, and break "flight time is the reload"
  for one tower.
- A 9-tile crater (`square9`) would break most rings with one shot: not at first.

**Architect** — defence.

- Cost 2 or 3, footprint 2×2. Less offence, more security: it fires ordinary shots like a cannon.
- **At the end of each combat phase**, before the banner, it **rebuilds the walls its owner lost
  to shots in that combat** within its reach on its own island: a circle, a tile's centre within
  the repair radius of the footprint's centre (`inRepairReach`) — 2.2 at cost 2, the 4×4 round its
  footprint, and 2.6 at cost 3, 24 tiles. It was a square at first, 1 and 2 tiles out from the
  footprint (2 and 3 to start, far too strong at Levels 3–5), and a square moves only in whole
  rings, 16 tiles to 36, so cost 3 was given a slower gun; the user disliked that debuff, and the
  circle's finer steps replaced it (ARCHIVE 13zl). Then the repair is on the board through the
  intermission, where the player sees it and the bots plan their build on a snapshot that already
  holds it (ARCHIVE 13zf).
- Only where the tile is free, and only if the Architect is active — as of the last resolution,
  the same rule that lets a gun fire, since shots landing do not refresh the enclosure. The
  repaired walls are the island's own again. The attacker keeps the points for them: the shot
  did land.
- Levers: the radius by cost, a real number (round a 2×2: 2.2 → 16 tiles, 2.6 → 24, 3 → 32). It
  repairs only walls lost to shots, never walls swept as orphans.

**Rapid Cannon** — more guns in less room (redesigned by the user, 2026-10-16).

- Cost 2 or 3, footprint 2×2. Not an impact tower: it fires with the ordinary guns.
- **As many cannons stacked on one footprint as it cost**: a barrel for each, each with its own
  shot in flight and so its own reload — exactly 2 or 3 ordinary cannons, standing where one does
  (`Cannon.shotIds`, `barrelsOf`). Simple to use, and its advantage is room: a tight
  wall is the one with nowhere to put a gun (the minimum-cut problem), and a Rapid 3 puts three
  there. Its risk is the same concentration: inert ground silences every barrel at once.
- If room is not advantage enough, its lever is a slightly **shorter** flight for its barrels —
  a factor a little under 1, such as 0.9 (a longer one would be a slower reload, a penalty). The
  soaks found Rapid 2 on target as it is and Rapid 3 a little strong, its barrels now at 1.15.
- Replaces the first design, one barrel with a flight factor of 0.4: at cost 3 it would have
  needed about 0.27, some 450 ms, where the bots' `readyDelayMs` (up to 500 ms) and a person's
  clicking set the pace rather than the flight, so more speed stops paying.

---

## 3. Where it lives

### 3.1 Simulation (`packages/sim`)

Built in ST1, the two costs in ST3b (2026-10-16); the rules are in `sim/src/specials.ts`.

- `Cannon` and `Shot` gain `kind: CannonKind` — `'cannon' | 'bertha' | 'architect' | 'rapid'` —
  and `cost`, 1 for an ordinary cannon, a tower's 2 or 3; a cannon's `w`, `h` its variant's
  footprint. Every lever is read by kind and cost (`footprintOf`, `flightFactorOf`, `craterOf`,
  `repairRadiusOf`). A gun's shots in flight are `shotIds`, ready while it has a barrel free
  (`isLoaded`, `barrelsOf`: one, a Rapid Cannon's its cost). Whether a kind is an impact tower is
  a property of the kind in code (`isImpactTower`), not configuration.
- `PlayerState` gains `special` (the loadout, a variant such as `bertha3`, from the match's
  options; null unless towers are played and the ruleset offers that variant), `specialsBought` (this cannon phase's, against `perRound`, zeroed as combat begins) and
  `openingPlacement` (set at the match's start and at a continue, cleared as combat begins — the
  castle chosen during the phase no longer tells an opening from an ordinary one).
- `MatchState.lostWalls`: the wall tiles shots cleared since the last barrage ended, noted only
  while towers are played, emptied by the repair. Everything new is in the state hash, version 4
  (`HASH_VERSION`), and so recordings are format 4; formats 1 and 2 replay against their own.
  Version and format 3, the towers at one cost, were never released and are refused. The
  snapshot carries it all.
- **Actions**: `place_cannon` gains an optional `special: true` — the player's tower rather than a
  cannon; absent, a cannon, so old recordings and clients read the same. `fire` is unchanged.
  New rejections: `special_off`, `no_special`, `special_at_opening`, `special_this_round`,
  `special_cap`, `special_too_dear`, each with its text in every locale.
- `placeCannon` charges the cost against `cannonsToPlace`; `findReadyCannon` puts the nearest
  ready impact tower first (§2.2); `flightTicks` takes a factor, exact at 1; `resolveImpacts`
  takes the crater of the gun that fired (`craterOf`); the intermission before a build phase,
  once no shot is in the air, runs the Architects' repairs in seat order (`repairWalls`, a
  `walls_repaired` event); `holdingsOf` counts a tower as the guns it cost (`gunsWorth`).
- **Determinism** holds without new randomness for the first three. The later towers that need
  chance (§4) take it from `streamFor(seed, name)`, never `Math.random`.
- Tests as ASCII pictures (`stateFromAscii` gains `B`, `A` and `R` at cost 3, `b`, `a` and `r` at
  2; `withSpecials`), in `specials.test.ts`: a Bertha's crater on an opponent's wall and not on a
  teammate's; a ready Bertha chosen before a nearer ready cannon, the nearest of two ready
  Berthas, a cannon when the Bertha is loading; the cheaper Bertha's longer flight; the
  Architect's repair inside its radius and not outside, nor when inert, nor over a placed block,
  its radius by cost, and round rather than square; a Rapid Cannon firing as its cost in cannons, each barrel freed by its
  own shot; a cheaper variant's cost charged; a variant not offered given as none; a tower
  scoring its cost in guns; the cap freed by a continue; every rejection.

### 3.2 Configuration (`packages/config`, `config/*.json`)

- `ruleset.specials`, strict like everything: `perRound` (1), `maxOwned` (3; to be tried without
  a limit in a later test), and per kind its variants by cost, `"2"` and `"3"`, each with its
  `footprint`, `flightFactor` and own levers — Bertha's `crater`, the Architect's
  `repairRadius` (from the footprint's centre, a circle). A variant left out is not offered (`offeredVariants`); a kind needs one at
  least. A loadout is a `TowerVariant` (`TOWER_VARIANTS`, `variantKind`, `variantCost`). An
  unknown key is an error. Whether towers are on at all is the settings' switch.
- `MatchSettings` gains `specials: boolean`, opening as the ruleset's `specials.enabled` (off), and
  `applySettings` writes it into the ruleset (ST2).
- A seat's loadout travels with the seat (as a bot's level and personality do), not in the
  ruleset: `dealSeats` gives each player their `special` — a person's choice, a bot's draw by
  seat from the seed among the offered variants (`drawnSpecial`, `ai/src/seating.ts`), which
  every page works out itself.

### 3.3 Protocol, rooms and recordings

Built in ST2, the costs in ST3b.

- **Protocol 26** (25 before the two costs): the settings' switch (`configure`'s `settings.specials`, the host's), a person's
  own tower (the `special` message, anyone's, before the start) and each seat's in the room's
  `seats`, each a variant; bots' draws are not sent, being derivable. The action field and the
  snapshot's new state came with ST1, guns' costs and shots in flight with ST3b. A v0.9.6 page
  cannot join a room of this one.
- **Recording format 4**: each player's `special` in the header, a variant, absent meaning none,
  so a replay builds the same match (`matchOptionsOf`); `--replay` reads it so.
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

Built in ST5 and ST6 together (2026-10-14), so people can play with towers; the costs in ST3b.

- **Lobby** (`lobby.ts`, `lobbyFlow.ts`): the host's switch, **Special towers** On/Off, beside lives
  and rounds; a guest reads it in the table's statement. While on, a person's own seat has a button
  showing their choice — its emblem, name and a pip a cannon it costs, or none — remembered for the next table (`towers.ts`, `bollwerk.tower`; a choice saved
  before the costs names no variant, so reads as none) and sent to a room as it opens; anyone
  else's seat shows their choice, and each bot's seat the variant drawn for it. The same in a
  tournament's lobby, and a switch in the tournament's setup.
- **The tower menu** (`towerMenu.ts`, `towerChoice.ts`; the user's, 2026-10-16), opened by that
  button, where one list of every variant had stopped scaling: a card for none and each tower — its
  emblem, name and what it is for (offence, defence, more guns) — a switch for the chosen tower's
  cost, a cost the rules do not offer greyed, a card's click choosing the cost last chosen for that
  tower (`bollwerk.towerCosts`) or else its cheapest; what the variant does by its own numbers
  (`towerWhat`: the Architect's reach, the Rapid's barrels, Bertha's shell against a cannon's —
  as fast at cost 2, faster at cost 3) and when it is affordable (cost 3 only with a second castle held). A click chooses at once and is sent, Done
  only closes; it closes itself when the lobby goes, a match begins or towers are switched off.
  Its **preview** (`towerShow.ts`, `towerPreview.ts`) plays the chosen variant by the rules
  themselves on two small islands — the sim's `fire`, `resolveImpacts` and `repairWalls` on a loop:
  an ordinary cannon for none, Bertha's cross (cost 2's shell visibly slower), the Rapid's barrels
  in turn, a rival's barrage on the Architect and the walls in its reach coming back, its circle
  outlined — in the player's combat look, a style drawn from their favourites where it is Random;
  under reduced motion a still of the moment that shows it.
- **Controls** (`controls.ts`): in the cannon phase the right button switches the ghost between a
  cannon and the tower (`placingTower`), only while the rules sell it and a gun still fits
  (`maySwitchTower`), a cue either way; back to a cannon once bought. Combat is unchanged: the
  left button fires, a ready Bertha first.
- **Beside the cursor** in the cannon phase (play-testing, 2026-10-16; `towerIcons.ts`,
  `BoardLabels.showPlaceIcons`): a row of icons, a cannon each still to place, where a number had
  read as the combat's count of guns ready. With the tower chosen its emblem leads the row and
  the cannons it costs leave it (4 cannons and a Bertha 3: the tower and one). None left, or no
  room for one (`placeableCannons` — the sim keeps the count until combat), a grey cannon struck
  through. Under it, while the right button would switch, its hint: a mouse with the right button
  lit, a turning arrow, and what a click switches to. The bar's count of cannons went.
- **HUD** (`hud.ts`, `towerLine`): a line in a cannon phase — the tower on offer and its price,
  the ghost switched to it, or why not now (the opening, bought this round, the most allowed, too
  dear); nothing once no gun fits. In combat the cursor says it (`drawFireReticle`): an amber glow
  while an impact tower is ready, an inner amber ring filling toward the next while they load
  (`impactReadiness`). Big Bertha brings her own (`nextTowerShot`, the gun the sim would fire):
  while she is ready her cross is outlined under the cursor, the tiles her shot would clear, and
  flames rise round the reticle in place of the glow.
- **The Architect's reach** (play-testing, 2026-10-16): the player's own Architects' circles
  outlined faintly in their colour round the island's tiles they cover, grey for one inert, in the
  cannon and build phases only — everyone's would clutter the busy styles (the user's); and the
  ghost's while placing one.
- **Emblems** (`render/towerMarks.ts`): one layer over both looks, under the camera, as the crown
  is one mark in every style — no style's own drawing changed. A dark round badge at the gun's
  foot with the emblem in the owner's light colour from the look in front: a shell for Bertha, a
  hammer for the Architect, two chevrons for the Rapid Cannon; grey while inert; under the badge
  a pip for each cannon it cost. Bare shapes in
  the owner's colour read as their outline alone at 16-pixel tiles and vanished on their own
  ground; the badge reads in every style. Keyed, so drawn again only when a tower changes. The
  ghost shows the emblem too.
- **Effects**, in the same layer, drawn only while one plays: Bertha's blast (the crater's cross
  flashing amber and a ring spreading past it), the Architect's walls shimmering back in the
  owner's colour as combat ends. The Rapid Cannon's flatter arc went with its quick flight (ST3b):
  its barrels fly as any cannon's.
- **Sound**: three cues, `tower_fire`, `tower_impact` and `walls_repaired`, the cannon's, the
  impact's and a piece's files played lower or higher (`rate`, a new field of a cue) — no new
  file, so none to credit; the Architect heard only for the player's own.
- **Dev**: `?autostart=1&specials=1&tower=bertha3` plays a match with towers, the person's tower
  as asked.
- To come in ST7: the How to play page and the screenshot scenes. Seen in headless Chrome: the
  lobby, the ghost and the HUD line, emblems in Minimal and Parchment, the glow, a blast; the
  icons, the hint, the reaches in Minimal and Noir, Bertha's cross and flames.

### 3.5 Bots (`packages/ai`)

Built in ST3.

- **Loadout**: drawn per seat from the seed (`drawnSpecial`), among the offered variants only
  (never none), so every page can show it in the lobby. By personality or set by the host may come later.
- **Buying** (`Siting.buysTower`): as the first placement of any cannon phase the rules sell it
  in, so long as the bot keeps `ai.planning.minGuns` guns — a tower counted by its barrels (one, a
  Rapid Cannon its cost), the cannons it costs not; the build planning's `gunsReady` counts
  barrels likewise. A first rule, for ST4 to measure; the planning's `wallValue` values a tower's
  points through `holdingsOf`, as the resolution does.
- **Placing** (`Siting.site`): only in the ground round a sealed castle, never in a pocket
  (`castleGround`). Big Bertha and the Rapid Cannon as an ordinary cannon goes — never pinning a
  wall, then room, then nearest the enemy; the Architect never pinning, then the most of its own
  wall within its repair radius, its weakest wall (`weakestWall` of its own island) counting
  three times, then room.
- **Firing** (`Gunner`): a ready impact tower fires next whatever is aimed at, so while one is
  ready the bot aims for it — at the chosen opponent's weakest wall, the centre where the crater
  takes most of it (`craterTarget`), subject to the same misses by level (`ai.aim`). The stream
  draws nothing new without a ready tower, so a classic table plays as before.
- The worker, the thread driver and the harness need nothing new: a bot's actions are actions.

### 3.6 Measuring

- The harness: `--specials on|off` and each seat's tower, repeating (`--special bertha3,none`;
  `random` draws as a match does), named in the seat's label, so wins read by tower;
  `shotStats.ts` keys a tower's shots by its variant.
- The statistics rows (`RoundStats`): `special`, `towersOwned`, `wallsRepaired`. `buildStats.ts`
  keys a group by its tower where the match played them and shows towers owned and walls rebuilt
  by stage; `shotStats.ts` shots landed and walls cleared by the kind of gun that fired.
- First look (four matches, Level 5, a Bertha against an Architect): each bought two or three
  towers by round 4; a Bertha's shot took 2.5 walls, a cannon's 0.8; the Architects rebuilt 9–13
  walls a round. The recordings replayed exactly.

---

## 4. Towers for later

In the order the user liked them; each to be designed in detail and agreed before it is built,
with a variant at each cost (§1) and the lever that tells them apart — the Bastion's radius, Chain
Lightning's chain, Scattershot's extra shots, the Mortar's shots a phase.

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

In order. Each ends with `npm run check` passing and the user's go-ahead to commit. ST1–ST3,
ST3b, ST5 and ST6 are built; their plans are in ARCHIVE 13zo, what was measured and changed after
them in 13zk–13zn.

### ST4 — Balance

Soaks per variant to the user's goal (§6), the levers tuned in config; the level ladder checked
with towers on and off. Recorded in ARCHIVE with the figures. Runs beside ST8's first test
session, on the build of the day (the user's, 2026-10-16) — never while the same checkout's sim
is edited.

**First round done** (2026-10-16, ARCHIVE 13zk): four soak rounds brought every variant to the
goal or its edge; the levers are in config, the figures in the ARCHIVE. **Open for the next
balancing round** (the user's, 2026-10-16 — another session, the results looked at again first):

- Every tower is a little strong at Level 3 (70–75% against none), where bots lose more walls and
  hold a second castle less often.
- A single figure at the edge, one measurement of 96 at ±10: Bertha 3 at Level 8 (46%). Rerun it,
  perhaps at 192, before turning a lever. (Architect 3 at Level 5 is settled: its circle, at a
  gun's flight, read 68% over 192 — ARCHIVE 13zl.)
- Not yet done: the level ladder with towers on and off; four-player tables, one variant against
  three without; whether the bots' buying rule (ST3's first) does the towers justice; then
  towers on by default.
- To rerun, resumable (a chunk whose outcomes exist is skipped), then `--summary`:

  ```bash
  npx tsx tools/headless/src/towerSoak.ts --out DIR --pairs architect3:none,bertha3:none \
    --levels 3,5,8 [--set specials.architect.3.repairRadius=3]
  ```

  13zk's own scripts stayed on another machine, so its figures were on other seeds than 13zl's.

### ST7 — Help and documentation

The How to play page — what a tower is and costs, the tower menu, the right button's switch in the
cannon phase and its hint, Big Bertha's cross and flames on the cursor, the Architect's circle —
the screenshot scenes (`tools/screenshots.sh`: the menu, a cannon phase with a tower, a combat
with a ready Bertha), CLAUDE.md, PLAN and ARCHIVE.

### ST8 — Play-testing

The testers' matches with towers on, triaged with them; then the decision on §4's next tower, and
a test without the cap of three.

---

## 6. Balance

- **The goal** (loosened 2026-10-16): each variant wins **50–70%** against an equal player using
  none, and a tower's two variants **40–60%** head to head. Not strict: the towers are for fun.
- **Measured** in two-player tables of equal bots, seats alternating, 96 matches each at Levels 3,
  5 and 8, on the same seeds throughout: each variant against none, each tower's two variants head
  to head, and none against none as the control — about 2,900 matches for a first round, then only
  the variants whose levers changed. Head to head is what tells the two variants alike: at 96
  matches a win rate is good to about ±10 points, and the difference of two rates each measured
  against none to about ±14. Pairs rather than three-player tables, because bots choose whom to
  shoot by nearness. Four-player tables, one variant against three without, as a later check.
  Time a first batch before planning the rest.
- **The levers**, coarse to fine: the footprint (2×2 or 3×3), each variant's own values (crater,
  flight factors, repair radius, the Rapid's barrels' flight). The balance is to how the bots use
  the towers, and their buying rule is still ST3's first (§3.5).
- **Watch**: failed rounds (an Architect may make turtles — ARCHIVE 10s found a turtle very hard to
  kill), match length, how often Bertha is affordable at all (it needs two castles sealed) and by
  whom, and the people's yardsticks (`shotStats.ts`, `buildStats.ts`).
- **Both costs for every tower** (2026-10-16) replaced a cost a tower (3, 2, 2). If a variant
  cannot be brought to the goal, it is left out in config and its tower comes at one cost.

---

## 7. Decisions before ST1

All settled with the user on 2026-10-14: firing by the left button with impact towers first
(§2.2); the Architect's repair at combat's end; three towers on the island, a continue freeing the
count; the cap of `cannons.maxTotal` counting a tower as one (it is unset by default); bots'
towers drawn at random, never none, shown in the lobby; a tournament switch; a tower as one gun
for the points (since changed: as its cost, §1); the costs 3, 2 and 2, with nothing saved towards a tower; the flight factors 1.0
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
