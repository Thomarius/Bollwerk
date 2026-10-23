# Special towers — design and plan

A match may let each player bring one **special tower**: a cannon with an ability of its own,
bought in the cannon phase by giving up two or three ordinary cannons. Each tower makes for a
different way to play — more damage, sturdier walls, a faster tempo — at the price of guns, and
of the points those guns would have scored. This file is the design as discussed with the user
(2026-10-11, its open questions settled 2026-10-14, every tower at two costs 2026-10-16) and the
plan to build it in work packages. **ST1–ST3, ST3b, ST5 and ST6 are built**, with the users'
first feedback, the tower menu and its preview (ARCHIVE 13zm, 13zn); ST4's first balance is
measured (13zk, the Architect's circle 13zl). The users' play-testing, ST8, closed with no
issues found (2026-10-17, ARCHIVE 13zp), and ST7 put the towers into How to play and the
screenshot scenes (13zr). ST4 is closed, its remaining soaks dropped, the towers off by default
for good and the bots' buying rule kept (the user's, ARCHIVE 13zw). Open: two decisions left after
ST8 — the next tower and a test without the cap of three (§5); the towers' own sounds, TS, are
in (ARCHIVE 13zx). The sixth tower, the Laser Tower (§2.6, 2026-10-21), is built, balanced and
played by the user; the seventh, the Frost Cannon (§2.7), built and balanced, its play-test open. Like PLAN.md it says what is configurable and why and leaves the
values to `config/*.json`; when a package is done its summary moves to ARCHIVE.md and this file
keeps only what is open.

---

## 1. What was decided

- **All towers available from the start.** No experience points or unlocks for now: Bollwerk is
  played among friends of very different skill, and unlocks earned by playing would give the
  stronger player more options as well as more skill. Unlocks may come back later as variety,
  never as power.
- **An on/off switch** for special towers among the match settings, beside lives and rounds:
  classic matches stay possible, and a test session can compare both. **Off by default**, for
  good (the user's, 2026-10-17, ARCHIVE 13zw): the towers are a wacky addition, not the base game. A tournament's setup has the same switch (§3.3).
- **Each player brings one tower for the match**, each their own — never none (the user's,
  2026-10-21: buying is always optional, so a tower brought need never be bought, and "No tower"
  chose nothing). A person's choice is remembered in their preferences; never chosen, theirs is
  drawn at random for the visit, as a bot's is. **Bots draw theirs at random** from the seed, and
  the draw is shown in the lobby, as the map is.
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
  in the rules, and gives the bots a clear placement rule. More follow by the user's designs. The fourth, the
  **Lightning Tower** (offence by chain strikes, §2.4), came on 2026-10-17, the user's design.
- **The sixth, the Laser Tower** (a beam through the first walls on its line, §2.6), came on
  2026-10-21, the user's design; the seventh, the **Frost Cannon** (a shot that freezes the tile it
  hits against building, §2.7), the same day — a risky one, the user's on purpose; and the
  eighth, the **Lullaby Tower** (a shot that lulls the enemy guns nearest it to sleep, §2.8).
- **Every tower comes at two costs, 2 and 3 cannons** (the user's, 2026-10-16): a player chooses
  the tower and the cost that suits them — a variant (§2.3). The cost-3 variant is the stronger
  tower, since it is bought only in rounds its owner holds a second castle. Never a cost of 1. A
  variant that cannot be balanced may be left out in config, so a tower can come at one cost.
  Every later tower is designed with both costs in mind, each by its own lever.
- **The balance goal** (the user's, loosened 2026-10-16 — the towers are a fun, wacky addition,
  not a tournament standard): each variant wins **50–70%** against an equal player using none, and
  a tower's two variants **40–60%** head to head. **From the Lightning Tower on** (the user's,
  2026-10-17), a new tower is balanced at Level 5 only: its two variants against each other and
  each against an equal bot with no tower.
