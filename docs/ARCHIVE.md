# Rampart Remake — decision archive

Why things are the way they are, in the order it was worked out. Each section records a
change that was made, what it was measured against, and what it cost — including the
attempts that were reverted, which are the ones worth reading twice.

This is history, not specification. **`docs/PLAN.md` is the current design**; where the
two disagree, PLAN.md is right and this file records how we got there. Numbers quoted
here were true of the build that measured them and many are now historical — the map
changed shape in 10l, and every bot figure from before that was measured on a layout that
no longer exists.

---

## 10a. Decisions from M2

The prototype plays. Three things came out of it.

**Thin walls versus the piece set — settled, no change.** Only `i3` and `i4` fit along a
straight run of a one-tile-wide wall, so every other piece deposits blocks beside it, and
that litter can eventually leave a gap with no free neighbours to anchor a repair. This
looked like a rules problem when the stopgap opponent hit it, but the stopgap hits it
because it was told to rebuild the exact rectangle it started with. Players do not do
that — they build whatever valid shape of wall works, thickening rather than restoring a
line. The finding is about the opponent, not the design.

**Combat was too long relative to build.** Nearly every wall was destroyed within a 30s
combat phase and 25s was not enough to restore it. Combat is now 20s, and a shot destroys
only the tile it hits rather than a 5-tile cross — a 5x reduction in damage per shot.
Both are single values in `config/ruleset.default.json`.

Worth noting for later tuning: these changes barely move the stopgap opponent's match
length (median 2-3 rounds either way), because that opponent is limited by its own repair
strategy rather than by incoming damage. Bot-vs-bot numbers will not be meaningful
evidence about pacing until M5.

**Opening cannons are placed by the player.** They were auto-placed, which quietly removed
the first real decision of the match. Castle selection now leads into a cannon placement
phase, so the only thing the game hands you is the wall ring.

### Intermissions

Phases used to change instantly, which made them easy to miss and meant the build phase
could begin while the previous volley was still landing on it. Every transition now runs
through an intermission, which holds until three things have happened:

1. every shot still in the air has landed and played its impact,
2. a pause of `endOfPhasePauseMs` has elapsed,
3. the announcement has crossed the screen, taking `transitionBannerMs`.

The banner travels at constant speed and does not dwell — it sweeps past rather than
stopping to be read. Its duration is a ruleset value rather than a stylesheet constant,
because the simulation holds the next phase until it has gone: this is match timing, not
decoration, and the server has to agree with the client about it.

While shots remain in flight the intermission keeps pushing its own end tick back, so the
announcement always plays against a settled board.

### When territory is shown

Territory shading is not merely a readout of the solver — when it updates is a design
decision in itself:

- **On castle selection**, immediately. The wall ring goes up with the choice rather than
  when the last player has chosen, so the shape you committed to is visible at once.
- **During the build phase**, on every block placed. A loop lights up as territory on the
  tick that closes it, which is the feedback that makes building legible.
- **Not during combat.** What is shown under a barrage is the territory you _earned_ at
  the last resolution, and it stays put even as the walls come down. Recomputing here
  would dissolve the map from under the player, and would also be misleading: the
  enclosure that counts is the one at the end of the next build phase, not the one that
  happens to exist mid-volley.

The cannon placement phase also ends as soon as no player has anywhere left to put one,
rather than running a timer that cannot change anything.

### Castles must never block each other's rings

Castle siting enforces separation on an axis, not merely by distance. Euclidean spacing
alone is not enough: an offset of 5,5 clears a minimum distance of 7 while dropping one
castle squarely on another's ring corner, and the ring is then built with a hole in it.

This mattered only once the escape flood became 8-connected. Before that a missing corner
still sealed, so the bug was invisible — a player could commit to a castle whose ring
could never be closed and not find out until the first resolution.

Every castle must be a viable opening choice, so the generator rejects any layout where
one castle's footprint intersects another's ring rectangle, and a test asserts that every
castle on a map yields a complete, sealed ring when chosen.

## 10b. Visual styles

The renderer is split in two. The **scene** owns the Pixi application, the layer stack,
the camera fit, the screen-to-tile mapping and the dirty tracking that decides when a
repaint is needed. A **theme** owns only what things look like.

Everything a theme needs is derived in the client from grid state it already has —
neighbour bitmasks for autotiling, damage states, animation frames — so styles reach into
neither the simulation nor the protocol. A second style costs its drawing code and
nothing else.

```
Theme
  init(layers, art)          prepare; a textured style generates its atlas here
  drawTerrain(state, view)   static for the match
  drawTerritory(state, view) on solver changes
  drawStructures(state, view) on grid changes
  drawEffects(state, view, frame)   every frame
  drawOverlay(state, view, ghost, player)  every frame
  noteImpact(x, y) / destroy()
```

**`flat`** — the minimal style: solid colour, hard edges, no textures and no atlas to
generate. It began as placeholder art for M2 and is kept as a real option. Besides being
a style in its own right it is the fallback when texture generation fails or is slow, the
low-spec option, and by some distance the easiest thing to debug against: an enclosure or
territory bug is obvious in flat colour and easy to miss under texture.

**`pixel`** — the procedural style. Every sprite is generated at boot from the palette and
packed into one texture, so the whole board draws in a single batch and the repository
carries no binary art.

Sprites are generated in neutral stone and grass and tinted per player at draw time. That
keeps the atlas small, and it guarantees the two styles cannot disagree on colour, since
both read the same palette. The land tint is deliberately faint: tinting hard enough to
identify an island by its grass turns the ground muddy and throws away the texture, so
ownership is carried by the tinted shoreline, the walls and the territory shading.

Shore tiles are generated for all 256 neighbour combinations rather than the usual reduced
47-tile blob set. At 16 pixels a tile the whole run is a few kilobytes, and covering every
case outright is far less error-prone than mapping corners onto a reduced set.

Chosen by `art.style` in config, overridden by `?style=` and by the menu. The palette is
shared: the minimal style's colours are the pixel style's colours, so the two cannot drift
apart.

The real cost of keeping two styles is not the abstraction but the discipline — every
renderer feature from here is built and verified twice. That is a deliberate tax, accepted
because the minimal look is a shipping option rather than scaffolding.

## 10c. How the netcode actually works

The server never sends the board during play. It sends **the actions it applied and the
tick they landed on**, and every client replays them into its own simulation. This is only
sound because the simulation is deterministic, which is why M1 spent effort on exact
integer square roots and a hand-written sine: those were not pedantry, they are what makes
this design safe.

```
client intent ──► server validates against the same rules everyone runs
                     │
                     ├─ accepted ──► broadcast commit { tick, actions }
                     └─ refused  ──► rejected { action, reason }  (to the sender only)
```

A client may advance its simulation to `tick + 1` on receiving commit `tick`, and never
further: the server never assigns an action to a tick it has already stepped past, so a
confirmed tick is final. The client therefore cannot display something that did not
happen. The cost is that a player's own action appears after one round trip — well under
the flight time of a cannonball, and far cheaper than local prediction with rollback.

**The hash is not a nicety.** Every 30 ticks the server includes a state fingerprint.
A client that disagrees has desynced, and says so rather than quietly drifting. The
integration suite runs whole matches between in-process clients and asserts zero
mismatches; an end-to-end run over real sockets reported 299 commits, 10 hash checks and
0 desyncs across two clients.

**Terrain is never transmitted.** A snapshot carries the seed, the ruleset and the
dynamic layers run-length encoded; the terrain and the piece sequence are regenerated.
The ruleset travelling with the snapshot matters: a client running different rules would
desync rather than merely look wrong.

**Authority over identity.** The server overwrites the `player` field of every incoming
action with the sender's own seat, so a client cannot act for someone else by writing a
different id. There is a test that tries exactly that.

**Disconnects.** A dropped seat is played by a bot after a grace period, so one dead
connection cannot stall the table. The seat is held, not freed: presenting the token
reclaims it and the returning player is sent a snapshot of the board as it now stands.

## 10d. Bots play at a human pace, and to a plan

Implemented. The two problems recorded here — no strategy, and inhuman speed — were
fixed together, because fixing either alone makes things worse: a better plan without a
rate cap is unbeatable for the wrong reason, and a rate cap without a better plan is just
a weaker bot.

### Pace, in human units

`config/ai.default.json` describes each tier in milliseconds, not per-tick chances. A
probability is opaque, does not survive a change to the tick rate or a phase length, and
cannot be compared against what a person manages. Placement time is `base + perCell *
cells`, so a bot slows down as the piece schedule widens — which is the same reason a
person's rate falls, rather than a separate rule bolted on.

Measured, player 0 across a match: **20 pieces in the first build phase falling to 8 by
the late rounds**, against the roughly 25-then-15 a person manages. Firing is barely
limited at all, at 260-600ms between shots, because clicking is fast and the reload is the
real constraint.

### A ladder, not a single objective

Each time it may place, a bot works down what would hurt most to be without:

1. **Stay alive.** Enclose something, or the rest is moot.
2. **Make room.** Cannons need sealed 2x2 ground; without it the reward is unspendable.
3. **Take more ground.** Another castle is another cannon a round, and a spare life.
4. **Thicken.** A minimum cut is one block thick, so every block of it is load-bearing.
   `weakestWall` against itself says where an opponent would come through, and the ground
   beside those blocks is where a second layer is worth having.

### Reaching for two castles is an affordability question

Combining repair with expansion is the interesting decision, and it is a gamble: more
cannons if the wall closes, elimination if it does not. A rate-limited bot can price it —
it knows how many pieces it can still lay this phase, and `riskMargin` is its appetite for
attempting a wall that does not comfortably fit. Below 1 it insists on slack; above 1 it
gambles.

Tuning found that **over-reaching loses**. A marshal set to bring three castles inside one
wall lost to a gunner reaching for two (8-9); cut to two castles it wins (10-6). Ambition
has to be paid for out of a budget, not assumed.

### What it fixed

|                   | before      | after                  |
| ----------------- | ----------- | ---------------------- |
| marshal vs gunner | 7-6         | **8-3**                |
| gunner vs recruit | 19-1        | **11-1**               |
| stalemates        | ~1 in 20    | **none in 30 matches** |
| match length      | 8-20 rounds | 6-9 rounds             |

The stalemates are gone. Between the widening piece schedule from section 10e and a human
build rate, bots can no longer repair everything thrown at them — so the question left open
there is answered: **the escalation is enough, once the bots stop building at six pieces a
second.**

### A performance note worth keeping

Build-phase thinking was 30.7 seconds of a 31-second match. The cause was not the
planning: when a bot could not fit a piece it forced a replan without also standing down,
so it re-planned on every tick. Standing down for 250ms first took it to 2.1 seconds. The
lesson is that a bot which fails to act still has to pay its own rate limit.

### Still open

- **Personalities.** The tiers carry risk appetite, but a separate axis — turtle, expander,
  aggressor — would make opponents feel different rather than merely better. Deliberately
  deferred; it layers cleanly on the ladder.
- **Late-phase idling.** A bot lays 8 pieces in a late build phase where a person manages 15. Once its wall is sealed, thickened and it cannot afford another castle, it stops.

## 10e. The piece set grows harder as a match goes on

Implemented. The catalogue is complete and the draw narrows by round.

### The set

22 pieces: the single, the domino, both trominoes, all seven one-sided tetrominoes, and
the eleven one-sided five-cell pieces that fit a 3x3 box. The 3x3 limit applies to
five-cell pieces only, so the straight four is in; within size five it excludes the
straight five along with L, N and Y. Enumerated rather than drawn by hand, and a test
asserts the counts per size so the catalogue cannot quietly drift.

### The schedule

`build.sizeSchedule` in the ruleset, as bands of piece sizes by round. Each band runs
until the next begins; the last runs to the end of the match.

| From round | Sizes      |
| ---------- | ---------- |
| 1          | 1, 2, 3    |
| 2          | 1, 2, 3, 4 |
| 3          | 2, 3, 4    |
| 4          | 2, 3, 4, 5 |
| 5 onward   | 3, 4, 5    |

Bands rather than per-piece curves, because a band is a single legible thing to tune.
Individual weights still apply within whichever band is active.

### The draw is a function, not a list

`pieceAt(ruleset, seed, round, index)` — a pure function, with no stored sequence. This is
what lets a client regenerate its own queue from the seed rather than receive it, and it
keeps the match state a fixed size however long a match runs. Every player draws the same
piece at the same position, so the bag is identical for everyone. `pieceIndex` resets at
the start of each build phase, since each phase deals a fresh queue.

### What it measured

Against a control that puts every piece in the bag from round one, three players per
match, eight seeds:

|         | escalating                     | flat bag                |
| ------- | ------------------------------ | ----------------------- |
| recruit | 13 rounds median, 2 unfinished | 14 rounds, 1 unfinished |
| gunner  | 15 rounds median, 1 unfinished | 21 rounds, 3 unfinished |
| marshal | 12 rounds median, 0 unfinished | —                       |

So it helps, clearly at gunner level, and marshal matches now always resolve. **It is not
by itself enough**: recruit and gunner still stalemate occasionally.

That is very likely an artefact of the bots rather than the rules. A bot places up to six
pieces a second (section 10d); a person places about one. Awkward pieces cost a human far
more than they cost a bot, so the escalation's real effect cannot be judged until bots
build at human speed. **Re-measure this after 10d, before adding anything more
sophisticated here.**

### Setting the table

Both the offline menu and the online lobby configure seats individually rather than
just counting players.

**Offline**, each seat is either the person or a bot of a named skill, so a match can mix
tiers — a recruit and a marshal against you — instead of facing three of the same. Setting
_every_ seat to a bot gives a **watched match**: no input is attached and the HUD drops the
control hints, which is much the clearest way to see how the bots actually play.

**Online**, the room reports a row for every place at the table: the people who have
joined, then the bots waiting behind the seats nobody took. Only the host may change a
bot, and only before the match starts — both enforced on the server, since a guest could
otherwise reconfigure the table by sending the message directly.

Seats a person holds still get a bot built for them, which is what covers them if they
drop mid-match.

## 10f. Sweeping, sectors, and what they exposed

Five changes from a session of watching bot matches, plus the bug that watching found.

### Wall that is doing no work is swept away

Between the build phase and the next barrage, **one rule applied once**: a wall block
with fewer than two orthogonal wall neighbours is swept. Every block is judged against
the board as it stood at the end of the build phase, and the failures go together — so
removing a block never condemns its neighbour in the same sweep.

A straight run of three loses both ends and keeps its middle, which is left standing
alone: it had two neighbours when the question was asked. Next round it has none, and
then it goes.

Orthogonal, deliberately: a wall seals only when it is 4-connected, so this is exactly
the connectivity that makes a wall a wall — and it means **a loop enclosing anything can
never be swept**, since every block of a loop has two orthogonal neighbours. A test
asserts that property directly.

**This was originally implemented as a cascade and that was wrong** — see 10n.

### Smaller castles, more of them, closer together

Castles are 2x2 and there are four per sector, on the larger ground the channels free up.
Build phase 25s to 20s.

### The bug watching found

Bots were laying blocks inside their own sealed ground, which is the one place a cannon
may go. Three causes, all now fixed: thickening worked inward as readily as outward,
spill into territory was scored as merely wasted rather than harmful, and the test for
"do I have room for my cannons" compared against `cannonsToPlace` — which is zero for
the whole build phase, because it is set at the resolution that ends it.

### And the bug that was underneath it

Measured while fixing the above: bots owned 15 cannons apiece and had **two active
between them**. A cannon fires only from sealed ground, and a minimum cut is by
definition the _tightest_ wall that works, so each round the planner drew the wall in
closer to the castle — and the new sweep then removed the old outer wall, leaving the
guns outside and silent. The bot was strangling its own artillery, one round at a time.

The fix is to make the player's cannons **sinks in the cut** alongside the castle, so a
valid wall has to enclose them. It costs more wall, which is simply what they are worth.
With it, a bot holds 12 to 18 active guns where it held none.

### Still unresolved

Bot-vs-bot matches now run long and often do not finish inside a tick budget that used
to cover several matches. Nobody is eliminated, because a near-optimal defender with four
castles on a large sector can almost always seal _something_. Damage is not the
constraint: raising fire rates to a person's clicking speed changed nothing.

This wants a human's judgement rather than more tuning, and the seat configuration added
alongside it is what makes that possible — set every seat to a bot and watch. Candidate
levers, in the order I would try them: fewer castles per sector, castles closer together
so one barrage threatens several, and a smaller sector so there is less ground to retreat
into.

## 10g. Sizing the map from the original

The endless matches were mostly a map problem. Measured from a screenshot of the
original's three-player map: roughly **42x30 tiles, about 400 a player including the
river**. Ours were 1100 tiles of pure land each — nearly three times the space, which is
why walling a castle was never in doubt.

Territories are now **440 tiles on a 56x56 grid**, and players start with **three
cannons** rather than two, as in the original.

Not the measured 400: four 2x2 castles each need an 8x8 block of clear ground for their
starting ring — 10x10 on three-player maps, where the 120 degree rotation needs a tile of
slack — and 380 tiles cannot hold four of those. 440 is the smallest that generates
reliably at every player count.

**480 was the first answer and it was quietly wrong.** At four players the island nearly
filled its sector, so the coastline was pinned by geometry rather than noise and every
seed produced _the same map_. A determinism test caught it. 440 restores ten distinct maps
in ten seeds at every player count — worth remembering that "fits" and "varies" are
different questions, and only one of them is obvious when looking at a single map.

### What it fixed, and what it did not

Recruit matches went from 36-43 rounds with frequent stalls to **three rounds, none
unfinished**. Gunner and marshal still do not reliably finish.

Chasing the rest turned up a second mechanism, and it is an interaction with the sweep
rather than a fault in either part alone. When a bot holds two enclosures and one is
breached, the sweep correctly removes that whole wall — and strands every cannon inside
it on open ground. Recovering them never fits one build phase's budget, so they stay
silent. Matches were reaching **zero active cannons for every player**: nobody could hurt
anybody, so nobody could win.

Two changes followed:

- **The planner asks for room.** A minimum cut is by definition the tightest wall that
  works, which is precisely the wall with nowhere to put a gun. It now requires a band of
  ground around each castle, so a bot can spend the cannons it earns.
- **A bot that has lost most of its guns commits to getting them back**, across several
  phases rather than one. That works because a part-built extension of a live wall still
  touches territory, so the sweep leaves it standing and the work carries over.

Together those took matches from zero active guns to one player holding six to eleven.
Still not enough: the other two defend perfectly with no firepower at all.

### Observed while watching, after the above landed

Recorded from playtest observation, and the current top priority:

1. **Recruit** encloses its starting castle and its cannons correctly, but does not
   expand, and **stops placing tiles entirely once its enclosure is valid** — most of the
   build phase goes unused.
2. **Gunner and marshal** tend to enclose _a different_ castle with minimal placement,
   **leaving no room for cannons at all**. Neither side ends up with firepower, and the
   match stalls.

These were seen around the same time as the `ROOM_RADIUS` and stranded-gun changes, so
re-observe before acting on them — set every seat to a bot and watch.

**Next lever, untried:** three castles rather than four, closer together, so a single
barrage threatens more than one at a time. Four spread-out castles give a near-optimal
planner four independent chances to seal something, and it only needs one.

## 10h. The planner asked for the tightest wall, and got what it asked for

Implemented. This is the answer to the two things recorded at the end of 10g, and it
turned out to be one thing wearing two hats.

### First, the harness had to be able to see it

Every diagnosis from 10d onwards was made by watching a match, which is why each of
those sections ends by asking the next session to go and watch again. The harness
printed rounds, ticks and a winner — none of the quantities the open questions were
actually about.

`--stats FILE` now writes a row per player per round, sampled at the resolution that
ends a build phase and nowhere else: `enclosedCastles` is live during a build phase and
the sweep runs inside the same step, so that instant is the only one where the numbers
mean what they look like. It records castles sealed, cannons owned and active, cannon
room, wall tiles, pieces placed against the pieces the tier had time for, and shots
fired. A summary of the same goes to the console, because a number nobody reads is not
instrumentation.

`--difficulty` also takes a comma-separated list now, one tier per seat. It could not
mix tiers before, which means the head-to-head records in sections 8 and 10d could not
have come from it and cannot be reproduced by it.

### What it said, immediately

Three players, eight seeds, averaged over every surviving player-round:

|                             | recruit | gunner  | marshal |
| --------------------------- | ------- | ------- | ------- |
| castles sealed              | 1.0     | 1.42    | 1.39    |
| cannons owned               | 7.1     | 7.2     | 7.1     |
| cannons **active**          | 4.3     | 3.9     | 3.3     |
| **room for another cannon** | **0.8** | **0.3** | **0.3** |
| wall tiles                  | 45      | 41      | 37      |

Room 0.3 is the whole story. A gunner or marshal at a typical resolution had space for
**zero** more cannons, behind a ring of 37 tiles, with half the guns it owned standing
outside and silent. It was not that the bots sometimes walled themselves in too tightly.
It was that they always did, and had no way to do anything else.

### The cause is the thing that made the planner good

Sealing is a minimum cut, and a minimum cut is by definition the _tightest_ wall that
works. Hand a planner the cut and tell it to build, and every round it asks for the wall
with nowhere to put a gun — and then the sweep takes the old, wider wall away, so the
room is not merely unbought, it is actively demolished. Section 10f called this the
bot strangling its own artillery and fixed it for one code path. There were six, and
`ROOM_RADIUS` reached three of them. The three it missed were the ones that matter most:

- the preferred branch of `reseal`, which is what runs after a breach — the exact
  moment the wall is redrawn from scratch,
- `hold`, which is where a settled bot spends most of a match,
- and `chooseCastle`, which scores a castle by how cheaply it can be walled. That is a
  measure of how tightly a castle can be strangled, so it reliably picked the castle
  with the least ground around it, before a single piece was placed.

### Ask for the widest wall you can pay for, not the tightest that works

`widestAffordable` asks at `ROOM_RADIUS` and steps the band down a tile at a time until
a plan fits the phase's budget. Room is what gets asked for first and surrendered last,
which is the exact inversion of the old behaviour, and a tight wall is still reachable
as the bottom rung. The same ladder now runs through `reseal`'s fallback, ending in the
cheapest wall on the board — because a bot that cannot afford any plan should build
toward one it can finish. Without that last rung a bot spent a phase laying fourteen
pieces of a wall that could never close, the sweep took the lot, and it died with
nothing standing.

**`ROOM_RADIUS` is two, and three was actively harmful.** Three tiles buys room for
about fourteen cannons against a reward of three a round — ground that must be walled
and then repaired every round under fire, for guns that will never exist. At three,
marshal matches went from never finishing to finishing in 2.3 rounds, all three players
eliminated together in a barrage none could out-repair. At two the band holds six or
seven and the wall is short enough to maintain.

**And a bot that has finished its plan thickens rather than stops.** Recruit laid 69% of
the pieces it had time for; marshal, which keeps finding expansions to afford, laid 106%.
The gap was simply standing still. This is the late-phase idling left open in 10d.

### What it fixed

Three players, eight seeds, same measurements:

|                         | gunner before | gunner after | marshal before | marshal after |
| ----------------------- | ------------- | ------------ | -------------- | ------------- |
| room for another cannon | 0.3           | **1.1**      | 0.3            | **5.5**       |
| cannons idle            | 46%           | **19%**      | 54%            | **10%**       |
| cannons active          | 3.9           | **5.8**      | 3.3            | **6.3**       |
| build phase used        | 65%           | 69%          | 65%            | **108%**      |
| matches unfinished      | 2 of 3        | **1 of 8**   | 3 of 3         | **0 of 8**    |
| rounds                  | 26.7          | 12.1         | 33+            | 4.5           |

Marshal, which could not finish a single match on any seed tried, now finishes all of
them with essentially every gun it owns firing.

Two players, six seeds, marshal against marshal — a case none of the above touched, and
the one the unit tests run:

|                         | before     | after      |
| ----------------------- | ---------- | ---------- |
| matches unfinished      | **4 of 6** | **0 of 6** |
| rounds                  | 27.3       | 4.2        |
| cannons idle            | —          | 4%         |
| room for another cannon | —          | 4.9        |

**Measure a change against a worktree with its own `node_modules`.** The first attempt at
that baseline pointed the worktree's `node_modules` at the main checkout's, and npm
workspace links are relative — so `@bollwerk/ai` resolved back through the symlink into
the working tree and the "before" run was the after code. It reported hashes identical to
the new run, which read as "the change does nothing" rather than as the setup error it
was. Identical state hashes across a code change are evidence the code did not load, not
evidence it did nothing.

### What it exposed, which is a rules question and not a bot one

For the whole of 10f and 10g the binding constraint was that nobody's artillery worked,
and section 10f records raising fire rates to human clicking speed changing nothing.
That was never a test of the rules — it was a test of guns that were inert whatever
their rate. **Now that the guns fire, damage is the constraint, and there is nothing in
the rules that bounds it.** Cannons are indestructible and accumulate at two or three a
round forever, while repair capacity is fixed by the length of a build phase. The two
curves cross, and with three players they cross for everyone at once: marshal draws two
of eight now, both of them every surviving player eliminated in the same resolution.

`cannons.maxTotal` already exists in the ruleset and is `null`. That is the first thing
to try in the balance pass, ahead of the combat-to-build phase ratio and the reward
schedule.

### Still open

- **Gunner holds room for 1.1 cannons where marshal holds 5.5.** The tiers differ in
  budget, so a poorer bot correctly settles for a tighter wall — but 1.1 is close enough
  to the old failure that it is probably not only that. One of its eight seeds still did
  not finish.
- **Seat bias.** Eight seeds of three identical recruits went six wins to seat 2; the
  baseline runs skewed to a seat as well. The map is meant to be rotationally symmetric,
  so either it is not, or something in the turn order or in three-player targeting
  favours a seat. The stats dump is the tool for this and it has not been pointed at it.
- The **three-castle lever from 10g has now been tried, and it is worse.** Three castles
  a sector at spacing six, three players, six seeds: gunner went from one unfinished match
  in eight to **five in six**, its room from 1.1 to 0.2, and marshal's room from 5.5 to
  1.2 with idle guns back up from 10% to 28%. Fewer castles means fewer candidate walls,
  and the ones that remain are tighter — so it pushes on exactly the thing 10h had to
  correct. Reverted, and it should not be retried without a reason beyond the one in 10g,
  which was that matches never ended. They end now.
- **Matches may now be too short.** Two-player marshal runs 4.2 rounds and three-player
  4.5, against an original whose matches were brisk but not that brisk. This is the same
  finding as the balance note above seen from the other side, and the two should be tuned
  together rather than separately.

## 10i. Deployment is one image and one process

Implemented. `Dockerfile` builds the client, bundles the server, and ships a runtime
stage holding three directories and no `node_modules`.

### The environment may set a port and nothing else

Section 4's rule is that no game rule is hardcoded — every tunable lives in
`config/*.json` behind a strict schema. The tempting extension is a general environment
override, and it is the wrong one: **a rule an environment variable could change is a
rule two clients could disagree about**, which is a desync rather than a setting, and the
snapshot carries the ruleset precisely so that cannot happen.

A port is not a rule. It is where the process binds, and managed hosts assign it rather
than asking. So `PORT` and `HOST` are read from the environment ahead of the config file
in `main.ts`, with a validity check, and nothing else is. The narrowness is the point and
is worth defending if it is ever proposed to widen it.

### The server is bundled, and the no-build-step design survives

The image runs plain JavaScript rather than TypeScript through tsx, which keeps a dev
toolchain out of production and the image at a few megabytes. The obvious way to get
there — emit configs for `server`, `sim`, `ai`, `protocol` and `config`, each with a
`dist` and a `package.json` exports map pointing at it — would have contradicted
section 3's "internal packages export TypeScript source directly, so there is no build
step between them", and left five build graphs to keep in step.

`packages/server/build.js` instead has esbuild resolve the workspace links itself and
emit one file. No package gains a build config, dev is untouched, and the bundle is a
deployment artefact rather than a new layer in the architecture.

Three things it cost, all of them worth recording:

- **`ws` is CommonJS**, and its `require` of Node builtins does not survive ESM
  bundling: the server started and then died with `Dynamic require of "events" is not
supported`. The bundle needs a `createRequire` banner. That same banner is what lets
  `ws` probe for `bufferutil` and `utf-8-validate`, find them absent, and carry on — so
  the image can ship with no `node_modules` at all.
- **The output must live at `packages/server/dist/`.** `paths.ts` finds the repository
  root by walking three directories up from itself, and that is how both `config/` and
  the built client are located; `dist` sits at the same depth as `src`, so nothing
  changes. Somewhere tidier would have needed a code change, and a silent one — the
  server would start and then fail to find its rules.
- **There is no Docker on the development machine.** Everything above was verified by
  assembling the runtime stage's three directories by hand and running the bundle from
  them with no `node_modules` on the path: it served the client, served a hashed asset
  with the right MIME type, answered the healthcheck, and completed a WebSocket room
  creation. That is a good test of the bundle and no test at all of the Dockerfile, so
  CI now builds the image and curls it. **That job is where the Dockerfile is actually
  exercised.**

### Not done here

`assets/audio/` is not copied into the image and the static handler would not serve it
if it were — it serves only from the client's `dist`. Whether audio files ship as static
assets beside the client or go through Vite's `publicDir` is a decision for the audio
work, and guessing at it now would have meant wiring half of it.

## 10j. Audio

Implemented. `packages/client/src/audio.ts` plays; `matchAudio.ts` decides what and
when. No audio files exist yet, so the game still runs and sounds exactly as it did —
which is the property section 7.4 asked for and is now load-bearing rather than
aspirational.

### The cue list is smaller and differently cut than 7.4's

Eighteen effects and four tracks became thirteen and five, and the music is organised by
mood rather than by phase: **castle select, cannon placement and building share one
track**, because they are one experience from the player's side — arranging a position
with nothing incoming — and only the barrage gets its own. Victory and defeat are
separate tracks where there was one game-over cue.

Two of the effects are spoken, and they are the phase boundaries that matter: `voice_fire`
opens combat and `voice_cease_fire` closes it. "Closes" means the step into the
intermission, not the last impact — shots already in the air still land, but no further
one can be started, which is exactly what the call means.

### What the sound is allowed to know

Every cue but one is driven by a simulation event rather than by the client's own
guess, so what a player hears is what the authoritative server actually did: a shot
confirmed, a wall that really came down, a castle genuinely sealed. The exception is
the countdown, which is a clock reading and has no event behind it.

**Nothing in audio may reach the simulation.** Choosing among a cue's variants is
random and uses `Math.random`, never the match `Rng` — drawing from the seeded stream
would make two clients with different audio settings produce different matches. That is
the same rule as everywhere else in `sim`, arriving from an unexpected direction.

The fanfare is deliberately not "you are enclosed". It fires when a wall closes around a
castle the player **was not already holding**, because still holding one castle is true
of every round they survive and is not news. Its counterpart fires when they hold less
than they did. An elimination has its own cue and is left uncrowded.

### Anything the browser can decode

`decodeAudioData` takes bytes and does not consult the extension or the content type, so
the manifest may name any format and cues need not agree with one another. The server's
MIME table knows `.ogg`, `.mp3`, `.wav`, `.m4a` and `.flac`; an unlisted extension is
served as an unknown binary, which still plays but is worth adding.

The one to think about is Ogg, which section 7.4 assumed throughout: Safari's support for
Vorbis and Opus arrived late and older iOS does not have it. `.wav` for short effects and
`.mp3` or `.m4a` for music is the combination with no such asterisk.

### Where the files live, and why that needed no server change

`assets/audio/` is now the client's Vite `publicDir`. The dev server hands the files
straight out and `vite build` copies them into `dist/`, which is already what the
production server serves and what the Dockerfile already copies — so audio needed no
change to the server, the static handler or the image. The manifest's `basePath` is
`audio` because a public directory's _contents_ are served at the site root.

**A missing file cannot be recognised from its HTTP status.** The static handler answers
an unknown path with the client's `index.html` and a **200**, which was measured
directly: `/audio/sfx/cannon_fire.ogg` returns 823 bytes of `text/html`. So an absent
cue arrives as a perfectly successful response, and what identifies it is that it will
not decode. The consequence worth knowing is that **a corrupt or truncated file is
indistinguishable from a missing one and will be silent rather than noisy.**

### Two things that are about taste, and were decided by arithmetic

Identical cues starting within **60ms** of each other are dropped. Three players with ten
guns each put dozens of shots in the air over a ten-second combat phase; twenty copies of
one sample a few milliseconds apart do not sound like twenty cannons, they sound like
distortion.

A browser will not start an `AudioContext` without a user gesture, so the first click or
keypress anywhere switches sound on. Calls made before that are **dropped rather than
queued** — a burst of everything that was missed, arriving at once the moment audio
unlocks, is worse than having missed it. Music is the one exception: the last requested
track is remembered, so the right one is playing when sound arrives rather than whatever
the next phase change happens to ask for.

### What is verified, and what cannot be

`matchAudio.test.ts` covers the translation — twelve cases over the calls in and out of
combat, the shared admin track, wall-versus-ground impacts, own-versus-rival placements,
the fanfare's "new castle" condition, elimination, victory against defeat, silence in a
watched match, and the countdown. It runs without a browser, an audio context or a sound
file, which is what the two-method `Cues` interface is for.

The built client was loaded headless in Chrome, at the menu and through a watched match
at ten times speed, with no runtime error.

The loading and decoding path was then verified against real files. Driving the actual
`Audio` class in headless Chrome with `missingFilesAreSilent` turned off makes every
failure a warning, so the set of warnings is exactly the set of cues that did not decode.
With one `.wav` and one `.mp3` supplied, the context reached `running`, twenty-three of
the twenty-five paths in the manifest warned — every file that does not exist, which is
the negative control that the capture works at all — and **the two real files were absent
from that list**, meaning both fetched and decoded. The server served them as `audio/wav`
and `audio/mpeg`.

So format support is whatever the browser decodes, and both of the formats most worth
having are confirmed. What is still unverified is subjective rather than structural: the
mix. Every `volume` in the manifest is a guess until somebody listens.

## 10k. Flight time is the reload, and it was set too short

A cannon cannot fire again until its shot lands — there is no separate reload — so
`shots.baseFlightMs` and `perTileFlightMs` set the rate of fire, and the honest unit for
them is **shots per cannon per combat phase**. Counted against the original, from
observation: ours fired about four times to the original's three.

Measured from `--stats` (`shotsFired / cannonsActive` at each resolution, three players,
eight seeds), and tuned against that number rather than against feel:

| base / per tile | 20-tile flight | shots per cannon | notes           |
| --------------- | -------------- | ---------------- | --------------- |
| 350 / 35        | 1.05s          | 4.5              | as shipped      |
| 500 / 60        | 1.70s          | 4.5 / 4.1        |                 |
| 600 / 80        | 2.20s          | 4.2 / 3.1        | gunner idle 57% |
| 700 / 90        | 2.50s          | 3.6 / 3.6        |                 |
| **850 / 110**   | **3.05s**      | **3.1 / 3.0**    | adopted         |

### What it says about the bots

The interesting result is one nobody asked for. At 500/60, with **no change to the bot at
all**, gunner's room for another cannon went from 1.1 to 5.3, its idle guns from 19% to
8%, castles sealed from 1.59 to 1.94, and its use of the build phase from 69% to 114%.

`widestAffordable` already asks for room first and surrenders it only to the budget, so
when incoming damage fell the repair bill fell, the budget stretched, and the roomy wall
came back on its own. **The bots' minimal enclosures were largely a symptom of excess
firepower, not an independent defect** — they were not choosing to turtle, they were
being priced into it. Worth remembering before writing a rule against behaviour that a
config value was causing.

### What it did not fix

Match length. Marshal at three players went 4.5 rounds to 4.1; two-player gunner averages
**2.8 rounds with two draws in six**. Mass simultaneous elimination is untouched and
`cannons.maxTotal` is still `null`.

And at 850/110 the accumulation problem is visible from the other side: matches last
longer, so marshal ends up owning 8.6 cannons and keeping only 6.2 of them enclosed —
idle back up to 28% from 13% at 700/90. That is not a flight-time fault; it is the
arsenal growing faster than the territory that has to hold it, which is the same finding
as 10h's and the same lever answers it.

A test asserting a two-player match ran past round five was removed. It was calibrated to
the old tuning and was measuring the ruleset rather than the bot; what replaced it is a
competence floor — both gunners survive the first round — which balance work should not
move.

## 10l. Rectangular islands in a pattern, and the map measured from them

Implemented. The wedge layout is gone.

### One island, copied

An island is drawn inside a rectangular generation box, **trimmed to its actual land**,
then stamped into N placements by translation and mirroring. Both transforms are exact
on a square grid, so every island is pixel-identical at every player count — where the
rotational layout could only manage that at 2 and 4, because a third of a turn has no
representation on a square grid.

What that deleted: the `exactRotation` special case, the slack tile in the channel, the
`repairedTiles` repair pass, and four of the six rejection reasons. `island_overlap`,
`island_area`, `island_split` and `water_gap` are now true by construction, so
`componentCount` and `waterGapHolds` went with them. Only `canonical_area` and
`canonical_castles` remain. `terrain.ts` is shorter than it was despite gaining the
pattern engine.

