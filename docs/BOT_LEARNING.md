# Stronger bots: valuing options, then learning the weights

The plan agreed with the user on 2026-10-07, for future sessions. **Goals: stronger bots,
and learning how to integrate machine learning into a game.** Python and neural networks
are left out for now; the user may come back to them once the steps below have proved
useful. This file is the plan and its progress; when a step is done, record the result
here (and summarise it into ARCHIVE.md as usual).

**Paused on 2026-10-07** after steps 1 and 2 and a first run of step 3: to resume, start at
§6, which says what is next and how to run what exists.

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
  down about a point at every level measured. Step 2 (B) started.
- 2026-10-07: B done (below). Going big while breached and widening the territory all
  round were measured and dropped; **widening once sealed — pushing the standing wall out
  to another castle, or a stretch of land beside it — is kept for every bot**: one such
  bot against two of the old won 65 of 96 at Levels 5 and 8. Next: step 3.
- 2026-10-07: step 3 started: a learned fit (`fitWeights` in `ai.default.json`, null =
  the hand-made fit; `buildScored` in `building.ts`) scoring every legal placement near the
  plan, the tightest repair, the thickening targets and the outer skin by ten features;
  trained by `tools/headless/src/cem.ts` (each candidate head to head against two of
  today's bots, `fitEval.ts`).
- 2026-10-07: step 3's first run done (findings below): the learned fit about equals the
  hand-made one — a small gain at Level 5, none at Level 8. **Paused here by the user's
  decision**; the pipeline is committed with `fitWeights` null, and the work left is §6.

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

### B, first version: going big while breached (2026-10-07)

**As built** (measured behind a temporary switch, then dropped): breached, a bot builds the most valuable wall it can finish — the
ground it held as combat began (remembered during combat, since the first placement of
a build phase refreshes territory for everyone), that ground widened by 1–3 tiles, or a
castle wall with room — while the tightest repair costs at most `bailoutShare` of the
cells it can still lay, priced at repair efficiency (0.45 blocks a cell); a big wall is
finishable at 0.55 blocks a cell (the bots' sealing share), must be worth 1.25× the tight
one, and a chosen one is kept unless another is worth 1.15× more. Checked at every plan.

**Measured**, every bot balanced at Level 5, three players, 96 matches, seeds 1001–1096:

| bailoutShare | failed rounds | points a round | castles | room | knockouts | time  |
| ------------ | ------------- | -------------- | ------- | ---- | --------- | ----- |
| off          | 11.9%         | 103.1          | 1.09    | 2.88 | 5         | 251 s |
| 0.33         | 11.4%         | 106.9          | 1.10    | 2.94 | 2         | 297 s |
| 0.5          | 11.9%         | 105.6          | 1.09    | 2.99 | 2         | 331 s |
| 0.7          | 12.3%         | 106.0          | 1.09    | 3.03 | 2         | 354 s |

Points +3–4% and no rise in forfeits, but within noise, castles unchanged, and planning
18–40% slower. Counted over four matches at 0.33: of ~920 breached plans the bail-out
held 628 back, the tight repair was the most valuable affordable wall in 263, and a big
wall was chosen 27 times. At a bot's pace a third of the budget is ~8 blocks as a phase
opens, against a median tight repair of 7, and it shrinks as the phase runs. **Breached is
not where the testers' value comes from**: it is castles — Thomas ends a phase with +1.8
castles, and value is tiles × castles — and 45% of his cells once sealed go into a wider
wall where the bots thicken (step 1, finding 2). Once sealed, the wall standing is the
bail-out.

### B, second version: going big once sealed (2026-10-07)

**Widening the whole territory does not work**: sealed, the candidate "territory widened
by 1–3 tiles" asks for a new perimeter outside the old wall, beyond any phase's budget.
Counted over four matches, the best wall within reach was the territory already held in
479 of ~530 plans. People push a **bulge** out from the wall they have. So sealed, the
candidates are the territory plus a patch of land of radius 2 or 4 round eight points
spread along the outside of the wall (the cut reuses the standing wall), and the castle
walls with room; the ground chosen is remembered, so the same bulge is built from plan
to plan. Bulges then won 100 of ~580 sealed plans at a gain threshold of 1.25×, and many
more gained 10–25%.

**Every bot changed**, balanced, three players, 96 matches, seeds 1001–1096:

| Variant              | failed rounds | points a round | castles | active guns | knockouts | time  |
| -------------------- | ------------- | -------------- | ------- | ----------- | --------- | ----- |
| L5 off               | 11.9%         | 103.1          | 1.09    | 5.45        | 5         | 251 s |
| L5 sealed, widening  | 11.7%         | 104.0          | 1.09    | 5.46        | 5         | 285 s |
| L5 bulges, gain 1.25 | 11.6%         | 102.4          | 1.08    | 5.54        | 1         | 363 s |
| L5 bulges, gain 1.1  | 11.6%         | 100.7          | 1.04    | 5.59        | 0         | 356 s |
| L8 off               | 14.7%         | 128.6          | 1.29    | 5.21        | 11        | 260 s |
| L8 bulges, gain 1.25 | 13.5%         | 132.4          | 1.27    | 5.67        | 3         | 380 s |
| L8 bulges, gain 1.1  | 13.2%         | 134.9          | 1.24    | 5.81        | 4         | 383 s |

**Head to head**, one bot with bulges at 1.1 and the breached rule at 0.33 against two of
today's, rotated through the three seats, 96 matches a level (seeds 2001–2096, fair
share 32, one standard error about 4.6):

| Level | wins     | failed rounds, it / today's | points a round, it / today's | active guns, it / today's |
| ----- | -------- | --------------------------- | ---------------------------- | ------------------------- |
| 5     | 32 (33%) | 11.5% / 11.6%               | 108.4 / 105.7                | 5.61 / 5.54               |
| 8     | 39 (41%) | 12.3% / 14.3%               | 137.7 / 131.9                | 5.75 / 5.34               |

A small gain at Level 8, about one and a half standard errors, and none at Level 5, for
planning about 45% slower. Castles do not rise: the bulges buy ground and gun room, not
the second castle that makes the testers' value.

### B, third version: reaching for castles — kept (2026-10-07)

**The candidates added**: for each castle outside the territory, the territory and that
castle with a band of 0 or 2 tiles, so the cut reuses the standing wall and only bridges to
the castle; reaching for every castle on the island, as spare work already did. Head to
head as above (one changed bot, balanced, against two of today's, 96 matches a level):

| Changed bot                                 | L5 wins | L8 wins |
| ------------------------------------------- | ------- | ------- |
| bulges and the breached rule, no castles    | 32      | 39      |
| castles only                                | 41      | 46      |
| castles and the breached rule               | 51      | 47      |
| castles, bulges and the breached rule       | 49      | 47      |
| castles and bulges                          | 48      | 54      |
| castles and bulges, reach 0.8 blocks a cell | **65**  | **65**  |
| castles and bulges, reach 1.0               | 67      | 64      |

Castles carry most of it; the breached rule adds nothing reliable and was dropped, with
its memory of the ground held. **Reach** was what held it back: at 0.55 blocks a cell (the
bots' measured wall efficiency) a castle the old ladder would have tried was out of reach,
and a cheaper bulge was built first — found by a test board where widening sealed one
castle where the old ladder sealed two. At 0.8: castles a round 1.39 against 1.06 at Level
5 and 1.74 against 1.29 at Level 8, points 23–33% more, failed rounds 12.9% / 12.1% and
14.1% / 14.8% (it / today's).

**As kept** (`widensWhenSealed` in each risk trait, true for all three; `widen` in
`building.ts`; `SealPlanner.around` cuts round given ground): sealed, after the guns are
recovered, a pocket is taken when short of room, and a thin wall is thickened for the
secondary and defensive traits, the bot weighs the wall it chose last, eight bulges at radii
2 and 4, the castles, and the castle walls with room; builds the most valuable it can
finish (cost at most cells left × 0.8 × the level's risk margin) if worth 1.1× what it
holds; keeps its choice unless another is worth 1.15× more; else the ladder as before.

**Every bot widening**, dealt personalities, three players, 96 matches (seeds 1001–1096):

| Level      | failed rounds | points a round | castles     | knockouts | at the cap |
| ---------- | ------------- | -------------- | ----------- | --------- | ---------- |
| 5 off / on | 11.5% / 11.6% | 108.6 / 113.8  | 1.13 / 1.20 | 11 / 12   | all / all  |
| 8 off / on | 11.7% / 12.7% | 136.5 / 148.4  | 1.28 / 1.38 | 13 / 18   | all / all  |

The ladder, all widening, one bot against two Level 5s, 96 matches: Level 4 won 12 (12h:
15%), Level 6 won 33 (12h: 42%) — in order, Level 6's edge smaller, about 1.7 standard
errors. **Time**: a build plan's mean 7.3 -> 7.8 ms at three players (Level 5) and 5.0 ->
6.1 ms at eight (Level 8), the worst 82 -> 93 and 47 -> 67 ms (four runs at once on this
machine, so for comparison only).

### Step 3, first run: a learned fit (2026-10-07)

**What is learned**: only where the piece in hand goes. The ladder still decides which
walls matter; a learned score then weighs every legal placement near any of them — the
plan, the tightest repair, the thickening targets, the outer skin — by ten features
(`FIT_FEATURES` in `config/src/ai.ts`): cells on each, cells spilt inside, cells wasted,
the plan's and the repair's cells times urgency (the repair's cost over what the phase can
still lay), and whether the placement finishes the plan or the repair. `fitWeights` in
`ai.default.json`, null by default (the hand-made fit), so the game is unchanged.

**Training** (`cem.ts`, `fitEval.ts`): ten iterations of sixteen candidates and the
current mean, each 24 matches head to head against two of today's bots at Level 5, the
same seeds within an iteration; the best four refit the Gaussian; `plan` held at 4 for
scale. Seventy minutes on this machine. The mean, by iteration: −0.08, −0.06, −0.12,
+0.06, +0.06, +0.33, +0.07, +0.10, +0.16, +0.33 (relative score: its points minus the
opponents' mean, over that mean, a match each).

**Learned** (plan 4): finishes the repair 8.3, the repair's cells 1.9 plus 2.3 × urgency,
spilt inside −4.2, skin 1.7, thicken 0.9, finishes the plan 0.3, the plan's cells −0.2 ×
urgency, waste −0.2. It learned what step 1 found by hand: rounds are lost in the last
blocks, so a placement that closes the repair is worth most.

**Checked on 96 fresh seeds** (900001–900096), today's bot in the same seat as the noise
— the measure sits above zero even then, since a mean of ratios leans upward:

| Level | relative, today / learned | wins, today / learned | failed rounds, today / learned |
| ----- | ------------------------- | --------------------- | ------------------------------ |
| 5     | +0.086 / +0.193           | 32 / 35               | 97 / 102                       |
| 8     | +0.088 / +0.074           | 35 / 30               | 118 / 114                      |

A small gain at Level 5, where it was trained (about two standard errors on the relative
score, nothing in wins), and none at Level 8. **The learned fit about equals the hand-made
one**: with the ladder choosing the walls, where a piece goes has little left to give.
What could: features for the choice of wall itself, training at more levels than one, and
more matches a candidate (24 leave one iteration's figure noisy by ±0.1).

---

## 6. Next steps (for future work)

Paused on 2026-10-07 after step 3's first run. Where to pick it up, most promising first.
Nothing below is decided; each is to be agreed with the user before it is built.

1. **Learn the choice of wall, not only the cell.** The big gains of this session came
   from which wall a bot builds (castles: 65 of 96 wins, B); the learned fit, which only
   places the piece once the ladder has chosen, gave little. Score each candidate wall
   the ladder and `widen` already produce — the tight repair, the plan, each castle reach,
   each bulge, the castle walls with room, thickening — by features of the wall: its value
   (tiles × castles, stood in), its cost against the cells left (`cellsAffordable`),
   castles gained, guns kept and room for the guns about to be earned, how much of it is
   wall already standing, the tight repair's slack after it. Learn the weights with the
   same CEM runner; the fit below it stays hand-made or uses the learned `fitWeights`.
   Mind the plan's time (~5 ms; `widen` already costs 7–21% more).
2. **Train better.** Levels 5 and 8 together (one candidate's score the mean of both), 48
   matches a candidate rather than 24 (24 left an iteration noisy by ±0.1), dealt
   personalities, and a check on fresh seeds after every few iterations rather than only
   at the end. About twice the seventy minutes a run.
3. **A better objective.** The relative score is a mean of ratios, which leans upward
   (+0.09 for today's bot against itself); the difference of points a round, or the win
   share against a fixed field, would read straighter. Penalise failed rounds directly if
   a learned bot starts trading safety for points.
4. **Levels from the learned bot** (step 3's plan): strength from noise — choosing among
   the top few by a temperature — besides pace and sloppiness; the soak must show the
   ladder in order (ARCHIVE 12h). Re-measure the ladder in any case: since widening, Level
   6 won 33 of 96 against two Level 5s, where it won 42% before (B).
5. **Lookahead or a neural value function** (step 4): only if the above stall.

Also open from this session, outside the learning work:

- **The testers' gap-neutral play while breached** is still not matched: going big while
  breached under a bail-out (B, first version) found too little room at a bot's pace. A
  learned choice of wall (item 1) is where it would be tried again, with the slack after
  the big wall as a feature rather than a fixed share.
- **Plan time**: `widen` weighs eight bulges at two radii and every castle each plan while
  sealed; fewer seeds, or weighing only when the last choice is built or blocked, would
  trim it, measured against the head-to-head result.

**How to run what exists**: `npx tsx src/fitEval.ts --weights '{...}' --seeds 1,2,3
[--level 5]` in `tools/headless` plays one weight vector head to head (`--weights null`
measures today's bot against itself); `npx tsx src/cem.ts [--iterations 10] [--population
16] [--elite 4] [--matches 24] [--level 5] [--out DIR] [--resume]` trains, writing
`state.json` (the mean and spread) and `log.jsonl` (every candidate) to `DIR`. The first
run's mean is in §5; to try it, put it in `fitWeights`.