- **Dropped**: the Magma Thrower (a burning tile blocking placement can make a ring unsealable —
  a forced lost life, the most frustrating loss there is) and the Spotter (where opponents' shots
  will land gives no real advantage). **Shelved**: the Keep (a tower counting as a castle; very
  hard to balance).

---

## 2. The rules

### 2.1 Choosing and buying

- With special towers switched on, every seat — person or bot — has a **chosen tower** for the
  whole match (its loadout); the rules still take none, which an old page or recording may send. People choose in the lobby; bots' are drawn from the seed when
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
- **Towers of two sorts.** A tower whose shot does something on impact — Big Bertha, the Lightning
  Tower, the Allerdickste Bertha, the Laser Tower — is an **impact tower**. A tower that fires ordinary shots — the
  Architect, the Rapid Cannon, however quick its reload — is not: it changes nothing about where
  to aim, and fires as any gun.
- **Every shot is a left click**, and the sim chooses the gun (`findReadyCannon`): the nearest
  ready impact tower if any is ready, otherwise the nearest ready gun of the rest, as today. So
  the player decides where a Bertha's shot lands by when they click, not which button.
- **Two reload rings** on the cursor: the one of today for the ordinary guns, and a second for
  the impact towers, filling towards the next one to be ready. While an impact tower is ready
  **the aiming cursor glows** — one glow for every kind at first, each kind's own animation later
  (the Lightning Tower's crackle, the Berthas' flames, the Laser's line). Neither shows for a player with no impact tower.
- Passive abilities (the Architect's repair) need no firing.

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

### 2.4 The Lightning Tower

The user's design (2026-10-17), the old sketch "Chain Lightning" made precise. An impact tower:
whenever it is ready it fires first, as Big Bertha does.

- **It strikes on the instant.** No shell flies: the tile clicked is struck on the tick the tower
  fires, and from there the bolt **jumps** — to a wall at random within its reach of the last
  tile struck, any live opponent's (so where islands lie close it leaps the channel to a second
  opponent), never the player's own or a teammate's, never a tile struck before. Every strike
  clears one tile, as an ordinary shot does, and scores as one; an Architect rebuilds what it
  takes like any shot's.
- **No wall in reach**, or a jump that misses by the variant's miss chance: the jump strikes a
  tile at random in reach, and the chain goes on from that tile all the same (the user's).
- **Its reload is an ordinary shot's flight** from the tower to the tile clicked, though nothing
  flies (times its `flightFactor`, 1 to start): the shot stays "in the air" that long, landing
  nothing, so every reload rule and the cursor's ring hold as for any gun.
- **Levers by cost**: `jumps` — 2 at cost 2, 3 at cost 3 (so up to 3 and 4 strikes), the main one;
  `missChance` — the user prefers more jumps that may miss to fewer that do not, and the soaks put
  it at 0.6 at both costs (§5 LT); `jumpRadius`, 4 tiles, a circle from the last strike's centre.
- **Chance from the seed**: a stream of its own for every shot (`streamFor(seed, lightning:id)`),
  so every client draws the same chain.
- **Seen and heard**: a lightning-bolt emblem; on the cursor while it is ready, a crackle of short
  bolts round the reticle (no reach circle — the chain stays a surprise, the user's); its strike a
  jagged bolt from the tower through every tile struck, jumping from one to the next, a flash at
  each; heard once a strike (`lightning_strike`, `tower_lightning.mp3`), never for the jumps.
- **Bots** aim it at the block of an opponent's weakest wall with the most of their wall within
  its reach, by the misses of their level, and buy and site it as an ordinary gun goes.

### 2.5 The Allerdickste Bertha

The user's design (2026-10-17): an absolutely massive cannon, one enormous shell a combat phase,
so the one shot has to count. Big Bertha made bigger and slower, an impact tower that fires first
whenever it is ready, as she does (the user's: no button of its own).

- **One shell a combat phase.** Its flight is fixed, **10 seconds** near or far (`flightMs`), and
  the flight is the reload: as long as the combat phase, so it fires once in each. Fired late, it
  lands in the intermission, which waits for the last shot down — accepted (the user's: nobody
  holds their first shot for long).
- **Its crater a circle**: every tile whose centre is within `craterRadius` of the tile aimed at
  — **2** at cost 2 (13 tiles, 5 across), **2.5** at cost 3 (21, 5 across and fuller), set by the
  soaks (§5 BB) once the bots aimed it as people do; it was 4.5 and 5.5 (69 and 97 tiles), which
  in people's hands took a whole castle's ring a shot (2026-10-19, ARCHIVE 14h). A fractional
  radius moves it a few tiles at a time, as the Architect's reach does. Only opponents' walls, as every shot.
- **A tower like the rest**: 2×2, at both costs, under the cap of three (the user's).
- **Seen and heard**: a lit bomb for its emblem; while it is ready, its circle outlined under the
  cursor and a ring of flames as wide; a blast over every tile it clears, longer than Bertha's;
  fired with a cannon's sound, landing with its own (`tower_biggest_impact`,
  `tower_biggestbertha.mp3`). No warning for the target (the user's): you see only your own
  shots.
- **Bots** aim it as Big Bertha, where its crater takes the most of an opponent's weakest wall,
  and buy and site it as an ordinary gun goes.

### 2.6 The Laser Tower

The user's design (2026-10-21): a beam that burns through walls in a line. An impact tower:
whenever it is ready it fires first, as Big Bertha does.

- **The click sets only the direction.** The beam runs from the tower's centre through the
  centre of the tile clicked and on to the map's edge, and clears **the first walls on its line**
  — `pierce` of them — however far they are: any live opponent's, so it crosses a channel to a
  second opponent (the user's); its owner's own walls, a teammate's and an eliminated player's
  rubble it passes over, uncounted. A click on one's own island or a teammate's is refused, as
  for every shot (the user's), so a beam is aimed at or past its target.
- **It strikes on the instant**, as the Lightning Tower does: the walls fall on the tick it fires,
  each scoring as one, and an Architect rebuilds them as any shot's.
- **Its reload is an ordinary shot's flight to the first wall it clears**, times `flightFactor`
  (1 to start), not to the tile clicked — the user's: clicked by the tower's own shore in the
  enemy's direction, the beam would otherwise reload in no time. Clearing nothing, it reloads by
  the flight to the tile clicked. The shot stays in the air that long and lands nothing, so every
  reload rule and the cursor's ring hold.
- **The line is exact**: every tile the ray passes through, walked in doubled coordinates
  (`traceLaser`). A ray through a tile's corner steps diagonally, touching neither side tile; a
  sealing wall is 4-connected, so a corner it holds is always one of the two tiles the ray does
  enter, and no beam slips through a wall. A 2×2 tower's centre is a tile corner, so its beam
  meets such corners often.
- **Its lever by cost is `pierce`**, the walls it clears — **2 at cost 2, 2.5 at cost 3**, set by
  the soaks (§5 LZ; 3 and 4 to start, far too strong). A fraction is the chance of one more (the
  user's: 3.5 clears 3, and a fourth half the time),
  drawn from a stream of its own for every shot (`streamFor(seed, laser:id)`), drawn whole lever
  or not, so every client draws the same.
- **Seen and heard**: a lens with its beam for its emblem; while it is ready, a faint line from
  the tower through the cursor to the board's edge (the user's), a glow in the player's colour
  round a white core, as their beam is (the users', red at first), and not the walls it would clear — that is for the player to read; its beam drawn out from the
  tower in its owner's colour round a white core, held and faded, each wall flashing as it burns;
  heard once a beam (`laser_fire`, the user's `tower_laser.mp3`).
- **Bots** aim it at the block of the chosen opponent's wall whose beam, traced as the rules will
  fire it, clears most — the weakest wall's blocks counting three, any other rival's one, for the
  walls it is sure to clear — so a beam along a thin wall, or through it to the ring behind,
  wins; and buy and site it as an ordinary gun goes.

### 2.7 The Frost Cannon

The user's design (2026-10-21), meant as a risky tower: a shot like a cannon's, but the tile it
hits cannot be built on in the next build phase. A precise hit can make a castle's ring
unsealable — the very risk the Magma Thrower was dropped for (§1), taken on deliberately this
time, and measured rather than assumed (§5 FR). An impact tower: whenever it is ready it fires
first.

- **It lands as an ordinary shot** — a cannon's flight, its reload — and clears the wall it hits
  as a cannon does, one tile, scoring as one. Its area is never to grow (the user's): one tile is
  dangerous enough.
- **The tile it hits is frozen**, wall or bare ground alike (the user's: the simplest rule), for
  the **first `freezeShare` of the next build phase** — nothing may be laid on it (`frozen`, a
  refusal of its own). A whole phase's freeze lasts through the overtime only where
  `throughOvertime` says so; less than a whole phase thaws at that share of the phase's 20
  seconds. The cannon phase after is never frozen: every freeze ends with the build phase. A sea
  tile it hits is not frozen, the sea taking no piece anyway; a tile frozen twice keeps the longer
  freeze.
- **Counters**: an Architect thaws every frozen tile of its owner's island in its reach as the
  barrage ends, as it rebuilds the walls (the user's); and a continue wipes the island's freezes
  with the rest of it — the island starts afresh (the user's). No cap on freezes (the user's).
- **The levers by cost**: **60% of the phase at cost 2; the whole phase at cost 3, thawing as the
  clock runs out, before the overtime** — set by the soaks (§5 FR), the reload a cannon's.
  Dropped as levers, by the user: a wider area, freezing only some shots a phase, and a cap a
  victim — hard to explain or to grasp.
- **Determinism**: the freezes are a list in the match (`frozen`), each a tile, its share, whether
  it lasts through the overtime and its thaw tick, given as the build phase opens
  (`startFreezes`); hashed only while there are any, so a match without them hashes as it always
  did, and copied by a rollout, which opens that phase too.
- **Seen and heard**: a snowflake for its emblem; each frozen tile a block of ice over the board
  in every style, the whole tile, a dark rim outside a white one and a shadow, so it reads on any
  ground and colour, a glint running across it now and then; solid to the end, cracks spreading
  across it as its thaw nears, then shattering (the users': shrinking read as passable); a red
  cross on any frozen cell under the piece in hand; a burst of frost where the shot lands. It lands
  with a cannon's impact, the user's `tower_frost.mp3` over it (`frost_impact`).
- **Bots**: aim it as Bertha, at the chosen opponent's weakest wall (its crater one tile); and in
  building treat a frozen tile of their own island as one no piece covers, so their seal routes
  round it, until it thaws (`markUncoverable`, `coverable`).
- **The risk measured**: the statistics' `frozenAtBuild` (tiles of the island frozen as the phase
  opened) and `repairFrozen` (of the cells the tightest seal still lacked on the last tick, those
  frozen) — rounds a freeze may have cost.

### 2.8 The Lullaby Tower

The user's design (2026-10-21, reworked 2026-10-22): a tower that sings enemy guns to sleep for a
while — a direct and passing answer to guns, above all to special towers. An impact tower:
whenever it is ready it fires first (the user's).

- **It shoots as a cannon does** — a cannon's flight and reload, the wall it hits cleared, one tile,
  scoring as one — and sings besides (the user's): **the `targets` viable enemy guns nearest the
  tile hit**, within `sleepRadius` of it (to the nearest tile of a gun's footprint), are **lulled
  once each** — 2 guns at cost 2, 3 at cost 3 (`lullTargets`). Viable: active, awake, and of a kind
  not `immune` — the Allerdickste Bertha never sleeps (the user's); the Architect, which fires as a
  cannon in combat, is lulled as one (`asCannons`, the user's, 2026-10-23), its repair after combat
  untouched.
- **A gun lulled as often as its threshold falls asleep**: a cannon at once, a special tower after
  `towerLulls` lullabies (2) — so a hit among cannons silences several, and a tower takes two
  (the user's design, the threshold by cost at first, `null`). Asleep, a gun fires nothing for
  `sleepMs`, **its reload paused**: it may fire again `sleepMs` after the moment it would have —
  now if it was loaded, else as its first shot in the air lands — so a sleep costs its gun that
  long whenever it falls. Its shot in the air lands; an Architect still rebuilds; a gun asleep still
  scores. A Rapid Cannon sleeps as one gun.
- **Only in combat, nothing carried over**: a shot landing in the intermission lulls nothing, and
  every gun wakes, its lullabies forgotten, as the combat phase ends.
- **The levers by cost**: `targets` (2, 3), `sleepRadius` (8; null for anywhere), `sleepMs` (3
  seconds both), `towerLulls` (2), `immune`. Set by the soaks (§5 LB).
- **The first design**, one gun a shot — the nearest within 1.5 tiles, asleep for 2 or 3 seconds —
  was too weak: bots stand their towers off the walls, so its sleep fell on a tower in 7% of shots;
  4 and 6 seconds changed little (ARCHIVE 14m).
- **Determinism**: a gun asleep carries `asleepUntil`, a gun lulled short of its sleep `lulled`;
  both hashed only while any gun has one, so a match without them hashes as before; carried in the
  snapshot.
- **Seen and heard**: a crescent moon for its emblem; a gun asleep dimmed, a rising stack of Zs over
  it, one for each second left, the last fading as it wakes (the user's); a tower lulled short of
  its sleep a row of pips, those lullabies taken filled; dark round white to read on any ground.
  The reload rings pass a sleeping gun over. The user's `tower_lullaby.mp3` over the cannon's
  impact, once a shot that puts any gun to sleep (`lullaby`).
- **Bots** always aim at a block of the opponent's wall, the weakest wall's counting three and any
  other one, and two more where the lullaby reaches as many viable guns as it may (the user's);
  a bot's own gun asleep is not ready to it. The statistics' `sleepDealt`: seconds of sleep a
  player's shots put on rival guns a round; `shotStats.ts` counts the guns slept by kind.

---

## 3. Where it lives

### 3.1 Simulation (`packages/sim`)

Built in ST1, the two costs in ST3b (2026-10-16); the rules are in `sim/src/specials.ts`.

- `Cannon` and `Shot` gain `kind: CannonKind` — `'cannon' | 'bertha' | 'architect' | 'rapid' | 'lightning'` —
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
- **Determinism** holds without new randomness for the first three. The Lightning Tower's chain
  takes its chance from `streamFor(seed, 'lightning:' + shot id)` (`sim/src/lightning.ts`), as
  any later tower must, never `Math.random`. Its kind and variants were appended to the state
  hash's codes, so hash version 4 and recording format 4 stand and v0.9.7's recordings replay as
  they were; a ruleset without the tower (`specials.lightning` absent) offers none.
- Tests as ASCII pictures (`stateFromAscii` gains `B`, `A`, `R` and `L` at cost 3, `b`, `a`, `r` and `l` at
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

- **Protocol 27** (26 before the Lightning Tower, 25 before the two costs): the settings' switch (`configure`'s `settings.specials`, the host's), a person's
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
  showing their choice — its emblem, name and a pip a cannon it costs — remembered for the next
  table (`towers.ts`, `bollwerk.tower`), and never chosen, drawn at random once a visit, not saved
  (as is a choice of none saved before 2026-10-21, or one saved before the costs, a bare kind that
  names no variant), and sent to a room as it opens; anyone
  else's seat shows their choice, and each bot's seat the variant drawn for it. The same in a
  tournament's lobby, and a switch in the tournament's setup.
- **The tower menu** (`towerMenu.ts`, `towerChoice.ts`; the user's, 2026-10-16), opened by that
  button, where one list of every variant had stopped scaling: a card for each tower, by name
  alphabetically in the language shown (`menuTowers`; the user's, 2026-10-21, the card for none
  gone with it) — its emblem and name (a line on its role, offence or defence, went: the user's, 2026-10-17) — a switch for the chosen tower's
  cost, a cost the rules do not offer greyed, a card's click keeping the cost chosen, tower and cost
  independent — the last cost chosen when none was (`bollwerk.towerCost`), else the cheapest; a
  cost remembered by tower had switched back as its card was clicked, which confused the users
  (2026-10-17); what the variant does by its own numbers
  (`towerWhat`: the Architect's reach, the Rapid's barrels, Bertha's shell against a cannon's —
  as fast at cost 2, faster at cost 3) and when it is affordable (cost 3 only with a second castle held). A click chooses at once and is sent, Done
  only closes; it closes itself when the lobby goes, a match begins or towers are switched off.
  Its **preview** (`towerShow.ts`, `towerPreview.ts`) plays the chosen variant by the rules
  themselves on two small islands — the sim's `fire`, `resolveImpacts` and `repairWalls` on a loop:
  Bertha's cross (cost 2's shell visibly slower), the Rapid's barrels
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
- **Sound** (TS, the user's, ARCHIVE 13zx): every gun fires with a cannon's sound, Big Bertha and
  the Rapid Cannon too; Bertha's shell lands with her own (`tower_impact`, `tower_bertha.mp3`); the
  Lightning Tower is heard once a strike (`lightning_strike`, `tower_lightning.mp3`); and each of
  the player's own Architects that rebuilt a wall knocks twice (`walls_repaired`,
  `tower_architect.mp3`), every knock 0.3 s after the last — a rival's unheard. The three files are
  CC0 from OpenGameArt, under the `sfx/` folder's credit.
- **Dev**: `?autostart=1&specials=1&tower=bertha3` plays a match with towers, the person's tower
  as asked.
- **How to play** (ST7, ARCHIVE 13zr): two pages after the guns' — cannons drawing together into a
  tower, the three in turn at both costs, and the right button switching the ghost between a gun
  and the tower with the cursor's hint; what each tower does is the menu's to tell. The screenshot
  scenes `towers-cannons` and `towers-combat`. Seen in headless Chrome: the
  lobby, the ghost and the HUD line, emblems in Minimal and Parchment, the glow, a blast; the
  icons, the hint, the reaches in Minimal and Noir, Bertha's cross and flames.

### 3.5 Bots (`packages/ai`)

Built in ST3.

- **Loadout**: drawn per seat from the seed (`drawnSpecial`), among the offered variants only
  (never none), so every page can show it in the lobby. By personality or set by the host may come later.
- **Buying** (`Siting.buysTower`): as the first placement of any cannon phase the rules sell it
  in, so long as the bot keeps `ai.planning.minGuns` guns — a tower counted by its barrels (one, a
  Rapid Cannon its cost), the cannons it costs not; the build planning's `gunsReady` counts
  barrels likewise. Kept as it is (the user's, 2026-10-17, ARCHIVE 13zw): with it every tower
  won 57–79% at Levels 5 and 8, and a better rule would mostly make the towers stronger; the planning's `wallValue` values a tower's
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

## 5. Work packages

In order. Each ends with `npm run check` passing and the user's go-ahead to commit. ST1–ST3,
ST3b, ST5 and ST6 are built; their plans are in ARCHIVE 13zo, what was measured and changed after
them in 13zk–13zn; ST8 closed in 13zp, ST7 in 13zr.

### ST4 — Balance

**Closed** (the user's, 2026-10-17, ARCHIVE 13zw), after the first rounds (13zk, 13zl) and the
control tower (13zt): the remaining soaks — Bertha 3 at Level 8 again, the level ladder with towers
on and off, four-player tables — dropped for now; the bots' buying rule kept; the towers off by
default for good. To measure again, resumable (a chunk whose outcomes exist is skipped), then
`--summary`:

```bash
npx tsx tools/headless/src/towerSoak.ts --out DIR --pairs architect3:none,bertha3:none \
  --levels 3,5,8 [--set specials.architect.3.repairRadius=3]
```

### LT — The Lightning Tower's balance

Built 2026-10-17 (§2.4). Measured at Level 5 only (§1): Lightning 2 and Lightning 3 each against no
tower, and head to head, 96 matches a pairing (ARCHIVE 13zs), then at Level 8 as a check (the
user's). Lightning 2 / Lightning 3 against none, then Lightning 3's share head to head:

| miss chance | Level 5          | Level 8          |
| ----------- | ---------------- | ---------------- |
| 0           | 82 / 90 / 64     |                  |
| 0.5         | 73 / 80 / 54     | 68 / 77 / 47     |
| **0.6**     | **67 / 69 / 53** | **57 / 64 / 55** |
| 0.7         | 66 / 63 / 46     | 56 / 61 / 46     |

Kept: the jumps as designed and a miss chance of **0.6** at both costs (the user's) — every figure
inside the goal, and the dearer variant the stronger again, which 0.7 had turned round. Level 5
sits near the goal's upper edge; 0.7 is the cautious fallback should play find it too strong.

### BB — The Allerdickste Bertha's balance

Built 2026-10-17 (§2.5). Measured at Level 5 only (§1): each variant against no tower and the two
head to head, 96 matches a pairing (±5), the crater's radius the lever (ARCHIVE 13zz). Cost 2 /
cost 3 against none, then 3 against 2:

| radius (cost 2 / 3) | against none | head to head |
| ------------------- | ------------ | ------------ |
| 3 / 4               | 45 / 42      | 50           |
| 5 / 6               | 69 / 71      | 65           |
| 4.5 / 5             | 63 / 49      | 40           |
| **4.5 / 5.5**       | **63 / 63**  | **52**       |

Kept then: 4.5 and 5.5. A wall is a thin line, so a wider circle takes only a few more of its
blocks, and one shell a phase is worth less than the cannons it costs until the crater is wide;
the dearer variant needs a radius one larger to make up for its third cannon.

**Re-balanced 2026-10-19** (ARCHIVE 14h): the testers found it very strong, and their shots took
14.8 blocks each where the bots' took 9.0 — the bots hugged the weakest wall with a crater wider
than a castle's ring, and shot their own guns into the crater while the shell flew. Aimed as people
aim it (16.4 blocks a shot), the old radii won almost everything, so the soak was run again:

| radius (cost 2 / 3) | against none | head to head |
| ------------------- | ------------ | ------------ |
| 4.5 / 5.5           | 94 / 97      | 55           |
| 3.5 / 4             | 78 / 88      | 50           |
| 3 / 3.5             | 76 / 80      | 52           |
| 2.5 / 3             | 70 / 77      | 51           |
| **2 / 2.5**         | **63 / 64**  | **48**       |

Kept: 2 and 2.5 — 13 and 21 tiles, both 5 across, the old balance's shares again.

### LZ — The Laser Tower's balance

Built 2026-10-21 (§2.6). Measured at Level 5 only (§1): each variant against no tower and the two
head to head, 96 matches a pairing (±5), `pierce` the lever (ARCHIVE 14k). Cost 2 / cost 3 against
none, then 3 against 2:

| pierce (cost 2 / 3) | against none | head to head |
| ------------------- | ------------ | ------------ |
| 3 / 4               | 77 / 84      | 52           |
| 2 / 3               | 66 / 75      | 56           |
| 1.5 / 2.5           | 52 / 67      | 59           |
| **2 / 2.5**         | **66 / 67**  | **56**       |

Kept: 2 and 2.5 — every figure inside the goal, the two costs alike against no tower and the
dearer a little the stronger. Bots with the starting values cleared 2.67 and 3.33 walls a beam
against a cannon's 0.75: a line through a wall finds nearly as many as it may take.

### FR — The Frost Cannon's balance

Built 2026-10-21 (§2.7). Measured at Level 5 only (§1): each variant against no tower and the two
head to head, 96 matches a pairing (±5), the share of the build phase frozen the lever (ARCHIVE
14l). Cost 2 / cost 3 against none, then 3 against 2:

| freeze (cost 2 / 3)          | against none | head to head |
| ---------------------------- | ------------ | ------------ |
| 50% / 100%, overtime too     | 58 / 74      | 64           |
| 50% / 75%                    | 58 / 57      | 46           |
| **60% / 100%, not overtime** | **59 / 70**  | **56**       |

Kept: 60% and the whole phase until the clock runs out (the user's) — every figure inside the
goal, the dearer the stronger. The overtime's 3 seconds took Frost 3 from 74 to 70 against no
tower on the same seeds, a hint within the noise: it is when the ring's last piece goes in.

The risk, 24 matches a setting at the starting values, the rival's rounds: failed 12.3% against
no tower, 12.5% against Frost 2 (never a frozen tile left on the last tick), 13.3% against Frost
3, 12 of whose 32 failed rounds had a frozen tile in the seal still missing — some 5% of rounds.
About 5.5 tiles of an island frozen a build phase; the bots building round them. A freeze rarely
forces a lost life: the whole phase's wins came from its victims holding less ground.

### LB — The Lullaby Tower's balance

Built 2026-10-21, reworked 2026-10-22 (§2.8). Measured at Level 5, 96 matches a pairing (±5).
Against no tower only for comparison (the user's: not a game anyone plays with towers on); the
goal against the Rapid Cannon "on par", and against impact towers ahead of the cost-3 ones and on
par with the cost-2 ones (the user's).

The first design, one gun the nearest within 1.5 tiles: 2 / 3 seconds gave 52 / 43 against none;
4 / 6 seconds 42 / 52, and against the cost-3 impact towers 26–35 — its sleep fell on a tower in
7% of shots. The area of effect (2 / 3 guns lulled, 3 seconds), cost 2 / cost 3 against none,
3 against 2, then 2 against Rapid 2 and 3 against Rapid 3:

| range, change              | against none | head to head | against Rapid |
| -------------------------- | ------------ | ------------ | ------------- |
| anywhere                   | 72 / 80      | 57           | 55 / 44       |
| 5                          | 56 / 58      | 50           | 45 / 30       |
| 5, towers need 2 lulls     | 56 / 58      | 47           | 45 / 38       |
| 5, towers first            | 56 / 58      | 53           | 49 / 40       |
| 5, lulls kept              | 56 / 58      | 54           | 47 / 41       |
| 5, towers first and kept   | 56 / 58      | 46           | 52 / 35       |
| 8                          | 57 / 71      | 52           | 53 / 43       |
| **8, towers need 2 lulls** | **57 / 71**  | **51**       | **53 / 49**   |
| 8, towers first            | 57 / 71      | 65           | 56 / 44       |
| 8, lulls kept              | 57 / 71      | 57           | 46 / 36       |
| 8, towers first and kept   | 57 / 71      | 51           | 63 / 41       |

Against no tower the radius alone decides — no change touches a match without towers. Kept: range
8, towers asleep after 2 lullabies (the user's). Towers first was mixed and lulls kept no gain
anywhere; both dropped. Then against the impact towers: Lullaby 2 against Bertha 2, Laser 2 and
Lightning 2 48 / 52 / 52 — on par, as meant; Lullaby 3 against Bertha 3, Laser 3 and Lightning 3
43 / 51 / 43, and the Allerdickste Bertha, immune, 48 — on par or a little behind, short of the
lead meant against cost 3.

### After ST8 — two decisions

ST8, the testers' matches with towers on, closed with no issues found (2026-10-17, ARCHIVE 13zp).
Left from it, each the user's to decide: the next tower, and a test without the cap of three
towers on an island (`maxOwned`, null for none). The next tower was the user's own, the Laser
Tower (§2.6, 2026-10-21), played by the user with two fixes (ARCHIVE 14k). Later towers come by
the user's own designs, the list of candidates removed (2026-10-21). Open: the test without the
cap.

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
  the towers, and their buying rule is ST3's first, kept (§3.5).
- **A tower that does nothing** is the control for the trade itself (ARCHIVE 13zt): Big Bertha
  with an ordinary crater and flight (`--set 'specials.bertha.2.crater="single"' --set
specials.bertha.2.flightFactor=1`, the same for cost 3) against no tower.
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
