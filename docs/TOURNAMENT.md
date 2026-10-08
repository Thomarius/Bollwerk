# Tournament mode — design and plan

A tournament is a run of matches against a field of named bot teams, played by one team of
people and their bots. It has an optional league stage first, then a knockout bracket, and
it is saved between matches so it can be resumed later. Every match a person plays is an
ordinary match under the current rules. Every match without them is decided by a quick
roll.

This file is the design as agreed with the user (2026-10-08) and the plan to build it, in
work packages. Like PLAN.md it says what is configurable and why, and leaves the values to
`config/*.json`. When a package is done, its summary moves to ARCHIVE.md and this file keeps
only what is still open.

---

## 1. The design

### 1.1 What a tournament is

- **Strictly cooperative.** The host's team is the only team of people. Everybody else is a
  bot, in teams generated when the tournament is made. A tournament of team size 1 is
  single player.
- **The schedule is made once, at creation**: every team and its name, every bot's name,
  level and personality, the league's matchdays and the bracket's shape. Nothing about the
  opponents changes over the tournament. Which team meets which in the bracket depends on
  results, but the bracket's shape does not.
- **Saved on the host's computer**, in the browser's local storage (the desktop app's window
  counts). Saved after every match, deleted when the tournament ends either way.
- **One deterministic stream.** The tournament has its own seed. Every draw (field, names,
  levels, personalities, pairings, map seeds, quick rolls) comes from a stream named for what
  it decides and where in the schedule it falls. Reloading, deleting and resuming a copy, or
  replaying a match therefore changes no result that was not the host's to change. The
  simulation is untouched. All of this lives outside `sim`, but it keeps the same discipline:
  no `Math.random` or `Date.now`, apart from a save's "last played" date.

### 1.2 Settings, chosen once at creation

| Setting           | Values                       | Notes                                                                                                                             |
| ----------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Team size         | 1–4                          | Constant for the whole tournament.                                                                                                |
| Team name         | text                         | Team size 2 or more only. At size 1 the team is the player.                                                                       |
| Your team's bots  | a name and level each        | One per seat beyond the host's. Fixed for the tournament, like everyone else's.                                                   |
| Opponents' levels | a range, _x_ to _y_          | Each opponent bot is dealt a level in the range.                                                                                  |
| Archnemesis       | on/off, and a name           | One bot at _y_ + 1, the leader (first seat) of its team. Needs _y_ ≤ 9.                                                           |
| Length            | Short, Medium, Long          | Sets the field size, which is not shown (§1.3).                                                                                   |
| League stage      | on/off                       | §1.4.                                                                                                                             |
| Knockout          | single or double elimination | §1.5.                                                                                                                             |
| Match size        | min–max teams a match        | Shown only at team sizes 1 (2–8 teams) and 2 (2–4). Sizes 3 and 4 allow only two teams a match, so every match is 3 v 3 or 4 v 4. |
| Rounds a match    | the lobby's bounds           | One value for every match, the final included.                                                                                    |

Not settings, on purpose: the league's points (§1.4), tie-breaks (§1.6), and the field size.

### 1.3 Length

Length is measured in **the matches the host's team plays if it wins every one**:

|        | League matchdays | Knockout rounds |
| ------ | ---------------- | --------------- |
| Short  | 2                | 2               |
| Medium | 3                | 3               |
| Long   | 4                | 4               |

The numbers are config, not code (`tournament.lengths`). **Each knockout round's match size
is drawn once at creation**, within the min–max, and holds for every match of that round, so
the bracket stays regular. The knockout field is the product of those sizes, counted in
teams. With a league, the field is larger and the league's table decides who goes through
(§1.4). Without one, the field is exactly the knockout field.

A field can grow large: four rounds of eight-player free-for-all is 4,096 teams. Quick rolls
cost nothing, but names run out and nobody needs that many. So **`tournament.maxField` caps
it**: while the product is over the cap, the largest round size is lowered by one, never
below the minimum. If even the minimum at every round is over the cap, that field is
accepted as it is.

