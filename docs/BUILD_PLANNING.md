# Build planning: the phase played out before it starts

The user's idea (2026-10-12), for PLAN §11 item 1, bots that hold ground as people do. It takes in
item 1.5(a), the exact cells a bot can still lay, and prepares the ground for 1.5(b).

## The problem

Even strong bots end a round with one castle sealed and a thickened wall, which earns
nothing more. When they reach for a second castle, with a repair on top, they often fail and
lose a life. The reason is that the bot judges what it can finish by an estimate: its pace, the
bag's average piece (`cost / 3.5`) and a safety factor (`riskMargin`, 0.5 to 1.1 by level). So a
bot either never commits to a wider wall or commits to one it cannot finish. The bolder `widen`
of ARCHIVE 13u lost because it started walls it did not finish.

## The idea

1. **A build phase can be computed in advance.** A bot's build phase depends on nothing but its
   own island, its pieces and its pace, so it can be played out on a copy of the match before
   it begins. The bot then knows the outcome of a plan exactly, not as an estimate.
2. **Several strategies played out, the best one carried out.** The bot plays the phase out
   once for each of several strategies, scores every result, and then lays the winner's pieces
   in order, with no more decisions during the phase.

## Why a build phase can be computed in advance (checked against the code, 2026-10-12)

- **No shot lands during build.** The intermission before build lasts until every shot has
  landed (`match.ts`, `advancePhase`), and then for the pause and the banner, about 5 s or 150
  ticks. Once the last shot is down the board is fixed until the build phase opens, and bots do
  nothing in that time. It is the planning window.
- **The pieces are known.** `pieceAt(ruleset, seed, pieceRound, index)` is pure.
- **The pace is exact.** The piece in hand may be laid `placementBaseMs + placementPerCellMs × its
cells` after the last one (ARCHIVE 13v). Overtime cannot close before the bot has laid its own
  last piece, since it ends early only once everyone has.
- **Nobody else builds on a bot's island.** Bots never build on a teammate's island
  (`crossIslandBuild: "humans"`). **The exception**: a person may build on a bot teammate's
  island. See _Interference_ below.
- **The rest is fixed when the plan is made.** The sloppiness draws come from the table's
  shared stream, so they are drawn when the bot plans. `PlanningSlots` holds a bot back a tick
  only when it plans. A bot carrying out a finished plan needs no slots.
- **The rules' own code does the evaluating.** A rollout clones the `MatchState`, applies only
  this bot's actions, and `step`s through `resolveRound`. The sweep, the points, the gun reward
  and the continue are exactly the game's, with no second copy of the rules to drift. In the
  clone every other player is marked out of the match, so a teammate sharing the pool of lives
  cannot change the bot's own result.

## Design

**Strategies.** A strategy is a goal plus what to do with spare time. Each goal is a wall
round chosen castles and ground, or keeping the guns. Spare time goes either to thickening or
to starting the next castle. Each strategy is played by a fresh `Builder` on the clone. The goals
mostly come from generators that exist already:

- **S0, today's ladder, always included.** At worst the bot does what it would have done.
- The tightest repair, then thicken.
- The tightest repair, then each reachable further castle. These share the repair at the start,
  which can be computed once.
- The wall that keeps every gun (`reseal`'s options).
- Room for the reward's guns (`pocketPlan`, `widen`'s bulges).
- The widest affordable wall (`seal.options` with room).
- Each of these again, spending spare time on the next castle rather than on thickening.

**Score of a finished plan**, read from the board after the clone's resolution:

- the round's banked points, territory and damage (a failed round forfeits both);
- a weight times **guns ready for the next barrage**: guns active after the resolution, plus
  the reward as far as there is room for it (`cannonRoom`);
- a weight times the **prospect**: for each castle still open, the points it would add, scaled
  down by the cost of its cheapest seal on the final board (`SealPlanner`) against the next
  round's cells. A nearly sealed second castle is worth something, since it may be finished
  next round;
- optionally a weight times the wall's strength (`weakestWall`). The user suspects thickening
  is wasted; this term lets the measurement decide.

The weights are to be tuned by soak, by hand first. The learned fit's trainer (`cem.ts`,
BOT_LEARNING) could tune them later.

