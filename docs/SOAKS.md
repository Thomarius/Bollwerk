# Soak plan — measuring the bots and the points game

Agreed with the user on 2026-10-02, to be run at the end of a day, when the machine is free
for an hour or two. **Measurement only**: nothing here changes a rule, a bot or a number in
`config/`. A finding that suggests a change goes into `PLAN.md` as a question for the user,
never straight into a commit. The test games of late September and early October already
read as solid and well balanced, with Levels 3–6 rising in skill without overwhelming a
person — so the default outcome is to change nothing, and the point is evidence.

It serves the open sections of `PLAN.md` §11: **11.2** (points decide, elimination
threatens), **11.3** (two players), **11.4** (measurements never taken) and **11.13** (the
bots' loose ends).

---

## 0. Before the run: the summary tool

The harness's `--stats` table has every number needed, but its console summary does not
compute margins, changes of lead or lives spent. Written first, in an interactive session,
committed with a test:

**`tools/headless/src/summary.ts`**, run as `npm start -w @rampart/headless -- --summarise
FILE [FILE...]` (or a script beside the harness), reading one or more `--stats` CSV files —
soak output and `recordings/*.stats.csv` alike — and printing, per file and for all of them
together:

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

Team tables (2v2) score and rank by team, as the game does. Tested on a small hand-made
table whose margins, lead changes and lives are known.

## 1. Where the output goes

Every run writes its table under **`soaks/<date>/`** at the repository root, which is
git-ignored (to be added to `.gitignore` with step 0) — soak output is data, as recordings
are, and is summarised into the plan rather than committed. One CSV per batch, named for
it, e.g. `soaks/2026-10-02/s1-3p-L5.csv`, and the console output of each beside it as
`.log`. The `recordings/` folder is not touched: the harness never writes there.

`npm start -w` runs the harness from its own directory, but resolves `--stats` paths from
where the command was typed (`INIT_CWD`), so run everything from the repository root.

## 2. The batches

Personalities are always **`dealt`**, from the seed by the bag, as a real match deals them.
Every batch has its own range of seeds (`--seed` is the first; match _i_ uses seed + _i_), so
no two batches play the same map. The harness puts player p on island p + 1 without the
seat shuffle a real match does, so **mixed tables rotate their level lists** across three
sub-batches, and no level sits on one island.

`H` below is `npm start -w @rampart/headless --`.

### Soak 1 — how good the points game is (PLAN 11.2)

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

### Soak 2 — the skill ladder (PLAN 11.4, 11.13)

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

### Soak 3 — personalities

No runs of its own: each trait value's share of wins, read from soak 1's Level 5 tables
(288 matches, about 860 bot seats), against its fair share. The guardrail of the bot work
(ARCHIVE 11zb) is that no personality decides a match on its own.

### Soak 4 — two players (PLAN 11.3)

| Batch      | Command                                                                                                      | Matches |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ------- |
| s4-2p-L5   | `H --players 2 --level 5 --personality dealt --matches 96 --seed 8000 --stats soaks/<date>/s4-2p-L5.csv`     | 96      |
| s4-2p-36-a | `H --players 2 --level 3,6 --personality dealt --matches 48 --seed 8200 --stats soaks/<date>/s4-2p-36-a.csv` | 48      |
| s4-2p-36-b | `H --players 2 --level 6,3 --personality dealt --matches 48 --seed 8300 --stats soaks/<date>/s4-2p-36-b.csv` | 48      |

Beyond soak 1's measures: rounds played, matches that never end (the old fear of 11.3),
and room for guns (`cannonRoom`), whose 0.7 at two players was the worst figure in the plan.

### Soak 5 — position bias (PLAN 11.4)

| Batch | Command                                                                                               | Matches |
| ----- | ----------------------------------------------------------------------------------------------------- | ------- |
| s5-4p | `H --players 4 --level 5 --personality dealt --matches 96 --seed 9000 --stats soaks/<date>/s5-4p.csv` | 96      |
| s5-6p | `H --players 6 --level 5 --personality dealt --matches 96 --seed 9200 --stats soaks/<date>/s5-6p.csv` | 96      |
| s5-8p | `H --players 8 --level 5 --personality dealt --matches 96 --seed 9400 --stats soaks/<date>/s5-8p.csv` | 96      |

Wins by island against 1 / players. With every seat the same level and personalities
dealt, an island winning clearly more than its share — beyond about two standard errors —
is the map, not the bots. 4p can reuse soak 1's s1-4p-L5 as a second sample.

### Soak 6 — the user's recorded games

```bash
H --replay recordings/ --stats soaks/<date>/s6-human.csv
```

Every complete recording, re-measured against the current code (each header names the
commit that made it; a replay that diverges says so, and those rows are set aside). The
person's failed seals, pieces placed, territory and damage against the bots' at the same
tables. A few games only: read as colour, not as a sample.

## 3. Running it

About **1,500 matches**. Measured on this machine (12 cores) on 2026-10-02: a three-player
Level 5 match takes about 3.2 s; four players about 5 s, eight about 12 s (estimated).
Serially that is roughly 1.7 hours of CPU; **six batches at a time** takes it to about
20–30 minutes of wall time while the machine is otherwise idle. Each batch is one process
and deterministic, so the batches run in any order and in parallel, and a batch that dies
is simply run again.

A runner, `tools/soaks.sh`, written with step 0: it holds the batch list above, runs six at
a time in the background (`&` and `wait -n`), writes each batch's CSV and `.log` into
`soaks/<date>/`, and at the end runs the summary over everything into
`soaks/<date>/summary.txt`. Started from the repository root:

```bash
tools/soaks.sh            # all of it, into soaks/<today>/
tools/soaks.sh s1 s4      # some soaks only
```

Nothing else should be built or tested on the machine while it runs, and **no code may
change under it**: a soak reads the working tree as it runs, so a commit mid-run mixes two
versions of the bots. Start it from a clean tree at a known commit, and note that commit in
the summary.

## 4. Reading it, and what happens next

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

### What would count as out of line

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
