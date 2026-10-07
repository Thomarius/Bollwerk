# Stronger bots: valuing options, then learning the weights

The plan agreed with the user on 2026-10-07, for future sessions. **Goals: stronger bots,
and learning how to integrate machine learning into a game.** Python and neural networks
are left out for now; the user may come back to them once the steps below have proved
useful. This file is the plan and its progress; when a step is done, record the result
here (and summarise it into ARCHIVE.md as usual).

Read first: PLAN §8 (how the bots play), ARCHIVE 10d, 10h, 10s, 11zb and 12h (how the
bots were tuned and what failed), CLAUDE.md "Measuring the bots" and "What has already
been tried".

---

## 1. The idea

### What the current bot measures, and what it misses

The bot's build phase is driven by the minimum cut (`SealPlanner` in `ai/src/tactics.ts`,
`Builder.decide` in `ai/src/building.ts`): how many blocks the cheapest sealing wall still
needs. After a breach it repairs tight first (ARCHIVE 10s), and widens only within a
budget (`widestAffordable`, `piecesAffordable`).

The testers often did something else: **while repairing, they laid pieces that already
surrounded new ground — even new castles — so after five pieces they had as many gaps as
at the start of the phase, then closed a far larger loop in time.** It paid off in
points and gun room. Any score built on "gaps left" calls those moves mistakes, because
by that measure they are.

### What the player was reasoning about

1. **The best result still reachable in the time left.** "Twelve pieces left: the big
   loop needs ten more blocks and gives two castles and 150 tiles; the tight repair needs
   three and gives one castle and 40 tiles."
2. **The bail-out.** "If it goes wrong, I can still close the tight ring in time." Going
   big costs little while the cheapest seal stays affordable; the risk is real only once
   it no longer fits.

Both are computable from what the bot already has: the candidate walls with their
remaining cost (`SealPlanner.options` at several widths, single castles, pairs, all),
and the pieces it can still lay (`Builder.piecesAffordable`, ~3.5 cells a piece).

### The measures (the "features")

Defined per player, on the board as it stands during their build phase:

| Name               | Meaning                                                                                                                                                     | Source                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `cheapestSeal` (T) | Blocks still needed for the cheapest wall sealing ≥1 castle                                                                                                 | `SealPlanner.cheapest(1, …)`                  |
| `budget` (B)       | Blocks the player can still lay this phase                                                                                                                  | time left × placement rate × cells a piece    |
| `bailoutSlack`     | B − T: the safety margin                                                                                                                                    |                                               |
| `reachableValue`   | max over candidate walls W of value(W) × P(finish W)                                                                                                        | below                                         |
| value(W)           | Points W would bank: enclosed tiles × castles (the scoring formula, PLAN §1.7), plus a term for gun room (`cannonRoom`)                                     | build W's tiles on a copy, `computeEnclosure` |
| P(finish W)        | Chance of closing W in time, from its slack: B against W's remaining cost, with an allowance for fit waste (pieces/budget runs 108–137%, ARCHIVE 12h stats) | to be fitted                                  |
| `carryOver`        | Wall that survives the sweep into the next round (touches territory)                                                                                        | `sweep.ts` rules                              |

**The key effect:** laying five tiles on the big loop barely changes T, but cuts the big
wall's remaining cost by five, so `reachableValue` rises. A score using it prefers exactly
what the testers did.

**Cost:** cutting every candidate wall again for every candidate placement is far too
slow (hundreds of placements × several cuts). Cut the walls **once per turn**, as the bot
already does, and score a placement by how many tiles of each wall it covers, weighted by
that wall's value — a softer version of today's `fit`, which aims at one wall. Caches last
one turn, never a tick (CLAUDE.md gotcha: bots act in turn and change the board).

---

## 2. The steps

### Step 1 — Check the theory against the testers' recordings

**Question:** do the measures explain the risky play? Do the two testers differ as the
user observed — **Mausica cautious, valuing immediate repair; Thomas, the more skilled,
taking bigger risks and playing longer-term**?

**Data:** `recordings/` — five matches replay exactly (2026-09-30 to 10-05, protocol 16,
format 1); the four of 2026-09-28 do not parse (fields added since). Sparse: tendencies,
not proof. Bots L3–L5 at the same tables give a baseline.

