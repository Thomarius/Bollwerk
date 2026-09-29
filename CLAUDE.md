# Rampart Remake

Multiplayer-only recreation of the 1990 Atari arcade game _Rampart_, in TypeScript.
Shoot down opponents' castle walls, then race to rebuild your own before the next
barrage. Fail to seal a castle and you spend a life; run out of lives and you are out.

**`docs/PLAN.md` is the design and the open work** — read it before changing rules,
terrain or bots. **`docs/ARCHIVE.md`** records how each decision was reached, with the
measurements and the reverted attempts; consult it before re-trying something. This file
is the orientation.

## Commands

```bash
npm install
npm start                           # build, then serve the game at http://localhost:8080
npm run check                       # format, lint, typecheck, test — must pass before committing
npm run build                       # client + server bundles, both needed by the image
npm run dev   -w @rampart/client    # play offline at http://localhost:5173
npm start     -w @rampart/server    # serves the built client at http://localhost:8080
npm start     -w @rampart/headless -- --matches 8 --players 3 --difficulty gunner --stats out.csv
npm start     -w @rampart/headless -- --map --players 3 --seed 2   # print a map as ASCII
npm start     -w @rampart/headless -- --replay recordings/ --stats human.csv   # recorded human play
tools/screenshots.sh /tmp/shots [scene...]   # client in fixed states, against the dev server
```

`npm run check` takes a few minutes, mostly bot matches. Run it in the background and
wait rather than assuming it hung.

Client dev query parameters: `?autostart=1&players=3&seed=7` (a random seed without it),
`&snapshot=build` to jump to a phase (`&round=N` for one deep in a match, `&idle=1` to
leave your seat undriven on the way, so you are soon knocked out), `&speed=10`,
`&style=flat|pixel|night|cyberpunk|blueprint|parchment` for both looks (a one-look style sets only its own)
(`&buildStyle=`, `&combatStyle=` for one), `&watch=1&bots=marshal` to observe a bot match,
`&rounds=12` for the round cap, `&teams=2` for teams of two in seat order. `?host=8` opens
the lobby at eight seats — a room if a server answers, a local table if not —
`?join=CODE` joins one, `&name=Bo` sets the name, `&seed=N` the map. The menu's Play and
Join reach the same lobby, which sets the map, players, teams, bots and rounds.

## Layout

| Package          | Contents                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| `config`         | Zod schemas, typed defaults, cross-file validation. Reads `config/*.json`. |
| `sim`            | The deterministic game core. No DOM, no Node, no I/O.                      |
| `protocol`       | Wire messages and validators.                                              |
| `ai`             | Bots: min-cut sealing, 0-1 BFS attack, difficulty tiers.                   |
| `analysis`       | Per-round match statistics, for bot soaks and recorded human play alike.   |
| `server`         | Authoritative match server, rooms, WebSocket, match recordings.            |
| `client`         | Pixi renderer, six visual styles, controls, HUD, netcode client.           |
| `tools/headless` | Bot-vs-bot soak runs and map dumps.                                        |

Internal packages export TypeScript source directly, so there is no build step between
them. The production image bundles the server with esbuild; development never does.

## Four things that are not negotiable

**The simulation is deterministic.** `(seed, ruleset, ordered input log)` must always
produce one identical match. The server sends _actions and the tick they landed on_, not
board state, and every client replays them — so any nondeterminism is a desync, not a
cosmetic bug. `Math.random`, `Date.now` and `performance` are banned in `sim` and `ai` by
lint rule. `Math.sin/cos/sqrt` are implementation-approximated per spec, so `trig.ts` and
`math.ts` provide exact replacements. Anything the sim must choose for a player comes
from `streamFor(seed, name)`. Every 30 ticks the server sends a state hash and clients
check it.

**Nothing derivable is transmitted.** Terrain and the piece queue are regenerated from
the seed. The ruleset travels in the snapshot, because a client on different rules would
desync rather than merely look wrong.

**No rule is hardcoded.** Every tunable lives in `config/*.json` behind a strict schema —
an unknown key is an error, not a silent default.

**The server owns identity.** It overwrites the `player` field of every incoming action
with the sender's seat, so a client cannot act for someone else.

## The rules, where they differ from expectation

Full detail in PLAN.md §1. The parts that surprise people:

- **One island, copied into a pattern.** A rectangular-ish island is drawn in a box,
  trimmed to its land, then stamped by translation and mirroring — both exact, so every
  island is pixel-identical at every player count. 2–8 players; grids at 2, 4, 6, 8 and
  rings at 3, 5, 7. **The map's size is measured from the island and the pattern, not
  configured.**
- **A wall must turn its corners.** The escape flood is 8-connected while the wall is
  not, so a diagonal join does not seal. The coastline is worth nothing.
- **Only walls are destructible**, and a shot removes exactly the tile it hits — and only
  an opponent's. `fire()` refuses your own island, and an eliminated player's rubble is
  indestructible.
- **Cannons go inert outside sealed territory.** This is the game's main corrective and
  the source of most bot trouble.