**A minimum of three guns.** The user decided (2026-10-12): a plan should leave at least three
guns ready for the next barrage, counting active guns plus reward with room. With a life left, a
round that is not the last, and no person in the team (the pool of lives is shared), the bot may
**fail on purpose** rather than carry out a plan below the minimum. A continue gives a fresh
castle and ring, the starting guns plus one for each life spent, and round one's pieces again.
This generalises the hollow-seal rule of ARCHIVE 13t. It is **measured before it is kept**: with
and without, and at minimums of two, three and four.

**Every level.** The user decided (2026-10-12): every level plans this way. The weaker levels are
held back by their slower pace and their sloppiness, which the rollout keeps since it plays at
the bot's own pace. If the ladder flattens, the levels are told apart by how much planning
each may do (the number of strategies).

**Interference.** If the board differs from the plan's prediction, because a person teammate
built on the bot's island, the bot must react at once, with no new search. It keeps the chosen
goal's wall as its target and fits each piece to that wall's remaining tiles (one `fit`, no
plan). Once that wall stands, it goes on with the ladder's spare work.

**Carrying a plan out.** The bot lays the plan's placements at their ticks. Before each one it
checks that its island is as predicted and that the placement is legal; otherwise it switches
to the interference fallback.

**Compute.** This is the main risk. A rollout is about 17 placements and up to as many plans of
about 5 ms each at Level 10. Eight strategies for each of eight bots exceed the 5 s window if
done all at once, and a room cannot send a tick before its bots have thought. So the work is
spread over the intermission, **counted in rollout steps, never in time**, so a match plays the
same on any machine (as `PlanningSlots` does). The repair shared at the start of several
strategies is computed once, and the number of strategies is set by measurement.

## Steps, each with its measurement

Each step ends in a measurement, and the next is built only if it is worth it. The baseline is step 1's
commit, not v0.9.3: its two fixes change how bots play.

1. **The rollout, and its exactness.** `rollout.ts`: clone, play one `Builder` at its pace,
   resolve, and report the placements and the result. A test plays real bot matches and checks
   that at every build phase the rollout of a fresh `Builder` predicts exactly what the live
   bot then did: every placement and tick, the points, castles and guns. A tool measures ms per
   rollout by level and players. This proves idea 1 on its own.
2. **The ceiling, with unlimited compute.** In the harness, strategies and the score with
   hand-set weights, chosen with no budget. Against the baseline: territory points a round,
   castles, guns firing, failed rounds and pieces a phase (`buildStats.ts --bots`); one such bot
   against two of today's, both seats, 96 matches at Levels 5 and 8 (as in ARCHIVE 12y); and
   points against a fixed field. **If the ceiling barely beats the ladder, stop here.** The
   score's terms are tested one at a time, each behind a temporary switch.
3. **The weights**, on a grid by hand, judged on points and failed rounds together.
4. **Failing on purpose**, behind its own switch: points a match, wins, lives spent on purpose
   against lives lost, at minimums of two, three and four guns.
5. **In real time.** Planning in the intermission under a step budget, the plan carried out,
   its checks and the interference fallback. The step 1 test keeps passing. Measured: the worst
   tick with eight Level 10 bots, on the server and in the local worker.
6. **The ladder across levels**, all planning. If the levels' gap narrows, the number of
   strategies is set by level.
7. **The testers' matches**, read with `buildStats.ts` beside Thomas's yardstick (301 territory
   points a round, 2.2 castles, 8.4 guns firing).

## Progress