### Patterns, and why they are configuration

`config/terrain.default.json` carries one pattern per player count: a grid for 2, 4, 6
and 8, a ring for 3, 5 and 7. A ring puts every player the same distance from the same
two neighbours, which is the uniform answer and the right one for odd counts; a grid is
tighter but gives edge and middle seats different neighbourhoods. Exact fairness is not
required — the point of 6 and 8 is team modes, which rebalance by how the teams are
drawn — so where the two differ the tighter map wins.

Measured, seed 1: 2p 52x25, 3p 55x49, 4p 52x48, 6p 77x48, 8p 102x48, with rings at 5 and
7 costing noticeably more. **Both focus counts came out smaller than the 56x56 they
replaced**, and every count generates on the first attempt with exactly equal areas.

Moving 5 or 7 to a grid is a JSON edit, which is the point of the table being config.

### The map is measured, and it has to be measured from the land

The map's size is not configured. It falls out of the island and the pattern, which is
what lets one configuration serve two players and eight without either being cramped or
swimming in ocean.

**Measure the island, not the box it was drawn in.** The first attempt spaced the boxes
by the channel width, which is wrong by the amount of box an island does not fill —
about a third — so eight or ten tiles of open water sat between the land. Section 1.2
rules that out: flight time scales with distance, and an ocean between players means
slow artillery and matches that will not end. The channel test caught it by reporting
zero channel tiles. The box is a frame that needs slack so the coastline is shaped by
noise rather than by the frame; the layout is spaced on the trimmed land.

That slack is now guarded at startup: an island filling more than 80% of its box gets a
configuration error, because a coastline pinned by the frame produces the same map for
every seed — the 10g trap, which generates perfectly and looks fine in one screenshot.

### It reset the balance baseline, as expected

A compact rectangle makes a tight cut cheaper than a wedge did, so `ROOM_RADIUS` — tuned
on wedges at 2 — was mistuned. At 3 it recovers: marshal's room for another cannon went
1.8 back to 7.3. Every number in 10h and 10k was measured on the wedge map and is
historical.

## 10m. Two bot faults found by watching, and what fixing them exposed

### A shot destroys exactly the tile it hits, so two shots at one tile is one wasted

Observed while spectating: a bot's whole opening salvo went into a single block. The
target list was consumed only when a tile stopped being wall, so with a three-second
flight and a gun firing every 150ms, every shot in the air was aimed at the same place.

Targets are now taken off the list when fired at, and any tile with a shot already
inbound — **anybody's** shot, since a block an opponent is about to remove does not need
removing twice — is skipped.

### Idling in a build phase is almost never right

Also observed: bots stopping with time left. `thickenTargets` could come back empty and
the bot would stand down for the rest of the phase.

The ladder now ends in `spareWork`: reach for the next castle, and failing that take in
more open ground for the cannons the wall will earn. **Affordability is deliberately not
consulted.** It governs whether to commit to a plan over staying alive, which is the
gamble 10d found you must not take; spending time nobody else wants is not that gamble.
A part-built extension of a live wall touches territory, so the sweep leaves it standing
and the work carries into the next phase — which is the difference between an expansion
that takes two rounds and one that never happens.

Measured, three players, eight seeds:

|                                | before | after    |
| ------------------------------ | ------ | -------- |
| gunner room for another cannon | 1.7    | **7.6**  |
| gunner build phase used        | 58%    | **121%** |
| gunner cannons idle            | 30%    | **16%**  |
| marshal build phase used       | 88%    | **101%** |
| marshal cannons idle           | 38%    | **31%**  |

Three players is in good order: marshal runs 4.6 rounds over eight seeds with none
unfinished, 3.14 shots per cannon, and wins spread 4/2/2 across the three seats.

### What it exposed, and it is not small

**Fixing the targeting multiplied real damage several times over.** The rate was already
calibrated to the original's three shots per cannon — but three shots that each remove a
block is a different weapon from three shots that remove one between them.

Two-player matches are now erratic in a way three-player ones are not: over six seeds,
two were decided in **round one**, one ran to the tick limit, and the rest scattered
between. Raising flight time to 1050/135 stops the round-one eliminations but drops the
rate to 1.4-2.6 shots per cannon, well under the original's three — so flight time is the
wrong lever. It is correctly set; the damage those shots do is what is now unbalanced.

The levers that remain are the opening cannon count, the build phase length against the
combat phase, and `cannons.maxTotal`, which is still `null`. That is the balance pass,
and two-player is where it should start.

Three bot competence tests were moved from two-seat to three-seat tables. Run on two
players they were measuring this imbalance rather than the bot.

## 10n. The sweep was a cascade, and the original was not

Observed against the original: the sweep removed too much.

It had two rules, both wrong. It pruned to the **2-core** of the wall graph — dropping
loose ends repeatedly until none were left — and then deleted whatever did not reach
sealed ground. Both are gone. What remains is one pass: **mark every wall block with
fewer than two orthogonal wall neighbours, then remove the marked blocks together.**

Marking before removing is the whole of it. Judging each block against a board that is
already being dismantled is what turned one pass into a cascade, and the difference is
not subtle: a five-block spur reaching towards another castle used to unravel completely
in a single resolution, so a wall half-built could never be carried across a round. Now
it loses its tip and keeps the rest.

A run of three reduces to its middle, which then stands alone — it had two neighbours
when the question was asked. It goes next round.

**Stranded wall now stays.** The rule requiring a wall to reach sealed ground is dropped
entirely, so a loop enclosing nothing survives. That is deliberate: it is not litter but
an obstacle, standing where a cannon cannot be placed and where a future wall has to
route around. The original kept it too.

The safety property is unaffected and still tested: every block of a loop has two
orthogonal neighbours, so a wall holding an enclosure together can never be swept —
which is what makes it safe to run automatically at every resolution.

### What it measured

Three players, eight seeds, per surviving player-round. The visible change is how much
wall survives, which is the point:

|                     | before | after  |
| ------------------- | ------ | ------ |
| marshal wall tiles  | 67     | **88** |
| gunner wall tiles   | 53     | **75** |
| marshal rounds      | 4.6    | 5.4    |
| gunner cannons idle | 16%    | 30%    |

Room for a cannon slipped a little at both tiers — 7.0 to 6.6 and 7.6 to 6.0 — which is
the arithmetic of more wall standing on the same ground, and gunner's idle guns rose with
it. Neither is alarming and both are the balance pass's business.

A fourth bot test moved from a two-seat to a three-seat table. Its pacing assertions were
never reached: a two-player match now ends before there are enough build phases to
measure a build rate over. Two players remains the case to fix, as 10m says.

## 10o. Continues

Implemented. Two lives beyond the first, as in the original, and failing to seal now
spends one instead of ending the match.

What happens: the island is wiped — cannons, shots in the air, and **the wall itself**,
which is more than `stripEliminated` did. That function leaves an eliminated player's
wall standing as unowned rubble, which is reasonable for somebody who is out and wrong
for somebody about to build again, who would otherwise have to plan around the wreck of
their last attempt. Then a castle is owed, chosen during the coming cannon phase, and the
ring goes up around it exactly as at the start of a match.

Cannons are the opening count plus one for each life already spent, so a player on their
last life fields more guns than one on their first.

### A continue rewinds the player's piece schedule, and that retires a stated rule

Section 1.5 said every player draws the same seeded sequence. They no longer do. A
continue sets the player's `pieceRound` to zero, so the next round deals them round one's
pieces — the small ones a player starting again needs to close a ring — while whoever has
survived longest goes on drawing the wide, awkward ones.

That makes the piece schedule a **personal difficulty ramp keyed to how long you have
held on**, which is a rubber band with real force: it stacks with the fresh compact ring
and the extra cannon. All three together are what make a continue worth having rather
than merely survivable.

`build.sharedPieceSequence` was dead config — declared and never read, the second such
flag after `layout`. It is now false, and the schema **refuses** it being true alongside
`resetPieceScheduleOnContinue`, so the consequence has to be written down in the config
rather than discovered in a match.

### The pause, and why it is in the sim

A life lost or a player knocked out adds `phases.continueBannerMs` to the intermission.
That is match timing rather than decoration: every client has to spend the same number of
ticks on it or they disagree about when the next phase began. One pause however many
players it was — the banners sit over their own islands and cannot overlap, so they are
all readable at once.

### Three things that had to change to let a player choose mid-phase

- `select_castle` was gated on `phase === 'castle_select'` and on having no castle yet.
  Both now admit a player who owes a choice during `cannon_place`, which is the same
  question asked twice, so it is the same predicate: `owesCastleChoice`.
- **`advancePhase`'s cannon-phase early exit would have ended the phase before they could
  act.** It stops when every player is `eliminated || cannonsToPlace === 0 ||
!canPlaceAnyCannon`, and a player who owes a castle has no territory, so
  `canPlaceAnyCannon` is false and they read as finished. Found by reading rather than by
  playing, which is the only reason it is not a bug report.
- A player who lets the clock run out gets a castle and guns chosen for them, from
  `streamFor(seed, 'fallback:round:player')` — deterministic, because `Math.random` is
  banned in `sim` and a replay has to reproduce these like any other choice. Without it,
  hesitating would leave them with no ring at all and cost them a second life for it.
  Only a person can reach this path: a bot always acts, and a dropped seat is played by
  one.

### What it measured

Three players, gunner, six seeds: **32 continues and 13 eliminations**, no action ever
refused, and every invariant held at the moment of the continue — island empty of walls
and guns, cannon grant equal to `startingCount + spent`, piece schedule at zero, castle
cleared and later rechosen.

Matches run **11.8 rounds** against 4.4 before, which is what three lives each should
cost. Nothing unfinished.

### Verified, and not

The simulation is covered: six tests in `match.test.ts`, and the banner wording and
timing window in `banners.test.ts` — which is why that decision was pulled out of
`main.ts` into a function of its own.

**The banners have not been seen.** Headless Chrome cannot show them: after 120 seconds
of virtual time at ten times speed a watched match is still on round 0, because the
render loop is barely driven. That also means the "ran a watched match with no runtime
error" checks in 10i and 10j were weaker than they sounded — the match was not
progressing far enough to exercise much. Anything time-dependent in the client needs a
real browser and a person watching it.

### Tests that had to say what they meant

`options()` in `match.test.ts` now builds its ruleset with `withoutContinues`, and so
does the stopgap suite. Nine tests broke on this change, all of them asserting that
failing to seal ends a player's match — which is still true, but only once the lives are
gone. Saying so explicitly beats them quietly measuring something else.

## 10p. Cannon clearance, the starting ring, and an arc nobody could see

### A cannon jammed against its own wall makes a hole nobody can fill

Observed while spectating: bots pick a castle on the shore and then stand cannons on the
wall beside it. A shot there leaves a one-tile gap with the cannon on one side and water
on the other — and a piece is at least two cells from round three on, because the size
schedule stops dealing ones after round two. The hole is not awkward, it is **permanent**.

Measured: players eliminated at a resolution had **15.1** such holes against **10.1** for
survivors.

`placeCannon` scored candidates purely on closeness to the nearest enemy castle, so it
had no reason not to press against the wall. It now prefers clearance and settles ties on
proximity — compared as a pair rather than summed, so there is no exchange rate to invent
between tiles of cover and tiles of range. Clearance is Chebyshev distance to the nearest
own wall **or water**, capped at two, from one distance field per placement rather than a
scan per candidate.

### The opening is geometry, not choice

The first survey said all 120 opening cannons across twelve matches sat at clearance one,
which looked like the bot's fault. It is not. A castle sits **centred** in its starting
ring, so at `ringRadiusTiles: 3` the free interior is a band exactly two tiles wide and a
2x2 cannon spans it completely. Surveyed directly: sixteen legal opening spots, every one
at clearance one. The bot had no better move available.

Widening the ring to 4 does make room — opening clearance went from 1.00 to 1.98 and
two-player round-one eliminations from 2 in 12 to none — **and it was reverted anyway.**
An 8x8 starting wall around a 6x6 interior is what the original had and what the game is
built around, and fidelity won. The clearance preference stays, because it governs every
round after the first, once a player holds enough ground to have a choice.

What made the revert cheap is continues (10o): a failed opening now spends a life instead
of ending a match. Measured after reverting, ten matches at each count, no elimination
before **round 4** at three players or **round 6** at two — the early knockouts the wider
ring was protecting against are gone for a different reason.

The cost is real and worth recording: room for another cannon fell from 8.3 to 3.1 at
three players and idle guns rose from 28% to 44%, which is the arithmetic of a 6x6
interior instead of an 8x8. Matches are long now — 15.3 rounds at three players, 25.7 at
two with one unfinished in ten.

### The shot arc followed the reload

Shots were flying off the top of the screen. The lift was `sin(pi * t) * span * 0.25`
where `span` is the flight **in ticks**, so the picture was tied to the reload: when
flight time went from 1.05s to 3.05s at twenty tiles (10k), the apex went from 8 tiles to 23. A five-tile lob peaked 10 tiles in the air.

It now scales with the **range** a shot is thrown, which is what a lob's height should
follow and which survives any amount of balance tuning: `sin(pi * t) * min(range * 0.22,
5)`. At twenty tiles the apex is 4.4 tiles rather than 23. Both styles drew their own copy
of the old formula; there is now one `shotLift` in `theme.ts`, so the next person to tune
it has one number to find.

(The first attempt used 0.16 and a 4.5-tile cap, which watching found too flat once the
shots were no longer leaving the screen.)

### And they were too slow, which is a different number

Flight time had been tuned against shots per cannon averaged over a whole match, and that
average hid the problem: **in round one a cannon at the median range of 26 tiles managed
2.8 shots, and one at 35 tiles only 2.1.** The distribution over eight seeds was 2x:5
3x:30 4x:1 5x:5 6x:1 — so the long guns were firing twice while the close ones fired six
times, and the whole thing looked sluggish.

Tuned against the round-one distribution instead, `850/110` becomes **`1600/45`**: 3x:25
4x:22 5x:1, mean 3.50, **minimum three**. Every cannon now gets its three salvos.

The trade is worth recording, because it is forced by geometry rather than chosen. Shot
distances in round one run from about 10 tiles to 36, a spread of nearly four to one, so
no setting gives every cannon exactly three: guaranteeing three at the far end hands the
close ones four or five. Pushing the mode down to three everywhere needs flight to be
nearly constant with distance — around `2400/20` — which contradicts section 1.4's rule
that flight time scales with distance, and makes close shots _slower_ than they were.
Lowering the per-tile term rather than the base is the compromise: **25-38% faster at
every range beyond twenty tiles, and within 5% of unchanged at point blank.**

## 10q. The online lobby, tested at last and then polished

### It had never been opened at more than four seats

The player cap went from four to eight (10l) and the online path was never exercised at
it: the protocol had validated 2-8 on both sides long before a room was asked to hold
eight. Covered now, both ways.

In `room.test.ts`: eight clients take eight distinct seats, a ninth is refused, and a
600-tick eight-player match leaves every client bit-identical to the server. And over a
real socket against the built server: seats 0-7 assigned in order, the ninth refused with
`room_full`, the match starting with eight people. Both worked first time — the cap was
genuinely the only thing in the way.

**The lobby had no way in except the menu**, which is why it went uninspected for so
long. `?host=N` and `?join=CODE` now open it directly, the way `?autostart=1` has always
opened the offline game. A whole path being untestable is itself the bug that lets it rot.

### Polish

The markup moved into `lobbyMarkup` in `lobby.ts`, a function of the room rather than
something assembled in place — whether a guest is shown the host's controls is exactly
the kind of thing that is obvious in the code and still wrong on the screen. Eight tests
cover it, including the eight-seat case that started this.

What changed for a player: the room code is set large and monospaced with a **Copy**
button beside it (falling back to selecting the text, because the clipboard API is
unavailable over plain http on anything but localhost — which is how somebody will first
try this on a home network); every seat carries the **colour it will actually play in**,
so the lobby and the board agree; seats read _"2 of 8 taken — the rest are played by
bots"_; and each bot tier says what it does, since "gunner" tells a new player nothing.

That last one needed a second pass. Explaining the tier on every row gave eight identical
lines of explanation on a default table, which reads as noise and buries the line doing
the work. It is now explained once per distinct tier.

Names are escaped. They come from other players and the server caps their length, not
their content.

Three copies of "player colour as CSS" became one, in `colours.ts`.

## 10r. The round cap and points scoring

Before this a match ended only when one player was left, and between competent bots
that could take thirty rounds or never happen. A match now ends at the resolution of
round `scoring.maxRounds` (10), or earlier when one player is left; at the cap the best
score among the survivors wins. The rules are in PLAN.md §1.7; this records how they
were settled and what was measured.

### Measured before anything was built

At the bot play of the day, four of eight three-player matches and seven of eight
two-player matches would have reached round 10. **So the cap is not a tie-breaker, it is
the main win condition**, and the scoring formula is the game's balance with elimination
the exception. The default weights split about 65/35 territory to damage at three
players and 76/24 at two.

### Questions that reading the code turned up

- **Territory is total tiles times total castles**, not summed per region. Two separate
  one-castle loops of 30 tiles score 120, exactly as one loop holding both would.
- **An enclosed tile is whatever the solver marks as the player's territory** — castle
  and cannon footprints included, so placing a gun never costs points.
- **Self-fire.** `fire()` had no island check at all, so a player could shoot a spare
  stretch of their own wall for two points a tile and rebuild it in a build phase they
  were spending anyway. The plan had recommended scoring it zero and leaving it legal;
  the decision was to forbid it. `fire()` refuses your own island, and an impact clears a
  wall only if a live opponent owns it — checked at impact too, so a wide crater cannot
  reach your own. An eliminated player's rubble is therefore indestructible, and a player
  can no longer clear their own stranded wall from ground a cannon needs. Both accepted.
- **A shared win is not a draw**, so `winner` became `winners`, beside `draw` and a new
  `endedBy`. The snapshot changed shape and `PROTOCOL_VERSION` went to 2, then 3 with the
  lobby settings. The welcome message had been sending a hardcoded 1 regardless.
- **Failing to seal in the final round still costs a life.** Nothing follows it, but the
  normal path needs no special case.
- **`maxRounds` is nullable, for tests only.** The game is balanced around the cap and a
  host cannot lift it. `withoutRoundCap` sits beside `withoutContinues`.

### Lobby settings, as a mechanism

Only `maxRounds` is settable, but game speed, team mode and special weapons are meant to
follow, so it is an explicit list of typed settings in `config/src/settings.ts` with
bounds in `server.lobbySettings` (5 to 20 rounds), not overrides by path into the
ruleset. The room accepts a change only from the host, before the start, and only inside
the bounds — refused whole rather than clamped — then applies it over the server's
ruleset and re-validates through `RulesetSchema`. The result travels in the snapshot, so
determinism is untouched. The offline menu has the same control, and a host's menu choice
carries into the room they open. The validator refuses bounds that exclude the ruleset's
own cap.

### Things found along the way

- **The HUD roster put player names into `innerHTML` unescaped**, and online they come
  from other clients.
- **`stateFromAscii` gave walls no owner**, so every wall in a test picture was rubble on
  island 1. It now owns walls by island and takes an optional island overlay picture.
- **The gunner-over-recruit position test changed result, not meaning**: it reads
  position at 20,000 ticks, which the cap now ends matches close to, and the lead fell
  from 5 of 8 to 4. It runs uncapped.

First measurement under the rules, four three-player gunner matches: two decided on
points at round 10, two by elimination. Territory 64 per surviving player-round against
24 for damage, 73/27 — damage fell once self-inflicted hits and rubble stopped counting.

## 10s. Teaching the bots to play for points

Bots were tuned for survival, and a soak cannot judge scoring weights while they play
for survival. This is where they learned otherwise — mostly by finding out they were
losing rounds they could have won.

### Three levers that did nothing

Marshal alone changed, in one seat against two gunners, both seats. Baseline 7 of 11.

| Change, marshal only                    | wins    | castles | forfeited rounds |
| --------------------------------------- | ------- | ------- | ---------------- |
| none                                    | 7 of 11 | 1.46    | 26%              |
| `maxCastles` 2 -> 3                     | 6 of 11 | 1.50    | 26%              |
| target the rival with the highest score | 5 of 11 | 1.47    | 27%              |
| `ROOM_RADIUS` 3 -> 4                    | 1 of 12 | 1.09    | 43%              |

The ambition cap was not binding — bots barely held two castles — so the handicap
expected under points was not there. A wider band was badly worse, as it was for
survival. What the numbers did show: **both tiers forfeited about a quarter of their
rounds**, and each forfeit costs the whole round and a life.

### Why a quarter of rounds failed

Headless `--stats` gained `repairAtBuild`, `repairLeft` and `repairStuck` — the cells the
tightest seal needed as the build phase opened, the cells still missing on its last
tick, and how many of those no piece in the bag could cover. Hashes are identical with
and without `--stats`, so measuring does not disturb play.

**Every failed round was affordable**: a tightest repair of 3–12 cells against a budget
of 42–47, ended 1–3 cells short with the whole phase spent. About 30% ended on a hole no
piece in the bag fitted; the rest on cells that could have been filled. Two causes in
`decide()`: a breached bot asked for the _widest_ affordable wall first, against an
estimate of 3.5 cells a piece that is optimistic once the bag widens; and it read
`enclosedCastles`, which landing shots do not refresh, so as a breached phase opened it
believed it was sealed. Most of its second castles came from that stale path.

**The fix: count sealed castles afresh, and when breached close the tightest wall that
keeps the guns before anything else.** Marshal alone with it: forfeits 26% -> 9%, wins 7
of 11 -> 10 of 12, and from seat 0, 2 of 6 -> 5 of 6 — most of the seat bias seen that
week was this bug. With every tier on it the ladder held. Preferring the roomiest repair
within three cells of the tightest was tried and dropped for no measurable gain.

**What it did to the game**: with every bot careful, three gunners forfeited half as
often (22% -> 11%) but held half the territory (80 -> 41 per sealed round), and eight
matches produced no eliminations at all. Careful play under the default weights is a
tight wall around one castle — the turtle the scoring was meant to punish. A finding
about the weights, visible now that the bots play for points.

### Three faults seen watching a match

- **"The sea counted as wall."** It did not. An independent check — a search outward
  from each castle rather than the solver's flood inward — agrees with the sim at every
  resolution of three full matches, and is now a test. The display was wrong: territory
  is refreshed at placements and resolutions, not when shots land, so a castle breached
  in combat stayed shaded as sealed. The client now draws territory and counts castles
  from a fresh `computeEnclosure`. Display only.
- **Cannons against a coastal wall.** Clearance treated a wall with the sea behind it
  like an inland one, and in a tight ring every spot touches a wall, so range decided —
  toward the enemy, where the coast usually is. A spot is now _pinned_ if a wall block
  beside it has nothing buildable beyond, and pinned spots are taken only when nothing
  else exists.
- **Idle beside an unwalled castle.** Thickening targets no piece could reach were marked
  unreachable, but `thickenTargets` never consulted that set, so the bot got them back,
  failed, and paused for the rest of the phase without reaching `spareWork`. Build
  choices are now tried in turn, skipping dead ends, and spare time reaches for every
  castle on the island. Pieces laid against time available went 95% -> 105%, territory
  41 -> 52.

The cramped-walls test held one seed to 0.5 while the soak average sits at 50–56%, so it
flipped with any change. It now measures three seeds against 0.6.

### Is thickening worth it — the baron

Two profile switches, `thickens` and `expandsWhenSealed`. Each variant with marshal's
speed and aim, against two gunners, twenty matches (equal play wins about 7):

| Variant                                   | wins of 20 |
| ----------------------------------------- | ---------- |
| marshal as it is                          | 13         |
| marshal, thickening off                   | 12         |
| no thickening, eager expansion            | 9          |
| eager expansion, thickening kept, `max` 4 | 14         |

Dropping thickening changes nothing; dropping it while expanding eagerly is worse — the
wall an expansion relies on while it is being built is the wall being shot. The 14 did
not survive a forty-match rerun (seeds 101–120): 28 against marshal's 29. It was kept
anyway as the **baron** tier, for variety rather than strength — marshal's skill,
`maxCastles` 4, eager expansion, thickening kept.

## 10t. Polish: looking at the client, combat, feedback, lives

The client had grown a scoring HUD tested only as functions. `tools/screenshots.sh`
changed that: Playwright's screenshot command renders in real time, where headless
Chrome's virtual time barely drives the render loop, so `&snapshot=PHASE&round=N` and a
wait reach any state worth seeing. Its first pass found six things nobody had seen: the
board under the HUD bar, the pixel sea ending in a hard rectangle, inert cannons nearly
invisible in pixel style, a 0.0s timer at game over, the round label jumping every
intermission, and a final table that was one upper-cased line.

**Combat.** The art config had declared banner waves, sixteen barrel rotations, recoil,
muzzle flash and shot trails, and nothing used them. They are built now, barrels
rasterised at each angle since rotating one sprite smears pixels. The barrel first drew at
9 px, too short to read, and in the base's own shade; banners at 5 px vanished. The shake
fires only for your own wall: shots land somewhere all the time.

**Leak hints**, found wrong on screen twice. Red vanished on the red player's island, so
they are in the UI's ink. And the first rule — every missing cell touches standing wall —
refused a real breach, because the corner of a missing run touches only its neighbours
in the run; it is now per run. The limit went 8 -> 12 when the first screenshot showed a
typical first-round breach of nine. The suggested repair keeps the guns inside: the
tightest wall regardless is often a ring that abandons them.

**Lives.** Pips in the roster, a life-lost banner that lands, red on the last, and a
knockout stamped over a greyed island. The old knockout message sat in the middle of the
screen for the rest of the match, over the game the player was left to watch; it is a line
at the bottom now. `&idle=1` leaves your seat undriven in a fast-forward, which is the
quickest way to put a mid-match knockout on screen.

**After the first human play.** Leak marks came out: hard to tell from the piece ghost and
from wall already laid, and read as the one right repair when any closing shape will do.
The castle outline stayed, as it has neither problem. The fire cursor only changed colour
slightly when a gun was ready; it now changes shape, and carries the count. And the time
left, which a player watching their wall never looks up to see, is repeated in large
figures in the sea near the middle — the one place every island faces.

**Second round of human feedback.** The points banner was far too quick at 2.4 s; it now
holds for the intermission, with the total. The aiming cursor appears during the "Fire!"
announcement, so a target can be chosen before the phase opens. The cannon badge counts
guns still to place. And overtime, a rule: a 3 s window after the build clock in which
each player may place the piece they hold. Its early end, once everyone has used it, is
noticed by the next step rather than run from inside the action — run from the action, a
resolution that ended the match did so before its tick was stepped, and the determinism
test's log replay came out different.

## 10u. Team mode

Chosen by the user ahead of the balance work, and built in six steps. The rules are in
PLAN.md §11.7; how they came out:

- **Every match became a team match**, free-for-all as teams of one, rather than a second
  copy of every rule. Checked, not assumed: free-for-all bot matches played out identically
  to the tick before and after, at each step that touched the sim or the bots.
- **PLAN.md had claimed the data model was team-aware already.** It was not; score, lives
  and elimination all belonged to a player.
- **A placed block belongs to the island, not the placer**, which made a teammate's help
  fall under the sweep, damage and rubble rules with no change to any of them.
- **The old bots made 598 refused shots at teammates** in two 2v2 matches before T3.
- **Islands are shuffled among seats, not inside the sim**, which keeps player p on island
  p + 1 everywhere; the server tells each connection who it has become. The shuffle applies
  to free-for-all too. Two room tests had assumed the first seat stays player 0, one passing
  only by luck of the shuffle.
- **One lobby for online and offline.** "A server is there" had to mean a welcome within
  two seconds, not an open socket: under the dev server the socket's address is the dev
  server's own, which can accept and say nothing.
- **Presentation found two layout faults on screen**: the team tag at an island's top middle
  sat under the big timer, and a 4v4 roster wrapped the bar onto two lines.
- **Measured (T6)**: random seating decides nothing measurable, and eliminations are rarer
  than in free-for-all — 5 in 180 team matches.

## 10v. Bugs found by the user's own play

- **No castle to choose after a continue.** The sim accepted `select_castle` in the cannon
  phase from a player owing one — bots and the timeout fallback used it, and it was tested
  — but the client's controls decided what a click meant from the phase alone, so a person
  was offered a cannon with nowhere to put it. What a click means is now `inputMode`, a
  pure function of the state and the player, tested by playing a match to a continue.
- **Announcements wiped everything else drawn over the board.** Each replaced every child
  of the banner layer, which also held the island banners, the team tags, the big timer
  and the cursor count; those went on updating nodes no longer on the page. Screenshots
  jump to a phase and skip announcements, which is why none caught it.
- **The cursor looked ready over a teammate's island**, where the shot is refused.
  `mayTarget` now answers for the cursor and the click alike.

The pattern across all three: the rules were right and tested, and the client asked a
different, simpler question than the sim did. Where the client has to predict a rule, it
should ask the same function or one tested against it.

## 10w. The original's banner: two looks, and the sweep drawn under it (V1)

The first package of the visual pass (PLAN §11.8). In the original, the banners either side
of combat change the board's look as they cross it — plain for building, cinematic for
combat — and the banner after the build phase carries the sweep of loose wall. All three
parts already existed here but were unconnected: one style for the whole match, a CSS
banner that knew nothing of the board, and a sweep drawn at the resolution before any
banner showed.

- **Client only.** The sim still sweeps at the resolution; the client draws the swept
  blocks until the banner's line passes their row. Safe because nothing is playable during
  an intermission and the next phase opens only once the banner has left. Checked with the
  user against the original: "Fire!" and "Rebuild" swap the look, "Place cannons" carries
  the sweep. The rare round with no cannon phase needs no rule — the next banner, "Fire!",
  takes the sweep as well.
- **Two settings, not a mode**: `art.styles.build` and `.combat`, flat and pixel by default,
  chosen per player in the menu. The same style for both simply switches nothing.
- **The banner follows the sim clock** (`bannerProgress`), not a stylesheet, so the wipe is
  always exactly beneath it. It now travels from wholly above the screen to wholly below,
  rather than from -12% to the bottom edge, so the wipe covers the whole board.
- **Each look has its own layer stack.** The pixel style empties its layers with
  `removeChildren()`, which took the other style's graphics with it when they shared. The
  hidden look is only marked stale and redrawn as a wipe reveals it, so between banners two
  looks cost what one did. A look that never ages its effects must not be handed impacts
  while hidden, or they all go off at once when it is next shown.
- **Owners of swept blocks come from the board last drawn**: the sweep has already zeroed
  them in the state, and `islandId` would be wrong for an eliminated player's rubble.
- Seen in real-time screenshots, frames diffed before and after the banner: blocks above
  the line gone mid-crossing, those below still standing, and the pixel look coming into
  view with the cannons placed while it was hidden.

## 10x. The pixel style as the combat look (V2)

With V1 the pixel style became specifically the combat look, the cinematic half of a pair,
so it was pushed further from the flat one. All client-side; the tunables are new fields
under `art.generators`.

- **Height, from light falling from the north**: a wall block with nothing to its south
  shows a front face — a light lip, then dark dressed stone — and walls, castles and guns
  cast a shadow onto the ground south of them. The castle gained a shaded front below its
  roofline. At first the face was too subtle under the owner's tint and was darkened a step.
- **Sealed ground paved**, flagstones tinted with the owner's colour, instead of an alpha
  wash that was hard to read under textured grass.
- **Water**: darker with distance from land, and surf along the coast whose opacity breathes
  a little out of step tile to tile. The first depth measure was a breadth-first flood,
  i.e. Manhattan distance, and the sea stepped in visible diamonds; it is Euclidean now,
  measured outright within the shading range, and only when terrain is drawn.
- **What was generated but never drawn is used**: the crater decals mark shots on land,
  fading over `fx.craterRounds`, and the damaged-wall variants crack the blocks either side
  of a breach for the rest of the round. Both sit below the walls, so rebuilding covers them.
- **Rubble** for an eliminated player's wall: loose stones with the grass showing through,
  no face, no shadow — in the way, but plainly nobody's.
- **Inert guns** slump (a short, unlit barrel) and smoulder instead of the red strike the
  flat style keeps. No reachable snapshot has an inert gun — that needs a gun left
  outside sealed ground at a resolution — so it was first seen by the user in play.

## 10y. Build-phase effects (V3)

The third package of the visual pass. Sealing a castle is the most satisfying thing a
player does, and it used to pass unmarked: the territory simply appeared.

- **The flood** (`seal.ts`). The client compares the enclosure before and after every
  change and floods whatever territory was gained, breadth-first from the castle's own
  footprint or from the edge of the territory already held, so a widened loop floods only
  its new ground. Drawing hides what the front has not reached and never adds anything
  back, so a flood outlived by a breach cannot restore lost ground. A lit front trails
  `sealGlowTiles` behind it. It is drawn in both styles, since it shows exactly what the
  last piece sealed. **40 tiles a second was too fast**: a typical region filled in about
  150 ms and read as a flash. 16 lets the ground be seen being taken.
- **Flags hoisted** in both styles: the flat style gained a plain pennant, since the
  flat look is where building happens by default and the moment would otherwise have no
  flag at all. Its first pennant was too small at a three-player tile size and was
  enlarged.
- **Pieces settle** from slightly large and bright, and in pixel style throw dust from
  their outer edges only.
- **The pixel ghost is the wall it would make**, joined to itself and to the standing wall.
  At first each of its cells was outlined, which cut the joined wall into squares again;
  only the outside is outlined now.
- **Overtime rings the board** in a pulsing red border, drawn just inside the board: drawn
  on its edge, half of it fell under the HUD bar and off the bottom of the window.
- Seen in screenshots driven through Playwright's library (for the mouse, to see the ghost)
  and in bursts of frames from a watched match, picked out by measuring what changed.

## 10z. Combat effects (V4)

The fourth package of the visual pass, mostly in the pixel style, which is the combat look.

- **The lob**: the ball grows by up to half again toward the top of its arc while its
  shadow shrinks and fades, so height reads twice over.
- **Impacts by what they hit**: in the sea a white plume and two rings (no blast, no
  scorch); on open ground a blast, a scorch mark and dust; on a wall a blast, the debris
  already thrown, and a breach that smoulders for `fx.smoulderMs`. **The first splash was
  too faint** against the patterned sea and gained the plume and a thicker bright ring;
  **the first smoke was grey and vanished against the grass**, and is dark now, as burning
  stone gives off, with embers that show more often.
- **Muzzle smoke**: puffs blown out along the barrel, slowing under drag and drifting up.
  The shot's origin is the tile at the gun's centre, so the muzzle is placed from there.
- **The landing mark pulses ever faster** as the shot nears, and turns red and thick over
  the watching player's own wall. Both styles, being the warning a player repairs by; the
  effect frame now carries who is watching.
- **Flags are lowered** on a breach, in a darker shade, and go back up from wherever they
  had got to if the castle is sealed again. `FlagHoist` holds the logic and is unit-tested.
- Looking at water needed the player's own shots, since even recruits land their misses on
  land. Playwright's `mouse.click` did not fire in this game where a move followed by a
  press did — worth knowing before concluding a click handler is broken. The flag coming
  down was not caught on screen; the user checked it in play.

## 11a. The lobby shows the real map (V5)

The fifth package of the visual pass, with three decisions from the user: draw the seed
when the table is set so the preview is the real map; make it random every time a lobby
opens, with `?seed=` kept for testing; and let the host seat a bot in their own place,
which replaces the "watch the bots play" button.

- **The seed moved from the start to the table.** A room draws it at creation (from its
  random generator, which also issues tokens, so match seeds changed for every room seed;
  no test depended on the old values) and sends it in every `room` message; a local table
  takes it from `crypto.getRandomValues`. The host may draw another or type one in.
  Protocol 7.
- **The preview deals exactly what the match will** (`preview.ts`): the terrain from the
  seed, the island of each seat from `seatOrder`, the colour from `matchPalette`. A test
  builds the real local match and compares all three. **The first colours were wrong**:
  `createMatch` renumbers team labels densely in order of first appearance among the
  players, after the shuffle, and the colour family follows the renumbered id. The same
  renumbering means the lobby's team letter can differ from the match's — recorded in
  PLAN 11.5, since it predates V5.
- **A host watching**: the server marks the host's seat a bot's at the start, ignores the
  host's actions, and — found while writing it — must not hand the seat back when the host
  reconnects, which the generic "reclaim a seat a bot was holding" path would have done.
- **Server bots are numbered from one**, as the lobby numbers seats: the match said "Bot 2"
  for the lobby's "Bot 3".
- **Dressing**: a stone-block title and the game's sea drifting behind the menu and lobby
  (`decor.ts`), seat cards with the seat's number in its colour, rank badges per tier
  (chevrons, a star for the baron), team columns, a flash for a newcomer.
- Checked over a real socket on a second port, host and guest in two pages: the guest saw
  the host watching, the host's match ran as a spectator, and the guest's island was the
  one the preview had shown. A server already on 8080 belonged to the user and was left
  alone — it runs the old protocol until restarted.

## 11b. The end of a round and a match (V6), and the team letters

The last package of the visual pass, and the fix for the team letters found in V5.