**Method:** replay each recording (`replayRecording`'s loop, `protocol/src/recording.ts`)
and, for every `place_piece` by every player, take the measures on the board just before
it, then after:

- ΔT: did the piece reduce the cheapest seal? (gap-closing vs gap-neutral moves)
- Δ`reachableValue`, `bailoutSlack` at the time
- per build phase: T at the start and end, castles and enclosed tiles at the start and at
  the resolution, points banked, whether the seal failed.

Per player: share of gap-neutral placements, how they correlate with slack (risk taken
only with slack in hand?), phases that ended with more castles/area than they began with,
failed phases. Compare Thomas, Mausica, and the bots by level.

**Deliverable:** a findings section below, and the analysis kept as a harness mode if it
proves useful (`--replay … --placements FILE`, a CSV per placement), else a script
outside the repository.

### Step 2 — The rule: "go big while a bail-out remains"

In `Builder.decide`, when something needs repair (and when expanding):

1. Take the tight repair and the bigger options (walls with more castles or room).
2. Pursue the most valuable option that fits the budget, **provided the tight repair
   would still fit after it** (slack after the big plan ≥ a margin).
3. At every replan, re-check; switch to the tight repair as soon as the bail-out is
   threatened.

**History to respect:** ARCHIVE 10s — widest-first repair lost a quarter of all rounds,
one to three cells short with the phase spent on a wider wall that did not close. It had
no bail-out check. Tight-first fixed the losses by giving up the upside. The offensive
trait's small-breach widening (`widensWhileRepairing`, `SMALL_REPAIR`) is a narrow form of
this idea.

**As a personality variant first** (a risk trait value, `config/ai.default.json`,
`botProfile`), so it is measured, not assumed.

**Measure:** soak against today's bots — same seats both ways (CLAUDE.md: position
matters), Levels 5 and 8, three players and teams; `--stats` columns: castles sealed,
cannon room, forfeited rounds, points. Success: more points and room, no rise in
forfeits. Use `npm run soak -- --only …` style batches or headless runs directly.

### Step 3 — The learned scoring function

Replace "which wall, then fit it" with "score every legal placement of the piece in hand":

- **Score** = Σ weightᵢ × featureᵢ(board after the placement), features from §1 plus
  cheap ones the tactics already compute: one-tile holes no piece can fill, thickness on
  the weakest path (`weakestWall`), pockets, guns left inert, cells spilt inside the wall.
- **Training:** the cross-entropy method (CEM) — sample weight vectors from a Gaussian,
  play headless matches with each (bots using the score against fixed opponents, both
  seats), keep the best ~10%, refit the Gaussian, repeat. Objective: points banked and
  rounds survived; forfeits heavily penalised. Plain TypeScript in `tools/headless`,
  the existing harness and soak machinery, this machine's CPU. No money.
- **Why CEM:** it is how linear-feature Tetris agents were trained to clear millions of
  lines; the problem (place pieces on a grid, delayed reward) is the closest studied
  cousin of this one; it needs no gradients and is easy to inspect.
- **Readable result:** a weight per feature, kept in `config/ai.default.json` behind the
  schema (no rule hardcoded). Personalities become weight sets (offensive weighs
  `reachableValue`, defensive `bailoutSlack`).
- **Levels:** strength from noise (choosing among the top few by a temperature), the
  existing pace and sloppiness, and the planned "misses like a person" work. The soak
  must show the ladder in order (ARCHIVE 12h).

**Success:** beats step 2's bot and today's bot in soaks at the same level and pace.

### Step 4 — Later, if wanted

Lookahead (play the rest of the phase out with random future pieces and a cheap policy,
score by the average outcome), or a neural value function trained in Python. Not now.

---

## 3. Constraints that hold throughout

- **The game must not change for people.** Only how bots choose; rules untouched.
- **Determinism.** `sim` and `ai` may not use `Math.random`, `Date.now`, `performance`
  (lint rule). Weighted sums and argmax are deterministic; avoid `Math.exp` and friends in
  bot code (implementation-approximated), or use `math.ts`/`trig.ts`.
- **No upcoming pieces.** The sequence is derivable from the seed, but people see only the
  piece in hand (the preview was removed); bots must too.
