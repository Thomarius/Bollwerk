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

**The weekend run (begun 2026-10-02).** The user chose packages A, B and D of a larger plan, for
a run over a weekend on the user's other machine with nobody watching: A, soaks 1, 4 and 5 at two to ten
times the sizes below (960 matches for the main tables); B, the full ladder — soak 2 at 480
a level, and every other pairing of levels, one bot at _k_ against two at _j_, 96 matches
each; D, two players with no round cap, five and seven players, and soak 6. Package C, rule
variants, was declined: the default rules read as solid and are not expected to change
without a very good reason. The batch list is code, `tools/headless/src/soakPlan.ts` — 291
batches, 22,656 matches, about 39 hours of one core and 11 hours on ten workers (matches run 2.8 times slower ten at a time: the twelve cores are six physical ones) — and it,
not the tables below, is what runs.

## 0. Before the run: the summary tool — done

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

## 1. Where the output goes

Every run writes under **`soaks/<date>/`** at the repository root, which is git-ignored —
soak output is data, as recordings are, and is summarised into the plan rather than
committed. One set of files a chunk of 16 matches — `<batch>.<nnn>.csv`, `.outcomes.csv`,
`.log` — and `run.json` (the commit), `progress.txt`, `problems.txt` if anything failed, and
at the end **`summary.txt`**, the one file to read. The `recordings/` folder is only read.

## 2. The batches

Personalities are always **`dealt`**, from the seed by the bag, as a real match deals them.
Every batch has its own range of seeds (`--seed` is the first; match _i_ uses seed + _i_), so
no two batches play the same map. The harness puts player p on island p + 1 without the
seat shuffle a real match does, so **mixed tables rotate their level lists** across three
sub-batches, and no level sits on one island.

`H` below is `npm start -w @bollwerk/headless --`.

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