- **Team letters now survive the shuffle.** `createMatch` numbered team labels in order of
  first appearance among the players, after the seat shuffle, so the host's Team A came
  out as team 1 whenever a Team B seat became player 0 — and the letter changed between
  lobby and match. `denseTeams` (in `teams.ts`) numbers them in label order instead, and
  both `createMatch` and the lobby preview call it, so the two cannot drift again. A match
  created without labels is unchanged: each player is their own team, numbered in player
  order. No recorded hashes existed to break — the replay test records within its own run.
- **Points count up** in the island banner, total and all, while a glow sweeps the
  territory outward from its castles, both over `tallyMs`. The glow is the seal flood's,
  run without hiding anything and at a speed that finishes with the count. The HUD had
  rebuilt a banner's class whenever its text changed, which would have replayed its
  entrance on every counted frame; the entrance now restarts only for a new kind of news.
- **A lost life crumbles outward** from the middle of the island over `lifeCrumbleMs`,
  each block dropping debris as it goes — the deferred-sweep mechanism again, with times
  instead of a banner line. Cannons still vanish at once: the sim removes them from the
  state, and the client does not keep them.
- **Fireworks** over the winners for as long as the game-over screen stays. The first
  bursts were too small and sparse to read as a celebration and were enlarged.
- Seen in frame bursts across a resolution in which the player failed and the bots scored,
  and at a game-over snapshot.

## 11c. Choosing seats instead of teams

**Found by the user**: in a team game the per-seat team dropdowns did nothing. They did
send the change, but a team assignment is taken only if it leaves the teams equal, and
changing one seat's team always unbalances them — so every change was refused and the
dropdown snapped back. Letting it through would have raised the question the user put:
who moves to the other team to make room, and which one?

**The user's answer, built**: teams belong to seats, and the host chooses who sits in each
seat — a bot, or any person at the table by name — swapping with whoever was there. The
per-seat team dropdowns are gone; a seat's team is the column it sits in.

- `configure.move { from, to }`, host only, before the start. A bot swapped out takes the
  mover's old seat and keeps its skill; the host stays host wherever they go; anyone moved
  is sent a new `welcome`. Protocol 8.
- **The room had assumed seats were join order** in three places, all fixed: a newcomer
  now takes the lowest free seat rather than the next number; bots fill whichever seats
  are free at the start, and the seats are ordered by seat before the shuffle; and leaving
  before the start no longer renumbers everyone — which had undone any seating and, as a
  bug of its own, never told the renumbered players their new seat.
- A shrinking table brings anyone seated beyond it into a free seat.
- The local table keeps the host's seat, so a person playing alone against bots can pick
  their side too.
- Checked over a real socket with host and guest (both moved onto Team B; the match
  agreed, islands as the preview dealt them), and in the local lobby.

## 11d. The user's audio, registered; the enclosure cues moved

The user supplied 15 of the 18 cues. The manifest had drifted from the folder — six
effects supplied as `.wav` where it named `.ogg`, new variant counts, renamed music — so
21 files would never have played; `config/src/audioFiles.test.ts` now fails on any file
the manifest does not name, or a variant count a supplied cue does not have. Music takes
`variants` too, so the build-phase track can rotate among the three supplied. All 29
files were decoded in Chromium.

**The fanfare was never heard in play**, the user reported, and rightly: it was judged
at the resolution against the castles held the round before, so the usual round —
breached, repaired, holding the same castle — made no sound, and its one reliable
outing, the end of round one, was buried under the scoring. It now plays the moment a
placement seals one of the player's castles while building, together with the flood of
new ground. `enclosure_failed` now means a round that ends with nothing sealed — the one
that costs a life — rather than holding fewer castles than before, which counted two
down to one as failure.

**Later the same day**: the user's second batch — `enclosure_failed`, `player_eliminated`,
more `piece_place` variants, and a new cue, `place_cannon`, which replaces the menu click
when a cannon is set down — brings it to 18 of 19; `wall_destroyed` is left out for now.
**M had muted the whole page**, so typing a name with an "m" in the lobby muted the
music; the key now belongs to the match alone. That left a mute saved from before with no
visible sign and no way out outside a match — the user reported "no sound at all", and an
instrumented browser showed every file decoding and playing at zero gain — so a **Sound**
switch now sits in the corner of every screen and shows the saved state.

## 11e. Recording human play

For the human test sessions that 11.2 waits on. Decided with the user: automatic, no
questionnaire (feedback comes separately, compiled), no notice to players, no replay
viewer — data for tuning only.

- **A match is its inputs.** The simulation is deterministic, so a recording is the
  header (seed, the exact ruleset, terrain settings, players with team and tier, `null`
  for a person) and the actions of each tick something was done on, plus a fingerprint
  every 30 ticks and an end line. JSON lines, written as the match runs, so an abandoned
  match keeps everything but its end. A ten-round match is under 100 KB.
- **The server records its own rooms** through a callback, so `Room` stays free of files.
  **A local match** records inside `LocalMatch` — a person's move lands between ticks,
  ahead of the bots' on that tick, and the recording keeps that order — and the page
  sends the lines to the server it came from, batched, with `sendBeacon` if the tab
  closes. Uploads are validated line by line; a file must open with its own header.
- **`--replay`** in the headless harness runs recordings through the same statistics as a
  bot soak. The code moved into `stats.ts` for it, and a soak's table came out identical
  to the one before the move, hashes and all.
- Checked end to end over a real server: a local match and an online room with two people
  both recorded, and both replayed exactly; a full ten-round local match replayed to 23
  rows, the person's seat among them. `npm start -w` runs the harness from its own
  directory, so replay paths are resolved from where the command was typed (`INIT_CWD`).

**Statistics written as a match ends**, at the user's request, so nothing is run by hand
after a session: the server replays the finished recording and writes `<id>.stats.csv`
beside it. A replay of a whole ten-round match with every measurement takes about 0.2 s
(the heaviest single measurement about 15 ms), so it runs in the server process, deferred
past the step that ended the match. The statistics code moved to a shared package,
`packages/analysis`, for the server and the harness alike; printing the summary stayed
with the harness. One setting, `recordings.enabled`, turns recording, uploads and
statistics off together — checked on a live server: no folder, uploads refused.

## 11f. The visual pass, as it was planned

Moved here from PLAN §11.8 once all six packages were done, so the plan's own text —
the decisions and the steps as agreed on 2026-09-26 — stays on record. How each package
actually turned out is in 10w–10z, 11a and 11b.

**Agreed 2026-09-26, finished the same day** (ARCHIVE 10w–10z, 11a, 11b). Everything here
is client-side and cosmetic: no sim, protocol or ruleset change, so it cannot desync a match or move a balance measurement,
and it can proceed while 11.2 waits on human play. Cosmetic randomness may use
`Math.random` (the client is outside the lint rule), but durations, sizes and counts
belong in `art.default.json` like every other visual tunable, not in code.

**Verification, for every package.** Headless Chrome cannot check anything timed (§7), so
each package pulls its decisions into pure functions with unit tests — which look is on
screen, where the wipe line is, which walls are still drawn — adds a scene to
`tools/screenshots.sh` where a still frame shows it, and leaves anything under a second
to be looked at by a person.

Work packages in order. V1 is the feature; V2–V6 are independent of each other and can
be taken in any order after it, though V2 comes first because V1 makes the pixel style
the combat look specifically.

### V1 — Phase themes and the banner wipe — done

Kept as it was planned, for the record; how it turned out is §7 and ARCHIVE 10w.

**The original.** The banners either side of the combat phase cross the screen from top
to bottom, and the board beneath changes as the banner passes: from the simple, flat look
of building to the more realistic, cinematic look of combat before it, and back after.
The banner between the build and cannon phases does not change the look; instead it
carries the sweep of loose wall, which vanishes row by row as the banner passes over.

**Today** all three parts exist but are not joined: one style is chosen for the whole
match (`Scene.useTheme` is called once), the announcement is a CSS animation across the
window that knows nothing of the board (`@keyframes sweep`), and the sweep is drawn the
moment the sim applies it at the resolution — before the banner shows — although the sim
already reports exactly which tiles went (`walls_swept`, ignored by the client).

**Decided with the user:**

- Two style settings, **build look** and **combat look**, default **flat** and **pixel**.
  The combat look is on screen during combat; the build look everywhere else — castle
  choice, cannon placement, building. Both are chosen from the same list of styles, so a
  new style is offered for either, and **choosing the same style for both switches
  nothing** (the banner still sweeps; nothing changes under it). No separate "classic"
  mode: it is simply the default pair.
- **"Fire!" wipes build → combat, "Rebuild" wipes combat → build**, and "Place cannons"
  carries the sweep. The sim is untouched: it still sweeps at the resolution, and the
  client only delays _drawing_ it. That is safe because nothing is playable during an
  intermission, and the next phase does not begin until the banner has left.
- **No special rule** for the rare round in which nobody has cannons to place and the
  sim goes straight to combat: the pending sweep is drawn away by whichever banner comes
  next, so that "Fire!" carries both the sweep and the wipe.
- The styles stay a per-player choice in the menu, not a table setting: they are how you
  see the game, not its rules, so they never travel to the server or the snapshot.

**Steps:**

1. **Settings.** `art.style` becomes `art.styles: { build, combat }`, both `ArtStyleSchema`,
   defaulting to `flat` and `pixel`. The menu's single Style select becomes two, "Building"
   and "Combat", remembered in `localStorage`. `?style=X` still sets both, for the
   screenshot script and old links; `?buildStyle=` and `?combatStyle=` set one each.
2. **Which look, as a pure function** of state alone, so a client joining mid-intermission
   gets it right without history. Before an intermission the look is combat exactly when
   `pendingPhase === 'build'` (only combat leads there); after it, combat exactly when
   `pendingPhase === 'combat'`. Outside intermissions it follows the phase.
3. **The banner follows the sim clock.** Its progress becomes a pure function of
   `(tick + tickFraction, phaseEndTick, bannerTicks)` and is applied as a transform each
   frame, replacing the CSS keyframes and the `animationend` removal. Then the wipe line
   _is_ the banner, and both stay right through dropped frames and at `&speed=`. The
   announcement's text and standings lines are unchanged.
4. **Two themes alive at once.** The Scene gets one layer stack per look, each under its
   own root container. Separate stacks are necessary as well as clean: the pixel style
   calls `removeChildren()` on its layers and would wipe the flat style's graphics if
   they shared. During a wipe each root is masked by a screen-space rectangle split at
   the banner's centre line — new look above, old below — covering the whole canvas, so
   the pixel sea beyond the board switches with it. Outside a wipe only the current look
   is visible and drawn.
5. **Cost.** The hidden look is not kept up to date; it is marked dirty on any change and
   redrawn in full (terrain, territory, structures) when a wipe begins and on resize, so
   steady-state cost is what it is today. Its own state — cannon aims, flags, the water's
   frame — simply survives being hidden. Check the frame rate mid-wipe at eight players,
   where both terrains are live; the pixel terrain is the large one.
6. **Effects and overlay.** Only visible looks draw effects. There are no shots in the air
   during a banner — the intermission waits for the last to land — so a wipe never cuts
   a shot in half; debris from the last impact may still be falling and is simply
   clipped. The overlay comes from the look of the coming phase from the moment its
   banner starts, so the aiming cursor that appears with "Fire!" is already the combat
   one. The HTML layer (team tags, island banners, big timer) is above the canvas and
   takes no part. The shake moves the stage and so moves both.
7. **The sweep, drawn late.** On `walls_swept` the client keeps the tile list and draws
   structures from a display copy in which those tiles are still wall until the banner
   line passes their row, as `drawTerritory` already draws from the live enclosure rather
   than the state. **The owner must come from the board the client last drew**: the sim
   has already zeroed `owner` for swept tiles, and `islandId` is wrong for an eliminated
   player's rubble. Territory needs no such treatment — a loop enclosing anything cannot
   be swept (§1.3). Each tile crumbles as it goes: a new `Theme.noteCrumble(x, y, owner)`,
   a puff of debris in the pixel style and a short fade in the flat one. A client that
   joins mid-intermission never saw the event and shows the walls already gone, which is
   correct.
8. **Tests.** Pure: the look before and after every kind of intermission; banner
   progress at its start, middle and end; which swept tiles are still drawn for a given
   line. Screenshots: a new scene caught mid-wipe into combat, and one mid-sweep on "Place
   cannons" (real-time Playwright, with `&snapshot=` and a wait into the banner). Then a
   person watches a whole round at normal speed.
9. **Docs.** §7 describes the two looks and the wipe; the style parameters in CLAUDE.md
   change.

### V2 — The pixel style as the combat look — done

Kept as planned, for the record; how it turned out is §7 and ARCHIVE 10x.

Now that it is the cinematic half of a pair, push it further from the flat style.

- **Use what is generated but never drawn.** The atlas already holds crater decals and
  damaged-wall variants (`wall.<mask>.<damage>`), but `drawStructures` only ever asks for
  damage 0 and the `craters` container stays empty. Scorch marks where shots land on open
  ground; cracked wall beside a breach, tracked by the client from impacts. Both kept by
  the pixel theme, which is hidden while building — whether they fade over rounds or are
  cleared by the "Rebuild" wipe is decided by looking.
- **Pseudo-3D.** Walls with a south-facing front and a drop shadow; castles with a front
  face and corner towers. The original's combat view was in perspective; this is the
  cheap version of it.
- **Sealed ground** as a courtyard or cobble pattern instead of an alpha tint, so "sealed"
  reads at a glance.
- **Water**: animated foam along the shore, deeper colour away from land.
- **Rubble**: an eliminated player's wall gets its own broken texture rather than
  grey-tinted wall.
- **Inert cannons**: a drooping barrel and a wisp of dark smoke rather than a red strike
  through. The flat style keeps the strike-through, where plain information is the point.

### V3 — Build-phase effects — done

Kept as planned, for the record; how it turned out is §7 and ARCHIVE 10y.

In both styles where they are information, shared through `theme.ts` as the build hints
and fire reticle already are; per style where they are decoration.

- **Sealing a castle**: the territory floods outward from the castle in BFS order and its
  flag goes up. The single most satisfying moment in the game, and today it just appears.
- **A piece lands** with a slight settle and a dust puff, rather than appearing.
- **The ghost joins up**: in the pixel style the held piece previews with the wall shapes
  it would form with its neighbours.
- **Overtime** shows as a pulsing red border round the board.

### V4 — Combat effects — done

Kept as planned, for the record; how it turned out is §7 and ARCHIVE 10z.

- **The lob**: the ball grows toward the top of its arc while its ground shadow shrinks.
- **Impacts by what they hit**: a splash ring in water, dust on grass, embers and smoke
  lingering a few seconds on a destroyed wall.
- **Incoming**: the target marker pulses faster as impact nears, more strongly on your
  own wall.
- **Breach**: a castle's flag comes down when it is breached mid-combat, rather than
  vanishing.
- **Muzzle smoke** drifting from each gun after it fires.

### V5 — Lobby and menu — done

Kept as planned, for the record; how it turned out is §6, §7 and ARCHIVE 11a. Decided
with the user: the seed is drawn when the table is set, so the preview is the real map;
it is random each time a lobby opens (`?seed=` still sets one); and the host may seat a
bot in their own place, which replaces the "watch the bots" button.

- **A mini-map** of the table as it stands: the pattern for the chosen player count,
  generated from the seed exactly as a match would be, with team letters. Islands are
  shuffled among seats at the start, so it shows teams, not who gets which island.
  **Open:** offline the menu's seed is known; online the room draws its seed only at the
  start, so either the room draws it when the table is created (a server change, but not
  a game-logic one) or the preview shows a representative map.
- **Seat cards** in team columns, each with its colour swatch and a small rank insignia
  per tier, instead of plain rows.
- **An animated background**: the pixel sea behind the panel, or a blurred bot match being
  watched.
- A **pixel-art title**, and a little feedback when a person takes a seat or the room code
  is copied.

### V6 — Resolution and match moments — done

Kept as planned, for the record; how it turned out is §7 and ARCHIVE 11b.

- **Points count up** across the territory as they are banked, during the intermission.
- **A lost life** crumbles the island's walls outward rather than clearing them at once.
- **Game over**: fireworks over the winning island(s).

---

**The image failed CI after recording landed** (`45bcd92`): the server created
`recordings/` at start-up, the image runs it as the unprivileged `node` user in an `/app`
owned by root, and `mkdir` failed with EACCES — the server died before it listened, and
the job's 30-second wait for an answer ran out. Reproduced without Docker by starting the
bundle in a read-only copy of the image's layout. Fixed twice over: the Dockerfile makes
`/app/recordings` and gives it to `node`, and a server that cannot make its recordings
folder now warns and runs on without recording (`openRecordingStore`), since a recording
is never worth the game server.

## 11g. Alternative visual themes (M10)

Planned in PLAN §11.9, agreed 2026-09-27: per-style palettes, then Night as the proof of
them, then offering each look only the styles made for it; Cyberpunk is the next theme
after those.

**Per-style palettes — done.** `stylePalettes` in `art.default.json` lays a style's own
colours over the shared ones; `artForStyle` does the laying, and every theme is handed its
result, so no theme's drawing code changed. Overrides rather than a full palette per style,
since a new theme mostly recolours land and sea and would otherwise repeat the rest.
Player ramps are overridden whole and checked against the shared ones by name, order and
hue: a hue may move at most 15 degrees, the gap between azure and sky in one team family.
One thing a palette alone could not do: the canvas has a single background colour, the
sea's, so a style with a sea of its own would sit in the other's frame. Each look now
fills the window behind the board with its own sea, under the same mask as the rest of
it. Checked with a temporary purple sea for pixel only: the flat look kept its own, and
the wipe split the margins at the banner. With no overrides, before and after screenshots
of both styles differ only by the clock.

**Step 2, every theme reading its own palette, needed no code**: the pixel sprite sheet is
generated from the art each theme is handed, and every shared helper in `theme.ts` takes
that art too.

**Night — done.** The pixel theme under a second style name, `night`, with fourteen
palette entries of its own and the shared player ramps. A near-black sea, dark cool land,
and the shore's pale rim telling the two apart. **Warm stone for torch-lit walls was tried
first and failed**: walls are the stone sprite multiplied by the owner's colour, so a warm
stone turned azure walls grey and violet greyish, which breaks the rule that a player
keeps their hue. Neutral, bright stone keeps all eight hues at eight players. The dark
stone was lifted once, because breached, inert guns vanished into the ground.

**Styles per look — done.** `STYLE_LOOKS` in the config package says which looks each
style is made for: a property of the drawing code rather than a tunable, so a table in
code, typed so that a style cannot be added without an entry. The menu offers each look
`stylesFor(look)`; `ArtStylesSchema` refuses a default pair that breaks it; and the URL
parameters and the menu's saved choice go through `chooseStyle`, which takes the first
candidate made for the look, so a stale saved choice or `?style=` naming a one-look style
falls through instead of drawing a look in a style never made for it. Every shipped style
still serves both looks, so the rules are tested against a table with a one-look style.

**Cyberpunk — done.** A theme of its own (`cyberpunk.ts`), drawn from shapes like the
flat style, for combat only. Its colours are a palette of eighteen entries and neon
player ramps generated from the shared ones: the hue kept exactly, saturation raised, and
lightness mapped as 0.3 + 0.6 L so that each team family keeps its order of lightness —
maxing every colour to one lightness would have made azure, sky, navy and steel one
colour. Its tunables are `art.cyberpunk`. Glow is a second Graphics per layer with
additive blending, as planned; no filter was needed. From the first screenshots, two
changes: a thick wall read as one slab of colour, heavier than the sealed ground inside
it, so its body was darkened and each block's cell drawn faint in it; and the island
tint was halved, so that sealed ground stands out from the land. Screenshots at two,
four and eight players, in teams of two, and mid-wipe against Minimal. The sub-second
effects — impact glitch, sparks, the power-down flicker, the hologram's flicker — need a
person to see them.

**Cyberpunk walls in 3D — done**, asked for by the user so that the swap from a textured
build look reads as the same walls lit differently. The pixel style's geometry, not its
look: a front face on every block with nothing to its south, at `frontFacePx` of the
tile, so faces line up exactly across the banner; the neon rim moves to the top's lip,
and down a shared side where a neighbour has a face and the block does not. Pixel casts
a shadow; on near-black ground a shadow is invisible, so the owner's colour spills onto
the ground in front instead. The first try barely read, because the top and the face
were nearly the same darkness; lifting the top 30% toward the owner's base colour and
darkening the face made it stand up.

**Cyberpunk's neon title — done.** The menu's title follows the combat look: while it is
Cyberpunk, the stone letters give way to the same 5x7 glyphs as a neon sign, in the
style's own magenta with a canvas-shadow glow and a white core, flickering on by a CSS
animation (off under reduced motion). Tubes run between cells side by side or one above
the other, and diagonally only where two cells meet at a corner alone, so an M reads as
strokes rather than a grid (`neonTubes`, tested). Smooth rather than pixel art, drawn
with room for the glow, which a negative margin gives back so the letters stand where
the stone ones do. Checked in a browser: the title switches as the dropdown changes, and
the building look's dropdown does not offer Cyberpunk.

**A title for every style — done**, the user's request once the neon one was in: stone
stays Pixel art's; Minimal's is flat blocks with a hairline gap, as its walls, each
letter in a player's colour; Night's is the stone in Night's palette, moonlight on the
top edge instead of gold, a pale halo and a few seeded stars. `TITLES` is a record over
every style, so a future style must bring one. The menu shows the title of the look
chosen last (the combat look as it opens, so the default pair still shows stone), and
every title reports how its letters sit in its image so `titleLayout` can show all of
them at one letter height, stone exactly as before. Minimal's first gap was a quarter of
a block and read as dots; drawn at twice the resolution with a one-pixel gap it reads
as blocks. Checked in a browser, the title changing with each dropdown.

**Cyberpunk opened to building — done.** Asked by the user whether anything justified
refusing it as a build look: nothing did. The restriction was taste carried over from
the plan ("building wants something calmer"), and the theme already drew everything a
build look needs, since a look is drawn whole during a wipe. What was thin as a build
look was filled in: the piece in hand is drawn by the same code as standing wall, joined
to the player's own wall, with faces; a gun being placed is a lit ring; a placed piece
throws sparks, as the pixel style throws dust. **The first invalid preview was a red
wall, which for the crimson player differed from a valid one by a one-pixel outline** —
so an invalid piece is now hollow, a red outline round a faint fill, and an invalid gun
is struck through. Seen by hovering in a scripted browser, valid and invalid, piece and
gun. The one-look mechanism stays, tested against a table with a one-look style, for
Blueprint.

**The menu title in both looks — done**, the user's idea, "one part in the build theme
and another in the combat theme". Of the ideas offered (a split at a banner's line, the
line sweeping as the banners do, a split by word, a split backdrop, a live preview), the
first two together: every title already puts its letters in one place at 8 pixels a
cell, so two stacked images coincide letter for letter, and CSS clip-paths cut them at
the line. The sweep is a pure function of time (`titleSweep`), a round in miniature that
keeps the game's rule that the arriving look is above a banner's line, and is tested to
change a row only as the line passes it — an earlier sketch that looped the line would
have flipped half the word at once. A backdrop per style, split the same way, was planned
next and then dropped by the user: changing backdrops would be too distracting.

**Blueprint and Parchment — done**, both for either look at the user's wish ("better
give the players more options"), without area tags ("arcade style, not too much
information on the main screen"), and with Parchment's wax seals in owner colours. The
wall geometry and hatching moved out of Cyberpunk into `walls.ts`, tested as ASCII
pictures, and the three shape-drawn styles build on it; Cyberpunk's walls were checked
pixel-identical after the move. Gun aiming, copied between styles until then, became
`GunAims`. Both palettes' player ramps are generated from the shared ones with the hue
kept exactly and each team family's order of lightness kept: Blueprint's washed toward
white (L 0.55 + 0.3 L), Parchment's muted and darkened to read as ink on paper
(L 0.16 + 0.42 L, saturation at most 0.62). Parchment is the first light style, so its
`uiInk` is dark: the shared build hints, flood core and reticle draw in it. From the
first screenshots, Parchment's two contour lines read as boxy frames round every island
at eight players and were cut to one, and its wax seals came out small and cog-like and
were made larger and smoother. Found in the user's first game with it: ink stains, which
last three rounds, were drawn in the effects layer above the walls and showed through
wall rebuilt over them; they now have a layer of their own under the structures, as the
pixel style's scorch marks do. Checked at two and eight players, close up, sealed and
breached, across a wipe from Pixel art, and as menu titles alone and split.

**Night's torchlight — done**, as agreed: torches at every sealed castle with a pool of
light that is lit while sealed and doused by a breach, light from muzzle flashes,
burning shot and smouldering breaches, and a torch at each end of Night's menu title
lighting the stone. Built into the pixel theme and switched on for Night alone. The
rule learnt from the warm stone held: light on the ground goes in the territory layer,
under the walls, so every player keeps their colour, checked at eight players; flames
and the glow round shots in flight are above. The first pool, 2.6 tiles across at 0.22,
was all but hidden by the guns packed round each castle; 4.4 tiles at 0.32 reads.
Seen in one frame: a sealed castle lit, and a breached one dark with its breaches
glowing. The torches' lighting and dousing is a pure function (`nextTorch`), tested.