- **Pace.** A bot lays pieces at its level's pace (`placementBaseMs`,
  `placementPerCellMs`); learning chooses where, never how often.
- **Time per plan.** A plan costs ~5 ms and the server's tick waits on its bots; plans are
  spread by `PlanningSlots`. New features must fit; profile with the think-time benchmark
  method of ARCHIVE 12w (time `Bot.think` over fixed tables, `--cpu-prof`).
- **Before-and-after soaks** per CLAUDE.md: `git stash`, run, pop, run; edit nothing while
  a soak runs; check hashes reproduce.
- **Commits** are the user's to approve, each time.

---

## 4. Progress

- 2026-10-07: plan agreed and written. Step 1 started: a first pass with simple
  measures (below). Still to do in step 1: `reachableValue` and `bailoutSlack` proper
  (area a wall would enclose, the player's own placement rate for the budget), and the
  split of gap-neutral pieces into progress and waste by them.
- 2026-10-07: step 1 proper done (findings below). The question is answered by hindsight;
  `reachableValue` over minimum-cut walls was built and does not explain the play.
  Decided with the user: A, the unfillable last gaps, then B, step 2 adjusted by the
  findings.
- 2026-10-07: A done (below): plans route round tiles no piece can cover; failed rounds
  down about a point at every level measured.

## 5. Findings

### Step 1, first pass (2026-10-07)

**Data:** the five recordings that replay exactly — two testers against L3–L5 bots, two
two-against-two and one six-player match per pairing; 3,080 pieces in 214 player-phases.
The script is `tools/headless/src/placements.ts` (run `npx tsx src/placements.ts` in
tools/headless; writes /tmp/bw/placements.csv and phases.csv). Its measures: for every piece, the cheapest seal of ≥1 castle before and
after (T), and of ≥2 castles; per build phase, what the player held as it opened and at
the resolution.

**Per build phase** (almost every phase opens breached; castles and tiles are the change
from the phase's opening to its resolution):

| Player  | phases | failed   | points/phase | castles Δ | tiles Δ | gap-neutral share in breached phases |
| ------- | ------ | -------- | ------------ | --------- | ------- | ------------------------------------ |
| Thomas  | 44     | 7 (16%)  | 232          | +1.80     | +81     | 37%                                  |
| Mausica | 44     | 12 (27%) | 99           | +1.07     | +44     | 32%                                  |
| bots L3 | 18     | 3 (17%)  | 66           | +1.00     | +30     | 24%                                  |
| bots L4 | 38     | 8 (21%)  | 53           | +0.79     | +28     | 23%                                  |
| bots L5 | 70     | 10 (14%) | 165          | +1.31     | +62     | 22%                                  |

**Per piece:**

| Player     | pieces | laid while unsealed | of those, gap-neutral | median T then | median s left | sealed: piece brings a 2nd/next castle closer |
| ---------- | ------ | ------------------- | --------------------- | ------------- | ------------- | --------------------------------------------- |
| Thomas     | 731    | 68%                 | 50%                   | 6             | 12.9          | 61%                                           |
| Mausica    | 576    | 78%                 | 41%                   | 5             | 12.4          | 59%                                           |
| bots L3–L5 | 1,773  | 54–62%              | 33–37%                | 3             | 10–14         | 25–38%                                        |

**What it hints at** (five matches: tendencies, not proof):

- **Thomas plays the long game the user described, and it pays.** Half his pieces laid
  while unsealed leave the cheapest seal where it was, and he lays them with twice the
  gap the bots leave open (median 6 blocks against 3). He ends a phase with +1.8 castles
  and +81 tiles, banks 232 points a phase — 40% more than L5 bots — and fails 16% of
  phases, about as often as L5.
- **Mausica repairs more and expands less, but caution did not make her safer.** Fewer
  gap-neutral pieces (41%), more of her pieces spent while unsealed (78%), less gained
  (+1.07 castles, +44 tiles, 99 points a phase) — and the most failed phases of anyone,
  27%. She also lays fewer pieces (13.1 a phase against Thomas's 16.6): with fewer pieces
  the tight repair is the right call, and still it often did not close. Speed and fit,
  not strategy, look like her limit.
- **The bots are the cautious ones.** The fewest gap-neutral pieces (22–24% in breached
  phases), and once sealed, only 25–38% of their pieces bring another castle closer,
  against about 60% for both testers: they thicken where people expand. That is the gap
  steps 2 and 3 aim at.
- **Not yet shown:** that Thomas's gap-neutral pieces are progress rather than waste. By
  the crude test (does the piece lower the cost of sealing two castles?) about half are
  for him and for Mausica alike; but that test misses a wall widened round the same castle
  for room. `reachableValue` (ground a wall would enclose, step 1 proper) is what can tell.

### Step 1 proper (2026-10-07)

**The script** (`tools/headless/src/placements.ts`, three minutes over the five
recordings) now measures, for every piece and on the island it landed on (37 pieces went
on a teammate's), before and after: every candidate wall (each castle alone, each pair,
all of them, at room radii 0–3) with its remaining cost and its value (enclosed tiles ×
castles, the wall stood in on a copy); the budget (time left × the owner's own rate of
laying cells × their own efficiency, blocks of the cheapest seal removed per repairing
cell, 0.41–0.48 for everyone); `bailoutSlack` = budget − T; and `reachableValue`, max over
walls of value × P(finish). **In hindsight**, at the resolution: whether each cell of the
piece ended in the wall round the player's territory ("sealing"), standing elsewhere, or
swept — and per phase, the wall finally sealed, priced as its blocks not yet standing as
the phase opened.

**1. Gap-neutral pieces are progress for people, mostly not for bots.** Of the cells of
pieces laid while unsealed in phases that sealed, the share that ended in the sealing wall:

| Placer  | repairing pieces | gap-neutral pieces |
| ------- | ---------------- | ------------------ |
| Thomas  | 66%              | 67%                |
| Mausica | 61%              | 66%                |
| L5      | 55%              | 47%                |
| L4      | 54%              | 43%                |
| L3      | 57%              | 33%                |

A tester's piece that leaves the cheapest seal where it was is as much part of the final
wall as one that closes a gap. A bot's is spill and thickening.

**2. Thomas closes far bigger walls than he needs, and they cost more than his "budget".**
Sealed phases that opened breached, medians:

| Player  | phases | tight seal | wall sealed | budget | sealed / budget | sealed > 1.5× tight | value at the end |
| ------- | ------ | ---------- | ----------- | ------ | --------------- | ------------------- | ---------------- |
| Thomas  | 36     | 8          | 30          | 22.4   | 1.4             | 97%                 | 214              |
| Mausica | 31     | 8          | 17          | 18.1   | 1.1             | 58%                 | 48               |
| L5      | 58     | 7          | 17          | 18.6   | 0.9             | 64%                 | 62               |
| L4      | 28     | 11         | 14          | 20.4   | 0.7             | 36%                 | 37               |
| L3      | 15     | 7          | 14          | 20.8   | 0.7             | 47%                 | 35               |

The budget, priced at repair efficiency, understates what a long wall costs to lay: on a
long run nearly every cell becomes wall, while a repair's last blocks are dear. **Budget
for a wall in cells, at about 0.6 of a cell laid a block** (the sealing share above),
not in blocks of the cheapest seal. Once sealed, the same holds: 45% of Thomas's cells end
in the sealing wall (he widens), against 12–24% for bots and Mausica (they thicken — 60–75%
of their cells stand off the seal).

**3. Risk with slack in hand.** Median `bailoutSlack` (blocks) when laying a repairing /
a gap-neutral piece while unsealed: Thomas 6.9 / 9.2, Mausica 3.6 / 5.0, bots 9.3–10 /
8.4–8.8. Thomas goes neutral when he has more margin than when he repairs; bots do the
opposite (a bot's neutral piece is mostly a bad fit, not a choice). Mausica plays on half
Thomas's margin throughout. By slack band, the share of neutral pieces whose phase sealed:
slack 0–5: Thomas 61%, Mausica 51%, bots 27–41%; 10–20: Thomas 88%, Mausica 79%, bots
64–84%.

**4. What fails, fails at the end, and was affordable.** Every one of the 40 failed phases
opened with a tight seal of 5–12 blocks against a budget of 14–24 (as ARCHIVE 10s found
for bots), and ended 1–3 blocks short in 37 of them. The chance of sealing by the cheapest
seal over the budget at the time, every piece laid while unsealed, pooled:

| T / budget | < 0.2 | 0.2–0.4 | 0.4–0.6 | 0.6–0.8 | 0.8–1 | 1–1.5 | > 1.5 |
| ---------- | ----- | ------- | ------- | ------- | ----- | ----- | ----- |
| sealed     | 97%   | 85%     | 66%     | 58%     | 59%   | 49%   | 12%   |
| Thomas     | 100%  | 96%     | 78%     | 57%     | 67%   | 38%   | 0%    |
| bots       | 96%   | 80%     | 62%     | 57%     | 46%   | 33%   | 9%    |

So **a bail-out needs a large margin**: the tight repair should cost no more than about a
third of the budget to be ~90% safe — far from "it still fits". At the same margin Thomas
seals more often than the bots (96% against 80% at 0.2–0.4), and **10 of the bots' 21
failed phases ended on a gap no piece in the bag could fill** (`repairStuck` > 0 in the
recordings' statistics), against 1 of the testers' 19: the bots' endgame fitting, not
their choice of wall, is where they lose rounds.

**5. `reachableValue` over minimum-cut walls does not explain the play.** Gap-neutral
pieces raised it for 34–37% of the testers' pieces and 26–41% of the bots' — no
difference — and in 33 of Thomas's 37 sealed phases the value he ended with exceeds every
affordable candidate wall. The walls people close are not minimum cuts round castles and a
band: they follow the old wall and the coast and take in whole stretches of land at once.
Value by the min-cut family is the wrong family; step 2 needs candidate walls of that kind
(the wall last round, its ring widened, the coast-hugging loop), or step 3 a feature that
does not depend on enumerating walls.

**For the next step**, then: the testers' long game is real, it is progress and it pays
(Thomas 232 points a phase, L5 165); it is taken with slack in hand; a bail-out must keep
the tight repair to about a third of the budget; and separately, the bots lose half their
failed rounds to unfillable holes at the end.

### A: the unfillable last gaps (2026-10-07)

**Where they came from**, 16 matches of three bots a level (Levels 3, 5, 8), on the build
phase's last tick: 12–14% of rounds failed, and in a quarter to a third of those the
cheapest seal still ran through a tile no piece of the bag could cover. Two thirds of
those tiles were unfillable already as the phase opened — a shot's hole between wall and
sea or wall and gun, once one-cell pieces stop being dealt — and a third were boxed in by
the bot's own pieces during the phase. At the opening, 36–58 of ~470 player-rounds had
their tightest repair running through such a tile.

**The change** (`markUncoverable` in `building.ts`, `coverable` in the new
`ai/src/coverage.ts`): before each plan, every empty tile of the island that no piece of
the bag could cover joins the bot's `unreachable` set, which the planner already routes
round. The bag is the rules' (which pieces the round can deal), not foresight. A build
phase only fills the board, so a tile uncoverable now stays so for the round. `analysis`
uses the same `coverable` for `repairStuck`.

**Measured**, 96 matches a variant, three players, dealt personalities, seeds 1001–1096,
with a temporary switch per part (rows are player-rounds, ±1 SE ≈ 0.6 points):

| Variant          | failed rounds | of them on an unfillable gap | points a round | knockouts |
| ---------------- | ------------- | ---------------------------- | -------------- | --------- |
| L5 before        | 12.8%         | 120                          | 103.5          | 12        |
| L5 routing       | 11.5%         | 55                           | 108.6          | 11        |
| L5 fit guard     | 12.4%         | 105                          | 104.8          | 13        |
| L5 both          | 11.5%         | 60                           | 108.0          | 6         |
| L8 before / both | 12.4% / 11.4% | 131 / 71                     | 129.9 / 133.2  | 14 / 13   |
| L3 before / both | 13.9% / 11.8% | 120 / 48                     | 82.2 / 84.0    | 28 / 17   |

The routing does the work; a guard in `fit` against placements that leave a planned tile
uncoverable (penalised as one covered tile) added nothing beside it and was dropped. No
cost in time (the soaks ran as long). The final code reproduces the routing variant's
hashes. Every level gains, the low ones most; the ladder is not re-measured.