- 2026-10-12: designed with the user; step 1 begun.
- **Step 1, the rollout** (2026-10-12): `rollOutBuild` (`ai/src/rollout.ts`). Exactness
  found two leaks, both fixed:
  - **`weakestWall` searched the whole map, other islands' walls included.** They changed
    which of several equally thin ways in it found, and so a bot's thickening depended on
    what its neighbours built. Shots fly over every other island, so only the target
    island's wall counts now. This touches the gunner's aim as well.
  - **As a build phase opened, `territory` and `enclosedCastles` still showed the board
    before the barrage** until anyone laid a piece, so a bot's first move depended on
    whether someone else had placed first that tick. The sim now re-solves the enclosure as
    a build phase begins (`beginPendingPhase`). This is a change to the sim: it changes the
    state hashes, and recordings made before it no longer replay exactly.

  With both fixes, `rollout.test.ts` (three bots at Levels 5, 8 and 10, two matches) predicts
  every piece, its tick and the round's result. So did five more matches at four players. The
  cost, measured with `tools/headless/src/rolloutCost.ts` at four players on this machine:

  | level | pieces a phase | ms mean | p90 | max | exact   |
  | ----- | -------------- | ------- | --- | --- | ------- |
  | 1     | 9.9            | 31      | 58  | 84  | 3/120   |
  | 3     | 11.8           | 45      | 80  | 94  | 15/120  |
  | 5     | 14.6           | 60      | 104 | 143 | 120/120 |
  | 8     | 18.5           | 81      | 181 | 216 | 120/120 |
  | 10    | 22.6           | 105     | 222 | 327 | 120/120 |

  Level 10 at eight players: 138 ms mean, 306 ms max, 80 of 80 exact. The sloppy levels (1–4)
  disagree only because they draw their slips from the table's shared stream as they fit. Once
  a bot carries out a plan, its draws are made when it plans, and these levels will be exact by
  construction. Eight strategies for each of eight Level 10 bots come to about 9 s of work
  against a 5 s window, as estimated: the work must be spread over ticks (step 5), and the
  number of strategies kept small or their shared start computed once.

- **Step 2, the ceiling** (2026-10-12): `buildPlanning.ts` (`strategiesFor`, `choosePlan`,
  `scoreOf`), a `Strategy` a `Builder` may follow (`follow`), and a `Bot` with `plansAhead`
  that plans in the intermission and lays the chosen rollout's pieces on their ticks
  (`playPlan`), its slips drawn from a stream seeded when it plans; the harness's `--plans
