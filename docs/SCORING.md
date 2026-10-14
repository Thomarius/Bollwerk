# Scoring by ground and guns — design and plan

Territory is scored today as **tiles × castles** (PLAN §1.7). This file is the change agreed with
the user on 2026-10-13 after a test match: **no multiplication by castles any more; instead every
gun firing at the resolution earns a flat bonus, 5 points as the starting value.** Built and
measured on 2026-10-14 (work packages 1–4, §9; ARCHIVE 13zd); the testers' matches under it, work
package 5, are still to come. Like PLAN.md it says what is configurable and why, and leaves the values to
`config/*.json`; once built, its summary moves to ARCHIVE.md.

---

## 1. The problem

The user's findings from the match `20261013-143405-local-5kh5gb` (alone against Levels 4, 5
and 6):

- **A minimal ring round an outer castle doubles the points of everything already held.** With
  the main castle sealed, sealing a second castle with the tightest wall multiplies all the
  ground by two — worth far more than widening the ground itself, which is against the spirit of
  the game. More ground should matter more; a castle is already rewarded with guns.
- **One flawless round decides a match.** A round with all four castles and wide ground gives a
  lead that only another flawless round can close.

## 2. The evidence

From the `stats.csv` of the 27 recorded matches with a person (all of `recordings/` on
2026-10-13). A round's tiles are its `territoryPoints / enclosedCastles` (`tilePoints` is 1),
castle and gun footprints included (`enclosure.ts` floods every tile but wall; checked).

**Points grow with the square of the castles held**, since each castle adds only 40–45 tiles:

| castles sealed | people's rounds | mean tiles | points now | tiles alone |
| -------------- | --------------- | ---------- | ---------- | ----------- |
| 1              | 84              | 43         | 43         | 43          |
| 2              | 147             | 90         | 180        | 90          |
| 3              | 63              | 128        | 384        | 128         |
| 4              | 38              | 181        | 724        | 181         |

The bots' rounds follow the same curve (1 castle 41 tiles, 4 castles 156).

**The test match**: in rounds 3–5 the user held as much ground as the bots, on two castles
against their four — round 4, 112 tiles × 2 = 224 against 119 × 4 = 476 and 132 × 4 = 528 —
and lost 2,384 to 2,687 after leading on ground most of the match.

**The matches rescored** (a static rescoring: people played to today's formula, so it shows a
tendency, not what would have happened):

|                                   | now  | tiles only | tiles + 5 a gun | tiles + 10 a gun |
| --------------------------------- | ---- | ---------- | --------------- | ---------------- |
| winner changed, of 27             | –    | 6          | 7               | 7                |
| guns' share of a player's score   | –    | –          | 23%             | 37%              |
| winner's score / second's         | 1.94 | –          | 1.39            | –                |
| winner's best round, share of all | 23%  | –          | 18%             | –                |

Under tiles + 5 a gun the test match goes to the user, 1,545 to 1,468; the match of 2026-10-11
against two Level 5 bots stays clearly Thomas's, 2,249 to 950 (4,841 to 1,220 today).

**Guns firing at the resolution do not run away** — breaches, guns left outside and continues
keep them down. Mean per player and round:

| round  | 1   | 2   | 3   | 4   | 5   | 6   | 7   | 8   | 9   | 10  |
| ------ | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| people | 3.0 | 5.5 | 7.0 | 7.5 | 6.4 | 6.0 | 6.8 | 7.3 | 7.9 | 8.4 |
| bots   | 3.0 | 4.7 | 6.4 | 6.0 | 5.4 | 5.2 | 5.8 | 5.2 | 5.0 | 5.4 |

## 3. The options weighed

- **Tiles only**: the cleanest fix, but a castle then scores nothing beyond its tiles, and the
  incentive to keep guns walled in is lost.
- **Tiles plus a flat bonus a castle**: no square growth, but it still rewards the minimal ring
  round an outer castle, only less.
- **A softened product** (each castle after the first adds half the tiles again): changed one
  winner in 27; it dampens the problem rather than removing it.
- **Tiles plus a bonus a gun firing — chosen.** A castle stays worth having, through the guns it
  earns, but pays over the rounds rather than at once; and walling the guns in is rewarded twice.

## 4. The rule

At each build phase's resolution, a player holding a sealed castle banks:

- `tilePoints` × the tiles of their territory — every sealed region, pockets included (PLAN §1.3),
  castle and gun footprints included — **not multiplied by castles**;