### 1.4 The league stage

- **Matchdays.** On each, every team plays one match against opponents drawn at random from
  the whole field, with match sizes drawn within the min–max. A team meets the same opponent
  twice only if the draw cannot avoid it.
- **Points: one for every team you finish ahead of.** A win in a four-team match is 3, a win
  in a two-team match 1, last place 0.
- **One table.** Ranked by points, then **Buchholz** (the sum of the points of every team you
  met), then a seeded draw. See the note below on why Buchholz replaces the match-score
  tie-break agreed on 2026-10-08.
- **Who goes through:** the top _K_ after the last matchday, _K_ being the knockout field.
  The league field is `tournament.leagueFactor` × _K_, rounded up until the matchdays divide
  it into legal matches.
- **The host's team plays every matchday.** It is out if it is not in the top _K_ at the end.
  It plays on even when it can no longer reach the top _K_: there is no early "you cannot
  qualify", which would be cruel to work out and confusing to show.

> **Why Buchholz and not total match score.** Quick-rolled matches produce placements, not
> scores. A table tie-broken on scores would compare the host's real points with numbers
> invented for the bots. Buchholz is the usual tie-break in Swiss-style leagues: it rewards
> having met strong teams, needs only placements, and is fair to every team.

### 1.5 The knockout

- **Seeding.** After a league, by its table, in standard seeding so the top seeds meet as
  late as possible. Without a league, by a random draw. Either way, **the archnemesis's team
  is placed in the half of the bracket opposite the host's**, so the earliest the two can
  meet is the final. In double elimination they can also meet in the losers' bracket.
- **Only a match's winner goes on.** In single elimination everyone else is out.
- **Double elimination.** The winners' bracket runs as single elimination. Every team it
  beats drops into the losers' bracket, and a team the losers' bracket beats is out. The
  losers' bracket keeps a pool: after each winners' round, that round's losers join it, and
  the pool plays one round of matches (sizes within the min–max, byes to the best-seeded when
  the count does not divide), one winner a match staying in. It ends when one team is left
  in it. **The final is one match**, the winners' champion against the losers' champion,
  with no reset. Since every count is known in advance, the losers' bracket's shape is fixed
  at creation too.
- **The final is always two teams**, even if the minimum match size is larger. That is the
  one exception to the min–max, and the configuration menu says so.

### 1.6 Results

- **A match's placement**: teams still in by team score (best first), then teams knocked
  out, by how late they went out (`eliminatedRound`, later first).
- **Ties in a played match** (a shared win at the cap, a simultaneous knockout): the higher
  score ranks first, then the later knockout, then a seeded coin flip. Quick rolls cannot
  tie.