1,0,0` seats such bots. Strategies: the ladder; then from each first wall — the walls held,
  or when breached the tightest repair keeping the guns and each castle walled alone without
  them — the wall thickened, reaching on (`spareWork`), with room, with each castle beyond it
  tight and with room, and with every castle. Up to 51 a phase on an island of four
  castles. Score: the round's points, 20 a gun ready (firing, or a reward with room), and
  half the best prospect; a failed round −100,000.

  The first try started every repair with the wall keeping the guns, too dear after a
  barrage: every strategy but the ladder failed the rounds the bot was breached in. Walling
  each castle alone as an alternative first wall fixed it.

  One planning bot against two of today's, three players, 32 matches with the planning bot in
  each seat (96), against the same seeds with no planning bot (each seat's own baseline, per
  seat averaged):

  |                   | wins of 32 | score | territory a round | castles | guns firing | failed rounds | pieces | wall tiles |
  | ----------------- | ---------- | ----- | ----------------- | ------- | ----------- | ------------- | ------ | ---------- |
  | Level 5, today    | 10.7       | 2,230 | 187               | 2.0     | 6.9         | 8.6%          | 15.1   | 110        |
  | Level 5, planning | **19.0**   | 2,831 | 246               | 2.4     | 7.5         | 7.7%          | 14.9   | 110        |
  | Level 8, today    | 10.7       | 3,519 | 307               | 2.3     | 6.7         | 12.7%         | 20.3   | 109        |
  | Level 8, planning | **22.7**   | 4,641 | 411               | 2.9     | 8.7         | 9.6%          | 19.5   | 119        |

  The opponents' scores barely move (Level 5 2,230 → 2,265; Level 8 3,519 → 3,388). Every plan
  came true (0 divergences in 192 matches). Chosen: the ladder in 29% of phases at Level 5 and
  40% at Level 8; thickening as the spare work only 7–9%; reaching for another castle (`reach`,
  `reachAll`) 40% at Level 5 and 26% at Level 8; the bot almost never opens a phase with its
  wall whole (`hold` under 1%). **The ceiling is far above the ladder; step 2's gate is
  passed.**

  The cost: a planning bot's matches took 17 s at Level 5 and 23 s at Level 8, against 2.5
  and 3.6 s, so about 1.5–2 s of planning a round for each bot, about 50 rollouts. Far over
  what real time allows (step 5): the strategies must be pruned to those that win, measured
  by how often each is chosen and what the score loses without it.

- **Pruning, and the search in real time** (2026-10-12; the user: a long wait at the start of a
  build phase is unacceptable, the flow of the game comes first).
  - **Strategies named by role**: castles by the cost of their wall, cheapest first (`alone1`,
    `reach2#1`), so a strategy means the same on every board. `--plan-log` writes every
    phase's strategies and scores. Over 960 planned phases (four players, two planning bots,
    Levels 3, 5, 8, 10), measured against the best of all 51, the greedy best sets lose 159
    (one strategy), 84 (two), 55 (three) and 33 (five) points a phase, where today's ladder
    alone loses 196. Wall the cheapest castle alone, then reach for every castle
    (`alone1/reachAll`), is the best single strategy at every level.
  - **Fixed short lists fall short.** In soak the lists of two, three and five kept only
    25–55% of the gain at Level 8 (territory a round 330–365 against 411 for all 51 and 307
    today). A different strategy suits each board. **An estimate** that ranked strategies
    without playing them, from their walls' cuts against the cells the bot will lay, did no
    better: with three rolled out it still lost about half the gap. It was dropped.
  - **Cheaper rollouts.** The ladder rolled out lean (`leanLadder`: planning again only once
    its plan is built) is faster and better (Level 8: 110 → 66 ms, score 395 → 433). Lean
    hurt the stage strategies (score −5–12%), so they keep replanning. A strategy's spare work
    is kept until built (`keptSpareWork`): it had been half of such a rollout's time
    (37.5 → 23.1 ms). **Strategies sharing a first wall** play it once and branch
    (`RolloutRun.fork`, `Builder.fork`, spare `halt`), exactly as each played alone
    (tested). That saved less than hoped (about 20 ms a strategy at four players, 31 at
    eight), since repairs are short.
  - **Anytime search** (`PlanSearch`): each bot works down its strategies, in a learned
    order first (`DEFAULT_PLAN_ORDER`) and then the rest, a simulated piece at a time from a
    snapshot of the board taken in the intermission. The table grants `stepsPerTick`
    simulated pieces a tick (`PlanningSlots.takeSteps`), shared out evenly by seat. Starting
    a search costs 8 of them (`SEARCH_SETUP_STEPS`): eight bots starting on one tick took
    130–180 ms. The search ends at the bot's first piece of the phase, the same tick for
    every strategy, since its island has not changed till then, with the best played out so
    far. With nothing played out, or every plan failing, the ladder builds live as before.
    **The game never waits for it.**
  - **The budget, 8 a tick.** Eight Level 8 bots, all planning, one process alone (3
    matches): the bots' time a tick p99 14.6 ms, p99.9 54.2, worst 222, against 14.9, 34.8
    and 211 for today's bots. The worst ticks are today's own spikes. Each bot weighs 11
    strategies a phase (at four players 21, at three 25–33). 16 a tick doubled the
    strategies but raised the worst tick to 130–160 ms with eight bots. A step costs 1.2 ms
    on average; the ladder's own plans are the dearest, up to 33 ms.
  - **Measured under that budget**, one planning bot against today's, 32 matches a seat:

    | three players            | today     | all 51, unlimited | real time |
    | ------------------------ | --------- | ----------------- | --------- |
    | Level 5, territory, wins | 187, 10.7 | 246, 19.0         | 256, 21.7 |
    | Level 8, territory, wins | 307, 10.7 | 411, 22.7         | 380, 19.0 |

    Eight players at Level 8 (one planner among seven, 24 matches from each of three seats;
    12.8 strategies a phase): territory a round 322 → 370, wins 15 → 25 of 72, castles 2.4
    → 2.7, failed rounds 11.8% → 10.4%.

  - **Still to do for step 5**: planning switched on in the game. Its budget and order go into
    `ai.default.json`, and every driver (room, local worker, thread) must give the table's
    `PlanningSlots` its steps. Also a test of the interference fallback with a person
    building on a bot teammate's island: the builder takes over with the chosen strategy's
    walls, one plan, no new search.