- `gunPoints` (5) × their **guns firing**: those standing on their sealed territory after the
  resolution, `cannon.active`. Guns earned at this resolution are not placed yet and do not count;
- `wallPoints` × the opponents' wall tiles they destroyed, as today.

A failed round forfeits all three, as today (`scoreDamageOnFailedRound` unchanged). In teams the
score stays the sum of the members' own.

## 5. How the games change

1. **Ground is the main thing.** A tile counts once however many castles hold it; a minimal ring
   round an outer castle earns its few tiles and the guns the castle brings.
2. **A castle pays over time.** About a gun a round, worth 5 points every round it stays walled
   in: an early castle is worth much, a late one little, and a castle first sealed in the final
   round brings no gun points at all, since its gun would be placed after the match. The last round
   is about ground and damage.
3. **A lead grows steadily rather than in a leap**, through guns kept and ground held.
4. **Breaching hurts where it should.** A breach of the wall round a leader's guns silences them
   and takes their points: the best attack, and its repair the best defence.
5. **Room for guns is worth a wide wall**: a gun's footprint is territory, so placing one costs
   no points and earns 5 a round.
6. **Damage weighs more.** Territory points about halve while damage stays; `tilePoints` 2 may
   restore today's balance of ground to damage (§8).
7. **Guns pay twice**, in fire and in points — a mild snowball, held down by breaches and
   continues (§2's table).

## 6. Where it lives

- **Config** (`packages/config`, `config/ruleset.default.json`): `scoring.gunPoints` and a
  switch for the castle multiplier (for instance `scoring.castleMultiplier: boolean`), strict as
  every schema. **An old recording's ruleset lacks both**, so a missing key must mean today's rule
  (multiplier on, no gun points), or old recordings no longer replay; the new defaults go in the
  default ruleset only. Check how `--replay` and the server read old headers before choosing.
- **Sim** (`packages/sim/src/match.ts`, `scoreRound`): the formula, behind one exported function
  (territory and gun points from tiles, castles and guns firing) that the bots call too, so no copy
  of the formula remains. The round's result carries the gun points beside `territoryPoints` and
  `damagePoints`. The ruleset travels in the snapshot, so the protocol version goes up (24).
  Tests: `scoring.test.ts` — "multiplies total area by total castles" becomes the switch's old
  side, new ASCII cases for guns counted, guns outside not counted, guns just earned not counted,
  pockets' guns counted, a failed round forfeiting them.
- **Bots** (`packages/ai`) — three copies of the formula, to call the sim's function:
  - `buildPlanning.ts` `prospect` (the castle nearly sealed, valued at area × castles);
  - `building.ts` the widening's `valueOf` (area × castles, against `WIDEN_GAIN`);
  - `combat.ts` the strategic personality's target (`tiles × enclosedCastles`).

  Built as `heldPoints` and `holdingsOf` (`sim/src/scoring.ts`). Valued by points alone, a
  castle was worth its few tiles, and the widening walled a strip of land rather than the castle
  beside it (`widening.test.ts`). So a bot values a wall by `wallValue` (`ai/src/tactics.ts`):
  its points, plus the guns its castles earn at `weights.gun` each — **only as many as the wall
  leaves room to stand** (the user's rule, 2026-10-14): a castle whose gun has nowhere to go is
  worth its tiles and no more. The widening and the planning's `prospect` both use it, at the
  bot's own `weights.gun`.

  And the planning's score (`scoreOf`) takes the round's points from the sim, gun points
  included, while `weights.gun` already values every gun left ready — **the guns would count
  twice**: lower `weights.gun` by about the gun points, measured. Expect bots to reach for
  castles less, with fewer guns; the repair of the wall round the guns (ARCHIVE 13t) gains.

- **Analysis** (`packages/analysis`): a `gunPoints` column in the per-round statistics, so the
  `stats.csv` of server, harness and `--replay` alike; `buildStats.ts` to show it.
- **Client**: the points banner after a round (it names the guns earned), the match summary and
  awards if they break points down, How to play and its screenshots, every text in English and
  German (`config/locale/`).
- **Docs**: PLAN §1.4 and §1.7, CLAUDE.md where it explains the scoring, ARCHIVE once done.
- **Tournaments**: quick rolls use level ratings, not scores, so they are untouched; a saved
  tournament carries its matches' rules, to be checked that a save from before still loads.

## 7. Work packages

Each ends with `npm run check` passing and the user's go-ahead to commit.

1. **Rule and config**: the switch and `gunPoints`, the sim's function and result, old
   recordings replaying exactly, the tests.
2. **Bots and statistics**: the three copies replaced, `weights.gun` adjusted, the `gunPoints`
   column.
3. **Measured**: a soak of the new rule against today's — the ladder across levels, points,
   failed rounds, castles held, guns firing — and the values of §8 settled by it.
4. **Client and docs**: the banner, summary, How to play, both languages, PLAN and CLAUDE.md.
5. **Play-testing**: the testers' matches under it, read with `buildStats.ts`.

## 8. Open questions, for the measurement

1. **`gunPoints`**: 5 to start; 10 made guns 37% of a score in the rescoring, likely too much.
2. **`tilePoints`**: 1 or 2 — whether ground should keep today's weight against damage.
3. **`weights.gun`** in the bots' planning, once gun points count in the round's score.
4. **Whether bots then hold too few castles** to keep up in guns — if so, the planning's
   `prospect` weight rather than any rule.

## 9. Measured (2026-10-14)

Work package 3: one soak, the same seeds under five variants, every bot's personality dealt as
in a match — the old rule (commit `10e7507`), the new as built, `gunPoints` 10, and
`weights.gun` 15 and 30. Each variant: the ladder (each of Levels 2–10 against three of the
level below, four players, 32 matches in every seat, 288 in all), three Level 5s (48 matches) and
Levels 3/5/7/9 at one table (32). The files and the script are in `soaks/scoring-2026-10-14/`
(git-ignored). With 32 matches a cell is ±3 wins, the ladder's sum ±8.

**The ladder** — wins of the one Level k in 32 (fair share 8):

| variant          | L2  | L3  | L4  | L5  | L6  | L7  | L8  | L9  | L10 | sum |
| ---------------- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| old rule         | 15  | 16  | 16  | 17  | 12  | 18  | 25  | 21  | 17  | 157 |
| **new**          | 13  | 11  | 14  | 14  | 11  | 19  | 17  | 18  | 15  | 132 |
| `gunPoints` 10   | 12  | 11  | 13  | 14  | 10  | 17  | 15  | 16  | 11  | 121 |
| `weights.gun` 15 | 14  | 12  | 16  | 16  | 12  | 17  | 22  | 18  | 13  | 140 |
| `weights.gun` 30 | 12  | 14  | 16  | 16  | 14  | 16  | 16  | 17  | 17  | 144 |

Flatter than under the old rule, as expected once a castle no longer multiplies a lead, and still
every level well above its fair share; Level 9 won 27 of 32 at the mixed table (26.5 before).

**Three Level 5s**, per player and round:

| variant        | castles | failed | guns firing | ground | guns | damage | damage share | winner / second | best round |
| -------------- | ------- | ------ | ----------- | ------ | ---- | ------ | ------------ | --------------- | ---------- |
| old rule       | 2.28    | 10%    | 7.3         | 217    | 0    | 36     | 14%          | 1.34            | 22%        |
| **new**        | 2.09    | 11%    | 7.3         | 73     | 36   | 36     | 25%          | 1.26            | 20%        |
| `gunPoints` 10 | 2.08    | 11%    | 7.3         | 73     | 73   | 36     | 20%          | 1.28            | 20%        |

At the mixed table the winner's lead over second fell from 1.60 to 1.27. Across the ladder's
tables castles held fell 0.15–0.2 at every level (Level 5 2.29 → 2.10, Level 10 3.06 → 3.02), guns
firing hardly (Level 5 7.4 → 7.2), failed rounds not at all (10–12%).

**The questions of §8, settled:**

1. **`gunPoints` 5.** At 10 guns score as much as ground at Level 5 and the ladder is flattest.
2. **`tilePoints` 1.** Damage counts for more — a quarter of a score rather than a seventh — which
   the user accepted (2026-10-14).
3. **`weights.gun` 20, unchanged.** 15, 20 and 30 are alike within noise in castles, guns and the
   ladder. It does not count a gun twice: the gun points are banked this round, `weights.gun`
   prices the gun's use in the barrages to come.
4. **Castles held**: down a little, guns not — once a wall is valued with its castles' guns
   (`wallValue`, §6). Valued by points alone they fell further in a first look (Level 7 3.04 →
   2.70 in eight matches).