- **Flight time _is_ the reload** — a cannon cannot fire again until its shot lands.
- **The starting ring is 8x8 around a 6x6 interior.** A castle sits centred in it, so the
  free band is two tiles wide and a 2x2 cannon spans it: opening cannons must touch the
  wall. Geometry, not a bot failing.
- **Continues**: failing to seal spends a life, wipes the island, and hands back a fresh
  castle and ring. It also rewinds that player's piece schedule to round 1, which is why
  `build.sharedPieceSequence` is false.
- **Orphaned wall is swept in one pass**: blocks with fewer than two orthogonal wall
  neighbours are marked against the board as it stands, then go together. A run of three
  keeps its middle. Stranded wall stays as an obstacle.
- **The piece set widens by round**, and one-cell pieces stop being dealt after the early
  rounds — so a one-tile gap with no free neighbour can never be filled.
- **Overtime**: when the build clock runs out, everyone may still place the piece they
  hold, within three seconds, and no more.
- **Every match is a team match**; free-for-all is teams of one. Teams share a score (the
  sum of their members') and a pool of lives, and a member failing with the pool empty
  takes the whole team out. Teammates may build on each other's islands — people only by
  default. A placed block belongs to the island, not to whoever placed it.
- **Seats are shuffled onto islands at the start**, server and local alike. Player p still
  owns island p + 1; the room tells each connection which player it has become, so never
  assume the first seat is player 0. **Teams belong to seats**, and the host chooses who
  sits where; the seed is fixed when the table is set, so the lobby shows the real map.

## Status

**Done**: M0–M6 (deployment verified by a CI job, since there is no Docker on this
machine; 18 of 19 sound cues supplied by the user, `wall_destroyed` still to come), M8
team mode (ARCHIVE 10u), M9 the visual pass (a build and a combat look swapped by
the banners, effects throughout, a lobby showing the real map), the recording of every
match (ARCHIVE 11e, each header stamped with the server's commit), M10 six visual styles
for either look, each with its own menu title and banner, and M11 the UI polish (a
compact roster, reload rings and aim line, an end-of-match summary, an Effects setting).
All display-only work since has left the sim untouched.

**Now**: the user is running human test sessions — the first, one person against two
gunners, is in `recordings/` and replays exact — and sends compiled feedback. The first
batch is PLAN §11.12: small fixes done, then castle-less pockets as territory (before any
§11.2 measurement), pause, and an open games browser. **No hidden keyboard shortcuts**
(the user's rule): every action has something on screen to click; Esc for pause is the
one agreed exception, and R/E rotate the piece as listed controls.
PLAN.md §11 opens with where to start:

1. **Elimination tuning** (§11.2), the next milestone — planned, and now able to use the
   recorded human rounds. Target: half of 3–4 player matches end with one player left
   before the cap. Weights stay; levers are one continue instead of two and a new
   placement delay, measured against careful bots and an ambitious points-driven one.
   The round cap and points scoring are done (§1.7): most matches reach the cap, so **the
   scoring formula is the game's balance**.
2. **Two-player balance** (§11.3), to be re-measured under the cap before anything is tried.
3. Measurements never taken (§11.4): the full ladder, and seat bias at 6 and 8 players in
   free-for-all (team seating is measured, and fair).
4. Independent of balance: bots as personality × skill (§11.6). The visual work of
   M9–M11 is done, its plans in ARCHIVE 11h.
5. **The second visual pass** (§11.11, M12), display only, runs beside the testing: eight
   packages W1–W8, the last a seventh style, Toy bricks.

## Measuring the bots

`npm start -w @rampart/headless -- --stats FILE` writes a row per player per round,
sampled at the resolution that ends each build phase — castles sealed, cannons owned and
active, cannon room, wall tiles, pieces placed against the pieces the tier had time for.
A summary goes to the console. `--difficulty marshal,gunner,recruit` sets each seat
separately, `--max-rounds N|none` overrides the cap. Rows also carry points banked and,
for diagnosing failed rounds, `repairAtBuild`, `repairLeft` and `repairStuck`: what the
tightest seal needed as the phase opened, what was still missing at its end, and how much
of that no piece in the bag could fill. Prefer this to watching; watching is for forming
the hypothesis.

**Human play is recorded** into `recordings/` (git-ignored): every match the server runs,
and every local match a page served by it plays, one `<id>.jsonl` each — header, the
actions of each tick, end (`protocol/src/recording.ts`). A dev-server page has nowhere to
send them and records nothing, as does `&snapshot=`. When a match ends the server writes
its statistics beside it, `<id>.stats.csv`, the same table a bot soak's `--stats` writes,
a person's seat's tier `human`. `--replay` does the same for any recordings by hand — an
abandoned match, or new columns over old sessions — and says whether each replay was
exact. One switch turns all of it off: `recordings.enabled` in `config/server.default.json`.
The statistics code is `packages/analysis`, shared by the server and the harness. A
recording replays exactly only against the code that made it, since the rules travel in
its header but the simulation does not — so the server stamps each header with its commit
(`-dirty` if the tree had changes), and `--replay` names it.

## What has already been tried, so it is not tried again

- **Scaling fire rate with cannon count** made matches _longer_ and flattened the skill
  ordering. Reverted.
- **Ambition is a liability for survival**: a marshal walling three castles lost to a
  gunner walling two, so it is bounded at two. Points scoring did _not_ invert this:
  lifting marshal to three changed nothing, because bots rarely hold two.
- **A wider room band** (`ROOM_RADIUS` 3 -> 4) is badly worse under points too: one win in
  twelve, rounds forfeited 26% -> 43%.
- **Making gunner purely defensive** produced six draws in eighteen — a turtle is very
  hard to kill.
- **Three castles per island rather than four, closer together.** Measured and reverted:
  gunner went from one unfinished match in eight to five in six. Fewer castles means
  fewer candidate walls and the survivors are tighter.
- **Widening the starting ring to 10x10** fixed opening cannon clearance and was reverted
  for fidelity to the original; continues absorb the early knockouts it guarded against.
- **Dropping wall thickening from a bot's priorities** changed nothing on its own (13
  wins of 20 against two gunners, then 12), and dropping it while expanding eagerly did
  worse (9). Eager expansion with thickening kept looked best at 14 of 20, but at forty
  matches it tied marshal (28 against 29): the `baron` tier is that, kept for variety.
- **Raising flight time further** to force exactly three salvos drops the rate below the
  original's three and makes close shots slower. The spread of ranges makes "exactly
  three for everyone" unreachable without flattening distance-scaling entirely.

## Hard-won gotchas

- **A minimum cut is the _tightest_ wall that works** — exactly the wall with nowhere to
  put a gun, and the most fragile one. Nearly every bot problem traces back to this.
- **`cannonsToPlace` is zero for the whole build phase**; it is set at the resolution that
  ends it. Judge cannon room against the reward about to be earned.
- **`enclosedCastles` is refreshed by placements and resolutions, not by shots landing.**
  It is legitimately 0 mid-repair, and it still says "sealed" as a breached build phase
  opens. Do not assert on it except at a resolution; a bot deciding on it must count
  afresh with `computeEnclosure`, which is what cost the bots a quarter of their rounds.
- **Headless Chrome cannot verify anything time-dependent in the client.** A watched match
  is still on round 0 after 120s of virtual time at 10x speed. Pull the logic into a pure
  function and test that, as `banners.ts`, `lobby.ts` and `scores.ts` do. It can still be
  _looked at_: in real time, Playwright's screenshot command renders fine, and
  `tools/screenshots.sh` uses `&snapshot=PHASE&round=N` plus a wait to reach a state —
  an announcement, the final round, game over.
- **A test asserting "failing to seal ends your match" needs `withoutContinues`**, and so
  does anything measuring the piece-size ramp: a continue rewinds the schedule, so the
  build rate climbs back instead of falling.
- **Tune shot flight against round one, not the match average.** The average hid long guns
  firing twice while close ones fired six times.
- **A one-tile gap between a cannon and water cannot be filled** once one-cell pieces stop
  being dealt. That is why `placeCannon` weighs clearance from wall and shore ahead of
  range.
- **Anything visual scaled by flight time breaks when the reload is tuned.** The shot arc
  went off-screen when flight tripled; it follows range now (`shotLift` in `theme.ts`).
- **`Int32Array.fill(Number.MAX_SAFE_INTEGER)` truncates to -1**, which silently disabled
  target selection for an entire tuning session.
- **Measure both seats.** Position carries a real advantage; a 19-1 record looked like a
  coin toss when only seat 0 was tested.
- **"Fits" and "varies" are different questions.** An island that nearly fills its box
  generates fine and produces the _same map for every seed_.
- **Prettier reflows code, so string-replace patches silently miss.** Assert on every
  replacement.
- **The static handler answers an unknown path with `index.html` and a 200.** A missing
  asset is not a 404 — audio decides a file is absent by its failure to decode.
- **Check nothing stale is answering.** A git worktree sharing the main checkout's
  `node_modules` resolves `@rampart/*` back into the working tree and measures the new
  code twice; a server left running on 8080 answers instead of the one you just built.
  Identical state hashes either side of a change mean the code did not load.
- **The HUD's banner layer holds more than the announcement**: island banners, team tags,
  the big timer, the cursor count. Replacing its children for each announcement detached
  the rest, which went on updating nodes no longer on the page. Screenshots taken with
  `&snapshot=` skip the announcements and could not catch it; watch a phase change.
- Removing a rectangle's **corner** does not breach it under 4-connectivity; use a
  mid-edge tile in tests.

## Conventions

Comments explain _why_, not _what_, and record measurements where a number was chosen by
experiment. Commit messages are prose explaining the reasoning and what was measured.
Tests state expectations as ASCII pictures where the subject is geometric
(`stateFromAscii` in `sim/testing.ts`). Findings that are deferred go into `docs/PLAN.md`
rather than being left in chat; completed work is summarised into `docs/ARCHIVE.md`.