- **The quick roll.** Each level has a **rating** (`tournament.levelRatings`, calibrated
  from the soak's ladder, ARCHIVE 12h). A team's strength is the sum of its members'
  ratings. A full placement order is drawn in proportion to strength, Plackett–Luce: first
  place in proportion to strength among all, second among the rest, and so on.
  Personalities play no part.

### 1.7 Playing a match

- **The pre-match screen** shows who is playing whom, the stage ("League, matchday 2 of 3",
  "Semi-final", "Losers' bracket, round 3"), the map, and the host's team. If team size is
  over 1 and a room could be opened, it also has the invite (code and link) and a choice of
  which of the team's bots sit out for the people who joined. The opponents are fixed: no
  levels, names or seats to change.
- **One room for the whole session.** The room is opened when the host starts or resumes,
  and keeps its code across matches until the host returns to the menu. People join it with
  the existing Join and games browser. It is private by default, with the same Public/Private
  switch as Play, and a public one is listed as a tournament, with the team named. **A person
  who joins may only take a seat on the host's team.**
- **With no server answering**, the tournament plays offline, the team's bots in every seat
  of the host's team, and the invite is not shown.
- **Interrupted is replayed.** A match the host leaves, or loses its connection to, is not
  counted. On resume it starts again, with the same opponents and the same map, since the
  map is drawn from the schedule. Only a finished match is saved. The Leave dialog says the
  match will be replayed.
- **Recorded** like any match the server sees, with the header naming the tournament and the
  match. Quick rolls are not recorded.

### 1.8 Between matches and at the end

- **After a match** of the host's team, every other match of the same stage is rolled, the
  results applied, and the tournament saved. Then the **standings**:
  - in the league, the top of the table and the host's neighbourhood in it;
  - in the knockout, the bracket around the host's path: the next opponents, and who is
    still alive elsewhere, the archnemesis included.

  From there the host plays the next match or returns to the menu.

- **The tournament ends** when the host's team is out (single elimination, or losing a
  losers'-bracket match, or missing the top _K_) or wins the final. Each ending has its own
  screen, summarising the team's path match by match: stage, opponents, placement, score.
  The save is deleted and the screen leads back to the menu.

### 1.9 The menu

- **New tournament** opens the configuration screen (§1.2).
- **Resume tournament** lists the saves: team name, length and modes, the stage reached and
  the date last played. The host can resume one, delete one (after a confirmation), or go
  back. A save from an incompatible version is listed as made by an older version and can
  only be deleted. Saves are not migrated.
- **Single match** is Play as it is now, with its Public/Private switch.
- **Join** and the list of open games stay on the main menu. They join single matches and
  tournament rooms alike.

---

## 2. Where it lives

- **`packages/tournament`**, a new package: pure, deterministic, no DOM, no Node. The save's
  schema, roster generation, the schedule (league and brackets), quick rolls, placement from
  a finished `MatchState`, standings, tie-breaks, advancing, and the ending. It depends on
  `config` and on `sim` (for `Rng`, `streamFor` and the state's types), never on `ai`.
- **`config/tournament.default.json`**, behind a strict schema: the lengths, the league
  factor, the field cap, the level ratings, and the name pools (§3, T2).
- **`client`**: the saves in storage, the menu, the configuration and resume screens, the
  pre-match screen, the standings and end screens, and the flow driving a session from one
  match to the next.
- **`protocol` and `server`**: a room told its table rather than letting its host set one, and
  kept across matches (protocol 18).
- **`ai`**: `dealSeats` takes fixed setups when a table brings them, rather than dealing
  personalities from the match seed.

The **simulation is untouched**. A tournament match is an ordinary match on a table with
given names, levels and personalities, and the rules are the current ones with the
tournament's rounds a match.

---

## 3. Work packages

In order. Each ends with `npm run check` passing and the user's go-ahead to commit.

### T1 — The tournament core (`packages/tournament`)

The whole tournament without a screen, testable on its own.

- The save's schema (Zod, strict, with a version), and the settings within it.
- **Roster**: the field from the settings (§1.3, the cap included), team and bot names
  unique within the tournament, levels in the range, the archnemesis as its team's leader,
  personalities dealt once, the host's team as configured.
- **Schedule**: league matchdays with their pairings, drawn as each matchday comes but from
  the stream fixed at creation. The single-elimination bracket with its round sizes and
  byes. The losers' bracket of double elimination as in §1.5. Seeding, with the archnemesis
  opposite the host.
- **Results**: placement from a finished `MatchState` (§1.6), the quick roll, league points,
  Buchholz, advancing through either bracket, and whether and how the tournament has ended.
- **Map seeds** drawn from the schedule, so a replayed match is the same match.
- Tests: every length and mode at every team size and match size, simulated through to the
  end by rolls alone. The field and the host's path length are as §1.3 says, every match is
  a legal size, the archnemesis never meets the host before the final in single elimination,
  the same seed gives the same tournament, and replaying one match changes no other.
- **A headless runner** (`--tournament` in `tools/headless`) plays whole tournaments by
  rolls and prints their shape: for checking, and for the calibration in T2.

### T2 — Ratings and names

- **Level ratings** fitted to the soak's ladder (ARCHIVE 12h, one bot against two of another
  level) as a Bradley–Terry fit, then **checked against a small soak of team matches** to
  test whether summing ratings is a fair model of a team. Adjust if not, before trusting the
  rolls.
- **Name pools** in config, one for every language: given names that read well in most
  countries, and team names (the user's choice, 2026-10-08). Large enough for the
  field cap with names unique.

### T3 — Fixed tables

A match can be set up with each seat's name, level and personality given, offline and on a
server.

- `dealSeats` keeps any given setups and deals only the rest. Islands are still shuffled by
  seat as ever.
- The local setup (`Setup`, `LocalMatch`) carries seat names and setups.
- The end screen's bot reveal and the recording header show the given setups.
- The recording header gets an optional `tournament` field (the tournament's id and the
  match's place), which bumps the recording format.

### T4 — Saves and the menu

- **Saves** in local storage: one key per tournament, plus an index. Write, list, load and
  delete, with the version check. Each write is a single `setItem`, so a closed tab never
  leaves half a save.
- **The menu**: New tournament, Resume tournament, Single match, Join and the open games
  (§1.9).
- **The configuration screen** (§1.2): the settings shown only where they apply, the
  archnemesis's limit on the range, the final's exception to the minimum, and a short line
  of what the length means in matches.
- **The resume screen**, with deleting confirmed.

### T5 — The tournament flow, offline

- **Pre-match**: the match about to be played, through the lobby view (`lobby.ts`) with
  everything but the team's sitting-out locked, or a screen of its own if that reads better.
- **Play** as a local match. On game over, the placement, the rolls of the stage, the save,
  then the standings.
- **Replay**: a match is marked as started in the save. On resume, a started match that never
  finished is played again.
- **Standings** (§1.8): the league table and the bracket view.
- **The two endings**, the save deleted, back to the menu.
- **Leaving mid-match**: the Leave dialog's line that it will be replayed.

### T6 — Online

- **Protocol 18.** The host sends the room the table of the next match: each seat's name,
  level and personality, which seats are the team's, and the settings. The room then refuses
  a seat outside the team, any `configure` but choosing which team bot sits out, and a
  rematch.
- **The room kept across matches.** After a match the host sends the next table, and everyone
  still at the room returns to its lobby, as a rematch does now.
- **For the teammates**, a short line of where the tournament stands (the stage and the
  opponents), sent with the table. The full standings stay the host's screen.
- **The games browser** marks a tournament room and names the team.
- The host dropping, on purpose or not, is the replay of §1.7.

### T7 — Texts, help and documentation

- Every new text in English and German (`locale.test.ts`).
- A short section in How to play on what a tournament is.
- `tools/screenshots.sh` scenes for the new screens.
- CLAUDE.md and PLAN.md brought up to date, and the work summarised in ARCHIVE.md.

### T8 — Play-testing

- A tournament of each length, played by the user: how long it takes and whether the rolls
  feel fair.
- Triaged with the user before anything changes, as every test session is.

---

## 4. Risks and things to watch

- **Double elimination with matches of more than two teams** has no standard form. §1.5's
  pool is the design. T1's tests must show it ends, and that the host's path through the
  losers' bracket is long but not absurd. If it is, its match sizes can be bounded
  separately.
- **Summing ratings** may misjudge mixed teams, given the cliff from Level 4 to 5. T2
  measures this before the rolls are trusted.
- **Save size**: a large field with a long league is thousands of results. They are kept
  compact (placements as small arrays, names as indices into the pools) and the save is
  measured in T1.
- **The archnemesis in double elimination** can meet the host in the losers' bracket before
  the final. That is accepted: it makes for a better story, not a worse one.