**Territory held through combat — done**, the user's request, from the original: a
breach counts for nothing until the build phase, so the territory and every sign of a
sealed castle should not come down with the first shots, which in most themes took most
of the combat look's effects with them. Display only. The client already computed the
enclosure itself (it had to, after "the sea counted as wall" in 10s: the sim's
stale territory carried a breached castle's shading into the build phase), so the change
is which copy each look is handed: the combat look the enclosure as combat began, the
build look the board as it stands, the HUD's castle count the held one until building
begins. `Scene` takes a territory and a set of sealed castles per look, and the rule for
when to hold is a pure function beside the look swap (`holdsCombatEnclosure`), tested.
No theme changed. Seen: mid-combat with many walls broken, every castle still lit in
Night and Cyberpunk; and under the "Rebuild" banner, Pixel art above the line already
showing both players' castles unsealed, Cyberpunk below still lit.

**The first recorded test game — checked.** One person against two gunners, played
locally through a page the server served: the recording and its statistics were written
as designed, and `--replay` found it exact, with statistics identical to the server's.
(The person won on points at the cap, 1658 to 1245 and 1062, failing to seal in two
rounds of ten — twice the bots' usual rate, the number 11.2 rests on.) Two fixes came of
it. The pieces budget, priced from a bot tier's pace, was written as 0 for a person and
read as "used none of the phase"; it is now empty, and the summary shows a dash. And a
recording did not say which code made it, though it replays exactly only against that
code: the server now stamps every header it writes — its own rooms' and browsers'
uploads alike, overwriting any claim a page makes — with its commit, from git or from
`BOLLWERK_COMMIT`, which the image is built with and CI passes. The field is optional, so
earlier recordings still read.

**U1, the HUD readable at eight — done.** The HUD rebuilt its whole markup every frame,
so nothing in it could animate; the roster now has a container of its own whose entries
are kept and only their contents rewritten, which lets scores count up (`countUp`,
tested, over `tallyMs`) and a change of places slide. Free-for-all is now in standing,
best first — reusing `standings`, which the end screen already sorted by; a team match
keeps the fixed team order chosen in 10u. Past four players in free-for-all the words
give way to icons, with the words on hover; the phase block never wraps; the bar's gap
tightened. Eight entries first fitted at 1400 pixels and overflowed at 1280, and fit at
both after the spacing was cut. The big timer, already red for the last three seconds,
now beats on each, and on overtime's three. Probed in a browser: scores climbing over
about 1.4 s at a resolution with a change of places, and the beat on 3, 2 and 1.

**U2, combat aids — done**, less the breach markers, which the user dropped: they were
tried before, as the gap marks removed after the first human play, and were very
distracting. Reload rings round the player's own guns, filling with each shot's flight
and flashing as it lands, and an aim line from the gun a click would fire — the sim's
own `findReadyCannon`, so it cannot disagree with `fire` — along the arc the shot will
take. Both shared helpers in `theme.ts`, called by all six styles; `shotLift` now takes
any course, not only a shot. Seen in a scripted game at Pixel art, Cyberpunk and
Parchment: four guns reloading with their rings part filled, and the dotted arc from the
ringed gun to the cursor, whose first brightness, 0.45, was a little faint on grass.

**U3, the end-of-match summary — done.** A `MatchLog` fed the events the client already
receives: wall destroyed credited through `shot_fired` to whoever fired, lives from
`player_continued`, scores and castles at every `round_resolved`. A team's castles are
its best round together (`mostCastlesOf`), not the sum of its members' separate bests.
The table gains three columns and an SVG chart of every score by round follows it. Tested
against hand-made events and a whole three-round match played by bots, where the log's
last scores and lives agree with the state. Seen at the end of a real ten-round match at
four players and at teams of two, watched at four times speed: the caption first
spanned the panel and labelled the chart's start "round 1" where its lines begin from
nought; the island labels, in the layer above the HUD, sat on top of the summary and now
step aside at game over; and a jump straight to the end showed noughts, so the columns
appear only when the log saw a resolution.

**U4, banners in the arriving look — done.** The phase banner is HTML, so each style's is
a class of `.phase-call` in CSS, chosen by a record over every style (`BANNER_CLASS`), so
a new style must bring one as it must a title; the announcement takes the style of the
look that arrives with it. Only the dress changes: the wipe follows the band's middle,
measured each frame, whatever padding a style gives it. Seen mid-crossing in every
style; Blueprint's first title block was the sheet's own blue and read only by its
rules, so it is a deeper blue laid on the drawing. One capture showed a white band over
the board that two repeats and a probe of the page could not reproduce — taken seconds
after the stylesheet changed, most likely the dev server swapping it in.

**U5, before the match — done**, which completes 11.10. The lobby's map takes the chosen
build look's colours, with its seat numbers and ring in the shared ink, since Parchment's
own is near black on its islands; the seat cards keep the shared colours, which read on
the lobby's panel. Castle choice already raised the ring at once, so what it lacked was
the ask and the moment: the castles to choose now breathe in the accent, shared by every
style in place of five plain outlines, and each choice, anyone's, breaks two rings out
from the castle in the chooser's colour (`choiceBurstMs`). The menu's Effects setting is
kept with the looks; `motion.ts` answers whether motion is reduced, from it or from the
system, for the title's sweep and the roster's slide, and a class on the page mirrors the
stylesheet's reduced-motion rules — and, beyond what the system setting did, it stops
the board's shake. Seen: four lobby maps, the pulse on a person's four castles and the
bots' choices bursting, the menu's new field.

## 11h. Finished work moved out of the plan (2026-09-28)

PLAN keeps only open work, so the sections of its §11 that were finished moved here as
they stood, under their old numbers, which commits and the entries above cite. The
theme rules every style keeps moved into PLAN §7, and team mode's one open item, bots
that do not help a teammate build, into PLAN 11.5.

### Formerly PLAN 11.1 Round cap and points scoring — done

The rules are §1.7, the lobby setting §6; how they were settled is ARCHIVE 10r.

### Formerly PLAN 11.7 Team mode — done

The rules are §1.8, seating and the lobby §6; how it was built and measured is ARCHIVE 10u.
Left open: **bots do not help a teammate build**, even under `crossIslandBuild: all` —
teaching one to help without wrecking a person's plan is its own question.

### Formerly PLAN 11.8 Visual pass — done

Agreed and finished on 2026-09-26, touching no game logic: two looks swapped by the
banners either side of combat, the sweep drawn away under the "Place cannons" banner
(V1); the pixel style made the cinematic combat look (V2); effects for building (V3),
combat (V4), the end of a round and of a match (V6); a lobby showing the real map (V5).
The result is §7; the plan as agreed, and how each package turned out, are ARCHIVE
10w–10z, 11a, 11b and 11f.

### Formerly PLAN 11.9 Alternative visual themes — done

**Agreed with the user 2026-09-27; per-style palettes, Night and styles per look done.**
Client-side only, like 11.8: no sim, protocol or ruleset change. A style may be made for
the **build look, the combat look or both** (`STYLE_LOOKS`): the menu offers each look
only the styles made for it, the schema refuses a default pair that breaks it, and a
link's or a saved choice that names a style not made for a look falls through to the next
(`chooseStyle`) — so `?style=` naming a combat-only style changes combat alone.

**First, per-style palettes — done** (§7, `stylePalettes`). The cheapest way to a new
textured theme is now to let the pixel theme take a different set of sprite generators
and a different palette, rather than writing a second large `Theme` class.

**Rules every theme keeps:**

- **A title of its own for the menu** (`TITLES` in `decor.ts`, a record over every
  style, so none can be added without one).

- **A player keeps their hue across the look swap.** If red became magenta under the
  banner, nobody could follow who is who. A theme may restyle a player's colour — neon,
  ink, pastel — but not change it; the eight colours and the team families must stay
  distinguishable in every theme.
- **Information stays readable**: the flood of newly sealed ground, the red mark over
  your own wall, the overtime border, the aiming cursor. These are shared helpers in
  `theme.ts`; a theme restyles them only where it keeps them legible.
- **Land, sea, wall and sealed ground tell apart at a glance**, including in a dark
  theme.

**The themes.** Agreed 2026-09-27: after per-style palettes, Night and styles offered per
look, **Cyberpunk comes next**, ahead of Blueprint:

1. **Night** — **done**: the pixel theme under its own palette, for both looks. Moonlit
   islands on a near-black sea, walls in bright moonlit stone, and torchlight (below), which palette
   alone could not do (ARCHIVE 11g).
2. **Blueprint — done** (§7). Planned as a build look; offered for both at the user's
   wish, for more choice, with no area tags on sealed ground — the game is arcade and
   the board should not carry much text. As planned: blue drafting paper with a grid,
   walls as white technical lines, castles as plan symbols, sealed ground hatched.
   Minimal stays as the style to debug against.
3. **Cyberpunk — done** (§7), neon menu title included — planned as a combat look, the
   user's idea, and opened to building too (ARCHIVE 11g). As planned: **Circuits, not runes** (runes are
   another theme, arcane, not planned). Brightness means structure and colour means
   ownership: walls are the brightest outlines on the board, each in its owner's neon;
   land is a dark grid, the sea near black with circuit traces and pulses running along
   them, fading toward the islands. Castles have a glowing core; sealed ground is a lit
   grid floor in the owner's colour; flags are holograms that flicker on; shots are
   plasma tracers, impacts bursts of light and glitch, gun smoke sparks; a breach shorts
   out with sparks and goes dark; an inert gun powers down with a flicker. A neon title
   for the menu. Glow by additive blending of a second, larger shape rather than a bloom
   filter, which costs frame rate at eight players; try the filter only if that is not
   enough.
4. **Parchment map — done** (§7), both looks. As planned, except that the wax seals are
   in each owner's colour rather than red, which would have been one player's: sepia
   land, the sea in ink contours and wave strokes, walls as inked stone, shots as ink.

**No further styles for now** (decided 2026-09-27): the six are enough. Considered and
not planned: a retro arcade CRT look, an arcane runic theme, and a high-contrast theme
with a pattern per player, the last the one worth reconsidering for six to eight players.
Cyberpunk stays as it is, its sea pulses included in the build look.

**Torchlight for Night — done** (agreed and built 2026-09-27; tunables in `art.night`).
Night is the pixel theme under its own palette; torchlight is drawing code of its own,
switched on for Night alone, so the pixel style is untouched. **The light falls on the ground, not on
the walls' colour**: warm stone was tried and turned azure walls grey (ARCHIVE 11g).

- **Torches at every sealed castle**: two flanking the gate, flames flickering a little
  out of step, and a warm pool of light on the ground two or three tiles across, fading
  at its edge and breathing with the flicker — a wider shape blended additively, as
  Cyberpunk's glow is. **The torches carry information**: a sealed castle is lit, a breach
  douses them with a puff of smoke, and re-sealing relights them, so lit means sealed and
  dark means breached across the whole map.
- **Light from combat**: muzzle flashes briefly light the ground round the gun; shots
  carry a small warm glow, as burning shot; a breach casts a faint flickering glow for as
  long as its embers smoulder.
- **A torchlit menu title**: Night's title with a small torch beside the word and its
  warm light on the stone.
- **Readability**: the pools stay faint over walls, so every player keeps their colour —
  checked at eight players, with the brightness capped if a colour drifts. Sizes,
  flicker and brightness are config. Faces keep their height, so wipes still line up.
- **Not included**: darkening everything outside the light, which would hide a board
  that building and aiming need whole; torches along the walls, which is clutter.

**Verification** as in 11.8: screenshots of each look in combat and building, both
styles mid-wipe, and every player colour side by side at eight players.

### Formerly PLAN 11.10 UI and effects polish — done

**Agreed with the user 2026-09-28 and done the same day**, while human testing went on.
Display only, like 11.8 and 11.9: no sim, protocol or ruleset change. Anything drawn on
the board is a shared helper in `theme.ts`, drawn in every theme's colours, as the
aiming cursor is; anything timed is a pure function with tests, since headless Chrome
cannot check it; tunables go in `art.default.json`. In this order:

**U1 — The HUD, readable at eight — done** (ARCHIVE 11g). The eight-player
screenshots wrapped each roster entry onto three lines and "round 3 / 10" under the
timer.

- A compact roster at six to eight players: icons for castles, guns and lives rather
  than words, a narrower entry, the team layout checked the same way.
- Scores that move: the roster's numbers count up as points bank, as the island banners
  already do, and rows slide into a new order rather than jumping.
- The clock louder at the end: the big timer figure in the sea pulses and turns red over
  the last seconds of a build phase, as the clock's cue sounds.
- Checked with screenshots at two, four and eight players, free-for-all and teams of two.

**U2 — Combat aids — done** (ARCHIVE 11g).

- Reload rings: a thin ring round each of the player's own guns filling as its shot
  flies, and a brief flash when it is ready — flight time is the reload, and nothing on
  the board says which guns will fire.
- An aim line: while aiming, a faint line from the ready gun a click would fire to the
  cursor, chosen by the rule the game uses, so it is never wrong.
- **Not breach markers**: dropped by the user, who found them very distracting when they
  were tried before — the gap marks removed after the first human play (§7).

**U3 — The end of a match — done** (ARCHIVE 11g). A summary under the fireworks: per player the score,
castles held, wall destroyed and lives spent, and a small chart of every player's score
round by round, so it shows where the match was won. From the events the client already
receives.

**U4 — Banners in the arriving look — done** (ARCHIVE 11g). The phase banner is one dark band with gold text
in every style, though it is exactly where the look changes. Each style gets its own: a
neon strip for Cyberpunk, a parchment ribbon for Parchment, a drawing's title block for
Blueprint, flat colour for Minimal; Pixel art and Night keep today's. A record over every
style, as the titles are, so a new style must bring one. The wipe's geometry does not
change.

**U5 — Before the match — done** (ARCHIVE 11g).

- The lobby's map in the chosen build look's colours, not plain ones.
- Castle choice with more to it: the castles to choose pulse softly, and each player's
  choice is marked on their island as they make it.
- An effects setting in the menu, full or reduced, saved with the looks: reduced turns
  off the shake, the flashes of the sweep and the title's repeating sweep, for anyone who
  wants that without changing their system's reduced-motion setting.

## 11i. The second visual pass, W1: fixes found in the screenshots

The first package of PLAN 11.11, all four found in the screenshots taken to plan it.

- **Blueprint's stray line.** A thin stroke ran from near the top-left of the window
  across the first island, in every build-phase capture. Pixi v8 starts each path at the
  last point of the one before, and `arc` joins its start to the current point by a line,
  so the dashes of an inert gun's ring — each a bare `arc` — were joined to wherever the
  previous path had ended. Each dash now moves to its own start first; so does the gun
  being placed, which had the same fault, and Parchment's broken wax seal, whose rim was
  drawn from its centre and carried a spoke.
- **Blueprint's inert guns** were a one-pixel dashed ring in dark rock, all but invisible
  on the sheet; they are drawn in the owner's ink at the style's line width.
- **Parchment's sea was the land's paper**, a shade darker, told apart only by the ink of
  the coast. It is washed a faded grey-green, as old maps colour their seas; the land
  keeps its warm paper. A palette change alone (`stylePalettes.parchment`).
- **Parchment's compass rose** sat under the big timer and muddied its figures. It goes
  to the bottom-right corner, the one the HUD leaves alone (`roseSpot`, tested). The
  first try measured the corner from the sheet drawn round the map, which runs past the
  window, and the rose came out half off-screen at two players and wholly at eight; the
  margin below the board is also shallower than the one above it by the HUD's inset. The
  view now carries the canvas size, and the rose is placed in the sea actually on screen.
  Seen at two, three and eight players.

## 11j. The second visual pass, W2: the pixel style upgraded

PLAN 11.11 W2, in the pixel theme and so in Night, which is that theme under its own
palette. Display only; the new tunables are `art.pixel` and three under
`generators.terrain`.

- **Castles** were a tinted box with a gate. The sprite is a curtain wall round a paved
  court, a round tower standing at each corner, a keep under a hipped roof lit from the
  north, and a portcullis in the front face, at the same face height as before so the
  wipe still lines up. The windows are dark in the sprite and lit over it while the castle
  is sealed: the sprite is multiplied by its owner's colour, so a warm light drawn into it
  would have come out green on one island and grey on another.
- **Guns** were a dark disc under a turning barrel. They stand in a pit of dressed stone,
  on a wooden carriage — cheeks, transom, a wheel either side — that turns and recoils
  with the barrel, generated at every step and recoil frame as the barrels are. The wood
  is its own sprite and untinted, since wood in the owner's colour stopped reading as
  wood; the pit's rim and the iron barrel carry the colour.
- **The coast.** The sand was three ragged pixels inside a shore tile tinted as hard as
  the grass beside it, which made every coast a coloured rim. The beach is now a sprite of
  its own, over the grass, tinted only faintly. Corners are rounded inside their tiles
  (`coast.ts`, tested): cut back where the land turns outward, with the sea drawn beneath
  the tile, and filled in where it turns inward, with a fillet of beach in the corner of
  the sea tile, the two measured to one arc so the beach runs across the seam without a
  step. **A fillet goes only where three tiles of land close round a corner**: two
  meeting at a point are not joined, since the escape flood is 8-connected and the sea
  passes between them — a fillet there would draw a seal that is not.
- **The sea** repeated one tile everywhere, and its flecks made a visible grid. Tiles now
  come in variants (`waterVariants`), scattered by a hash, each with flecks of its own that
  no longer change frame to frame. Glints wink at a rate per tile of sea, and crests form
  on open water at least three tiles from land and drift with the wind. **The first
  crests were little arcs and read as gulls**; a crest is now a lit dash over the shade of
  its trough.
- **Cloud shadows** drift over everything, wrapping round the area drawn. **The first
  were dark smudges** — small, round, too dark — and read as dirt on the sea; they are
  now twice the size, wider than tall, fainter, and softened by six rings a blob.
- **Reduced motion**: the clouds stand still, and there are no glints, which flicker, or
  crests, which drift. **Night** has no clouds, having no sun; its glints are moonlight.
- Seen at two, three and eight players, both styles, close up and whole.

## 11k. The second visual pass, W3: living land

PLAN 11.11 W3, in every style. Display only; tunables in `art.scenery` and `art.pixel`.

- **Scenery** (`scenery.ts`, tested) is placed from the match seed alone, so both looks put
  a tree on the same tile and the wipe does not move it: copses of broadleaf trees or
  pines, thinning to bushes at their edges, and lone trees, bushes and boulders. Only
  inland — a tree on the beach looked washed up — and not on or beside a castle.
  **Fields**, in the plan, were left out: a flat patch of colour is what sealed ground is.
- **Cleared for good.** A tile loses its scenery once anything is built on it or it is
  sealed, and keeps nothing after — so no tree grows back through a breach, and a look
  holding the enclosure through combat clears no differently in the end. Each look keeps
  its own tracker, since a hidden look is only redrawn as a wipe reveals it.
- **The puff** comes only from a piece landing, which the scene tells the looks on screen
  before their redraw; a tracker puffs only for what it last drew. Clearing on the redraw
  alone would have had a hidden look, revealed, throw up every tree cleared while it was
  away. Pixel art and Night knock trees into leaves and boulders into chips; the styles
  drawn from shapes share `ClearingPuffs`.
- **Readability, found in the screenshots**: Blueprint's first tree was a circle with a
  cross — a gun's survey mark in small — and is a landscape plan's scalloped canopy now;
  Pixel art's first boulder was a round grey rock, the double of a cannonball in flight,
  and is two low, earthy stones with moss on them. Cyberpunk's nodes are dim and neutral,
  since on that board brightness means structure and colour an owner.
- **Ocean life** (`pixel/ocean.ts`, tested), in Pixel art and Night: a boat under sail
  crossing a row of open water now and then, gulls wheeling with their shadows on the
  water, a fish jumping. All of it outside the box round the land by a tile, where no shot
  flies, on screen and out from under the HUD — for which the view now carries the HUD's
  inset. None under reduced motion.
- Seen in every style at three players and in Pixel art at two, close up.

## 11l. The second visual pass, W4: atmosphere

PLAN 11.11 W4. Display only; tunables in `art.pixel` and `art.cyberpunk`.

- **The day by round** (`daylight`, tested): morning gold as a match opens, plain noon
  light, sunset at the last round, coming round every ten rounds when there is no cap.
  **A tint on the ground and sea only**, in the territory layer under the walls — the
  rule the torchlight taught, since a wash over everything shifts every player's hue.
- **Weather per match** (`weatherFor`, tested), from the seed and `weatherOdds`: clear,
  overcast (two and a half times the clouds, darker, a grey cast on the ground), rain
  (overcast, with streaks slanting on the wind over everything and rings on the sea) or
  fog (pale banks drifting where the clouds' shadows would). None at Night, and no rain
  under reduced motion. Seeds 1, 2, 5 and 7 give rain, fog, clear and overcast, which the
  screenshot scenes use.
- **Night's sea**: a lighthouse off the outward corner of every island — the one farthest
  from the middle of the map, on the sea tile diagonally beyond its land, so nothing is
  ever built under it — whose beam turns over the water, lit into the ground layer like
  the torches' pools. A path of moonlight on the outer ocean: **first kept above the
  land, where at three players it sat under the HUD bar and was never seen**; it takes
  the deeper band now. Fireflies wander and wink over the land. Its glints, from W2, are
  the stars on the water the plan asked for.
- **Cyberpunk**: thin fast rain in the sea's neon, faint enough to read as weather and not
  as a shot, and a wall hit's flash split into magenta and cyan for a moment.
- **Bloom**: the Effects setting gains **High**, full with the glow layers of Night and
  Cyberpunk under a blur filter — the filter the plan for Cyberpunk held back for frame
  rate at eight players, now there for whoever asks. Read as a theme is made, so it
  takes effect from the next match.
- Seen in each weather at three players, at the last round's sunset, and at Night at two
  and three; the rain's movement, the fireflies' winking and the beams' turning need a
  person to see them.

## 11m. The second visual pass, W5: the board, felt

PLAN 11.11 W5. Display only.

- **The sealing preview** (`sealPreview.ts`, tested), a menu setting off by default:
  while the piece in hand fits and would seal ground, that ground is washed and outlined
  in the valid ink. It asks the sim's own `computeEnclosure` with the piece's cells stood
  in as wall, so it cannot disagree with the rules (the lesson of 10v), and counts anyone's
  ground, for a piece laid on a teammate's island. The ghost is asked for every frame, so
  the answer is kept until the tile, the piece or the board changes. Unlike the gap marks
  removed after the first human play it shows what a move would do, not which move to
  make — but it is information, so the testers are to judge it before it is ever on.
- **A gun set down** is told to the looks as a landing, so it settles as a piece does and
  each style's own dust or sparks, and the scenery under it, go with it — no new hook in
  every theme.
- **The held piece** casts a soft shadow to the south-east and swings a quarter turn into
  place as it rotates (`GhostMotion`). Pixel art draws its piece as sprites, so its shadow
  has a Graphics of its own beneath them.
- **A knockout** (`RuinSmoke`): the island's castles burn for eight seconds and smoke for
  the rest of the match, in every style; Pixel art and Night fly the flags at half-mast,
  struck dark. **The first smoke was dark and vanished on the greyed island**; it is pale.
- **Wall chunks** in Pixel art and Night: four per block shot away, thrown out, bouncing
  once, lying with their shadows while the breach smoulders.
- **Blueprint's draftsmanship**: an eraser's smudge where a block was shot away, for the
  round and under the walls, so a block drawn in again covers it (the ink stains' lesson,
  11g); pencil strokes over a piece just laid, fading as it is inked.
- Seen: the knockout at round five, half-mast and smoke. The preview, the swing, the
  chunks' bounce and the pencil need a person, and a mouse.

## 11n. The first compiled test feedback: five small fixes

PLAN 11.12, the part done at once. All client-side; no sim, protocol or ruleset change.

- **The lobby's Copy button did nothing** over a LAN address (reported from Linux Mint).
  The clipboard API exists only in a secure context — https or localhost — and the call
  was written `navigator.clipboard?.writeText(...).then(...).catch(...)`: with the API
  absent the optional chain skipped the whole expression, fallback included, so the click
  had no effect at all. It now checks for a secure context first, falls back to selecting
  the code and `execCommand('copy')`, which plain http still honours, and only then leaves
  the code selected to copy by hand.
- **"1 team life left" beside two pips.** The `player_continued` event carries the
  continues left in the pool; the roster's pips count those plus the life being played,
  and the banner printed the raw number. Not a team fault — free-for-all said the same.
  The banner now counts as the pips do; "last life" at no continues was already right.
- **The reload ring could not be seen**, and was read as appearing only after the shot
  landed. It always filled over the shot's flight, which is the reload; it was a 1.5 px
  line hugging the pit, under the barrel and smoke in Pixel art. Now thicker, a little
  further out, over a dark halo, with a stronger track. Seen firing in Pixel art,
  Minimal, Parchment and Cyberpunk, rings part-filled on every gun in the air.
- **No hidden keys**, the user's rule: "press R to play again" (which in fact went to the
  menu) is a **Back to menu** button, and M's mute is gone too, the corner's Sound switch
  doing that job. The end screen is a node of its own rather than part of the markup the
  HUD rewrites each frame, since a button replaced between press and release never
  receives the click. R and E still turn the held piece, as a listed control.
- **The name is remembered** in the browser, as the looks are; `?name=` still overrides.

## 11o. Pockets count, as in the original (F1)

PLAN 11.12 F1, reported from the test sessions: walled ground with no castle in it was
refused as territory, which the original did not do. Now a sealed region on a player's
island holding no castle is their territory for every purpose — guns stand and fire
there, its tiles score — while that player holds a sealed castle anywhere. Decided with
the user: per player (a teammate's castle does not make your pocket count), and a pocket
never saves a round, so the life rule is untouched.

- **One change in the sim**: `computeEnclosure` now counts sealed castles before it owns
  the regions, and gives a castle-less region to its island's player when they are in and
  hold one. Scoring, cannon placement, inert guns, the bots and every client view read
  `territory`, so they follow with no change of their own. The old comment defending the
  rule — a bare 2x2 "cannon that can never be silenced" — was not true: a pocket's wall
  is shot like any other, and now its guns also fall silent with the last castle.
- **A ruleset switch**, `enclosure.castlelessRegionsCount`, on by default. The ruleset
  changed shape, so protocol 9; recordings made before replay against their own commit.
- **Tested** as pictures: a pocket with a castle sealed elsewhere is territory and arms its
  gun; breach the castle and the pocket goes with it; island 2's pocket is not made to
  count by island 1's castle; the switch off restores the old rule; pocket tiles score
  with the rest, and a pocket alone spends a life.
- **Measured**, three gunners, twelve seeds, the rule on against off: sealed 1.01 / 1.02,
  active guns 4.8 / 4.9, idle 20% / 19%, territory 51 / 51, every match to the cap either
  way. The hashes differ, so the rule engaged, but the bots barely meet it: they never
  wall a pocket on purpose. The balance question is how people use it, which the test
  sessions will show; teaching bots to (PLAN 11.6) is where the soak would move.
- The client's seal flood already started a region no castle or held ground reaches from
  its own first tile, so a new pocket floods like any other ground.

## 11p. Pause (F2)

PLAN 11.12 F2, for the test sessions: anyone at the table may pause, anyone may resume,
with no limit on count or length. Esc does it — the one keyboard shortcut the user
accepted, being what games use — and so does a button beside the Sound switch; an overlay
says who paused, with a Resume button. Protocol 10: a `pause` request and a `paused`
broadcast naming who.

- **The server steps no ticks while paused.** Every timer in the match counts ticks, so
  that one check stops everything at once — bots, phase clocks, the grace before a bot
  takes a dropped seat — and the recording gains nothing, so a paused match replays
  exactly. Resuming zeroes the room's accumulator, so the pause is not paid out as a
  burst of ticks; the client does the same with its own.
- **Moves sent while paused are dropped**, not queued to land on resuming with a plan made
  against a frozen board. The test shows the control: the same castle choice, sent
  unpaused, lands.
- A player reconnecting mid-pause is told it is paused along with their snapshot. A pause
  made by somebody who then drops holds until anyone resumes, which is the rule anyway.
- **Offline**, not advancing the local match is the whole of it: the bots think inside
  `advance`, and a local recording writes only stepped ticks.
- Checked in a browser: a local match's clock held at 19.2 s through two seconds of pause,
  and Resume, the button and Esc each toggled it; and over a real server with two people,
  Bo's Esc paused both screens ("Bo paused the match" on Ada's, "You paused" on Bo's), the
  clock held on both, and Ada's Resume cleared it for both.

## 11q. The open games browser (F3)

PLAN 11.12 F3, the last of the first feedback batch: why read out a code when the menu
could list the games? Decided with the user: public by default, a Public / Private switch
beside Play (a room is made the moment Play is pressed, so that is where the choice
goes), solo tables listed like any other — to play alone undisturbed, make it private —
and only rooms not started with a seat free. Protocol 11: `create` carries `public`.

- **Over plain HTTP**, `GET /api/rooms`, since the menu has no socket; the reply carries
  the protocol, and a page on another one shows no list rather than rooms it could not
  join. Under the dev server `/api/rooms` answers with the page, which does not parse, so
  the section stays hidden there, as the lobby falls back to a local table.
- **Refreshed every three seconds** while the menu is up, rewritten only when it changed,
  so a Join button is never replaced under a pressed mouse.
- **A stale Join**: `join` is refused `room_full` for a room full or started and
  `no_room` for one gone; either now returns to the menu with a line saying so, over a
  list fetched afresh, instead of the error page.
- Checked over a real server with six pages: a public table listed in another's menu
  with host, seats and rounds, a private one not; Join from the list landed in the same
  room and the host's lobby showed the newcomer; a room filled by code while another page
  still listed it sent that page back to the menu with the notice, and the next refresh
  no longer listed it.

## 11r. The second visual pass, W6: moments

PLAN 11.11 W6. Display only; tunables in `art.camera`, `art.summary` and
`effects.finalStampMs`.

- **The camera** (`camera.ts`, tested) is a container under the stage holding both looks'
  roots, zoomed and moved together. The wipe's masks stay on the stage outside it, since
  the banner's line is in screen space; `screenAt`, `tileAt` and `rowAt` go through it,
  so HTML over the board and clicks stay exact. The view is kept inside the fitted
  window, where there is board. It moves only while nothing is playable, and not at all
  under reduced motion.
- **The opening**: close on the viewer's island (2.4×) for the first 30% of the opening
  intermission, then out to the whole map as the banner crosses, a pure function of the
  sim clock so a client joining part-way is where it should be. **"You are here"** stands
  over the island from the first frame until a castle is chosen. Its first text was the
  player's own colour, and crimson on the dark box did not read: light text in a border
  of that colour.
- **Game over**: a push onto the winners over seven seconds. **First brought to the middle
  of the screen, the winner sat behind the summary**; it now grows about where it stands,
  the others drifting off the edges.
- **The final round**: the banner before its combat is headed "Final round" with "Fire!"
  under it (the small "Final round" line it replaces); a stamp lands across the board as
  the round opens; the round counter reads "final round 10 / 10" in the accent; and a
  faint warm dusk holds at the screen's edges until the end, in every style — Pixel art's
  sunset was its own — and never over the board's middle, so no colour moves.
- **The filmstrip** (`filmstrip.ts`, tested): at every resolution the client sees, the
  board a pixel a tile — sea, land, sealed ground washed in its owner's colour, walls in
  it, castles and guns in its dark shade, rubble grey — kept in the `MatchLog`, turned
  into an image once, and shown under the chart, numbered by round, scaled by whole
  pixels.
- Seen: the opening close with the marker, mid-pull under the banner, and the castle
  choice with the marker still up; the stamp over a final round's combat; the push at
  game over clear of the summary; a five-round watched match's strip of five, the fourth
  showing an island wiped by a lost life. The pull and the push themselves need a person.

## 11s. The second visual pass, W7: the UI in each look

PLAN 11.11 W7. Display only; tunables in `art.menu`.

- **The HUD in each look** (`HUD_SKIN` in `hud.ts`, a record over every style, as
  `BANNER_CLASS` is): the bar, clock, round label, time bar, piece box, cannon count and
  hints read CSS variables on `#hud`, and each skin sets them — Minimal flat under a hard
  gold rule, Cyberpunk near black under a glowing cyan rule with its phase in magenta
  neon, Blueprint a gridded title block ruled double, Parchment a strip of paper lettered
  in ink, where the dark monospace bar had sat worst; Pixel art and Night keep the dark
  bar with gold. The HUD takes the arriving look's skin as a banner starts, since the bar
  is at the top of the screen and above the line is always the new look.
- **The bar had overhung the board by a fifth**: grown to its content it was about 85
  pixels where the board leaves it 64, which the old see-through gradient hid and the
  first solid skin showed at once, its rule twenty pixels below the time bar. It is now
  exactly 64, its rule inside.
- Team letters and the dividers between teams take the skin's accent: the shared gold was
  faint on Parchment's paper. Parchment's hint, which sits on the board, gets a pale
  ground under its ink.
- **The lobby's map breathes**: surf along every coast rises and falls a little out of
  step tile to tile, and the castles brighten together and back (`surfAt`,
  `castleBreath`, tested). Redrawn each frame while the lobby is open — the canvas is
  resized only when its size changes — and still under reduced motion.
- Seen in every style at three players, at eight and in teams of four in Parchment, and
  the lobby's map in two frames a second apart. The eight-player roster's last entry runs
  past the right edge at 1280 pixels, as it did before this; noted in PLAN 11.5.

## 11t. The eight-player roster, made to fit

Seen in the W7 screenshots and older than them: at eight players in free-for-all the
roster's last entry ran past the right edge — measured, 44 pixels at 1280 wide and 86
with sixteen-character names and four-digit scores; 300 and 342 at 1024, a player or two
wholly off the screen. Tightening the gaps would have fixed only the screenshot. Of three
options offered — a compact entry that fits by construction, two rows of four, a side
panel past four players — the user chose the first.

- The compact entry (past four players, free-for-all only) carries what changes: score,
  castles, guns firing (the total on hover) and lives as one pip and a count, red on the
  last, where a pip a life cost the most. Names past nine characters are cut short; the
  whole name and everything in words are on hover.
- The roster may shrink, its gaps and text scale down on narrow windows, and it clips
  rather than ever drawing past the edge.
- Measured the way the fault was, the worst case written into the roster and read in the
  same instant: nothing clipped at 1024, 1280 or 1920. Names at eight characters instead
  of nine changed nothing — the status line is the widest — and trimming the icons'
  margins and the gaps' scaling closed the last seven pixels at 1024.

## 11u. The second visual pass, W8: Toy bricks

PLAN 11.11 W8, the last package, which completes M12. A seventh style for either look,
built from shapes like Cyberpunk, Blueprint and Parchment on the shared wall geometry, so
its walls stand to the pixel style's height and a wipe lines up. Agreed with the user:
shapes rather than sprites, a faint stud on the sea so it stays calm, bright studs on
the land, a light plastic sheen and no weather, and "Toy bricks", never a trademark. The
pixel style's shown name became Medieval in the same stretch, its id unchanged.

- **Everything a style brings**, which the types list the moment the name is added: the
  theme (`bricks.ts`), a palette of its own (green and blue baseplates, grey stone; the
  shared player colours are bright and clean already, so no ramps), a title (the word in
  studded bricks, a letter a player's colour), a banner (a long yellow brick with a row of
  studs), a HUD skin (a blue baseplate under a yellow rule, the piece box with rounded
  plastic corners) and a menu name.
- **Readability, from the first screenshots**: the studs on walls were in the bricks' own
  colour and barely showed, and are in the lighter shade; sealed ground, smooth tiles over
  the studs at 0.55, came out brownish and faint over the green, and is at 0.8.
- The invalid piece is hollow, a red outline with a cross in each cell, and an invalid
  gun struck through — the lesson of Cyberpunk: a red brick would be the crimson player's.
- Seen: building and combat at two and three players, the player's shots in the air, a
  close look at walls, guns, a castle and sealed tiles, a wipe from Medieval, and the menu
  title split with Minimal. Scenes in `screenshots.sh`. The click, the tumbling bricks and
  the bounce need a person.

## 11v. The reload at the cursor

From the test sessions, after 11n had made the rings round each gun visible: they were
still little use, since nobody aiming has time to look at their own island. What a
player wants is to know, while aiming with every gun in the air, when a click will fire
again. So:

- **With no gun ready, a ring round the cursor fills** as the next gun reloads — the one
  whose shot lands first (`nextReload` in `controls.ts`, tested: the soonest landing as
  a share of its flight, nothing while a gun is ready or none could fire, only the
  player's own active guns) — in the player's colour over a dark halo, from the top. It
  sits at the ready crosshair's radius, so as it closes it becomes that ring; the small
  struck-through ring inside it still says "not now". The ghost carries it, computed
  with the frame's tick fraction so it fills smoothly rather than a tick at a time.
- **The rings round each gun are gone**, with their flash, from all seven styles and the
  config (`readyFlashMs`).
- Seen in a browser: with all seven guns in the air, the cursor at "0" and its ring four
  fifths round. Getting there took some care: shots aimed near the channel land within a
  second, so the window with nothing ready is short — which is exactly when the ring is
  wanted — and clicks in one tick claim one gun.

## 11w. Finished work moved out of the plan (2026-09-29)

PLAN keeps only open work, so its finished sections moved here as they stood, under their
old numbers, which commits and the entries above cite: the second visual pass (M12,
entries 11i–11m, 11r, 11s, 11u) and the first batch of test-session feedback (11n–11q,
11t, 11v).

### Formerly PLAN 11.11 Second visual pass — done

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

**W2 — Medieval upgrade — done** (ARCHIVE 11j): castles with towers, a keep and lit
windows; guns on carriages in stone pits; beaches and a rounded coast; a sea without a
grid, with glints and crests; cloud shadows. Night took all of it but the clouds.

**W3 — Living land — done** (ARCHIVE 11k): scenery on open land in all six styles,
cleared by building and sealing; boats, gulls and fish on the outer ocean in Medieval
and Night. Fields were left out: flat patches of colour read as sealed ground.

**W4 — Atmosphere — done** (ARCHIVE 11l): the day by round and weather per match in
Medieval; the moon's path, lighthouses and fireflies at Night; Cyberpunk's rain and
colour split; bloom behind a new High Effects setting.

**W5 — The board, felt — done** (ARCHIVE 11m): wall chunks, Blueprint's smudges and
pencil, guns set down as pieces are, the piece's shadow and swing, knockout smoke and
half-mast flags, and the sealing preview behind a menu setting, off by default — **for
the testers to try** before it is ever on by default.

**W6 — Moments — done** (ARCHIVE 11r): the opening on your own island, marked "You are
here", pulled out to the map; the final round's banner, stamp and dusk; the push onto the
winner; the summary's filmstrip.

**W7 — The UI in each look — done** (ARCHIVE 11s): the HUD bar, clock, piece box and hints
dressed per style (`HUD_SKIN`); the lobby's map breathing.

**W8 — Toy bricks — done** (ARCHIVE 11u, §7): a seventh style, for either look.

### Formerly PLAN 11.12 Test-session feedback, first batch — done

Eight items from the user's compiled feedback. Five small ones are done (ARCHIVE 11n): the
lobby's Copy button over plain http, the lives count on the life-lost banner, reload rings
that can be seen, a button in place of the R key at the end of a match (with M's mute
removed too — no hidden keys), and the player's name remembered. Then, in order:

**F1 — Pockets count — done** (ARCHIVE 11o, §1.3): sealed ground without a castle is
territory while its player holds a sealed castle, behind `enclosure.castlelessRegionsCount`.

**F2 — Pause — done** (ARCHIVE 11p, §6): anyone may pause and anyone resume, by Esc or
the button beside the Sound switch; the server steps no ticks while paused.

**F3 — Open games browser — done** (ARCHIVE 11q, §6): the menu lists public rooms still
being set, with Join; a Public / Private switch beside Play decides as the table is made.

## 11x. Bots as a level and a personality (11.6, phase 1)

The first phase of PLAN 11.6: the split, with no change of play. Done in two steps, the
model and then everything that shows it, each checked the same way.

- **The model** (`ai.ts` in config): a level table of anchors — Levels 1, 2, 5, 8, 10 —
  interpolated between, and risk traits; `botProfile` compiles a level and a personality
  into the profile the bot already read, so its play code did not change. Gunner and
  marshal differ in judgement (0.8 against 1.0), so `riskMargin` stays with skill and
  risk scales it; balanced reproduces both, and baron is Level 8 offensive exactly.
- **Sloppiness**, new, in skill: below Level 5 a bot sometimes takes its second-best fit
  for a piece, and chooses its castle and gun spots carelessly as the recruit alone did.
  The random stream is drawn only where there is sloppiness, so careful levels are
  untouched. The recruit's other habits — one castle, a random target — were personality
  hiding in a tier, and went: Level 2 is a weaker balanced bot.
- **The surface**: the lobby offers Level 1–10 per seat, the ranks and their badges and
  blurbs gone for one line under the seats; `server.botLevel` replaces `botDifficulty`;
  the server and local matches deal each bot a personality from the seed by player
  (`dealPersonality`), a person's seat included for the bot that covers a drop; the
  recording header carries level and personality, and old recordings naming a tier still
  read (`setupOfRecorded`); the statistics' `difficulty` column became `level` and
  `personality`; `?level=` and `?personality=` for local matches, `--level` and
  `--personality` (or `dealt`) for the harness, whose soaks stay balanced unless asked.
  Protocol 12. Local bots are named "Bot N", as a room names them.
- **Checked twice**: gunner, marshal and baron tables, six seeds each, hash-identical
  before and after the model, and again through the new flags after the surface. A test
  caught a pattern mangled on its way through the shell — the personality parser split
  on the letter "s" — before anything used it.

## 11y. General tactics for every bot (11.6, phase 2)

Four tactics from the user's play, each measured at three players over seeds 1–36 at
Level 5 and Level 8 (the old gunner and marshal) before and after. One kept, one found
already there, two dropped.

- **Guns toward the enemy was already there**: gun spots compare never-pinned, then room,
  then distance to the nearest enemy castle (10p). Nothing added.
- **Close gaps from the outside — kept, while repairing.** Fitting a piece penalised
  spill onto sealed ground, but inside a broken ring nothing is sealed, so the case the
  user named went unpenalised. First applied to every plan, with the ground the plan
  would seal standing in for territory: room for guns rose 24% at Level 5, but walls came
  out 14% thinner and forfeits rose 10.4% -> 12.7%. An expansion's whole interior had
  counted as inside, including the band outside the current wall where thickening goes.
  Applied only while the bot holds no sealed castle: Level 5 forfeits 10.4% -> 10.4%,
  room 2.48 -> 2.90, active guns 5.12 -> 5.24; Level 8 forfeits 13.4% -> 14.3% (within
  noise at this size), room 4.15 -> 4.38, active guns 5.10 -> 5.49, territory points
  97 -> 91, knockouts 1 -> 7 in 36 matches. Walls have fewer tiles (84.6 -> 80.0,
  82.5 -> 73.6), partly by design: blocks that used to spill inside counted as wall and
  stood where guns belong.
- **No unfillable holes — dropped.** Penalising a fit that leaves a wanted tile with no
  free neighbour, once one-cell pieces stop being dealt, changed nothing measurable: the
  holes `repairStuck` counts come from shots, not from the bots' own placements.
- **Thicken the side that takes fire — dropped.** Trying thickening and outer-layer tiles
  nearest an opponent first raised Level 5 forfeits (10.4% -> 11.8% beside the kept
  rule) with nothing gained. Thickening already targets the weakest wall as seen from
  outside, which is where a breach comes through whichever way the shots fly.
- Attributed with a temporary switch per change, not committed, and the final code
  checked hash-identical to the variant measured.

## 11z. Risk and targeting traits (11.6, phase 3)

Decided with the user before coding: targeting rules as proposed, but half the aimed
shots rather than 70%, to feel out first; defensive judged safe as the phase goes rather
than at its start, which follows a barrage; offensive allowed to widen its wall while
repairing, not only to reach for a new castle; castle choice as proposed; every value
dealt evenly. Cannon space stays balanced until phase 4.

- **Targeting** (`traitTarget`, tested in `targeting.test.ts`): point-maximizing takes
  the nearest opponent's wall closest to one of its own guns — shortest flights, most
  shots — and leaves breaching to its neutral share; strategic breaches whoever earns
  most a round (territory times castles), banked score breaking a tie; finisher the
  weakest — fewest lives in the pool, then fewest castles, then the thinnest wall;
  grudge whoever aimed most at its walls last round, from the shots in the air, and the
  neutral rule when nobody did. Each decides half the aimed shots. The weakest-wall
  search is now kept per opponent, since one bot shoots at several.
- **Defensive**: once sealed, thickens until no way in takes fewer than two shots — the
  user's "each enemy-facing wall", read as every wall, since shots have unlimited range
  — or until no piece can, then reaches for the next castle whether or not the phase
  can close it.
- **Offensive**: with a breach its tightest repair closes in 4 blocks or fewer, it
  repairs with the widest roomy wall that fits the pieces left this phase, widening its
  ground in the same repair; otherwise tight first, as the 10s rule says. Then reaches
  for up to four castles, as baron did.
- **Castle choice**: among castles whose roomy wall costs within 20% of the cheapest,
  offensive opens from the one nearest the other castles, defensive from the one
  farthest from any opponent, balanced from the cheapest.
- **Sanity soak**, Level 5, three players, twelve seeds, every seat one trait: no action
  refused, nothing unfinished. Forfeits — balanced 9.4%, defensive 6.1% (walls 114 tiles
  against 80, but 3.8 active guns against 5.9), offensive 17.5% (eight knockouts, four
  matches ended by elimination), point-maximizing 9.4%, finisher 13.5% (three
  knockouts), grudge 11.9%, a dealt mix 11.8%. Balance is phase 5.
- Strategic targeting changed from the old formula, so default bots are no longer
  hash-identical to phase 1's; that check did its work there.

## 11za. Cannon space: pockets for guns (11.6, phase 4)

Agreed with the user before coding: max cannons walls pockets when short of room,
instead of widening its loop, and as spare work before thickening, only once its castle
is sealed; pockets for one gun (2x2 inside) or two (2x4 either way), the cheapest per gun;
at most two; cheapest first rather than facing opponents; secondary asks less room and
thickens first. And, the user's note: a pocket is far easier against a wall already
standing than on its own.

- **`pocketPlan`** (tested): a small interior of free land outside the territory, ringed
  — corners included, since the sea slips through a diagonal join — by the bot's own
  wall where it stands and new blocks where it does not. Reused wall costs nothing, so
  pockets against the standing wall win by construction, and at least two tiles of it
  are required, so none ever stands alone. Beside a ring, a two-gun pocket down its side
  costs ten blocks, five a gun, where one for a single gun costs eight.
- **`pocketCount`**: sealed regions of a player's territory holding no castle — a new
  `pockets` column in the statistics, so the trait is seen working, not inferred.
- **Cannon-space traits** in config: room band, room margin, thicken-first and pocket
  cap. The room band was the constant `ROOM_RADIUS`; its history now sits with the
  setting. Balanced keeps 3 and a margin of two guns; secondary 2, no margin,
  thickening first; max cannons as balanced with two pockets.
- **Sanity soak**, Level 5, three players, twelve seeds, every seat one value: nothing
  refused or unfinished. Balanced forfeits 9.4%, room 2.75, 0.84 pockets — leftover and
  inner walls enclose small castle-less ground already. Max cannons 13.6%, room 3.71,
  1.74 pockets, but active guns 5.71 against 5.86: the gun reward per castle is fixed, so
  the room goes unused while the pockets' walls add to every repair. Secondary 12.5%,
  room 2.90 — worse than balanced where it should be safer; at twelve seeds about two
  standard errors. Both are phase 5's, starting with pockets only when room is short.

## 11zb. Tuning the levels and personalities, and the reveal (11.6, phase 5)

The last phase of 11.6. Three players throughout; a fair share of wins is a third.

- **The guardrail holds for every trait**: Level 5 against two Level 2 bots with the
  same trait won 10 to 12 of 12 for each of the ten values.
- **The ladder climbs**: one seat at a level against two at Level 5, wins of 12 — Level
  1 and 2 none, 3 one, 4 two, 6 five, 7 five, 8 nine, 9 ten, 10 all twelve. Levels 6 and
  7 play alike; 1 and 2 are not told apart by Level 5, which beats both every time.
- **Traits against balanced**, one seat with the trait against two balanced bots, all
  Level 5, wins of 24 (fair 8, a standard error about 2.3): max cannons 10, finisher 7,
  point-maximizing 6, offensive, grudge and secondary 5 each, defensive 2. Only
  defensive was clearly out of line.
- **Defensive, found**: its own rows showed half the active guns of the balanced seats
  beside it (2.7 against 5.9) and less than half their territory points. Its risk scale
  was not it — 1.0 instead of 0.7 changed nothing. Its castle was: "farthest from any
  opponent" means an outer castle hemmed in by sea, with no room for guns. Opening from
  the cheapest castle instead: 6 wins of 24, active guns 5.3, territory points 53. The
  sheltered choice stays in the schema, unused. Offensive's central choice made no
  difference (5 wins against 6 from the cheapest) and stays, as flavour.
- **Offensive widening while repairing does fire**: counted with a temporary counter over
  eight matches, of 2198 breached plans 1170 were small repairs and 1134 of those widened.
- **Max cannons** forfeits more (13.6% in phase 4) for room its fixed gun reward cannot
  fill, but wins a fair share and a little more; left as it is, its swinginess accepted.
- **The reveal** (`revealLines`, `botSetupsFromSeats`, tested): one line per bot under the
  summary — its colour, name, level and personality in plain words. No protocol change:
  the client deals personalities from the seed and player as the server does, and takes
  levels from the table as the host set it, kept from before the start since the room
  renumbers its people once the shuffle has dealt them. A test checks the client's
  setups equal what a local match dealt. Seen at the end of a watched five-round match.

## 11zc. Small things: a sound dropped, grids at 5 and 7, rounder islands

PLAN 11.5, decided with the user on 2026-09-30.

- **`wall_destroyed` dropped**: the impact already has an explosion, and a second cue for
  a wall was not wanted. Gone from the cue list, the manifest and its one trigger; the
  audio test that keeps folder and manifest in step now sees every cue supplied.
- **Bots helping a teammate build**: not to be done — too complicated for too little.
- **Grids at 5 and 7 players**, rings until now: a grid lays islands row by row, so a
  short last row now sits centred under the one above rather than leaving an empty
  corner of ocean; whole tiles, so every island stays congruent. Five players share six's
  footprint (77x48 at seed 1, rounder islands aside) and seven eight's.
- **Islands less boxy**: the field an island is cut from was the distance to its box's
  edge, square corners and all, roughened by noise of about a tile and a half — a
  rectangle with a ragged edge. It is now the distance inside a rounded rectangle
  (`cornerRadiusTiles`), and the noise may move the coast further (`coastlineRoughness`
  up to 2). The roundest shapes tried read as islands, but **the terrain tests caught
  the cost**: rounded islands meet their neighbours at points, with open sea between, and
  at three players the water shared by two islands within three tiles fell from over 80
  to 9 — the ocean between players §1.2 forbids, since flight time is the reload.
  Measured over five seeds per setting, water within three tiles of two islands:
  today's square boxes 216–256 at four players and 94–147 at three; corner radius 6,
  roughness 1.0, noise 0.1 kept 172–256 and 90–123 on a map two tiles larger each way;
  radius 8 dropped three players to 28 on one seed, radius 12 to 8. Radius 6 it is:
  rounded corners and a wandering coast that still faces its neighbours.
- The terrain settings travel in a match's snapshot, so protocol 13; the new field
  defaults to 0 — the old shape exactly — so recordings made before still replay.

## 11zd. Finished work moved out of the plan (2026-09-30)

As 11h and 11w: PLAN keeps only open work, so its finished sections moved here as they
stood, under their old numbers — the small items (11zc) and the bots as skill and
personality (11x–11zb). What the bots left open is PLAN 11.13.

### Formerly PLAN 11.5 Smaller — done

- Nothing open. Done or decided 2026-09-30 (ARCHIVE 11zc): the `wall_destroyed` cue
  dropped, grids at 5 and 7, rounder islands; bots helping a teammate build will not be
  done — too complicated for too little.

### Formerly PLAN 11.6 Bots as skill and personality — done (2026-09-30)

**The next milestone (M13)**, ahead of 11.2's baseline, which is then measured over the
personality mix real matches will contain. Today a tier bundles two things: **skill** —
pace and aim (`placement*Ms`, `fireIntervalMs`, `aimJitter`, `replanTicks`) — and
**personality** — how it plays (`maxCastles`, `riskMargin`, `picksTarget`, `thickens`,
`expandsWhenSealed`). They become two separate things: a skill level the host chooses, and
a personality the bot is dealt.

#### Decided with the user

**Skill: Level 1 to Level 10**, chosen per seat in the lobby, replacing the ranks —
testers found the military ranks hard to read, and levels are the arcade way. Skill is
pure performance: placement speed, fire interval, aim, replanning, and, new, **sloppy
building**: low levels sometimes take a worse fit for a piece, as a hurried person does —
players like to see bots make mistakes. The config holds anchor levels and interpolates
between them, so the table is tuned by editing numbers. **Level 5 is today's gunner and
Level 8 today's marshal** (recruit falls about Level 2), so earlier measurements still map;
Level 10 has headroom beyond marshal. The default seat is Level 5. Recruit, gunner,
marshal and baron retire as names; baron's play survives as a personality.

**Personality: four traits, dealt at random and hidden until the end.** Three values each,
four for targeting — 108 combinations. Drawn per bot from the match seed
(`streamFor(seed, …)`), so local matches and recordings reproduce them, and written into
the recording header with the level. **Revealed at game over** in the summary, one plain
line per bot — "Bot 3 · Level 6 · offensive · finisher · max cannons" — as a surprise.
**Nicknames** for combinations ("the Turtle", "the Raider") are wanted as an option but
not designed yet: plain trait names first.

- **Risk.** **Defensive** secures its main castle first — sealed, thickened, room for its
  guns — and expands to more castles only once everything else is safe and with a wide
  margin of time: it does expand, since castles are a main way to win, just late and
  safely. **Balanced** is today's. **Offensive** repairs just enough, then reaches for the
  next castle at once, up to three or four, accepting tight margins — baron's play.
- **Targeting.** **Point-maximizing** fires at the nearest opponent's walls: flight time is
  the reload, so near targets mean more shots and more points, and any wall tile scores.
  **Strategic** fires at the points leader's enclosures, so nobody runs away with it.
  **Finisher** fires at the weakest player (fewest lives, weakest wall), to knock them
  out. **Grudge** fires at whoever destroyed most of its wall last round, which makes
  rivalries show in the summary; damage per shooter is tracked already.
- **Cannon space.** **Max cannons** walls pockets for guns (§1.3), new: a planner for a small
  region beside its own wall, the fewest blocks that seal it, and guns placed there.
  **Balanced** is today's. **Secondary** puts castles and safety first, a tighter wall.
- **Castle choice**, as flavour following risk rather than a trait of its own: an
  offensive bot opens from a central castle with neighbours to reach for, the others from
  the cheapest. A defensive bot opening from the sheltered corner was tried and dropped in
  phase 5: it had half the guns and won 2 matches of 24.

**Targeting is a share, not absolute.** Each targeting trait sends a configurable
share of shots to its own choice — 50% to start, the user's call — and the rest by the
neutral rule, breach whoever threatens most, so no bot fires everything one way.

**The guardrail.** Personalities may be swingier, or somewhat weaker or stronger than
others; that is flavour. They must not be decisive: **for every trait, a bot three levels
higher wins most matches against one three levels lower** — no trait lets Level 2
reliably beat Level 5. Measured at three players, both seats.

**General tactics for every bot**, whatever its level and traits, from the user's play:

- **Guns not against a wall with sea or wall beyond** — a shot there leaves a one-tile gap
  that is hard to fix. Done (10p, 10s): pinned spots are the last resort.
- **Close gaps from the outside.** Done (ARCHIVE 11y): while a bot holds no sealed castle,
  spill inside the ring its plan would seal counts against a fit.
- **One shot per wall tile** — a second hit on a tile is wasted. Done (10m), counting every
  player's shots in the air.
- **No unfillable holes** — tried and dropped (ARCHIVE 11y): no measurable effect, since
  the holes `repairStuck` counts come from shots, not from the bots' own pieces.
- **Thicken the side that takes fire** — tried and dropped (ARCHIVE 11y): trying nearest-
  opponent tiles first raised Level 5 forfeits. Thickening already targets the weakest
  wall as seen from outside.
- **Guns toward the enemy** — already done: gun spots compare never-pinned, then room,
  then distance to the nearest enemy castle (10p).

#### Phases

1. **The split, no behaviour change — done** (ARCHIVE 11x). Skill levels and personalities in
   `ai.default.json` behind a strict schema; `Bot` built from a level and a personality.
   Personality "balanced · strategic · balanced", with the targeting share at 100% and
   today's formula, must reproduce today's gunner and marshal **hash for hash** in the
   soak — the check team mode used (ARCHIVE 10u). Lobby: a Level 1–10 choice per seat
   replaces the ranks and their badges; `server.botDifficulty` becomes a default level;
   the server and local matches deal personalities from the seed; the recording header and
   the statistics carry level and personality. `?personality=` and a headless flag fix
   them, so soaks and screenshots are not random. Protocol bump.
2. **General tactics — done** (ARCHIVE 11y): closing gaps from the outside, while repairing
   only; guns toward the enemy was already there; the other two were measured and dropped.
3. **Risk and targeting traits — done** (ARCHIVE 11z): all four targeting rules at a 50%
   share, defensive thickening then expanding, offensive widening while repairing, and
   castle choice by risk.
4. **Cannon space — done** (ARCHIVE 11za): the pocket planner, max cannons walling up to
   two pockets against its own wall, secondary asking less room and thickening first.
   **For phase 5**: max cannons forfeited 13.6% against balanced 9.4% with its extra room
   unused — pockets only when room is short is the first thing to try — and secondary
   forfeited 12.5%, to be re-measured at size.
5. **Tuning and the reveal — done** (ARCHIVE 11zb): the guardrail holds for every trait,
   the ladder climbs from Level 1 to 10, no trait dominates, and defensive opens from the
   cheapest castle — the sheltered one cost it most of its guns. The reveal is in the
   summary. **Still open**: nicknames for combinations, if wanted; Levels 6 and 7 play
   alike; max cannons forfeits more for room it does not use, if that ever matters more
   than its fair share of wins; Level 8 knockouts rose with phase 2.

**Carried in from before**: the pockets note (§1.3, ARCHIVE 11o) — bots obey the rule but
never wall a pocket on purpose, which is why turning it on moved the soak not at all; max
cannons is how the soak will finally measure what it does to balance.

## 11ze. The second compiled test feedback (formerly PLAN 11.14)

Eight items from the user's compiled feedback, triaged with them on 2026-09-30 and built
the same day in three groups: bugs, display, then two rule changes, which land ahead of
11.2's baseline.

- **The banner wipe missed the screen's edges** on a high-density display. The masks were
  sized as `renderer.width / renderer.resolution`, but Pixi v8's `renderer.width` is
  already in CSS pixels, so at a device pixel ratio of 2 they covered half the window each
  way and 2/3 at 1.5 — neither look was drawn beyond them until the wipe ended and the
  masks came off. The camera, first suspect, was innocent. `tools/screenshots.sh` runs at
  a ratio of 1, where the two agree, which is why no screenshot caught it: reproduced by
  capturing a wipe at a ratio of 2 with the fix taken out, where both looks stop short of
  the middle, and seen whole with it.
- **"Lives lost 2" for a player who was out.** The summary counted `player_continued`,
  and the failure that puts a player out spends no continue. The column is **lives left**,
  read from the state — the pool plus the life being played, none once out — so it no
  longer depends on the log having seen every event; `MatchLog.livesSpent` went.
- **No clock in overtime** (`showsClock` in `clock.ts`): the HUD's figures and bar and the
  big timer stop at 0 and go, and no tick sounds; a second countdown from 3 had read as
  the build phase starting over.
- **The countdown ticks over five seconds, louder each tick** (`countdownGain`, 35% of the
  cue's volume up to full), while the big timer's beat and red stay at three: heard
  before it is seen, as the user asked. `play` takes a gain for it.
- **The filmstrip is gone** from the summary, with its config (`filmstripTilePx`); the
  user found it did not look good and added nothing.
- **The fireworks show**: the summary is held back for `summary.delayMs` (4 s) and fades
  in, narrower and see-through. Timed in the HUD, not by a CSS delay, which would restart
  whenever the markup is rewritten; traced in a browser, released about 4 s after game
  over.
- **Only your own shots are marked**, in all seven styles through the shared
  `drawShotTarget` — no opponents', no teammates', and no red warning over your own wall
  (the user's call, on both questions); the balls in flight still show, and a spectator
  sees no marks. Bots, to match, skip only tiles their own shots are headed for: two
  players' shots at one tile race, and the second hits nothing. Grudge targeting still
  counts shots arriving at the bot's own walls, which a person sees come in too.
- **The main castle**, as in the original: `cannons.firstRewardForMainCastle` gives the
  first castle's reward only to the castle the player chose, while it is sealed — afresh
  after a continue, which resets every castle — and every other sealed castle earns
  `perAdditionalCastleReward`. The rule is one pure function, `cannonReward`, used by the
  resolution and the bots' estimate alike. Defaults off in the schema so recordings from
  before replay as played; on in the config. Protocol 14. Bots resealing weigh a plan
  that takes the main castle back as one more gun kept; the tight repair still comes
  first. Tested both ways: main breached and another sealed earns one cannon, two with
  the rule off.
- **The crown** (`drawMainCastles`): the user chose a crown badge over a second flag or a
  ring, shown always, sealed or not, since which castle counts double matters most once
  it is breached. One shared helper in the owner's colour with a dark rim, drawn by every
  theme before its shots in flight; 1.1 tiles wide was a little small at three players,
  1.35 reads. Seen in Medieval, Minimal, Cyberpunk and Parchment.
- **Measured**, both rule changes together, three players, Level 5, dealt personalities,
  sixteen matches before and after: forfeits 11.8% -> 9.2%, knockouts 2 -> 0, cannons
  awarded per player-round 2.36 -> 2.22, active guns 5.53 -> 5.69, damage points 39.5 ->
  39.4, territory points 56 -> 63, every match to the cap either way. Nothing beyond noise
  at this size but the expected fall in cannons awarded: bots racing each other's shots
  did not cost them damage.

### Formerly PLAN 11.14 Test-session feedback, second batch — done

Triaged with the user 2026-09-30. In this order; groups 1 and 2 are display only, group 3
changes rules and bots and lands **before 11.2's baseline**, which it would otherwise
invalidate.

**Group 1, bugs.**

- **The banner wipe misses the screen's edges**: during a transition neither look covers
  the whole visible window, and the new one snaps in whole once the banner has gone. The
  masks are meant to span the canvas, margins included; first suspect is the camera (ARCHIVE
  11r), which the masks sit outside. Reproduce in a mid-wipe screenshot before fixing.
- **"Lives lost 2" for a player who is out** in the summary: it counts `player_continued`,
  and the last failure is an elimination, not a continue. The column becomes **lives
  left** — 0 for a player who is out, the pool for a team.

**Group 2, display.**

- **Overtime shows no clock**: the countdown stops at 0 and disappears; overtime is
  carried by the red border and the HUD's wording, with no ticks.
- **The countdown ticks over the last five seconds, louder each tick.** The big timer's
  beat and red stay at three, so it escalates in two steps: heard first, then seen.
- **The summary's filmstrip is removed** (`filmstrip.ts`, ARCHIVE 11r): it did not look
  good and added nothing.
- **The fireworks show**: the summary appears only after a few seconds of fireworks and
  the camera's push, and is narrower and translucent.

**Group 3, rules and bots.**

- **Only your own shots are marked** where they will land — not opponents', not
  teammates', and not the red warning over your own wall; cannonballs in flight stay
  visible. Bots, to match, skip only tiles their own shots are headed for: of two shots
  at one tile the first to land takes it and the points, the second hits nothing. (10m's
  fix, a bot putting its whole salvo into one tile, stands.)
- **The main castle**, as in the original: the castle a player chose is worth two cannons
  sealed, every other sealed castle one. Today the first sealed castle is worth two,
  whichever it is, so this matters only when the main castle falls while another holds.
  After a continue every castle is reset and the newly chosen one becomes the main
  castle. `startingCastleId` already records it. A ruleset switch, so a protocol bump;
  the bots' reward estimate follows, and likely a preference for resealing the main
  castle first. **Its look, simply for a first version**: a marker drawn by a shared
  helper rather than new art in all seven styles (the original gave it two towers
  instead of one).

## 11zf. The third visual pass, X1–X5 (PLAN 11.15)

Agreed with the user on 2026-09-30 from a list of suggestions, after the second test
feedback, and built the same day; X6, a shape per player, is left for the next session,
off the board only. Display only throughout, like 11.8–11.11: no sim behaviour, protocol
or ruleset change. Each package was committed on its own.

- **X1, mouse only and a roster of points and lives** (`c937203`). R and E no longer turn
  the piece; the right button and the wheel do, and Esc for pause is the one key left. The
  roster lost castles and guns — the board shows both — and each player became a card:
  their colour down its edge, the name small over a large score and large pips, the last
  life red and glowing. One layout at every count: eight cards fit at 1024 pixels wide with
  room to spare, where a compact form had been needed. Roster entries now keep their inline
  style when rewritten, which the colour rides on. In Toy bricks the blue player's bar
  vanished into the blue plate; there the bar is drawn inside the card with a light rim,
  since a rim drawn outside was clipped for the first card.
- **X2, information on the board** (`c03aedb`). The crown is the owner's colour while the
  main castle is sealed and stone grey with a crack once breached — the owner's dark shade
  vanished into a castle of the same colour — by each look's own sealed castles, so the
  combat look holds it through the barrage. Hovering a castle while choosing shows its ring,
  from `startingRingTiles`, which the sim now exports and builds the ring with; a test
  checks them tile for tile. Over the countdown's last five seconds an unsealed player's
  castles flash red on every tick (`countdownBeat`). The points banner says the guns earned.
- **X3, ground lost drained** (`c3c50b2`). The seal's flood in reverse: as the "Rebuild"
  banner reveals the board, ground held at the start of combat and lost since is washed
  dark red and runs out through the breach (`drainsFrom`). Started together as the banner
  appeared, the upper islands drained before the lower were revealed, so each island's
  waits until the banner's line reaches it (`releaseDrains`). Seen slowed to a tile a
  second; 6 a second in play.
- **X4, moments and atmosphere** (`6166bd7`). Winners' banners hoisted over their castles
  with the fireworks (`WinnerBanners`); distant thunder in Medieval's rain, a faint double
  flash over the whole board (checked firing at 0.8; 0.13 in play, for a person to judge);
  embers up the screen's edges through the final round, in HTML beside its dusk.
- **X5, Medieval light** (`165a8db`). Snow as a seeded weather — flakes, and white on the
  tops of walls and castles, kept under reduced motion. Adding it moved which seed gives
  which weather: 1 rain, 2 snow, 3 fog, 5 clear, 21 overcast. Shadows follow the day
  (`shadowCast`): long and leaning west in the morning, the old fixed shadow at noon,
  longest and leaning east at sunset. Walls and castles on a south coast are mirrored
  faintly in the sea below, rippling, warm with torchlight at Night.
- **Found along the way**: a white band across the board in screenshots of a banner's
  crossing, recorded once before in 11g, is headless Chrome capturing a stale strip where
  the banner had just been — the page holds nothing there. And the second test game's
  feedback before the pass: the Holding / Next piece box and the hint line removed, the
  crown centred on its castle, the summary opaque with lifted grey (`d4ef940`).

## 11zg. The online delay on every click

From the third test session: two 2v2 matches over a LAN, a Linux and a Windows machine,
the server on the Linux one, each machine hosting once. **Both times the host felt a
constant delay under a second between a click and its effect**, the whole match long; the
player who joined felt none, and played as offline.

- **The cause was the client's pacing, not the network or the server.** `NetworkMatch`
  plays confirmed ticks at the page's own clock and caught up on a backlog only past 60
  ticks. A backlog under that never shrank, and a click lands on the server's tick but
  shows only once the page has played its way to it. The backlog came from the opening:
  between the snapshot and the first frame the page builds the board and both looks'
  sprites, about a second during which commits arrive and are never made up. A frame over
  250 ms, whose time is capped, adds to it in the same way.
- **Reproduced** with a real server and two headless pages, host and guest in a 2v2 room:
  20–28 ticks behind on both, steady for the whole run, the first game frame about a
  second after the snapshot. The status line beside the ping said so all along, in 11 px
  grey at the HUD's bottom right, where nobody looked.
- **The fix**: anything beyond `CATCH_UP_MARGIN_TICKS` (2) is played in the frame it is
  found, as anything past 60 was. Two ticks so that commits arriving in pairs still play
  at the page's own pace. Tested by feeding a match commits faster than it plays them —
  the old code fails both catch-up cases — and by the same two pages: no longer behind.
- **Why only the hosts is not explained.** Nothing in the room or the client treats the
  host differently once the match starts, and in the reproduction both pages lagged
  alike. A backlog that once passed 60 ticks was cleared outright, so whatever spared the
  guests, the fix removes the delay either way. To be confirmed at the next test session.

## 11zh. A shape per player (X6, PLAN 11.15)

The last package of the third visual pass. Display only: no sim, protocol or ruleset
change. Decided with the user before building: plain geometric shapes; **one per team in
a team match**, so a colour-blind player can tell the teams apart, teammates still told
apart by shade; beside the seat's number in the lobby, not around it; and, beyond the
roster, island banners, lobby and summary already planned, on the "You are here" marker
and at the ends of the summary chart's lines. The bots' reveal and the team tags over the
islands were offered and left out.

- **The shapes are config** (`art.playerShapes`, by player): circle, square, triangle,
  diamond, star, plus, hexagon, inverted triangle, from an enum the schema checks, none
  twice, and at least one per allowed player — the check the palettes have.
- **Dealt as the colours are** (`matchShapes` beside `matchPalette`, sharing its test of
  what makes a team match): by player id in free-for-all, by team id in a team match, so
  Team A, the lobby's first column, has the circle. The lobby's preview deals them by the
  same rule, and a test checks every seat's shape against the local match's.
- **Drawn from paths, not a font** (`SHAPE_PATHS`, a 24-unit box): inline SVG in the HUD,
  `Path2D` on the lobby's canvas. The test sessions run Linux and Windows, whose fonts draw
  ▲ and ★ differently. Each carries a light rim, so a dark colour's form reads on the
  dark bar.
- **In the roster** the shape leads the figures, as large as the pips, the team's in its
  head; in the summary it replaces the colour square, the team's before its name, while
  members keep their squares.
- Seen at eight players in free-for-all and in teams of two, in the lobby at eight, on the
  marker, on a life-lost and two points banners, and on the summary of a five-round match
  with its chart. Two lines ending on nearly the same score overlap their marks; left. The
  screenshot script gains `shapes-eight` and `shapes-teams`. Fixed waits drifted too far
  in headless Chrome for the banners and the chart, so those were caught by waiting for
  the elements themselves.

## 11zi. Personalities from a bag, and small items (2026-10-01)

- **A table's personalities are mixed**, the user's suggestion: each trait was drawn
  independently per player, so two bots at a table of three shared a risk one time in
  three. `dealPersonalities` deals the whole table from one stream of the seed, each trait
  from a bag of its values, shuffled, drawn without replacement and shuffled afresh when
  spent — so no two bots share a value until a bag is out (three risks, four targetings,
  three cannon spaces). **Bots draw first**, then the people's seats, whose personality
  is only for the bot covering a drop: drawn in turn, a person between two bots could
  empty a bag and let them repeat. The room, a local match, the client's reveal and the
  harness's `dealt` all call it, and tests pin the room's deal and the reveal's to it.
  Recordings carry their bots' personalities in the header, so old ones replay as played;
  a soak with `--personality dealt` deals differently from before.
- **The sealing preview is always on**: the test sessions found it helpful, so the menu
  switch and its saved setting went.
- **Dropped from the plan**: nicknames for personality combinations, not worth the work
  for so small a gain, and game speed as a lobby setting — the game is played at one
  speed. The milestone table's "one sound to come" was stale since `wall_destroyed` was
  dropped (11zc).

## 11zj. The connection where it is seen, and a leaking ping

- **A badge beside Pause**, online only (`NetworkBadge`, `netHealth`, tested): "Online · 45
  ms" by a green dot; amber for a round trip of `slowPingMs` or a page `slowBehindTicks`
  behind the server, red for `badPingMs`, `badBehindTicks` or a desync, each saying which
  ("Slow link · 180 ms", "Behind 0.8 s", "Out of sync"). The status line it replaces was
  11 px of grey in the HUD's far corner and said nothing until ten ticks behind; in the
  session where the hosts lagged (11zg), nobody saw it. That line now says only
  "watching" or the last move the server refused. Seen in a real host and guest match.
- **The lobby's ping never stopped**: every lobby opened set an interval that pinged on
  after its connection closed, and a closed connection queued what it could not send, so
  a page that went back to the menu again and again grew a queue forever. The interval
  stops with its connection, and a closed connection drops what it is given.

## 11zk. Ocean life in every style (O1, PLAN 11.16)

The testers praised the land's scenery, and only Medieval and Night had anything on the
sea. Each style's design was chosen by the user: Parchment an engraved ship and a sea
serpent; Blueprint a ship drawn in plan on a dashed course; Cyberpunk drones and a
hover-craft (data packets were offered and refused, too close to the trace pulses and to
tracer shots); Toy bricks a boat, a rubber duck and a shark's fin; Minimal a plain boat,
though it was offered nothing, being the look to debug against.

- **Moved by one module, drawn by each style.** `ocean.ts` now holds the outer ocean,
  moved out of `pixel/ocean.ts`, and three movers: `Crossings` (one at a time along an open
  row, off one side and out the other), `Circling` (wheeling round a spot) and
  `Surfacings` (up for a while, then gone). Medieval's boats, gulls and fish run on them,
  drawn as before; `seaLife.ts` draws the other five, in each theme's effects layer, which
  is cleared every frame and holds nothing else out there. Tested as properties: one
  crosser at a time on an open row, surfacings gone when their time is up, circlers within
  their radius.
- **From the first close-ups**: Parchment's ship sailed the top row with its masts under the
  HUD bar, so a crosser may ask for headroom and keeps to rows whose top is clear of it;
  a serpent surfaced on the compass rose, so surfacings can be kept off a spot; the toy
  boat's cabin overhung its stern when it sailed left; and the serpent was too small to
  read, so it is about 40% larger.
- **Neutral colours throughout** — paper and ink, the sheet's white, the neon of the sea and
  the embers, sand, grey and a duck's yellow — so nothing passing reads as a player's.
  Tunables in each style's block of `art.default.json`.
- Seen in every style at two players, with the rates raised for the screenshots and
  restored after. They come every quarter of a minute or so in play, so no screenshot
  scene can catch them reliably; the bobbing, the coils rising and the drones' blinking
  need a person.

## 11zl. How to play (H1, PLAN 11.16)

For new players, at the user's word: as few words as possible, nobody reads a manual. Seven
pages, approved with their captions before building, opened from a menu button only —
not on a first match — and the button marked until the pages have been opened once.

- **Each page a looping picture**, drawn on a canvas in Minimal's colours, and one caption
  of ten words or fewer: the mouse (left places and fires, right or the wheel turns, Esc
  pauses); the round as four icons lit in turn, ten times round; a block dropping into the
  last gap of a ring and the ground flooding in from the castle; a corner joined at a
  point letting the sea in beside one turned properly; a gun on sealed ground firing
  beside one outside it, silenced, and the crowned castle's "+2"; a shot arcing onto an
  opponent's wall and a block breaking out; sealed ground scoring beside an open ring
  costing the last of three lives.
- **The boards are real**: small ASCII boards through `stateFromAscii`, judged by the sim's
  own `computeEnclosure` — the flood follows its territory, the silenced gun is the one
  `cannonActive` refuses, and the leak pours in by the 8-connected escape. A test holds each
  picture to its rule: the open ring unsealed and the closed one sealed, differing by the
  one block; the diagonal join unsealed and the turned corner sealed, differing at the
  corner; one gun of two silenced; the target an opponent's wall.
- **From the first look**: the water first washed the whole island outside the leaking ring,
  which read as the land flooding, so it shows only where the sea gets in; and the round's
  icons nearly touched, their arrows hooks, so they are smaller with arrowheads.
- Seen page by page in a browser at each key moment. Opened by a click, so no screenshot
  scene reaches it; the loops themselves need a person.
- **The user's edits before committing**: page 2 reads "Choose, place cannons, fire,
  rebuild", page 4 "Walls must include all corners"; and the Effects options became
  Glowing, Standard and Reduced.

## 11zm. A picture of each look in the menu (S1, PLAN 11.16)

The two look choices were picked by name and by the title alone. Each now has a picture
beside it, drawn by the style's own theme, so it is the look itself and not a likeness.

- **One fixed island** (`PREVIEW_BOARD`): a sealed ring round the crowned main castle with a
  gun either side, a second castle outside it, sea round it all; clear weather at noon, so
  Medieval shows no rain and no long shadows. A test holds it to that: the main castle and
  both guns sealed, the other castle not.
- **Rendered once per style, one at a time**: a real `Scene` on a canvas of its own, a few
  long frames of effects so the flags are up, then `toDataURL` and the renderer destroyed —
  each takes a WebGL context, which browsers ration. Kept per style for the page's life;
  built after the title's first sweep, and a slow picture never replaces a newer choice.
- **Sixteen pixels a tile**, the pixel style's own, shown at half that: the first pictures,
  at twelve and shown smaller, were too small to read the guns and the crown.
- Seen in every style for both looks in a browser, with no errors in the console.

## 11zn. The ranking between rounds (I1, PLAN 11.16)

The standings after a resolution rode under the next banner as one line of text. They
are a ranking now, inside the same crossing, so the match's timing does not move.

- **`ranking(state, before)`** (tested): the standings as the HUD ranks them — those in
  ahead of those out, then score, then seat — with each entry's score after the round
  before (the match log's previous resolution; nought before the first) and the places it
  won or lost, the places before ranked by the same rule so a tie breaking differently is
  never a move. Teams in a team match, shown in their first member's colour and shape.
  The text line it replaced, `standingsLine`, went.
- **Drawn** as entries sliding in one after another, each score counting up after them
  (`countUp`, over `tallyMs`), the round's gain popping in beside it, and a green ▲ or red ▼.
  Still under reduced motion, counted at once.
- **From the first look**: on Minimal's gold banner the ranks and gains, in the accent,
  vanished into it; the ranking takes each banner's own ink. Seen in Minimal and
  Parchment, free-for-all and teams, in watched matches; the moves need a round past
  the first and a person to watch.

## 11zo. The elimination target, retired (2026-10-01)

The user's decision after a test game decided on points (PLAN 11.2): almost every match is
to be decided on points at the cap, with elimination a real threat that punishes rather
than the way matches end. The target it replaces — half of three- and four-player matches
ending with one player left before the cap, by one continue instead of two and a new
placement delay — is kept here as it stood, measurements and reasoning included.

### Formerly PLAN 11.2 Elimination tuning — planned, waiting on human play

**Agreed 2026-09-25, not started.** The user is playing test sessions first, so the
tuning is not fitted to the bots alone; those sessions are recorded (§9), and the user
will send compiled feedback.

**Changed since it was planned**: bots are now a skill level and a personality (§8), so
the baseline is measured over the mix they are dealt in real matches; pockets count as
territory (§1.3); islands are rounder and five and seven players sit in grids (§1.2);
only the main castle earns the first castle's reward, and bots no longer avoid tiles
other players' shots are headed for (ARCHIVE 11ze) — so every measurement from before
then is historical. Overtime shipped (§1.6), a
little more wall per round for everyone; and team matches eliminate even less than free-for-all — 5 in 180 at gunner
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

1. **Baseline at three and four players**, current rules, after 11.6 — Level 5 and Level 8
   tables over the personality mix, and fixed personalities to bracket it. Share ending with one player left, eliminations per match,
   lives spent, forfeit rate, and the round each elimination happens in. Measurement only.
2. **An ambitious personality**, delivered by 11.6 as offensive risk: bigger walls, more
   castles, more risk — standing in for the way people play. Every lever is then measured against
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
this target needs. Finishing off the weakest — the finisher targeting of 11.6 — may
matter as much as either rule.

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

## 11zp. The server as something a program starts and stops (A1, PLAN 11.17)

The first package of the desktop app. `main.ts` built and bound the whole server as it
loaded, and found `config/`, the client and the recordings folder by walking up from its
own file. All of it is now `startServer(options)` in `server.ts`, and `main.ts` a command
line over it, so `npm start` and the image run exactly as before.

- **Options** for what a packaged app keeps elsewhere: `root` (where `config/` is), the
  client's folder, the recordings folder — a folder of the user's in the app, since it
  cannot write inside itself, and still switched by `recordings.enabled` — the port and
  host, the commit stamped into recordings, and where its news goes.
- **It returns** the addresses to open and a `stop()` that closes every socket, the tick
  loop and the listening port, resolving once the port is free; or, when it could not
  bind, `port_in_use` or `no_permission` as an answer rather than a thrown error. The
  command line prints that in one line and exits, where it used to die with a stack.
- **Tested in process** (`server.test.ts`): on a free port it serves the games list and
  welcomes a client creating a room; a second server on the same port is told it is
  taken; after `stop()` the port refuses, and a server started on it again works. The
  built bundle checked by hand the same way: it serves, a second copy says the port is in
  use and exits 1, and a bad `PORT` is still refused.

## 11zq. The desktop app's window (A2, PLAN 11.17)

`packages/desktop`, Electron 44, over A1's `startServer`. Bundled by esbuild as the server's
image is — the main process with the server and the whole simulation in one file, a
CommonJS preload, the window's own script — and run from the repository with
`npm start -w @bollwerk/desktop` after `npm run build`, which it serves the client of.

- **The window**: whether the server is running, the addresses other players open, each with
  Copy; Start and Stop; Open in browser; and Play here, the game in a window of the app's
  own. It starts the server as it opens, since that is what it is opened for, and closing
  it stops the server before the app quits. One copy at a time: a second only brings the
  first forward. Mouse only.
- **A taken port** is a state, not an error: "Port 8080 is in use — another server may be
  running", and a button to try the next. The state machine (`control.ts`) is apart from
  Electron and tested: running, stopping and running again; a taken port and the next;
  starts while running and stops while stopped ignored.
- **Paths**: from the repository, its `config/` and built client; packaged (A3), the app's
  resources. Recordings go to the user's data folder (`%APPDATA%\Rampart`, `~/.config/Rampart`),
  never shown. Packaged, the commit comes from `BOLLWERK_COMMIT`, as the image's does.
- **Seen, driven by Playwright's Electron support**: opened with 8080 free, then with a server
  holding it — told so, moved to 8081, the games list answering there; Play here opening
  the menu; Stop freeing the port. From the first screenshots, a disabled quiet button
  looked enabled; it is greyed now.
- **Electron's binary** did not download in `npm install`: its install script did not run.
  `node node_modules/electron/install.js` fetches it; release builds in CI (A4) must do the
  same.

## 11zr. Packaging the desktop app (A3, PLAN 11.17)

`npm run package -w @bollwerk/desktop` bundles the app and runs electron-builder for the system
it is on: a portable `.exe` on Windows, an `.AppImage` on Linux, into
`packages/desktop/release/` (git-ignored). It wants `npm run build` first, for the client it
carries. `BOLLWERK_VERSION` sets the release's version, as a tag will in CI (A4).

- **Nothing of the workspace's `node_modules` goes in**: the bundle carries the server and
  the whole simulation, so the package's `@bollwerk/*` dependencies became development ones
  and the app holds only `dist/`, `ui/` and its `package.json`. `config/` and the built
  client, audio included, are resources beside it, where A2's packaged paths look.
- **The commit is baked in** at build time (`BOLLWERK_COMMIT` first, then git, `-dirty` with
  changes), since a packaged app has no repository to ask; recordings it makes are stamped
  with it.
- **electron-builder wants an exact Electron version** and an author; Electron is pinned at
  44.5.1. The default Electron icon is used, as no icon is set.
- **Built and checked here**: `Rampart-0.1.0-windows.exe`, 120 MB, unsigned. The unpacked app
  driven by Playwright served its own resources on 8080, the games list answering, Play
  here showing the menu with its look pictures, Stop freeing the port; its recordings
  folder is `%APPDATA%\Rampart`. The Linux AppImage can only be made on Linux: on the user's
  Mint machine, or in CI (A4).

## 11zs. Release builds on demand (A4, PLAN 11.17)

`.github/workflows/release.yml`, apart from CI's own jobs, which it does not touch. Built on
demand only: **a tag `v1.2.3`** builds the Windows portable `.exe` on Windows and the Linux
`.AppImage` on Linux, stamped with the tag's version and the commit, and publishes both as a
GitHub release of that version; **a run by hand** (`workflow_dispatch`) takes a version and
keeps the files as the run's artifacts only, to try before tagging. How to cut one is in
CLAUDE.md.

- **Found on the way**: the Dockerfile copies every workspace's `package.json` before
  `npm ci`, as its comment says it must, and `packages/desktop` was missing from the list —
  harmless so far, CI passed, but it is there now. And Electron's install script would
  fetch its 100 MB binary in every CI run and image build, neither of which runs it:
  `ELECTRON_SKIP_BINARY_DOWNLOAD` skips it in both, and in the release build, whose
  electron-builder fetches the Electron it packages itself.
- **Not yet run**: a release is outward-facing, so the first run is the user's to start (A5).
- **The first run by hand failed on Linux** (2026-10-01): electron-builder names a Linux
  executable after the npm package, `@bollwerk/desktop`, which no file may be called;
  Windows names it after the product, so only Linux broke, and the Windows job was
  cancelled with it. The Linux executable is `rampart` now, with a desktop name so the
  window is linked to its launcher. Found by running the Linux packaging on Windows, which
  goes as far as an AppImage's symlinks before Windows refuses them.

## 11zt. The desktop app checked, and finished work moved out of the plan (2026-10-02)

**A5, the desktop app checked on both systems**: the user ran the release workflow by hand
for 0.1.0 and tried both files — the portable `.exe` on Windows 11 and the `.AppImage` on
Linux Mint. Games were hosted and joined across the LAN, the next port was offered and
taken when the first was in use, and the game ran perfectly. The same session found the
hosts' delay on every click gone (11zg). With that, 11.17 is done, and the desktop app is
milestone M14. How to cut a release, and to build the file locally, is in CLAUDE.md and
the README.

As 11h, 11w and 11zd: PLAN keeps only open work, so its finished sections moved here as
they stood, under their old numbers — the third visual pass (11zf, 11zh), help for new
players, the menu and the sea (11zk–11zn), and the desktop app (11zp–11zs).

### Formerly PLAN 11.15 Third visual pass — agreed 2026-09-30

Agreed with the user from a list of suggestions; left out: points rising from each wall
block your shot breaks (too messy), "Double!" callouts for sealing several castles with
one piece, and "Just in time!" for a late seal (not needed). Display only, like 11.8–11.11:
no sim, protocol or ruleset change, so nothing can desync or move a balance measurement.
The same discipline: anything timed is a pure function with tests, scenes go into
`tools/screenshots.sh`, tunables go in `art.default.json`, anything under a second is left
for a person to see, and §7's rules hold — a player keeps their hue, information stays
readable, land, sea, wall and sealed ground tell apart.

Packages in order. X1 first, since X6's shapes need a place in the roster it redesigns;
the rest are independent.

**X1 — Mouse only, and a roster of points and lives — done** (§7): a card per player,
colour down its edge, name over a large score and large pips; in Toy bricks the bar is
rimmed, since the blue player's vanished into the blue plate.

- **The keyboard controls go**: R and E no longer turn the piece; right-click and the
  wheel do, and every action is on the two mouse buttons. Esc for pause stays, the one
  exception agreed in F2. CLAUDE.md's rule is rewritten to match.
- **The roster shows only points and lives**, per player and per team: castles and guns
  firing go, from the full entry, the compact one and the hover text. The room that frees
  is spent making the score and the lives stand out — larger figures, the pips larger and
  the last life louder — and should let eight players fit without a compact form at all.
  The layout is agreed with the user before building, with screenshots at two, four and
  eight players, free-for-all and teams.

**X2 — Information on the board — done** (§7). The breached crown was first the dark
shade of the owner's colour and vanished into a castle of that colour; it is stone grey.
The ring preview asks the sim's own `startingRingTiles`, which builds the ring.

- **The crown shows the main castle's state**: bright while it is sealed, dimmed and
  cracked once it is breached, still always shown. In the combat look it follows the
  enclosure held through combat, as every other sign of "sealed" does.
- **The ring before the choice**: hovering a castle while choosing — at the start or after
  a continue — shows faintly, in the player's colour, the ring it would get.
- **Unsealed at the end**: while nothing of the player's is sealed, their castles are
  outlined already (`hints.ts`); over the countdown's last five seconds that outline pulses
  red with each tick.
- **Guns earned** in the island's points banner at a resolution: "+3 guns" beside the
  points, since today they show only when the cannon phase opens.

**X3 — Ground lost, drained — done** (§7). Begun together as the banner appeared, the
upper islands had drained before the lower ones were revealed: each island's drain waits,
wholly washed, until the banner's line reaches it (`releaseDrains`). As the "Rebuild" banner reveals the build look, territory
lost to breaches drains away from the gaps in a dark red wash — the seal flood run in
reverse (`seal.ts`), in every style.

**X4 — Moments and small atmosphere — done** (§7).

- **The winners' banners**: large banners in the winners' colours rise over their castles
  with the fireworks, which the camera's push lands on.
- **Distant thunder** in Medieval's rain: a rare, faint flash across the sky, never
  mistakable for an impact; none under reduced motion.
- **Embers** drifting at the screen's edges through the final round, with its dusk; none
  under reduced motion.

**X5 — Medieval light — done** (§7). Adding snow to the odds moved which seed gives
which weather: 1 rain, 2 snow, 3 fog, 5 clear, 21 overcast, as the screenshot scenes now
say.

- **Reflections**: castles and walls mirrored faintly in the sea tiles beside the coast,
  rippling; Night's torches too.
- **Shadows by the time of day**: short at noon, long toward the morning and sunset
  rounds, with the daylight tint that already changes by round.
- **Snow**, as one of Medieval's seeded weathers (`weatherOdds`): falling flakes and white
  edges on walls and castles. Not a style of its own.

**X6 — A shape per player — done** (§7, ARCHIVE 11zh). Beside colour, each player carries
a shape on the roster, the island banners, the "You are here" marker, the lobby's seat
cards and map, the summary's table and the ends of its chart's lines, so eight players
and colour-blind players can tell islands apart. **Off the board only**, the user's
decision of 2026-09-30. Decided 2026-10-01: plain geometric shapes, and in a team match
one shape per team, so teams tell apart without colour.

**The third visual pass is done**: X1–X5 in ARCHIVE 11zf, X6 in 11zh.

### Formerly PLAN 11.16 New players, the menu and the sea — agreed 2026-10-01

Chosen by the user from a list of suggestions; left out for now: hovering a roster card to
light its island, a "Preparing the board" overlay, a rematch, volume sliders, first-match
hints and guns that glow while their shot still counts. Display only, with the discipline
of 11.15. In this order:

**O1 — Ocean life in every style — done** (§7, ARCHIVE 11zk). The testers praised the land's
scenery; the sea gets its own in every style, each design chosen by the user.

**H1 — How to play — done** (§7, ARCHIVE 11zl). Seven pages of pictures and a line each,
from the menu's button only — the words and pages approved by the user, whose rule was
as few words as possible.

**S1 — Style previews — done** (§7, ARCHIVE 11zm).

**I1 — A livelier scoreboard between rounds — done** (§7, ARCHIVE 11zn). To be judged in
the next test session.

**11.16 is done**: O1, H1, S1 and I1 in ARCHIVE 11zk–11zn.

### Formerly PLAN 11.17 A desktop app for releases — agreed 2026-10-01

**The goal**: the game as one portable file for Linux Mint and Windows 11, which starts and
stops the server as `npm start` does, behind a minimal window — so a host needs no Node, no
repository and no terminal. Decided with the user: **Electron**, accepting a file of about
100–150 MB; **portable** files only, a single `.exe` for Windows and an `.AppImage` for
Linux, no installers; no recordings button, since recordings are for internal analysis
and tuning only. **Built on demand for major versions, never for every change**: `npm start`
and the Docker image stay the way the game is run day to day.

No rule, protocol or sim change: a packaged server is the same server, and a page it serves
plays exactly as one `npm start` serves. Packages in order:

**A1 — The server as something a program can start and stop — done** (ARCHIVE 11zp).
As planned: `main.ts` bound the
moment it loads. It becomes a thin command line over `startServer(options)`, returning the
addresses it serves on and a `stop()` that closes every socket and room, so `npm start`
behaves as before. The options carry what is found today by walking up from the server's
own file (`paths.ts`): where `config/` and the built client are, which a packaged app keeps
in its resources; where recordings go, which must be a writable folder of the user's
(`%APPDATA%` on Windows, `~/.config` on Linux), since an installed app — an AppImage above
all — cannot write inside itself; and the port. A port already taken is reported as such
rather than thrown. Tested in process: start, a client joins, stop, start again on the same
port.

**A2 — The window — done** (ARCHIVE 11zq). As planned (`packages/desktop`, Electron): Start and Stop; whether it is running;
the addresses other players open, as `npm start` prints them (`openableUrls`), each with a
copy button; **Open in browser**; and **Play here**, the game in the app's own window for
the host. Closing the window stops the server. A taken port says so and offers another.
Mouse only, as everywhere (CLAUDE.md). The commit is stamped as the image stamps it
(`BOLLWERK_COMMIT`), so recordings made through the app replay against the right code.

**A3 — Packaging — done** (ARCHIVE 11zr). electron-builder, from `npm run build`'s output: the bundled server, the
built client, `config/` and the audio as resources; a Windows portable `.exe` and a Linux
`.AppImage`. One script, `npm run package`, builds the file for the machine it runs on, so a
Windows build can be made here; the version is the release's.

**A4 — Release builds on demand — written** (ARCHIVE 11zs; its first run is A5's). A GitHub Actions workflow run by hand (`workflow_dispatch`)
or by pushing a version tag, building both files on their own systems and attaching them to
a GitHub release. Never on an ordinary push: CI's existing jobs are untouched.

**A5 — Checked on both systems — done** (2026-10-02, ARCHIVE 11zt). The user on Linux Mint, this machine on Windows: start,
another machine on the LAN joins and plays, stop, start again, a second copy finding the
port taken. Known and accepted: Windows SmartScreen warns of an unknown publisher until the
file is signed, which needs a paid certificate and is not planned; Windows Firewall asks
once whether to allow the network, which LAN play needs; an AppImage must be marked
executable. How to cut a release goes into CLAUDE.md.

## 11zu. The fourth visual pass (PLAN 11.18)

- **Y1, preparing the board**: as a match opens, "Preparing the board" stands over the
  screen, three wall blocks lit in turn beneath it, until the board's first frame takes it
  down. The work it covers — building both looks' sprites, about a second today — holds
  the page without yielding, so the screen is painted first: two animation frames after it
  goes in, then the work. In headless Chrome the board is ready within about 300 ms, and
  six-fold slower still too quick to photograph, since a screenshot waits for a frame and
  the first frame is what removes it; its look was checked by placing the same markup over
  the menu.
- **Y2, the pause menu**: the pause overlay is the match's menu — Resume; Effects, taking
  effect at once but for the glow, a filter made with a match's looks, which says it comes
  with the next match; Sound, kept in step with the corner switch; and **Leave match**,
  which asks once more ("Really leave? Click again", in the warning colour) before it
  goes, since one stray click should not end a match. The panel is built once and only
  its line about who paused is rewritten, as a control replaced under the mouse never
  takes the click (10v). Leaving goes through the session: online the connection now
  closes, so the seat goes to a bot after the grace a drop gets — and the end screen's
  Back to menu, which left the socket open with its ping behind the menu, does the same.
  From the first screenshot: a rule giving every `small` in the overlay a display showed
  the hidden glow note, and the hover colour beat the warning one; both fixed.
- **Y3, out and watching**: once a player is knocked out — their team, in a team match — a
  strip at the bottom of the screen says "You're out — watching" ("Your team is out —
  watching") with **Back to menu**, which leaves at once, there being nothing left to lose,
  through Y2's leave. Not for a spectator, and gone at game over, where the summary has its
  own button. Whether it shows is a pure function (`watchingText`), tested; seen in the
  `knocked-out` scene, clear of the corner's buttons and the island's own banner.
- **Y4, volumes and levels**: two sliders, **Music** and **Sounds** — not "Effects", the
  visual setting's name — under the looks in the menu and in the pause menu, 0 to 100,
  each over the manifest's own levels, which stay the mix. Music and sounds each pass
  through a bus of their own under the master, so a slider moves a whole kind at once;
  the corner switch stays the mute, giving the volumes back as they were. Saved in the
  browser (`parseVolume` reads them back, tested), and the pause menu shows them as they
  stand when it opens. The sounds slider clicks at its new level when let go. In the
  lobby a bot seat's level shows as ten pips beside its choice, to the host and guests
  alike (tested), so a glance down the seats tells how hard a table is.
- **Y5, awards at the end**: the summary names up to three awards, cards between the
  table and the chart, each in its player's colour and shape with a line saying what
  earned it. Fourteen categories (`awards.ts`): Wrecker, Landlord, Castle collector, Iron
  wall, Comeback, Front-runner, Photo finish, Last stand, Phoenix, Late bloomer,
  Artillerist, Steady, a named Nemesis ("Bo's nemesis") and Mason. Those that apply are
  drawn from a stream of the match's seed, so every screen at a table shows the same;
  each a different award, and to a different player while any is left without one. An
  award whose best is shared is not given. The match log gained what they need, all from
  events the client already receives: the wall each shooter broke on each island (a wall
  is its island's), pieces laid, lives spent, guns and territory points at each
  resolution — no protocol change. Tested on hand-made logs (sole bests and ties, an iron
  wall, a comeback, a nemesis, a photo finish), the draw (same seed, same awards; spread
  round the table) and a whole bot match. Seen at the end of watched five-round matches at
  three and four players: Phoenix, Wrecker, Bot 3's nemesis; Steady, Artillerist, Bot 2's
  nemesis.
- **Y6, rematch**: Rematch beside Back to menu at the end. Online it is the host's
  (protocol 15, a `rematch` message the room takes from the host alone, once the match is
  over): the room goes back to its lobby — everyone still connected in the seat they had
  before the start, which the start had dealt onto islands and renumbered; the bots that
  filled the empty seats gone; levels, teams, settings and a watching host's bot kept; a
  new map — and tells each person their seat, then the room, which every page reads as the
  lobby, taking its match down. Others see "Rematch — the host decides", disabled.
  Locally it reopens the table as it was, on a new map. Tested in the room (the guest's
  request ignored, seats and settings restored, the seed changed, a new match started
  from it), and driven end to end: locally after a watched five-round table, and online
  over a real server with a host and a guest, both pages back in the lobby. Found by the
  first run: the HUD lets clicks through to the board and its buttons must take them back,
  as Back to menu did — Rematch did not, and a click on it reached the board.
- **Y7, Stained glass**, an eighth style for either look (`glass.ts`, `art.glass`): everything
  a style brings — palette, tunables, a title of leaded panes, a banner of jewel panes, a
  HUD of lead under coloured glass, a menu name and picture, sea life (a glass ship, a
  leaping fish), screenshot scenes. The first board cut one pane a tile and read as a
  mosaic, its lead grid busy at eight players; land and sea are now irregular panes of a
  few tiles (`panes.ts`, tested: one material each, a few tiles on average, the same cut
  every time), and walls stay one leaded block a tile, since that is what a shot takes.
  Approved by the user from screenshots, building, in combat, at eight players, in the
  menu and across a wipe from Medieval; its motion is to be seen in play.

## 11zv. Finished work moved out of the plan (2026-10-02)

As 11zt: PLAN keeps only open work, so the fourth visual pass moved here as it stood. What
it left to check in play is in PLAN §11's where to start.

### Formerly PLAN 11.18 Fourth visual pass — agreed 2026-10-02

Chosen by the user from a list of suggestions; left out: lighting an island while its
roster card is hovered (nobody hovers there) and first-match hints (How to play covers
them). Display and menus only, with the discipline of 11.15: no sim or ruleset change; the
rematch alone touches the protocol. Anything timed a pure function with tests, scenes in
`tools/screenshots.sh`, tunables in `art.default.json`, §7's rules kept — a player keeps
their hue, information stays readable, land, sea, wall and sealed ground tell apart; mouse
only. Packages in order, the small ones first:

**Y1 — Preparing the board — done** (ARCHIVE 11zu). A screen over the board for the moment a match opens while
the looks are built, so a pause that grows with the visuals never reads as a freeze —
today it is about a second (ARCHIVE 11zg). Taken down at the first frame drawn.

**Y2 — The pause menu — done** (ARCHIVE 11zu). The pause overlay becomes a menu: Resume; the Effects and Sound
settings, as in the main menu, taking effect at once where they can; and **Leave match**,
back to the main menu — online the seat goes to a bot after the grace, as for any drop
(§6). The end screen's Back to menu stays.

**Y3 — Out, and watching — done** (ARCHIVE 11zu). A player knocked out sees a quiet strip — "You're out —
watching" — with Back to menu, instead of only their island greying, for the rest of the
match.

**Y4 — The menu's sound, and the lobby's levels — done** (ARCHIVE 11zu). Two volume sliders, music and effects,
in place of the Sound switch's single on and off (the corner switch stays, as a mute);
saved with the looks. A bot seat's level shown as pips on its lobby card beside the
choice, so a glance tells how hard a table is.

**Y5 — Awards at the end — done** (ARCHIVE 11zu). The summary names up to **three awards**, each to a different
player where it can, from a long list of categories, of which those that apply are drawn —
**the same draw on every screen**, from the match's seed, so a table talks about the same
awards (decided 2026-10-02). Every value from the match log the client keeps (`MatchLog`)
and the state, so no protocol change; a new counter or two from events the client already
receives. The first list, to grow:

| Award            | Goes to                                                    |
| ---------------- | ---------------------------------------------------------- |
| Wrecker          | most enemy wall shot down                                  |
| Landlord         | most ground held in one round                              |
| Castle collector | most castles held at once                                  |
| Iron wall        | never failed a seal                                        |
| Comeback         | the biggest climb in the standings from round 5 to the end |
| Front-runner     | led after the most rounds                                  |
| Photo finish     | the winner, by under 5%                                    |
| Last stand       | finished the match on their last life                      |
| Phoenix          | lost a life and still finished in the top half             |
| Late bloomer     | the biggest single round's score, in the last three rounds |
| Artillerist      | most guns at once                                          |
| Steady           | scored in every round                                      |
| Nemesis          | shot down the most of one opponent's wall ("Bo's nemesis") |
| Mason            | most pieces placed                                         |

**Y6 — Rematch — done** (ARCHIVE 11zu; protocol 15). Beside Back to menu at the end: the same table again in one click.
Decided 2026-10-02: **online, only the host** may call it, and it brings **everyone still
connected back to the room's lobby** with the table as it was — seats, teams, levels and
rounds — and **a new map**; the host starts as usual, anyone may leave, and the others see
"waiting for the host" until then. Locally it reopens the local table the same way. The
room is reset for a new match rather than closed, which is a protocol change.

**Y7 — Stained glass, an eighth style — done** (§7, ARCHIVE 11zu). The board as a church window: lead lines between
the tiles, light through coloured glass, the sea in deep blue glass, sealed ground lit
brighter. For both looks. Everything a style brings, as Toy bricks did (ARCHIVE 11u): a
theme, its palette and player ramps (hues kept, §7), a title, a banner, a HUD skin, a menu
picture (`stylePreview`), its sea life (`seaLife.ts`) and screenshot scenes. Its details
are agreed with the user from screenshots of a first board.

## 11zw. Bollwerk: the game renamed, and its attribution (2026-10-02)

The project was "Rampart Remake" and its title said "Rampart": the name of the original,
published by Atari Games in 1990 and today a trademark of Warner Bros. Entertainment, which
received Atari Games' later arcade titles with Midway's assets in 2009. A game's rules are
free to take; its name is not — and in Germany a work's title is protected on its own, as a
_Werktitel_ (MarkenG §5), besides any trademark. So the game was renamed before anything
was released, with the user, on 2026-10-02.

**The name.** Candidates weighed: Mortar (gun and masonry at once), Barbican, Castellan,
Merlon, Breach & Mend, and puns (Siege the Day; Rubble Trouble and Breakwater probably
taken; Fort Night too near Fortnite). The user wanted a German name, and first suggested
_Schutzwall_ — set aside because to German ears it is first the _antifaschistischer
Schutzwall_, the GDR's name for the Berlin Wall, and a game of walling off territory under
that name reads as a joke about it (_Mauer_ and _Mauerbau_ carry the same, more faintly).
**Bollwerk** was chosen: the exact word for a bulwark, no baggage, sayable in English, no
umlaut for file names or the title's glyphs. Searched: no video game of that name; a board
game _Bollwerk 178_ (2021, chess-like). _Bulwark: Falconeer Chronicles_ is another word,
language and kind of game, and was judged no conflict. Bulwark and Bastion themselves are
taken.

**Renamed everywhere**, the user's choice, since nothing was out yet and saved settings
could be lost: the repository (`Thomarius/Bollwerk`, renamed on GitHub by the user; the
local folder stays `RampartRemake`), the `@bollwerk/*` packages, the `BOLLWERK_COMMIT` and
`BOLLWERK_VERSION` variables, the browser's `bollwerk.*` keys (no migration), the desktop
app (`io.github.thomarius.bollwerk`, a name the user controls rather than a domain they do
not, its data folder now `Bollwerk`), the release files and title, the Docker tag and the
page title. The menu's title has the letters B, O, L, W, E and K, drawn in its 5x7 grid;
eight letters are 376 of the menu's 416 pixels. Nothing in the simulation, the protocol or
the recording format carried the name, so state hashes and old recordings are unchanged.
In this file the older entries keep "Rampart" where they meant the project; only command
lines were updated to the new package names.

**The attribution**, approved by the user: _"Bollwerk is an unofficial fan game inspired by
Rampart (Atari Games, 1990). It is not affiliated with or endorsed by Warner Bros.
Entertainment, which owns the Rampart trademark. It uses no code, graphics or sound from
the original; the audio is from OpenGameArt.org under the licences listed in
CREDITS.md."_ It is in the README, `CREDITS.md`, the menu's Credits and the release notes;
a short form, "Inspired by Atari's Rampart (1990)", stands under the menu's title beside
the Credits button, and in the desktop window. Both texts live once, in
`packages/config/src/credits.ts`.

**The credits are enforced.** All the audio is from OpenGameArt under open licences, some
of which (CC-BY, OGA-BY) require the author to be named. The manifest gained `credits`, one
per file (variants may have different authors): title, author, licence from a closed list
of OpenGameArt's licences each with its link, source address, and what was changed. The
bundle validator refuses a credit for a path no cue loads. `npm run credits` writes
`CREDITS.md` from it, with Markdown escaped so prettier leaves it alone, and a test fails
when the file is stale; the menu's Credits is made from the same list and its links open
in the person's browser, from the desktop app too. A file without a credit is a warning
until the user has gathered them all, and an error under `BOLLWERK_REQUIRE_CREDITS=1`,
which the release workflow sets before it builds anything.

## 11zx. The audio credited (2026-10-03)

The user supplied author and licence for every music track, and said every sound effect
is CC0. **CC0 asks for no attribution, so the sound effects are one credit, not thirty**:
a credit's key may be a folder, ending in `/`, covering every file in it without a credit
of its own (`creditFor`), and the Credits and `CREDITS.md` show it as one line where its
first file would stand. A folder credit that covers no file a cue loads is refused, as a
file credit for an unknown path is. A file with its own credit still shows it, so a sound
added under CC-BY beside the others is credited by name.

**Every track has its title and OpenGameArt page.** Two were found from their embedded
tags — the menu's is RandomMind's _Medieval: The Old Tower Inn_ (CC0), the victory cue
Matthew Pablo's _Lively Meadow (Victory Fanfare and Song)_ (CC-BY 3.0) — and the user found
the rest: Alexandr Zhelanov's _Tiny Swords Duel_ (CC-BY 4.0) for combat, Marcelo
Fernandez's _Medieval Rondo_ (CC-BY 3.0) for defeat, and the three build-phase tracks from
Zhelanov's pack _Unused music_ (CC-BY 3.0), whose pieces have no titles and are credited by
their file names there (`Brirfing_theme.mp3` is the pack's own spelling). Which file is
which was settled by size: each is byte for byte the pack's download, so nothing was
changed. A title is optional all the same, since a folder's credit has none.

**The check is unconditional**: with everything credited, `BOLLWERK_REQUIRE_CREDITS` is
gone, and a file without a credit fails `npm run check`; the release workflow still runs
that test first, before it builds anything.

## 11zy. Chocolate, a ninth style (2026-10-03)

The user's idea: "Chocolate", after _Willy Wonka and the Chocolate Factory_ — and the
brief was that it look fun and bring ideas the other styles do not. Proposed and agreed
before any code: **the first style whose material moves** — every other is built of
something solid (stone, ink, neon, bricks, glass) and this one flows, melts, drips and
shines. Decided with the user: the name Chocolate; a milk-chocolate river, never dark, so it
stays clear of Night and Cyberpunk; more chocolate and sweets and less factory, so the only
machinery is a glass pipe at sea. Named after the material, never the film, as Toy bricks is
never named after a maker.

What carries meaning, and how: **a shot takes one square of a chocolate bar**, which is what
a bar is for, so the rule and the look agree; **sealed is the chocolate flowing** over the
castle's cake, started and stopped by `FlagHoist` as the other styles' flags are; a breach
leaves **bite marks** on the blocks either side of it for the round; a player who is out
turns grey-white with **sugar bloom**, what old chocolate does, rather than smoking. The
piece in hand is an empty mould — cracked, not red, where it does not fit, since red is a
player's colour.

Seen in screenshots building, in combat, at eight players, in the final round, in a snowy
match, with a player knocked out, across a wipe and in the menu. What the first look
changed: the river's depth bands stepped in tiles, so they are drawn as overlapping rounds;
the meadow's lighter patches made a checkerboard, so they are round too; the fall read as a
crate and became one sheet between banks of meringue into a round pool; the fountain's
streams, thin lines over the cake, read as a cage, so the flow is a glaze over the tiers;
the overtime drips vanished against the milk river and are dark chocolate; and an icing
drizzle over the title read as a row of V marks and went. Every style shows a full-width
white band in a headless screenshot taken mid-wipe — Stained glass too — so it is the
capture, not the style. Anything moving is still to be seen in play (PLAN §11).

## 11zz. Every style to the edges (PLAN 11.19, 2026-10-03)

Asked which parts of the screen no style reached yet: the board, the phase banner, the top
bar and the title were each style's, but the HTML over the board and the match's finish
were shared. The user chose the four packages proposed: the skin beyond the bar, the big
timer, the island banners and stamps, and the finish. Kept shared on purpose, and agreed:
the crown (11.14), the aids that carry information (§7's rule), the menu and lobby, which
show two looks at once, and the small effects.

**Z1, the skin beyond the bar.** The skin's class moved from `#hud` to the page, its
variables with it, so they reach the banner layer and the overlays; it is taken off as a
match is left. The panels redefine the page's own colours from the skin's, so the rules
written for them work unchanged. Medieval's and Night's box is see-through, which the
summary had been made opaque to escape (its grey figures were unreadable over the board),
so the panels take an opaque `--hud-panel` where a skin's box is not solid, and the
summary's grey is lifted toward the ink in every skin. Text on the accent is dark on every
bright accent and light on Parchment's ink red (`--hud-on-accent`).

**Z2, the big timer**: CSS alone per skin — Medieval and Night share theirs, as they share
a skin. Seen side by side in all eight.

**Z3, the island banners and stamps**: the same, by skin; Parchment's knocked-out stamp
and final stamp are in red ink rather than the owner's colour, as a stamp on a map is.
**Headless Chrome could not reach them by the clock** — a resolution is over forty seconds
of wall time away and virtual time crawls — so they were checked by a Playwright script
that puts each kind into a running match's banner layer under each skin and photographs it.

**Z4, the finish**: `Fireworks` and `WinnerBanners` take a `FinishLook` — a spark shape and
a flag — from each theme, the physics and the hoist shared so the send-off keeps one
timing. Bricks fall heavier and ink lingers longer; nothing else differs in timing. Seen at
game over in all eight.

## 12a. Halloween, a tenth style (2026-10-03)

Pitched before any code and agreed with the user: Night already does dark and torchlit, so
Halloween is purple dusk, a murky green bog and pumpkin orange, and its idea is a board
**haunted** — fog drifting, bubbles, ghosts, bats, eyes in the dark. Decided with the user:
cute-spooky, no gore, skulls and bones only here and there with more ghosts and pumpkins;
crypt stone with spirit-light in the mortar for the walls (over an iron graveyard fence,
which reads less as a solid block); spectral fireballs for shots — not flying pumpkins,
since the scenery is full of pumpkins and nothing on the ground may read as a shot; the
name Halloween.

What carries meaning: **sealed is the house lit up** (the porch lantern, the windows, the
chimney's smoke), by `FlagHoist` as every style's sealed sign is; a wall shot away **sets a
ghost free**, this style's mark of a hit as the bite is Chocolate's; the piece in hand is a
spectral wall, cracked rather than red where it does not fit. The finish gained a burst,
`spirits` — bats in the owner's colour and little ghosts, floating up rather than falling —
and a flag, `tattered`, on a crooked branch. Bats and ghosts are drawn by `spooky.ts`,
shared by the theme and its sea life so neither imports the other. `hash` is Chocolate's.

Seen in screenshots building, in combat, at eight players, in the final round's witching
hour, foggy and snowy matches, across a wipe, in the menu, at game over, and with the
island banners, stamps and pause menu placed into a running match by a Playwright script.
The first look changed only sizes: the freed ghosts and the witching hour's eyes were too
small to notice and were enlarged. Anything moving is still to be seen in play (PLAN §11).

## 12b. A gallery for choosing the looks (2026-10-03)

With ten styles and more planned (Christmas, Sports, Fantasy), the two dropdowns were not
going to scale. Proposed and agreed: **a gallery** of every style's picture behind a click
on the menu's picture, one gallery for both looks with a Building / Combat switch at its
top — two separate galleries are the fallback if one confuses players — **arrows** either
side of each picture to step through the styles in place, and **Random**, drawn from every
style as each match starts, as most games offer. **Looks** in the pause menu opens the
same gallery mid-match. Groups, filters, favourites and a seasonal strip were declined for
now; they are the next step once there are more than about fifteen styles.

The choice is `LookChoice`, a style or `random`, saved as the menu's was; a match resolves
it once with `resolveLooks` — two randoms never draw the same style, which would make the
banners change nothing — and the lobby's map shows the default build look's colours when
building is random. Mid-match, `Scene.replaceLooks` makes the new themes, swaps them in and
redraws them from the board as it last stood; nothing of the sim, the server or the
recordings sees the looks. The pure parts — choosing, stepping, resolving, the gallery's
markup — are tested (`looks.test.ts`); the rest was driven in Chromium by a Playwright
script: the arrows, the gallery and its switch and badges, Random, and a mid-match change.

**A Pixi trap, found that way**: the style pictures are rendered by a throwaway renderer,
destroyed with `destroy(true)` — which also releases Pixi's resources shared by every
renderer on the page, among them a pool of batches the match's renderer had checked out.
Harmless in the menu, where no other renderer runs; over a match, its next frame failed in
the batcher. The pictures are now destroyed without releasing the shared resources.

The order, the user's choice after seeing it: the styles alphabetically by name — Minimal
lands in the middle, which is fine — and Random last.

## 12c. Less text, larger figures (2026-10-03)

The user's list. The menu lost its summary of the rules (How to play has them) and the
note under Join; the open games list says "No open games" when there are none. The lobby
lost the line under the room code (seats taken, the table local) and the one under the
seats (what a level is). In a match, the roster's names and figures are sized by the width
each entry gets, as large as the 64-pixel bar holds — at three players the names went
from 11 to 14 pixels and the scores from 25 to 30, and team members' names grew alike —
and the team tags over the islands, which testers found easy to miss, from 0.8 to 1.2 rem.
Larger, they met the big timer at the map's centre and, in the top row and at the window's
edge, ran under the bar and off the screen: each now takes the top corner of its island
farther from the timer and is kept on screen and below the bar. Seen at three, eight and
eight in teams at 1400 pixels, eight at 1024, and four and six in teams.

## 12d. Sakura, an eleventh style (2026-10-03)

The user's idea: a Japanese style, a clear reference without being called Japan. Pitched
before any code and agreed: every style has one idea of its own, and this one's is **the
board as an ukiyo-e woodblock print** — flat colour in bold outline, colour fading across an
area as a printer wipes the block, and the prints' motifs: the curling wave with claws of
foam, bands of mist, swirled clouds. Kept clear of Parchment, which is light, sepia and a
map, and of Medieval, whose castles are European. Decided with the user: the name Sakura;
the carp streamer as the sealed sign, over paper lanterns lit, which would be near Night's
torches and Halloween's lit house; the season turning in the final round; Mount Fuji in the
corner as the reference, rather than the flag.

What carries meaning: **sealed is the carp flying** (`FlagHoist`), and a breach brings it
down limp; **sealed ground is a raked gravel garden**, raked round the keeps as round
stones (`rakeLines`, tested on pictures: rings that close, inward corners carried past
rather than cut); **a hit throws roof tiles and a curled cloud**, the style's mark of a hit
as the bite is Chocolate's and the freed ghost Halloween's; the piece in hand is a brush
stroke that breaks up dry where it does not fit, not red. No torii, lanterns or vermilion on
the board, which would read as the crimson player. The finish gained `blossom`, a
chrysanthemum's bowed streaks among cherry petals, and `nobori`, a tall war banner hung from
an arm. The wave, the cloud, the petal and the maple leaf are `ukiyo.ts`, shared by the
theme, its sea life and the finish, so none imports another.

Seen in screenshots building, in combat, at eight players, in the final round, in rain, fog
and snow, with a player knocked out, in the menu and at game over; the banner, the island
plaques, a team tag and both stamps placed into a running match by a Playwright script. What
the first look changed: Mount Fuji's snow ended in a comb of teeth and its mist in two hard
bars, its foot outlined under them — fewer, longer streaks, staggered bands and flanks
inked without the foot; snow lying on each block's cap read as candy stripes along a run, so
a snowy match whitens the caps instead; the rain's streaks were lost, since every petal's
fill ended their path before it was stroked, and are drawn in one stroke first; the maple
leaves were too small to notice; and the HUD's pattern ran under the whole bar, its fade
laid beneath it. Anything moving is still to be seen in play (PLAN §11).

## 12e. Oktoberfest, a twelfth style (2026-10-03)

The user's brief, with no pitch to review this time: Oktoberfest, its stereotypes, "we are
German — we deserve a good joke about this fair". The idea chosen is **the fair on islands
in a sea of beer**, every rule of the game told as one of the Wiesn's clichés, the joke
always on the festival and never on a player.

What carries meaning, and the joke in each: **walls are stacked beer crates**, the student's
furniture, a shot taking one crate; a player who is out keeps grey crates of **empties**;
**sealed is the giant Maß on the tent's roof full**, and a breach drinks it dry — nobody
needs telling what a breach costs (`FlagHoist`, like every style's sealed sign); **sealed
ground is the Bavarian lozenges**; **guns are kegs and fire pretzels**, so no pretzel lies
about in the scenery to be taken for a shot; a crate swept goes back for its **deposit**;
in overtime and the final round **the band plays**. A Ferris wheel takes the compass rose's
corner, and the scenery's boulders are one in three **a reveller asleep in the grass** — the
Bierleiche, snoring, with nothing worse than that. Kept off: anything a player's colour could
be taken from, and the Hill of Shame's less printable sights.

The finish gained `pretzel`, pretzels and gingerbread hearts iced in the owner's colours,
and `rauten`, a lozenge flag on a maypole. The pretzel, the heart, the Maß, the reveller and
the band's notes are `wiesn.ts`, shared by the theme, its sea life and the finish. The
banner's lettering was first Comic Sans, as the hearts' icing is bubbly, and was changed to a
rounded face: the joke should be the beer, not the font.

Seen in screenshots building, in combat, at eight players, in the final round with the band,
in rain and snow, with a player knocked out, in the menu and at game over, and the banner,
hearts, a team tag and both stamps placed into a running match by a Playwright script. What
the first look changed: the beer's bands were too strong and read as orange juice, so its
shades were drawn closer; the bubbles, the tents' Maß and the notes were enlarged; and the
lozenge rule under the bar, drawn with a border image, showed as a single blue tab, so it is
two lattices of stripes laid where the rule would be. Anything moving is still to be seen in
play (PLAN §11).

## 12f. Opera, a thirteenth style, and v0.5.2 (2026-10-03)

The user's idea: music — classical, with choir and orchestra, conductors, sheet music and a
fabulous opera house. Pitched and agreed: every other style is built of a material, and this
one is built of **music itself** — the waves are staves, the walls a keyboard, sealed ground
a page of the score, the guns an orchestra's brass. Decided with the user: the name Opera;
**piano keys** for the walls over organ pipes, which are grander but read less as a block a
shot takes; **the house playing** as the sealed sign, over a conductor before every house,
who would be tiny at eight players — so one conductor beats time in the corner instead;
**brass horns, muted when silenced**, over the 1812 Overture's cannons.

What carries meaning: **sealed is the house playing** (`FlagHoist`), windows lit and notes
rising, and a breach brings a rest as the light goes down; **sealed ground is the score**,
ruled in the owner's colour; **a silenced gun is muted** — _con sordino_; **a hit knocks a
key out with a sour note**, the style's mark of a hit; the black keys stand in a keyboard's
true pattern, two and three, so a wall reads as a keyboard. The finish gained `roses`, roses
and flowers thrown at a curtain call, and `lyre`, a pennant with a golden lyre. The notes,
rest, lyre, rose and swan are `music.ts`, shared by the theme, its sea life and the finish.

Seen in screenshots building, in combat, at eight players, in the finale with its
spotlights, with a player knocked out, in the menu and at game over, and the curtain banner,
cartouches, a team tag and both ticket stamps placed into a running match by a Playwright
script. What the first look changed: the black keys, drawn wide and blunt, read as holes in
the walls, and became narrower, shorter, rounded and glossed; the notes riding the staves
crowded the islands, and are fewer and smaller. Anything moving is still to be seen in play
(PLAN §11).

**Released as v0.5.2**, the user's call, to try the three new styles — Sakura, Oktoberfest
and Opera since v0.5.1 — on the desktop app.

## 12g. More languages: English and German (PLAN 11.20, 2026-10-03 to 10-04)

Planned and agreed with the user before any code, in six steps, each committed on its own.
Decided first: a dropdown in the menu and the pause menu; German says _du_; the disclaimer
translated with its names kept; the desktop window in the system's language; style and award
names translated where natural, names that are names kept (Cyberpunk, Halloween, Sakura,
Oktoberfest, Opera).

**Step 1, every text moved, nothing changed.** 272 texts into `config/locale/en.json`, typed
(`TextKey` is its keys, so a mistyped key fails the typecheck), read through
`packages/config` and shown by the client's `i18n.ts`. The proof that nothing moved: every
existing test passed with its English expectations untouched. What took more than a move:
English-only plurals and ordinals, lists joined with "and" (to `Intl.ListFormat`, in
British English so a list of three keeps no comma before "and"), "Ada's nemesis", "… on
points" endings, fragments spliced into sentences — all whole templates now. Texts in
module-level tables became keys looked up when shown, so a change of language reaches them.
The disclaimer's English lives once, in `en.json`, and `credits.ts` reads it for
`CREDITS.md`. Server refusals are shown by `code`, the server's own words for a code the page
does not know; action rejections by reason.

**Step 2, the chooser.** Saved as `bollwerk.language`; the browser's own language on a first
visit; `&lang=` for screenshots, unsaved; the page's `lang` follows. Panels built once and
kept — the pause menu, the network badge, the "out" strip, the sound switch — listen for the
change.

**Step 3, German**, drafted by the agent with fixed terms (Burg, Mauer, Kanone, Runde,
umschließen, Spiel, Teil for a wall piece, Optik for the looks) and read by the user, who kept
"Credits", chose "Spielregeln", "Host" and, for the bots' targeting, "effizient",
"gnadenlos", "nachtragend". `german.test.ts` renders the main screens in German and fills
every text, failing on a key or a placeholder showing through. Found by switching: the old
language's default name was saved as if typed.

**Step 4, the layout pass** at 1024 and 1400 pixels, every screen. Only the HUD's bar broke,
at 1024: the roster sized its figures assuming a 300-pixel phase label, German's is half as
long again, and four teams' pips ran into the next team's letter (English already clipped
the last) while eight players lost a pip each. Fixed for every language rather than by
shortening approved German: the label measured (`--phase`), a team counted as 1.4 entries, an
entry clipped at its own edge, a label over 22 characters set smaller, the pips and gaps a
little smaller. Award titles wrap balanced.

**Step 5, the desktop window**, 22 texts in the system's language. Importing the
configuration whole into its page took its script from 2.5 kB to 870 kB; the language list
moved to `@bollwerk/config/languages`, a module with no dependencies, and the page reads the
locale files directly, 31 kB.

**Step 6**, the tests, came with the steps: parity of keys and placeholders, the plurals and
ordinals of both languages, the German screens. Left to the user's next session: German in
play, and the desktop window's German, not yet read by anyone but the agent. French waits for
a reader.

### Formerly PLAN 11.20 More languages — as planned and recorded step by step

**The goal**: the game in English, German and French to begin with, every text a player
reads in external files that a translator edits without touching code. Adding a language
is adding a file. English stays the reference and the default.

**What is translated** — everything a player reads, all of it in the client:

- the menu and the looks gallery (`main.ts`, `looks.ts` — the style names too), the lobby
  (`lobby.ts`), the open games list (`browser.ts`), How to play's captions (`howToPlay.ts`),
  the Credits panel's headings (`credits.ts`);
- in a match: the HUD's phase names and lines (`hud.ts`), the announcements and the winner's
  line (`banners.ts`, `scores.ts`), the island banners and team tags ("Team A"), the
  connection badge (`network.ts`), the pause menu (`pause.ts`), the "You're out" strip
  (`watching.ts`), the end screen and its awards (`summary.ts`, `awards.ts`), the
  personality reveal, "Bot 3";
- the server's refusals, which arrive as `{ code, message }` (`protocol/messages.ts`): the
  client translates by `code` and shows the English `message` for a code it does not know,
  so an older client still says something;
- the desktop app's two window titles and its server window.

**Not translated**: player names; the title's letters, which spell Bollwerk in every
language; the disclaimer's legal names (Rampart, Atari Games, Warner Bros.); `CREDITS.md`,
the README and the docs; log lines, recordings and the soak's tables.

**The files**: `config/locale/en.json`, `de.json`, `fr.json` — flat keys grouped by screen
(`"menu.play"`, `"lobby.start"`, `"hud.phase.build"`, `"award.wrecker.title"`), values with
named placeholders (`"{name} wins on points"`). Whole sentences, never assembled from
pieces, since word order differs between languages; plurals as an object of the forms the
language needs (`{ "one": "{n} life", "other": "{n} lives" }`), chosen by the browser's
`Intl.PluralRules`. Read through `packages/config` like every other file, behind a schema:
**every language must have exactly English's keys and the same placeholders in each**, an
unknown key is an error, and a test fails on any gap — as the credits' test does — so a
text added to the game cannot be forgotten in a language. A key missing at runtime shows
the English text, never the key.

**The mechanism**: `packages/client/src/i18n.ts` — `t(key, params?)`, the language in use,
and the plural helper. The pure functions that make markup and lines today (`lobbyMarkup`,
`bannersFor`, the awards, the summary) call `t()` instead of holding English, so their tests
keep running in English unchanged; one more test renders the main screens in German and
fails if any key or `{placeholder}` shows through.

**Choosing the language**: in the menu, beside Effects; saved in the browser like the other
settings (`bollwerk.language`). The first time, the browser's own language if the game has
it, otherwise English. A change redraws the menu at once; a match takes it at the next
frame, since the HUD is redrawn every frame anyway. It is the page's own choice: players at
one table may each play in their own language, since nothing translated travels.

**Layout**: German runs about a third longer than English, and the tight places are known —
the HUD bar and the roster, the phase banner, the island banners, the buttons, How to play's
captions of ten words or fewer. A screenshot pass per language at 1024 and 1400 pixels wide,
by `tools/screenshots.sh` with a `&lang=` parameter, and the Playwright script that places
banners into a running match (ARCHIVE 12a) for what the clock cannot reach. CSS
`text-transform: uppercase` turns ß into SS, which is correct; the fonts carry ä, ö, ü, é,
è, ç.

**Steps**:

1. The mechanism and the English file: every text moved out, nothing on screen changes,
   every test still passes. The largest step — a few hundred texts, most of them already in
   the well-separated places listed above.
2. The language choice in the menu, and `&lang=` for screenshots.
3. **German**: drafted by the agent, read and corrected by the user, then the layout pass.
4. **French** the same way, when a reader for it is found.

About one to two sessions for steps 1–3.

**Decided with the user (2026-10-03)**:

- **A dropdown** of the languages in their own names ("English", "Deutsch"), in the menu
  beside Effects **and in the pause menu**; English and German first, French later.
- German says **du**, as nearly every game does.
- **The disclaimer and "Inspired by…" are translated**, their meaning kept and the names
  (Rampart, Atari Games, Warner Bros.) unchanged; `CREDITS.md` and the README stay English.
  `credits.ts` marks "Bollwerk" and "Rampart" in the text by pattern, so every language must
  keep both words.
- **The desktop app's server window is translated too**, following the system's language
  (Electron's locale); the game inside it follows the dropdown as everywhere.
- **Style and award names are translated where natural** — Mittelalter, Nacht, Pergament,
  Spielzeugsteine, Buntglas, Schokolade, Blaupause, and German award titles — while names
  that are names stay (Cyberpunk, Halloween, Sakura, Oktoberfest, Opera).

**What the survey found** (2026-10-03): about 300 texts in the client and 25 in the desktop
app and config. The parts needing more than a move: English-only plurals (`awards.ts`
`plural`, `banners.ts` `lifeWord`, `hud.ts` cannon counts), ordinals (`awards.ts`
`ordinal`), lists joined with "and" (`scores.ts` `names`, to `Intl.ListFormat`),
possessives ("Ada's nemesis"), times and numbers ("18.6s", to the language's number
format), fragments spliced into sentences (`banners.ts` "team lives", `main.ts` "the
building look"), the personality words — which recordings carry, so they get display keys
of their own rather than being changed — and `showError`'s raw English refusals, to be shown
by `code` instead. The tests asserting English (lobby, scores, banners, awards, network,
browser, pause, looks, watching, credits, summary, config) keep running in English unchanged,
which is the proof that step 1 moved nothing.

**Implementation order**: (1) the mechanism and `en.json`, every text moved, nothing on
screen changed; (2) the dropdowns, `bollwerk.language`, `&lang=` and the page's `lang`
attribute; (3) German drafted, read by the user; (4) the layout pass in German at 1024 and
1400 pixels; (5) the desktop window; (6) tests — key and placeholder parity, plurals, the
main screens rendered in German with no key or placeholder showing through.

**Step 1 done (2026-10-04)**: 272 texts in `config/locale/en.json`, read through
`packages/config` (`locale.ts`: the schema, `localeProblems`; `TextKey` is `en.json`'s keys,
so a mistyped key fails the typecheck) and shown by `packages/client/src/i18n.ts` — `t`,
`ordinal` (by `Intl.PluralRules`' ordinal rules), `formatNumber`, `listOf` (`Intl` in
British English, so "Ada, Bo and Cy" keeps its missing comma). Texts held in module-level
tables are keys looked up when shown (style names, phase labels, How to play's captions), so
a change of language reaches them. The disclaimer's English lives once, in `en.json`;
`credits.ts` reads it for `CREDITS.md`. Server refusals are shown by `code`
(`refusalText`, the server's words for a code it does not know), action rejections by
`rejection.<reason>`. Every existing test passed unchanged, and the screens read as before;
`locale.test.ts` checks parity, `i18n.test.ts` the mechanism. **Not yet**: the language
switch (step 2) — panels built once and kept, the pause menu among them, will need relabelling
when the language changes mid-match; the desktop window (step 5); the names in a match's
state ("Bot 3", "You" in a local match) stay as the match began, since they travel.

**Step 2 done (2026-10-04)**: a Language dropdown above Effects in the menu and among the
pause menu's settings, each language in its own name (`languageOptions`). The choice is saved
as `bollwerk.language`; a first visit takes the browser's own language if the game speaks it
(`detectLanguage`: "de-AT" is German), else English; `&lang=` sets one for screenshots
without saving it (`startingLanguage`). The page's `lang` follows, for CSS uppercase and
screen readers. A change in the menu writes the menu afresh, keeping a name typed but not yet
saved; mid-match, the HUD takes it at the next frame since it is redrawn every frame, and the
panels built once and kept listen (`onLanguageChange`) — the pause menu fills itself afresh,
the network badge's tooltip and the "You're out" strip's button are relabelled, as is the
corner sound switch. With English alone the dropdown has one entry; German arrives in step 3,
and with it the first real switch to watch.

**Step 3 done (2026-10-04)**: German, drafted and read by the user, who changed Credits
(kept as "Credits"), How to play ("Spielregeln"), host ("Host", throughout) and the bots'
targeting ("effizient", "gnadenlos", "nachtragend"); the rest was approved. Fixed terms: Burg,
Mauer, Kanone, Runde, umschließen, Spiel; "Teil" for a wall piece; "Optik" for the looks.
`german.test.ts` renders the lobby, open games, gallery and credits in German and fills every
text, failing on any key or placeholder showing through. Seen switching in the menu and, from
the pause menu, mid-match.

**Step 4 done (2026-10-04)**: every screen in German at 1024 and 1400 pixels — menu,
gallery, Spielregeln, Credits, the lobby in teams of eight, the HUD at three and eight and in
teams, the cannon count, the pause menu, the "out" strip, the end screen with awards and the
bots' reveal, and the banners, plaques and stamps placed by script. What did not fit, all at
1024 and all in the HUD's bar: the roster sized its figures assuming a 300-pixel phase label,
and German's "Bau deine Mauern wieder auf" is half as long again — so four teams' pips ran
into the next team's letter (English already clipped the last) and eight players lost a
pip each. Fixed for every language rather than by shortening approved German: the HUD
measures the label (`--phase`), a team counts as 1.4 entries since its figures carry five
pips, an entry clips at its own edge rather than spilling into the next, a phase label over
22 characters is set smaller (`.phase.long`; English's "Next: Rebuild your walls" too), and
the pips' smallest size and the gap between entries came down a little. Award titles wrap
balanced ("Erzfeind von Bot 3"). The Credits keep each audio file's own words, so the
sound effects read "von various authors"; credits are not translated, as decided.

**Step 5 done (2026-10-04)**: the desktop app's server window speaks the system's language
(`detectLanguage` over the page's `navigator.languages`, which Electron takes from the
system), 22 texts under `desktop.*` — its title, the status lines, Start and Stop, the port
messages, Copy, Open in browser, Play here, the two notes. The game in its own window follows
the dropdown as everywhere. The language list and its detection moved to
`@bollwerk/config/languages`, a module with no dependencies, and the window reads the two
locale files directly: importing the configuration whole took its script from 2.5 kB to
870 kB, now 31 kB. Seen in German and English, running and with its port taken.

## 12h. The weekend soak, and carelessness that fades (2026-10-05)

The soak planned in `docs/SOAKS.md` (below, as it stood), packages A, B and D, ran on this
machine from the evening of 2026-10-02 to the next morning: 22,656 matches at `568feb6` in
1,417 chunks of 16, ten processes at a time, about eleven hours, nothing failed. Its folder is `soaks/2026-10-02/`
(git-ignored), its reading `summary.txt`. The weekend's commits — languages, styles,
rendering, and bots planning a third faster (`fac3d8b`) — were pulled first, and 57 soak
matches from 19 tables (2–8 players, Levels 1–10, teams, no cap) replayed on the new code
to identical hashes, so the figures describe the code as of `1ec623e`.

**PLAN 11.2, points decide, elimination threatens — met.** At Level 5, dealt personalities:

| Table       | At the cap | Knockouts a match | Median margin | Under 10% | Lead changed after round 5 | Round 5's leader won |
| ----------- | ---------- | ----------------- | ------------- | --------- | -------------------------- | -------------------- |
| 3 players   | 100%       | 0.14              | 20.6%         | 27%       | 47%                        | 64%                  |
| 4 players   | 100%       | 0.18              | 15.8%         | 33%       | 53%                        | 61%                  |
| 2v2         | 93%        | 0.14              | 24.1%         | 23%       | 33%                        | 73%                  |
| 6 players   | 100%       | 0.26              | 13.6%         | 38%       | 69%                        | 45%                  |
| 8 players   | 100%       | 0.25              | 13.9%         | 38%       | 75%                        | 35%                  |
| 3p, Level 8 | 100%       | 0.10              | 23.1%         | 22%       | 51%                        | 60%                  |
| 3p, 3/5/6   | 99%        | 0.22              | 28.1%         | 18%       | 42%                        | 67%                  |

960 matches a table (Level 8, 480). No knockout in rounds 1–2 in any capped table, nearly
all in rounds 6–10. 12–13% of player-rounds fail to seal and about 90% of players fail at
least once; the user's four recorded games, replayed, fail 15%. Bot against bot the margins
are wider than the user's 6% game, but a third of matches finish within 10% and the lead
changes after round 5 in half of them. Decided with the user: nothing to change.

**PLAN 11.3, two players — no longer a problem.** At Level 5, 93% end at the cap in 9.9
rounds, cannon room 2.7 (it was 0.7, with matches that would not end). Without a cap, 94%
end by knockout in 19 rounds on average; 4 of 480 reached the tick limit and 27 were
simultaneous knockouts, a draw. Level 3 against Level 6, no cap: 18 of 480 unfinished. A
skill gap tells hard at two: Level 6 beats Level 3 95% of the time, by a median 82%.

**PLAN 11.4, position bias.** None at four players. At three, pooled over 14,976 matches of
rotated and uniform tables, island 3 wins 35.3% and island 1 31.6% (±0.8): a small edge of
the ring, which the seat shuffle hides from players. Left alone, the user's decision. At 5–8
players one island a table falls past two standard errors, as chance alone allows.

**PLAN 11.4 and 11.13, the ladder.** One bot at the row's level against two at the column's,
the odd seat rotated through the islands (96 matches a cell, 480 against Level 5):

```
  vs     L1   L2   L3   L4   L5   L6   L7   L8   L9  L10
  L1      ·  20%  13%   2%   0%   1%   0%   0%   0%   0%
  L2    54%    ·  36%  17%   2%   3%   2%   0%   2%   0%
  L3    66%  42%    ·  29%   3%   2%   1%   0%   0%   1%
  L4    76%  55%  41%    ·   6%   4%   4%   4%   3%   0%
  L5    95%  89%  82%  82%  31%  27%  16%  11%   9%   4%
  L6    95%  86%  92%  78%  42%    ·  24%  15%  10%   7%
  L7    96%  90%  88%  93%  49%  26%    ·  39%  21%  13%
  L8    98%  89%  92%  82%  56%  50%  45%    ·  27%  14%
  L9   100%  96%  97%  81%  70%  71%  54%  51%    ·  23%
  L10   99%  98%  98%  92%  75%  72%  65%  60%  33%    ·
```

The order holds, with a cliff from Level 4 to 5. **Levels 6 and 7** looked alike head to
head, but those cells carry ±9.6 points; against two Level 5s (±4.3) the climb is even —
42%, 49%, 56%, 70%, 75% for Levels 6 to 10 — and the step from 6 to 7 is the same in the
table as 5 to 6 and 7 to 8 (4% faster building, 11–13% faster firing). The three steps
from 5 to 8 build only 4% faster where the others build 7–9%; the user leaves them. The
jump from 8 to 9 matches its 9% building step: building speed is what strength follows.
**Level 8's knockouts** (11.13) are 0.10 a match against Level 5's 0.14: no problem.

**Personalities.** Win share over seat share, 7,200 Level 5 matches: risk balanced 1.15,
defensive 0.96, offensive 0.90; cannons secondary 1.13, balanced 0.95, max 0.92; targeting
strategic 1.04, finisher 1.02, grudge 1.01, points 0.94 — the same in every table. No trait
decides a match (the strongest, 38% where 33% is fair); the user accepts it, offensive play
being meant to swing.

### The cliff from Level 4 to 5, and carelessness that fades

The code said why: below Level 5 any sloppiness at all switched on two careless choices —
the castle taken at random, and a gun's spot weighed half by chance — while the slips in
fitting a piece faded with sloppiness. Measured with a temporary table, 192 matches a cell,
a Level 4 variant against two Level 5s: as it was 6.3% (the soak's 480); with the switches
and no slips in fitting 5.2%; careful, with neither, 13.0% — and that careful Level 4 won
64.1% against two ordinary ones. So the switches were the cliff, the fitting slips nothing,
and the step in speed from 4 to 5 the rest.

**`carelessness`**, a new column of the level table, makes the switches chances: the castle
at random, and a gun placed carelessly, each with that probability — 1, 0.75, 0.5, 0.25 and
0 for Levels 1 to 5, anchored at Levels 1, 2 and 5. The stream is drawn only by a level with
any carelessness, so Levels 5–10 play exactly as before: 96 control matches of theirs ended
on the soak's hashes. Measured on the soak's own seeds (240 matches a level against two
Level 5s, 96 a cell otherwise), before and after:

| One at ... against two at ... | Before      | After        |
| ----------------------------- | ----------- | ------------ |
| L2 against L1                 | 54%         | 58%          |
| L3 against L2                 | 42%         | 53%          |
| L4 against L3                 | 41%         | 53%          |
| L5 against L4                 | 82%         | 58%          |
| L1 against L2                 | 20%         | 7%           |
| L2 against L3                 | 36%         | 17%          |
| L3 against L4                 | 29%         | 19%          |
| L4 against L5                 | 6%          | 15%          |
| L1, L2, L3, L4 against two L5 | 0, 2, 3, 6% | 0, 1, 7, 15% |

The steps from 1 to 5 are now alike — a level wins 53–58% against two of the one below, and
7–19% against two of the one above — where 4 to 5 was a cliff and the steps below it shallow.
Level 1, still careless every time, falls further behind the rest.

### The plan's sections, as they stood

### Formerly PLAN 11.2 Points decide, elimination threatens — goal revised 2026-10-01

**The goal, the user's decision of 2026-10-01**: almost every match is decided **on points
at the round cap**. Elimination stays a real threat and must stay relevant — failing to
seal costs the round's points and a life, and a player who fails one time more than their
lives allow is out, can no longer win, and should feel it coming — but a knockout is the
exception that punishes, not the way matches end. It replaces the target of 2026-09-25,
half of three- and four-player matches ending with one player left before the cap, which
is in ARCHIVE 11zo with the levers it called for.

**So the scoring formula is the game's balance** (§1.7), as it already was in practice, and
what is measured is whether points make good matches:

- **Close finishes and changes of lead**: a winner's margin, and how often the lead changes
  hands after the early rounds, so that the last rounds still matter.
- **The threat is real**: most players fail to seal at least once in a match and spend a
  life for it; a person's failure rate stays near what it is (about 20%); knockouts happen
  now and then — to a player who takes too much risk or falls behind on repairs — and
  hardly ever in rounds 1–2.
- **The ladder holds** under points: a better level still wins most matches, and no
  personality decides a match on its own (the 11.6 guardrail).

**Levers no longer wanted for it**: continues 2 -> 1 and the placement delay
(`build.placementCooldownMs`) were planned to raise eliminations to half; neither is
needed now, and neither is planned. Kept in mind only if elimination stops being a threat
at all — nobody ever spending a life. **The weights stay** (§1.7).

**Today's evidence.** The latest test game (2026-10-01, one person against three Level 5
bots dealt from the bag — balanced, defensive and offensive risk, three different
targetings — in `recordings/`): the person won on points, 1423 to 1335, 1039 and 819, a
margin of 6%. Bot 4 took the lead in round 6 and lost it in round 8. Nobody was knocked
out; seven of forty player-rounds failed to seal (17.5%), every player failed at least once
and three of four twice — one short of being out. The person's territory points led
(113 a round against 45–87) and their damage trailed (30 against 33–46). The user's verdict:
close, and the balance quite good as it is. The first human game (2026-09-28) was also won
on points, failing two rounds of ten. Two games; the soak is what tells it at scale.

#### Steps

1. **Measure points as the deciding thing**, current rules, at three and four players and
   2v2, Level 5 and Level 8 tables over the dealt personality mix: winners' margins,
   changes of lead after round 5, lives spent per player, forfeit rate, knockouts and the
   round each happens in. Measurement only; `--stats` and `analysis` carry all of it but
   the lead changes, which are a few lines over the per-round scores.
2. **The same over the recorded human games**, with `--replay`, as they accumulate.
3. **Decide with the user** whether anything wants changing. The game reads as balanced to
   them today, so the default is to change nothing.

**Recording it** (ARCHIVE 11e): every test match lands in `recordings/` with its
statistics beside it once it ends — the same per-round table the bots produce — so how
often a person loses a castle, how much of the build phase they use and what repair they
leave undone are measured, not recalled. The user's impressions come separately.

### Formerly PLAN 11.3 Two-player balance

The worst thing in the project. At gunner, over ten seeds: **33.8 rounds average, three
matches unfinished, cannon room 0.7, and only 48% of the build phase used.** Three players
is healthy by comparison at 12.3 rounds. The bots are back to cramped walls with idle guns
— the failure mode of 10h — because the smaller starting ring plus heavier incoming fire
leaves no budget for room.

Levers not yet tried: `cannons.maxTotal` (still `null`), the opening cannon count, and the
combat-to-build ratio. **Needs re-measuring before anything is tried**: that figure predates
the round cap and the bots of 10s. At the cap, eight two-player gunner matches all reached
round 10, two ending by elimination. Best done after 11.2's measurements, which say what
balanced means.

### Formerly PLAN 11.13 Loose ends from the bots

Left open when 11.6 finished (ARCHIVE 11x–11zb, 11zd); none blocks anything.

- **Levels 6 and 7 play alike** (5 wins of 12 each against two Level 5 bots), and Levels 1
  and 2 are not told apart by that test, since Level 5 beats both every time. The table is
  anchors in `ai.default.json`, interpolated.
- **Max cannons forfeits more** (13.6% against 9.4%) for gun room its fixed reward cannot
  fill, though it wins a fair share; pockets only when room is short is the first thing to
  try, if it matters.
- **Level 8 knockouts rose** after phase 2's "close gaps from the outside" (1 to 7 in 36
  matches), forfeits within noise. Worth a look when 11.2 measures knockouts anyway.

### Formerly docs/SOAKS.md — the soak plan, agreed 2026-10-02

The runner stays (`npm run soak`, `tools/headless/src/soak.ts`, its usage in that file's
header), and so does the batch list it runs (`soakPlan.ts`), for the next soak.

Agreed with the user on 2026-10-02, to be run at the end of a day, when the machine is free
for an hour or two. **Measurement only**: nothing here changes a rule, a bot or a number in
`config/`. A finding that suggests a change goes into `PLAN.md` as a question for the user,
never straight into a commit. The test games of late September and early October already
read as solid and well balanced, with Levels 3–6 rising in skill without overwhelming a
person — so the default outcome is to change nothing, and the point is evidence.

It serves the open sections of `PLAN.md` §11: **11.2** (points decide, elimination
threatens), **11.3** (two players), **11.4** (measurements never taken) and **11.13** (the
bots' loose ends).

**The weekend run (begun 2026-10-02).** The user chose packages A, B and D of a larger plan, for
a run over a weekend on the user's other machine with nobody watching: A, soaks 1, 4 and 5 at two to ten
times the sizes below (960 matches for the main tables); B, the full ladder — soak 2 at 480
a level, and every other pairing of levels, one bot at _k_ against two at _j_, 96 matches
each; D, two players with no round cap, five and seven players, and soak 6. Package C, rule
variants, was declined: the default rules read as solid and are not expected to change
without a very good reason. The batch list is code, `tools/headless/src/soakPlan.ts` — 291
batches, 22,656 matches, about 39 hours of one core and 11 hours on ten workers (matches run 2.8 times slower ten at a time: the twelve cores are six physical ones) — and it,
not the tables below, is what runs.

#### 0. Before the run: the summary tool — done

The harness's `--stats` table has the per-round numbers; who won is the sim's verdict, so
the harness also writes one row a match with `--outcomes FILE` (`MatchOutcome` in
`@bollwerk/analysis`: teams, levels, personalities, how it ended, winners, final scores,
the state hash). The summary is **`tools/headless/src/soakSummary.ts`**, tested on a
hand-made table, reading both and writing, a line a group then a block each:

| Measure                    | From the rows                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| How matches end            | the last round's rows: one player left (elimination), at the cap on points, a draw                                       |
| Winner's margin            | final score of the winner against the runner-up, as a share of the winner's; median, and the share of matches under 10%  |
| Lead changes after round 5 | the leader by score after each resolution from round 5 on, counting changes; and how often the leader after round 5 wins |
| Lives spent                | rounds a player failed to seal (`enclosedCastles` 0); mean per player, and the share who spent at least one              |
| Failed seals               | failed player-rounds over all player-rounds                                                                              |
| Knockouts                  | players `eliminated` by the end; per match, and the round each happened in                                               |
| Wins by level              | in mixed tables, each level's share of wins against its fair share                                                       |
| Wins by trait              | each personality value's share of wins (risk, targeting, cannon space) against its fair share                            |
| Wins by island             | each player id's share — in the harness player p is island p + 1 — against 1 / players                                   |
| Ties                       | matches with a shared win                                                                                                |

Team tables (2v2) score and rank by team, as the game does; a shared win is split between
its winners; a share beside a fair one is starred beyond two standard errors. The ladder and
the pairings are laid out as one matrix: the odd seat's share of wins, a third being even.
`npm run soak -- --summarise FILE...` summarises any stats tables, recordings' included.

#### 1. Where the output goes

Every run writes under **`soaks/<date>/`** at the repository root, which is git-ignored —
soak output is data, as recordings are, and is summarised into the plan rather than
committed. One set of files a chunk of 16 matches — `<batch>.<nnn>.csv`, `.outcomes.csv`,
`.log` — and `run.json` (the commit), `progress.txt`, `problems.txt` if anything failed, and
at the end **`summary.txt`**, the one file to read. The `recordings/` folder is only read.

#### 2. The batches

Personalities are always **`dealt`**, from the seed by the bag, as a real match deals them.
Every batch has its own range of seeds (`--seed` is the first; match _i_ uses seed + _i_), so
no two batches play the same map. The harness puts player p on island p + 1 without the
seat shuffle a real match does, so **mixed tables rotate their level lists** across three
sub-batches, and no level sits on one island.

`H` below is `npm start -w @bollwerk/headless --`.

##### Soak 1 — how good the points game is (PLAN 11.2)

| Batch       | Command                                                                                                             | Matches |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| s1-3p-L5    | `H --players 3 --level 5 --personality dealt --matches 96 --seed 1000 --stats soaks/<date>/s1-3p-L5.csv`            | 96      |
| s1-4p-L5    | `H --players 4 --level 5 --personality dealt --matches 96 --seed 2000 --stats soaks/<date>/s1-4p-L5.csv`            | 96      |
| s1-2v2-L5   | `H --players 4 --teams 2 --level 5 --personality dealt --matches 96 --seed 3000 --stats soaks/<date>/s1-2v2-L5.csv` | 96      |
| s1-3p-L8    | `H --players 3 --level 8 --personality dealt --matches 48 --seed 4000 --stats soaks/<date>/s1-3p-L8.csv`            | 48      |
| s1-mix356-a | `H --players 3 --level 3,5,6 --personality dealt --matches 32 --seed 5000 --stats soaks/<date>/s1-mix356-a.csv`     | 32      |
| s1-mix356-b | `H --players 3 --level 5,6,3 --personality dealt --matches 32 --seed 5100 --stats soaks/<date>/s1-mix356-b.csv`     | 32      |
| s1-mix356-c | `H --players 3 --level 6,3,5 --personality dealt --matches 32 --seed 5200 --stats soaks/<date>/s1-mix356-c.csv`     | 32      |

The mixed table, Levels 3, 5 and 6, is the kind the user plays against.

##### Soak 2 — the skill ladder (PLAN 11.4, 11.13)

One bot at Level _k_ against two at Level 5, for _k_ from 1 to 10, 48 matches each, the odd
level rotated through all three seats, 16 matches a seat:

```bash
for k in 1 2 3 4 5 6 7 8 9 10; do
  H --players 3 --level $k,5,5 --personality dealt --matches 16 --seed $((6000 + k*100))      --stats soaks/<date>/s2-L$k-a.csv
  H --players 3 --level 5,$k,5 --personality dealt --matches 16 --seed $((6000 + k*100 + 20)) --stats soaks/<date>/s2-L$k-b.csv
  H --players 3 --level 5,5,$k --personality dealt --matches 16 --seed $((6000 + k*100 + 40)) --stats soaks/<date>/s2-L$k-c.csv
done
```

480 matches. Level 5 against two Level 5 is the control: about a third of the wins.

##### Soak 3 — personalities

No runs of its own: each trait value's share of wins, read from soak 1's Level 5 tables
(288 matches, about 860 bot seats), against its fair share. The guardrail of the bot work
(ARCHIVE 11zb) is that no personality decides a match on its own.

##### Soak 4 — two players (PLAN 11.3)

| Batch      | Command                                                                                                      | Matches |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| s4-2p-L5   | `H --players 2 --level 5 --personality dealt --matches 96 --seed 8000 --stats soaks/<date>/s4-2p-L5.csv`     | 96      |
| s4-2p-36-a | `H --players 2 --level 3,6 --personality dealt --matches 48 --seed 8200 --stats soaks/<date>/s4-2p-36-a.csv` | 48      |
| s4-2p-36-b | `H --players 2 --level 6,3 --personality dealt --matches 48 --seed 8300 --stats soaks/<date>/s4-2p-36-b.csv` | 48      |

Beyond soak 1's measures: rounds played, matches that never end (the old fear of 11.3),
and room for guns (`cannonRoom`), whose 0.7 at two players was the worst figure in the plan.

##### Soak 5 — position bias (PLAN 11.4)

| Batch | Command                                                                                               | Matches |
| ----- | ----------------------------------------------------------------------------------------------------- | ------- |
| s5-4p | `H --players 4 --level 5 --personality dealt --matches 96 --seed 9000 --stats soaks/<date>/s5-4p.csv` | 96      |
| s5-6p | `H --players 6 --level 5 --personality dealt --matches 96 --seed 9200 --stats soaks/<date>/s5-6p.csv` | 96      |
| s5-8p | `H --players 8 --level 5 --personality dealt --matches 96 --seed 9400 --stats soaks/<date>/s5-8p.csv` | 96      |

Wins by island against 1 / players. With every seat the same level and personalities
dealt, an island winning clearly more than its share — beyond about two standard errors —
is the map, not the bots. 4p can reuse soak 1's s1-4p-L5 as a second sample.

##### Soak 6 — the user's recorded games

```bash
H --replay recordings/ --stats soaks/<date>/s6-human.csv
```

Every complete recording, re-measured against the current code (each header names the
commit that made it; a replay that diverges says so, and those rows are set aside). The
person's failed seals, pieces placed, territory and damage against the bots' at the same
tables. A few games only: read as colour, not as a sample.

#### 3. Running it

The runner is **`npm run soak`** (`tools/headless/src/soak.ts`), from the repository root.
It runs the plan's chunks, the dearest first, in a pool of harness processes at
below-normal priority — all cores but two by default — and writes the summary at the end.
A chunk's files are written under a temporary name and renamed when its process ends, so a
chunk with files is complete, and **the same command after any stop carries on** where it
was. It refuses a tree with uncommitted changes, and a folder begun at another commit.

```bash
npm run soak                       # all of it, into soaks/<today>/
npm run soak -- --out soaks/<date>   # resume that folder, after a restart
npm run soak -- --list             # the plan and its cost, running nothing
npm run soak -- --trial            # every batch at two matches, into soaks/trial-<today>/
npm run soak -- --only s1,s4       # batches whose names start so
npm run soak -- --summary --out soaks/<date>   # remake summary.txt from what is there
```

Nothing else should be built or tested on the machine while it runs, and **no code may
change under it**: a soak reads the working tree as it runs, so a commit mid-run mixes two
versions of the bots. The machine must not sleep, and Windows Update should be paused for
the run; a restart costs only the chunks in flight, once the command is started again.

#### 4. Reading it, and what happens next

In the next interactive session after the run:

1. **The summary is read together** and written into `PLAN.md`: 11.2 gains the points-game
   figures for each table, 11.3 the two-player ones, 11.4 the ladder and position bias,
   11.13 what became of its loose ends (Levels 6 and 7, Levels 1 and 2, max cannons'
   forfeits, Level 8's knockouts). Numbers with their sample sizes, and the margin of
   error where a share is compared with a fair share (96 matches is about ±10 points, 48
   about ±14).
2. **What the user's games say** (soak 6) beside the bots'.
3. **Anything that looks out of line is a question, not a change**: written into the plan
   with the evidence, decided with the user, and only then built — measured before and
   after with the same seeds (CLAUDE.md, before-and-after soaks).
4. Once settled, the figures move into `ARCHIVE.md` as the baseline of M7.

##### What would count as out of line

Guides for the reading, not targets to tune to:

- **Matches**: nearly all decided on points at the cap (the 2026-10-01 goal); a knockout now
  and then, hardly ever in rounds 1–2; most players spending at least one life.
- **Closeness**: a good share of matches won by under 10%, and the lead changing after
  round 5 in a fair share of them — a match whose leader after round 5 almost always wins
  is decided too early.
- **The ladder**: each level winning at least as often as the one below, with Level 5 near
  a third against two Level 5s; a level that does not climb is a loose end (11.13).
- **Personalities**: no trait value far outside its fair share (beyond about two standard
  errors).
- **Islands**: none clearly favoured at 4, 6 or 8 players.
- **Two players**: every match ending, and room for guns not back at the old 0.7.

## 12i. Square bases under every gun (2026-10-05)

Test players found the round guns of several styles hard to read while building: a player
building round a gun judges what its 2x2 footprint takes up, and a circle hides the corners,
where the square guns of Minimal and Toy bricks were clear. Every gun now stands on a plain
square filling its footprint, a hair in from the edge so neighbours part, in the owner's
darker shade and outlined in their colour (`cannonBase` in `render/cannonBase.ts`): under the
round guns of Opera, Cyberpunk, Stained glass, Chocolate and Halloween, and the stands of
Sakura and Oktoberfest, which were not round but showed no footprint either; Blueprint's an
outline in the owner's ink, Parchment's tinted paper. Medieval's and Night's gun pits are
sprites, so their square is a stone slab in the pit's sprite, tinted per player with the
rest. Simple on purpose, the user's wish: the gun on it is the style's; the base only says
where it stands and whose it is. Checked in screenshots of every style's build phase.

## 12j. Opening the host's port by UPnP (PLAN 11.21, 2026-10-05)

A host can let friends outside the house join without forwarding a port by hand, where the
router allows it. Decided with the user before building: **off by default** — it opens a
port to the whole internet, which a game among friends at home does not need — so the
desktop app has a switch, **Open to the internet**, remembered once set (`settings.json` in
the app's data folder), and `npm start -- --upnp` asks from the command line; the image
never does, and nothing in it passes the flag. That also settled the plan's contradiction:
it wanted UPnP off in the image through `server.default.json`, which the image ships, while
the environment may say only where to listen. The config holds only the lease
(`server.upnp.leaseSeconds`, an hour) and how long to look for a router.

**How** (`packages/server/src/upnp.ts`): `@achingbrain/nat-port-mapper`, pure JavaScript
and maintained, finds the first IPv4 internet gateway answering UPnP IGD within six seconds,
asks it for its outside address first — a private or carrier-grade one (100.64.0.0/10:
DS-Lite cable, some fibre and mobile) means **no mapping can help**, and the host is told so
rather than shown an address nobody can reach — then maps the same port from this machine's
address on the router's network, with a lease the library renews. The mapping is removed
before the server stops (bounded at two seconds, so a silent router cannot hold up a stop)
and lapses by itself if the process dies. A request the host has withdrawn meanwhile is
dropped. NAT-PMP and PCP, which the plan named for routers without UPnP, were left out: the
library needs the default gateway's address for them, and the routers common here — the
FRITZ!Box above all — speak UPnP IGD. A public IPv6 address of the machine is mentioned too,
"if the router lets them": many routers' firewalls do not by default.

**Saying what happened**: the desktop window under the switch — the public address with a
Copy button, or that the router did not answer (UPnP off or unsupported: forward by hand),
refused (with its reason), or that the line has no public address (a VPN such as Tailscale
helps) — and the console for `npm start`. **The lobby** shows the link for friends outside,
`http://<public address>:<port>/?join=<code>`, under the room code with its own Copy: the
`room` message carries the server's public address while the port is open (`internet`,
**protocol 16**), and every open lobby is told again when it comes or goes.

**Bundling**: `@achingbrain/ssdp`, beneath the library, reads its own `package.json` at run
time to sign its messages, which no bundle resolves — the bundled server died on start. A
small esbuild plugin (`packages/server/bundling.js`, shared with the desktop app's build)
writes the name and version into that code as it is bundled, and fails the build if the
library stops reading it that way.

**Tested** against a fake router (mapping, refusal, no router, no public address, a request
withdrawn mid-search, the lobby's address arriving and leaving), and the window drawn in its
states in both languages. **Not tested on a real router**: this machine cannot reach the
user's; the user tries it at home, from a phone on mobile data.

### The plan's section, as it stood

### Formerly PLAN 11.21 Opening the host's port by UPnP — agreed 2026-10-03, not started

**The goal**: a person hosting from the desktop app or `npm start` is reachable from the
internet without forwarding port 8080 by hand — **where the router allows it**, which is
not everywhere, and saying plainly when it did not work. A hosted public server would solve
it for everyone but costs money every month, which a fan project without a budget does not
spend (decided 2026-10-03, §12).

**How**: as the server starts, ask the router for a mapping of the game's port — UPnP IGD,
and NAT-PMP / PCP for routers that speak those instead — with a lease of about an hour,
renewed while running and removed as the server stops; a lease that expires on its own
covers a crash. A small pure-JavaScript library rather than a native one, so it works in
Electron and Node alike; to be evaluated first (`@achingbrain/nat-port-mapper` is a
candidate). Only the one port, only while the server runs.

**Saying what happened**, in the server window and the console where the addresses are
printed today (`addresses.ts`): "Reachable from the internet at 203.0.113.7:8080"; or "The
router did not open the port (UPnP is off, or not supported) — forward 8080 by hand"; or
**"This connection has no public address"** when the address the router reports is itself
private or carrier-grade (100.64.0.0/10) — common in Germany on cable (DS-Lite) and some
fibre and mobile lines, where no router setting can help. A public IPv6 address, where
there is one, is listed too: guests with IPv6 can reach it directly.

**Configuration**: `server.upnp.enabled` in `config/server.default.json` — on for the
desktop app and `npm start`, off in the Docker image, which is deployed behind its own
networking.

**Testing**: the mapping logic against a fake gateway in unit tests; the real thing only on
the user's router, which this machine cannot reach. About one session.

**Not part of it**: relays, tunnels or a public lobby server, which need a machine on the
internet (§12).

## 12k. The piece schedule's rewind is settled (2026-10-05)

PLAN 11.4's last item was measuring `resetPieceScheduleOnContinue` against the alternative,
since only "on" had ever run. The user's decision: the rewind is absolutely needed, a player
coming back from a continue must get the early pieces again, and there is nothing to learn
from turning it off. The item is dropped, and with it 11.4; position bias and the full
ladder, its other two items, were measured by the weekend soak (12h).

## 12l. Office, a fourteenth style (2026-10-05)

The user's idea: something weird and funny, "Office". Pitched and agreed before building: an
open-plan office at war with itself, every department taking it deadly seriously, built of
office life where the other styles are built of a material. Decided with the user:
**cubicle partitions** for the walls, over stacked reams of copier paper or filing cabinets;
**photocopiers throwing paper planes** for the guns, over staplers firing paper balls; and
**silly** rather than dry, with the little people and jokes of the pitch kept — the
gossips at the water cooler, the colleague racing past on an office chair, the jammed
printer, the ringing phones.

What carries meaning: **sealed is the office working** (`FlagHoist`) — screen on with its
chart climbing, lamp lit, coffee steaming — and a breach puts a sad face on the screen;
**sealed ground is booked**, the owner's carpet tiles inside floor tape; **a silenced gun has
"out of order" taped on**. Changed from the pitch while building: the booked ground's tape is
striped in the owner's colour and white rather than yellow, and the big timer's liquid
crystal is dark on a pale green rather than amber — yellow and amber on the board would read
as the amber player's — and the pails under the leaks are grey for the same reason with
azure. The name stickers carry no "HELLO my name is": a text drawn by the stylesheet would
escape the locale files. The finish gained `memo`, sticky notes and paper clips, and
`necktie`, the winners' flag; the paper plane is `drawPlane` in `seaLife.ts`, shared by the
shots, the planes come down on the carpet and the sea life.

Drawn cheaply from the start (CLAUDE.md, drawing a style cheaply): partitions, offices and
booked ground by island (`IslandParts`), the copiers and planes as stamps turned and placed,
the coffee rings on a change, the shreds of a snowy match as stamps, the popcorn haze as
`Discs`. At eight players in combat, headless Chrome on this machine: 60 fps, render 0.8 ms
and 4,900 vertices rebuilt a frame, against Opera's 1.65 ms and 13,900 in the same run.

Seen in screenshots building, in combat at two, three and eight players, in the final round
with its tubes, at game over with the neckties, in a rainy and a foggy match, with the
printer-paper banner mid-wipe, the name stickers after a resolution, and the menu's title on
sticky notes. What the first look changed: the robot vacuums' bumpers, drawn as arcs with no
`moveTo`, carried on from the last path across the whole screen in long thin lines (an arc
in Pixi starts from wherever the path was); the title's letters, dots of marker, read as
blobs and became joined strokes; memos pinned to one partition in ten were too many, and are
one in sixteen. Anything moving is still to be seen in play (PLAN §11).

## 12m. The bar clear of its rule, written on a change, and the gallery playing (2026-10-05)

Three of six suggestions after Office, chosen by the user; the rest declined — a card on
hovering an island (nobody has time to hover in a game this fast, and the arcade feel wants
information kept minimal), tips on "Preparing the board" (up for a second at most), quick
emotes online, and a preview of the next piece, which would change the balance and give
people more to parse.

**The bar's second line under its rule.** The timer and the round label ran into the rule at
the bar's foot in every skin — unseen under rules of one to three pixels, where it is the
font's empty descent, but under Oktoberfest's lozenges (6 px), Office's tape (8) and Opera's
keyboard (9) the rule was painted over the figures, and the roster's by about three pixels.
Measured in every style at three players in English and eight in German: the phase block is
set at a line height of 1.1, which lifts the clock clear in every skin, and the three thick
rules take less padding at the top (`--hud-pad-top`). Everything in the bar now ends above
its rule.

**The bar written on a change** (PLAN 11.22). It was rebuilt with `innerHTML` and measured
every frame, which had the page restyled, laid out and repainted sixty times a second. The
label is written when its text changes and measured then, and again when the clock gains or
loses a figure; the clock's figures are the timer's text; the time bar's fill is the one
thing set every frame, by its width alone; a change of skin, whose lettering changes the
label's width, measures again. Over 300 frames of a watched build phase the label was
rewritten 7 times where it had been 265.

**The gallery's cards play on hover** (`galleryLive.ts`): the style runs over its still on
the same island, the sea and flags moving and a shot from the first gun every couple of
seconds, at the wall block farthest from it and into the sea by turns (`liveShot`, tested),
so each style's hit and splash are seen. One renderer for the gallery, made at the first
hover, its looks swapped by `Scene.replaceLooks` as the pointer moves — a quick sweep shows
only where it stops — drawing only while a card is hovered, destroyed with the gallery and
never with `destroy(true)`; nothing under reduced motion. Checked over the menu and over a
running match from the pause menu, which drew on unharmed.

## 12n. The test session of 2026-10-05: everything visual checked, 11.22 closed

The user and testers checked everything visual in a session of their own: **Office** ("very
cool", ARCHIVE 12l), **the stutter as the looks swap is gone** (PLAN 11.22 below), **the
German texts** in play and in the desktop window, **the square gun bases** in every style
(ARCHIVE 12i), and every style in motion from the plan's list of things to check in play.
Rendering performance, PLAN 11.22, is closed with it; its one item left, bots of one level
planning on the same ticks, is behaviour rather than drawing and stays in the plan as a
session of its own with a soak before and after. Its other ideas — the banner's HTML,
bringing the hidden look up to date during the pause before a banner, and Pixi's texture
GC — were not needed: the stutter they would have answered is gone.

### The list of things to check in play, as it stood

**To check in play**, since a still frame cannot show them: a knocked-out player's own
roster card looked cut off at its right edge in a screenshot (2026-10-02, the user to test);
Stained glass's shards, glints, fish and ship; the music and sounds sliders by ear; and
Chocolate in motion (ARCHIVE 11zy) — the river's current and the fall, the shine on the
walls, the fountains starting and stopping, a square snapping off, the sweep's melting, the
mould poured and wobbling, and whether the swirls cost frame rate at eight players; and
Halloween in motion (ARCHIVE 12a) — the fog, the bubbles, the freed ghosts, the lanterns
lit and put out, the candles, the cauldrons, the witching hour's eyes, and the frame rate
at eight players with the fog over everything; Sakura in motion (ARCHIVE 12d) — the crests
curling and breaking, the petals and the turn to maple leaves, the carp swimming and hanging
limp, the clouds a hit throws up, the rain's streaks, and the frame rate at eight players;
Oktoberfest in motion (ARCHIVE 12e) — the bubbles, the Ferris wheel, the Maß filling and
being drunk dry, pretzels spinning, bottles flying, the deposit's coin, the band's notes,
the Weißwurst; Opera in motion (ARCHIVE 12f) — the staves swelling and their notes riding,
the conductor's beat and its hurry, the houses playing and falling silent, the horns, the
sour notes, chords and glissandos, the finale's spotlights; Office in motion (ARCHIVE 12l) —
the copiers turning and flashing, the planes' flight and their crashes on the carpet, the
sheets fluttering out of a hit, the shredder, the flat-packs, the marching ants, the offices
working and their sad faces, the cooler's gossips, the deadline's tubes and ringing phones,
the robot vacuums and the chair racer, and the weather's shreds, drips and haze; whether one gallery for both looks reads
clearly, or two would (ARCHIVE 12b); and the larger roster figures and team tags in a
real team match (ARCHIVE 12c).

### Formerly PLAN 11.22 Rendering performance — agreed 2026-10-04, first in the next session

**The problem, the user's report (2026-10-04)**: serious stutter, worst in the newest styles,
Oktoberfest and Opera, even on a fast gaming PC with a good GPU. It is getting in the way of
play, so it comes before everything else. **The user's condition: keep every effect** — make
it cheaper, do not take it away.

**Why, as far as reading the code tells (not yet measured)**: Pixi draws with WebGL, so the
GPU is used, but the styles drawn from shapes **clear and rebuild their moving parts every
frame** in `Graphics` objects, and a rebuilt `Graphics` is cut into triangles on the CPU, in
JavaScript, on one thread, before the GPU sees it. The GPU then waits. Hence no help from a
good GPU. The heaviest by construction: Opera's staves (five wavy lines a stave across the
whole sea, a segment every half tile, stroked anew each frame) and the notes riding them;
Oktoberfest's bubbles (up to 260), the Ferris wheel (12 spokes, 24 lights, 8 gondolas), a
Maß on every tent, the pretzels as stroked polylines; then Sakura's crests and petals,
Halloween's fog, Chocolate's swirls, Night's and Cyberpunk's blur under "Glowing". All grow
with the map, so eight players is the worst case, and the renderer draws at up to twice the
screen's density. Only the visible look is redrawn (`Scene.drawEffects`), so the two looks
cost double only during a wipe.

**The principle: build once, then only move.** Moving, rotating, tinting and fading what
is already built is nearly free on the GPU; rebuilding it is what costs.

**Steps**:

1. **Measure first.** A frame-time readout behind `&perf=1`: milliseconds a frame, split
   into the sim, the HUD, and each layer's drawing (terrain's flow, effects, overlay), with
   the worst of the last seconds. Taken by the user on their PC for every style at three and
   eight players — headless Chrome cannot measure time (CLAUDE.md). The figures before every
   change, and after.
2. **Opera's staves**: drawn once, without the breaks at the coasts, and slid sideways each
   frame by their phase (wrapping by a wavelength); the breaks made by a mask of the open sea,
   drawn once with the terrain. The finale's swell as a second, taller set, or a scale. The
   riding notes as sprites of one note drawn once to a texture.
3. **Many small identical things as sprites** of a texture drawn once, tinted and moved:
   bubbles, petals, leaves, snow, rain, the riding and rising notes, coins, bits of debris —
   in a `ParticleContainer` where there are hundreds.
4. **What turns, turned**: the Ferris wheel drawn once and rotated, its gondolas alone
   moved; spinning pretzels and the like as sprites rotated rather than redrawn.
5. **What changes rarely, drawn when it changes**: the Maß on each tent, the houses' lights,
   the conductor's podium and body, the scorches and puddles — in a `Graphics` of their own,
   redrawn on a change of state, not sixty times a second.
6. **What must still be rebuilt, with fewer points**: plain fills for strokes where nobody
   can tell, fewer segments a curve.
7. Then the older styles the same way, in the order the measurements give.

Each step measured before and after with the readout, and checked by eye that nothing looks
different. Opera and Oktoberfest first.

**Progress (2026-10-04)**. The readout is `&perf=1` (`client/src/perf.ts`): milliseconds a
section, frame intervals with percentiles and stutter counts, and the vertices Pixi cut into
triangles again, by `Graphics` (named by layer) and at their worst in one frame — the count
that matters, since Pixi triangulates a changed `Graphics` inside `render`. Headless Chrome
on this machine renders on its real GPU (AMD Renoir, integrated), so it measures too; a
script drove a watched match at eight players, `seed=3&level=8&snapshot=combat&round=3`.
Found and done, in order of effect:

- **`motionReduced()` read storage and built a media query at every call**, and the styles
  call it per particle and per point of a curve: Opera's staves called it 37 000 times a
  frame, 48 ms. Cached (`motion.ts`): Opera 13.5 → 41 fps alone, and every style gains.
- **Walls redrawn whole at every hit**: Oktoberfest's were 200 000 vertices, 126 times in
  30 s — the stutter. `IslandParts` (`render/islandParts.ts`) draws an island to a
  `Graphics` and redraws the one hit: 35 000 at worst. Done in Minimal, Parchment,
  Oktoberfest and Opera.
- **Stamps** (`render/stamps.ts`): a `GraphicsContext` drawn once, shared by many
  `Graphics` that are only moved, turned, scaled and faded. Opera's riding notes, horn coils
  and notes in flight; Oktoberfest's kegs and pretzels (stroked with round joins, 70 000
  vertices a frame).
- **Drawn once, slid**: Opera's staves, masked by the open sea; **drawn on a change**:
  Opera's ink blots, Oktoberfest's Maß, Parchment's ink stains.

The user's figures on their own machine (the same integrated GPU, 2341x1160) confirmed it —
Opera 20.2 → 58.9 fps, frames over 50 ms 201 → 8; Parchment's render 6.3 → 3.4 ms; Minimal
unchanged — and the same was then done in **every style**:

- `IslandParts` for walls in all eleven styles drawn from shapes, and for **sealed ground**
  too (`of: 'territory'`), redrawn some 300 times in 30 s as breaches change it: each island's
  board carries only its own `islandId`, so `dimEliminated` dims an island once. Cyberpunk's
  additive glow is a second layer of parts.
- **`Memos`** for the guns' barrels in seven styles: a `Graphics` a gun, redrawn as it fires
  and kicks and not between. Halloween's brew keeps bubbling every frame, outside the memo.
- **Stamps** for Chocolate's swirls (a step per sixty-fourth of a turn and twentieth of a
  tile in size, since a squashed spiral turned is not the same shape rotated), Sakura's
  crests (per forty-eighth of their rise, mirrored for direction), Halloween's bog bubbles
  (a ring per half pixel of radius, so the line stays one pixel) and fog banks, and
  **Medieval's cloud shadows** — 700 soft discs a frame, 48 000 vertices, most of its cost.
- **Medieval's terrain sprites as a render group of their own** (`tileLayer`): beside the
  sea's crests, redrawn every frame, Pixi gathered and packed all ten thousand again each
  frame. Render 8.7 → 4.5 ms. Making the scene's layers render groups did nothing.
- **The bots' spikes**: in a local match bots think inside the frame, and a plan of their
  walls takes 15 to 50 ms; bots of one level plan on the same ticks (49 apart at level 8),
  so eight made ticks of 80 to 135 ms. `LocalMatch` now spreads a tick's turns over frames,
  8 ms a frame, the rest and the step waiting for the next: the same actions on the same
  ticks, which a test checks against a run with every bot in a frame of its own.

Final, the same 30 s at eight players on this machine, before any of it and now:

| Style         | fps         | frames > 50 ms | render ms  | vertices/frame | worst sim ms |
| ------------- | ----------- | -------------- | ---------- | -------------- | ------------ |
| Minimal       | 59.2 → 59.9 | 3 → 0          | 0.9 → 0.8  | 3k → 2k        | 83 → 22      |
| Medieval      | 34.7 → 58.9 | 37 → 0         | 18.8 → 4.5 | 57k → 9k       | 99 → 26      |
| Night         | 46.8 → 58.3 | 19 → 0         | 12.0 → 5.5 | 17k → 18k      | 100 → 25     |
| Cyberpunk     | 55.5 → 59.7 | 6 → 0          | 5.3 → 3.9  | 28k → 25k      | 90 → 29      |
| Blueprint     | 55.1 → 59.5 | 9 → 1          | 4.9 → 2.9  | 21k → 16k      | 120 → 33     |
| Parchment     | 53.7 → 59.7 | 14 → 0         | 7.7 → 2.5  | 43k → 10k      | 95 → 25      |
| Toy bricks    | 54.4 → 59.6 | 15 → 1         | 4.3 → 2.0  | 22k → 8k       | 90 → 22      |
| Stained glass | 58.1 → 59.9 | 7 → 0          | 3.5 → 1.6  | 22k → 7k       | 87 → 25      |
| Chocolate     | 44.8 → 58.8 | 49 → 1         | 13.7 → 5.8 | 83k → 19k      | 93 → 24      |
| Halloween     | 53.1 → 59.6 | 16 → 0         | 7.8 → 3.4  | 41k → 14k      | 95 → 22      |
| Sakura        | 50.3 → 59.6 | 20 → 0         | 10.3 → 4.0 | 67k → 18k      | 120 → 22     |
| Oktoberfest   | 45.2 → 58.9 | 84 → 4         | 10.0 → 3.7 | 59k → 22k      | 81 → 25      |
| Opera         | 13.5 → 59.5 | 279 → 0        | 14.8 → 3.7 | 78k → 19k      | 130 → 23     |

The screen's 60 Hz caps fps. Still open:

- **The styles in motion, by eye**: stills before and after matched for every style, but
  the stepped stamps — swirls turning, crests rising, bubbles swelling — and the draw order
  moved where a stamp now lies over later effects (Oktoberfest's pretzels and Opera's notes
  over splashes) need a look in play.
- **The server's bots**, partly answered (2026-10-04, second pass): `SealGraph` lays an
  island's flow graph once and cuts it for every set of castles a bot weighs, instead of
  eleven times a `sealOptions`; the cut is the same, edge for edge, and the headless
  matches end on the same hashes (seeds 3–4 at eight players, 11–13 at three). Bot time
  down a third (eight players, two matches: 25.3 → 17.1 s); in one eight-player match the
  worst tick fell 135 → 80 ms and ticks over 50 ms 65 → 14. Tried and dropped: caching
  graphs across a plan's calls (17.1 → 17.0 s) and a reused BFS queue (no change). Spreading
  the server's bots over its event loop would not help the room, which cannot send a tick
  before every bot has thought on it, and online the stall falls in the build phase, where a
  late tick only delays others' pieces. What remains is behaviour: bots of one level planning
  on the same ticks, which staggering would answer, as a design question first.
- **Night and Cyberpunk** took the same tools: Cyberpunk's barrels and their glow as `Memos`
  (25k → 16k a frame, 59.8 fps), Night's torch pools and flames as stamps of one disc in
  their added layers (`Discs`; 17k → 10k), and Medieval's and Night's wall sprites a render
  group of their own (render 5.3 → 4.9 ms in Night, 4.5 → 4.1 in Medieval).

**The stutter as the looks swap (2026-10-05)**, reported by testers as minor. Measured by a
script logging every frame of a watched eight-player match in headless Chrome on this
machine's integrated GPU, with Chrome's tracer for what lay outside the script: outside the
banners not one frame over 17 ms, but the "Fire!" bringing in the combat look cost two
frames of 117–167 ms (Minimal to Opera); "Rebuild" back into Minimal cost nothing. Three
causes, two done:

- **Done: the hidden look redrew its terrain at every wipe.** It was marked stale as a whole,
  and terrain, each style's dearest drawing, changes only with the window. Staleness is now
  by layer (`Scene`). At a later reveal Opera's drawing went 28 → 4 ms and Pixi's render of
  it 68 → 18.5 ms; Medieval's terrain alone had been 42 ms at every banner, and its reveal
  now drops no frame.
- **Done: a look's first reveal** cut all its drawing into triangles and uploaded its
  textures in that frame. `Scene.warmUp` renders the hidden look once offscreen in the
  match's first frame, behind "Preparing the board", and after a change of looks from the
  pause menu. The first "Fire!": Opera 183 → 68 ms, Medieval 117 → 33, Cyberpunk 100 → 65.
- **Left, the user's decision: the banner's own HTML.** Chrome's GPU process rastered the
  new Opera banner and the eight island banners in their Opera dress for 73 ms at one reveal
  (33 ms at the next), and the banner's first layout costs 7–18 ms, part of it fonts used
  for the first time. Putting the banner on a layer of its own (`will-change`) changed
  nothing. Ideas if it matters: reuse each style's banner element rather than making a new
  one, or make it in the pause before it moves.

**Done since (ARCHIVE 12m): the HUD's bar is written only when its text changes** — it was
rebuilt every frame (`innerHTML` of the phase label and the rest, then `offsetWidth`); now
the clock's figures are the timer's text, the time bar's fill only its width, and the label
measured only when it changes. Further ideas from the same reading, not taken up yet:
**bring the hidden look up to date during the pause
before a banner**, a layer a frame, so the reveal has nothing left to draw (Cyberpunk's
structures still take 13 ms then); and **Pixi's GC** unloads a texture unused for 60 s
(`gcMaxUnusedTime`), while the combat look is hidden 50–58 s around a build phase and longer
with a pause — not seen happening, but raising the limit would rule it out.

## 12o. Levels 2–4 and the volume sliders approved in play (2026-10-05)

The user and testers played the lower levels after carelessness began to fade by level
(12h): Levels 2–4 are approved as they are. The music and sounds sliders work as they
should by ear. Both come off the plan's list; UPnP on a real router is the one manual test
left.

## 12p. Bots share their plans, so they no longer plan on the same ticks (2026-10-05)

Left from 11.22 (12n): the stall a room feels when several bots plan at once. **Why they
coincided**: the pieces are dealt by `(seed, round, index)`, the same to every player, so
bots of one level take the same time over each piece, and a replan falls due only on a bot's
placement ticks. Every bot planned on the build phase's first tick, and bots of one level
stayed in step all phase. The room cannot send a tick before its bots have thought, and the
client does not predict, so a person's own piece showed up to two ticks late about every
1.5 s of an online build phase. Measured with a throwaway probe timing every bot's turn
(two matches a table, seeds 3 and 4, this machine; a tick is 33 ms): eight Level 8 bots all
planned together every 40–49 ticks, 40 ms a tick and up to 79, a plan being about 5 ms.

**The fix, the user's choice of two**: a table's bots share **a number of plans a tick**
(`PlanningSlots` in `packages/ai/src/planning.ts`, `ai.plansPerTick`, 2) — a wall's plan, the
spare work planned afresh at each placement once the plan stands, and a castle's choice — and
a bot finding none left waits a tick. Counted in plans, never in time, so a match plays the
same on any machine. Once apart they stay apart, keeping the same pace from different starts.
**The turns go in player order rotated by the round** (`turnOrder`), in the room, the local
match and the harness alike, so the bots that wait as a phase opens are not the same every
round. The other way offered, staggering each bot's first move of a phase, needed nothing
shared but guaranteed nothing once bots fell back in step. A bot made without slots, as in
tests, is never held back.

Build ticks over 33 ms, before and after; worst build tick in brackets:

| Table                  | Before   | After   |
| ---------------------- | -------- | ------- |
| 8 players, Level 8     | 111 (79) | 4 (59)  |
| 8 players, Level 5     | 99 (92)  | 13 (54) |
| 4 players, Level 5     | 33 (47)  | 8 (61)  |
| 8 players, Levels 3–10 | 29 (77)  | 3 (46)  |

Every bot choosing its castle on one tick cost 39–69 ms; now 30–46. One plan a
tick gained nothing over two (eight at Level 8: 4 slow ticks either way). What is left is a
different thing: a single bot's plan of 30 to 55 ms in a build phase's last few seconds (PLAN
§11), and the first salvo of combat, where every bot looks for each opponent's weakest wall
on one tick (one slow tick in two matches).

**No soak**, the user's decision: it does not matter that matches play out differently; the
probe is enough to show the gain. Every hash changed, so recordings made before replay only
against the commit that made them, as ever.

## 12q. Random looks every round, and the leak in every swap of looks (PLAN 11.23, 2026-10-06)

**The idea**, a play tester's: Random drew one style for the whole match. Instead it draws a
new one at every banner that brings its look, repeating none while any is left, and every
banner changes one style for a different one. **Agreed with the user**: the per-round Random
replaces the old one; both looks on Random share one cycle; the pause menu offers Random; short
hitches in the pauses between phases are acceptable; and the menu's title rotates its random
halves too. The user asked for the frame-rate cost first, and would have dropped the idea had
it been substantial.

**Measured first**, by a script in headless Chrome on this machine's integrated GPU, in a
watched eight-player match, swapping the hidden look through every style twice. Play is
untouched — only two looks are ever alive, and the hidden one costs nothing between banners —
but building a look in one frame was 75–295 ms: the theme's `init` 0–2 ms except Medieval and
Night, 160–180 ms (their generated atlas); terrain 8–80 ms; territory and structures 2–45 ms;
the warm-up 35–135 ms. After the warm-up a banner's reveal cost 3–25 ms, as before. All
fourteen looks built up front took 1.9 s and **+437 MB** of heap: not that way.

**A leak in every swap, already there** (the pause menu's Looks had it): forcing the
collector, the heap grew about 13 MB a swap, 50 → 585 MB over 42. Two causes, both Pixi's:

- **`destroy({ children: true })` hands its options down, and a `Graphics` destroyed with any
  options keeps its own context**, still registered with the renderer, geometry and all: 255
  contexts a pass through the styles. `release` (`render/release.ts`) destroys each one bare;
  every `destroy({ children: true })` in the renderer uses it. Contexts held steady at 51.
- **`BigPool` keeps what it is given back, with its last batcher's buffers** — several
  megabytes each, and a look's drawing is larger than the next's reuse: still about 45 MB a
  pass. `Scene.drop` empties it after throwing a look away; only free items go. Six passes then
  stayed between 76 and 175 MB, wherever the collector happened to be.
- And Medieval's and Night's frames share an atlas none of them owned, left uploaded: two
  textures a pass, now destroyed with the theme.

**Built** (`looks.ts`, `render/scene.ts`, `decor.ts`, `main.ts`):

- **`LookRotation`**: the looks come on screen as building, combat at "Fire!", building at
  "Rebuild" and so on, and are drawn in that order. One random: every style but the other
  look's, shuffled, a cycle at a time. Both: one shuffled cycle of all fourteen drawn by turns,
  seven rounds a cycle. A new cycle keeps the styles last on screen to its end: drawn anywhere,
  the first watched match brought the combat look back in Parchment straight after Parchment.
  The page's own `Math.random`, since no look reaches the sim, the server or a recording.
- **`Scene.prepare`** makes a look hidden, in a slot of its own kept up to date like the
  others, a frame's share (`SHARE_MS`, 8 ms) at a time: the theme — Medieval's and Night's atlas
  drawn a sprite at a time between calls to `pace` (`buildAtlasPaced`) — each board layer, and
  a first render of each thing in them, one at a time. **`promote`** puts it in place once the
  look it replaces is out of sight; until then the old one shows again, so a look not ready in
  time costs only the change. After each resolution the client prepares the combat look "Fire!"
  will bring and the build look of the "Rebuild" after it; the first round's build look is
  made at the start, behind "Preparing the board".
- **The pause menu** offers Random, and a change starts a new rotation; **the title**
  (`SplitTitle.use`, `titleTurn`) gives a random half its next style while it is out of sight in
  the sweep — the combat half as the line leaves the word, the build half once the combat banner
  has crossed — which is when a banner on the board would. Random's card and the menu's row say
  "A new style every round" on hover.

**After**, a watched eight-player match at double speed with both looks random: the looks
followed one cycle of fourteen, then a new one. Building a look is spread over about a third of
a second after each resolution; Medieval and Night now take half a second with no frame over
67 ms, where one frame of 270 ms was. The frames left long: 100–133 ms at a resolution, which
fixed looks show too (133 ms), and up to 133 ms when one first render cannot be split (Sakura's
terrain, 113 ms); and **each banner's first frame is now 67–100 ms**, where fixed looks pay that
only once, since every banner brings a style seen for the first time — about 25 ms of it the
board brought up to date, the rest, as in 12n, the banner's restyled HTML rastered for the
first time. With the pause menu, Office for building and combat switched to Random, the combat
look went through eight styles, never Office, and the choice was saved.

**Checked in play** by the user and testers (2026-10-06): the rotation works, the hitches are
barely noticeable, and the title reads very well. PLAN 11.23 closed.

## 12r. Cyberpunk under "Glowing": sharp cores, and the blur at half resolution (2026-10-06)

**Reported by testers**: under Glowing, Cyberpunk's banners stuttered at the phase changes and
combat dropped frames badly, with fixed looks as well as random ones. Night, the other bloomed
style, did not.

**Why**: Cyberpunk's glow was five layers, each spanning the board and each under its own
`BlurFilter` (strength 5, quality 2): a texture the size of the screen and four passes over it
apiece, about 2 ms of GPU each whatever was in it. Night has two. Measured with the match
paused at eight players, 1600x900, on this machine's integrated GPU, the variants switched live
and alternated three times: Standard 57 fps and 6.6 ms of GPU a frame, Glowing 39.5 fps and
15.1 ms. The cost grows with the screen's pixels, so the user's 2341x1160 paid nearly twice
that. Half resolution brought it to 8.5 ms; one blur alone cost 1–3 ms, whichever.

**And a fault the pictures showed**: the glow layers held the sharp cores as well as the glow —
the shots' white-hot heads and inner lines, the castles' cores, muzzle flashes, the power-down
rings, the holograms' flags, impact rings and glitch bars, arcs, fade outlines, sparks, and the
lit grid of sealed ground. Unbloomed, an added layer draws them sharp; bloomed, the blur took
them too, and shots flew as coloured smudges with the cores put out.

**Done, the user's approval of both**: the cores are drawn in `effectCore`, added like the glow
but never bloomed, above it; the grid of sealed ground is a layer of its own, added and never
bloomed, which leaves its glow layer empty, so four blurs rather than five; and the four run at
half resolution, which looked nearly alike side by side. Measured the same way: GPU 7.9 ms a
frame under Standard, 14.6 under Glowing before, 9.7 now — the blur's own cost 6.7 → 1.8 ms;
46.7 fps against 40.9, Standard 54.2 in that run. Under Glowing a shot's coloured trail and halo
are glow alone, so they read as a soft haze of the owner's colour round a sharp white head.

**Checked in play** by the user (2026-10-06): it looks very good and runs stable.

## 12s. A slow plan late in a build phase, and v0.7.0 (2026-10-06)

**The problem** (ARCHIVE 12p): with bots sharing their plans, the slow ticks left at eight
players were one bot's plan of 30 to 55 ms in a build phase's last seconds, against about 5 ms.
**Why**, from a throwaway probe timing every `decide()` in two matches of eight Level 5 bots
(seeds 3 and 4): 17 plans of 2046 over 25 ms, up to 104 — all with nothing sealed, under 2.5 s
left and a budget of 0.1–1.1 pieces, each three searches of about 10 ms that could not succeed:
`widestAffordable` for two castles at every room radius, `reseal`'s `widestAffordable` for one
castle keeping the guns, and `reseal`'s `sealOptions` at every radius, for its last resort.

**The fix, exact**: a wall that must enclose more — more castles, the guns, a band of room — is
never cheaper than one enclosing less, since any wall round the larger set also cuts off the
smaller. So `reseal`'s gun-keeping search is gone, which could never succeed: `decide` calls it
only once the tightest gun-keeping wall, its radius 0, is past the budget. And the two-castle
search runs only when the cheapest pair at no room fits. Tried first as a probe: no plan over
25 ms, the worst in a phase's last 3 s 15 ms. **Play is unchanged**: nine matches — eight at
Level 5, three at Level 8, four of mixed levels, six with personalities dealt — end on the same
hashes before and after, and whole matches run 5–9% faster.

**v0.7.0** was released the same day: random looks every round (12q), Cyberpunk's glow (12r)
and this.

## 12t. A piece in the corner for every style (PLAN 11.24, 2026-10-06)

Testers liked the piece seven styles stand in the sea's bottom-right corner — Parchment's
compass rose, Chocolate's chocolate fall, Halloween's moon, Sakura's Fuji, Oktoberfest's Ferris
wheel, Opera's conductor, Office's water cooler — so the other seven were given one, each
chosen by the user from two proposals: **Minimal** a signal buoy (Minimal kept, since players
choose it for its plainness: not only the style to debug against); **Medieval** a windmill;
**Night** a fishing boat with swaying lanterns; **Cyberpunk** a holographic billboard;
**Blueprint** the drawing's title block; **Toy bricks** a crane on a barge; **Stained glass**
an hourglass.

**Shared**: `corner.ts` — `cornerSpot`, the spot every piece stands on, and `pressing`, a
phase's last five seconds or overtime, when they hurry as the conductor does; every sea life
hides what passes behind the piece (`behindCorner` in `ocean.ts`). Each piece's timings are in
its style's config.

**How each was drawn**: the buoy, the crane and the hourglass are shapes redrawn each frame in
a `Graphics` of their own in the terrain layer, under everything, as the cooler is; the
windmill and the boat are pixel art on a grid of 40 by 40, each art pixel as many screen
pixels as the spot allows, the sails plotted a pixel at a time so they stay pixel art as they
turn, and in the terrain layer so the day's tint and the clouds pass over them. The boat's
light on the water is drawn under its hull in its own layer: with the torches' pools, which
lie over the terrain, it covered the hull as two brown discs. The billboard is drawn sharp in
`effectCore` and glows in `effectGlow` (12r). The title block is the first text on the board:
Pixi `Text`, rastered only when the words change, so the sheet's number and the "FINAL" stamp
are in the reader's language (`plan.sheet`, `plan.final`); a word too long for its cell is
lettered smaller. Corrected by looking: the buoy and the crane made a third larger than their
square, which their slender shapes do not fill; the billboard's cube tipped further and turned
a little, since face on it read as an 8 beside the big timer; the title block wider than its
square and its stamp larger; the boat's hull edged in moonlight, lost in the dark sea before.

**Measured** in a paused eight-player match, each piece on and off by turns three times: frame
rates 54–60 either way, render time within 0.6 ms; drawing a piece 0.1–0.3 ms a frame.

**Checked in play** by the user and testers (2026-10-06), every style: the new pieces are great. Released as **v0.8.0** the same day.
