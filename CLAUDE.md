# Bollwerk

Multiplayer-only recreation of the 1990 Atari arcade game _Rampart_, in TypeScript.
Shoot down opponents' castle walls, then race to rebuild your own before the next
barrage. Fail to seal a castle and you spend a life; run out of lives and you are out.

**The name is Bollwerk, never Rampart** (renamed 2026-10-02, ARCHIVE 11zw; the repository
is `Thomarius/Bollwerk`, the local folder still `RampartRemake`). Rampart is a trademark
of Warner Bros. Entertainment: the game names it only to say what it is inspired by
(`INSPIRED_BY` and `DISCLAIMER` in `packages/config/src/credits.ts`, shown in the menu,
the Credits, the desktop window, the README and the release notes). In the docs "the
original" means Rampart. Nothing of the original is used — no code, graphics or sound.

**Every audio file must be credited** in `config/audio.manifest.json` (`credits`, by path:
title where known, author, licence, source, changes), or by its folder's credit — a key
ending in `/`, which is how the sound effects, all CC0, are one line (`sfx/`). `npm run
credits` writes `CREDITS.md` from it, and a test fails when that file is stale or any file
is uncredited. Every sound is from OpenGameArt.org, but three music tracks from Pixabay (Pixabay Content
License, credited to their authors as they ask).

**`docs/PLAN.md` is the design and the open work** — read it before changing rules,
terrain or bots. **`docs/ARCHIVE.md`** records how each decision was reached, with the
measurements and the reverted attempts; consult it before re-trying something. This file
is the orientation.

## Commands

```bash
npm install
npm start                           # build, then serve the game at http://localhost:8080
npm run check                       # format, lint, typecheck, test — must pass before committing
npm run credits                     # CREDITS.md, from the audio manifest's credits
npm run soak                        # the weekend soak again (ARCHIVE 12h), resumable; --list, --trial, --summary
npm run build                       # client + server bundles, both needed by the image
npm run dev   -w @bollwerk/client   # play offline at http://localhost:5173
npm start     -w @bollwerk/server   # serves the built client at http://localhost:8080
npm start     -w @bollwerk/headless -- --matches 8 --players 3 --level 5 --stats out.csv
npm start     -w @bollwerk/headless -- --map --players 3 --seed 2   # print a map as ASCII
npm start     -w @bollwerk/headless -- --replay recordings/ --stats human.csv   # recorded human play
npm start     -w @bollwerk/headless -- --tournament --count 400 --league --double  # tournaments by rolls
tools/screenshots.sh /tmp/shots [scene...]   # client in fixed states, against the dev server
npm start     -w @bollwerk/desktop  # the desktop app, after npm run build
npm run package -w @bollwerk/desktop # its portable file for this system, into packages/desktop/release/
```

`npm run check` takes a few minutes, mostly bot matches. Run it in the background and
wait rather than assuming it hung.

Client dev query parameters: `?autostart=1&players=3&seed=7` (a random seed without it),
`&snapshot=build` to jump to a phase (`&round=N` for one deep in a match, `&idle=1` to
leave your seat undriven on the way, so you are soon knocked out), `&speed=10`,
`&perf=1` for the frame-time readout (ARCHIVE 12n: a fixed 30 s window, Copy for the figures),
`&style=flat|pixel|night|cyberpunk|blueprint|parchment|bricks|glass|chocolate|halloween|sakura|oktoberfest|opera|office|undersea|electric|cartoon|christmas|noir` for both looks (a one-look style sets only its own)
(`&buildStyle=`, `&combatStyle=` for one), `&watch=1&level=8` to observe a bot match (`&personality=offensive` fixes every bot's),
`&rounds=12` for the round cap, `&teams=2` for teams of two in seat order, `&lang=de` for a
language (not saved). `?tournament=new` and `?tournament=resume` open the tournament screens,
`?tournament=demo&seed=N` a tournament of teams of two between matches (saved as `t-demo`), and
`&snapshot=game_over` plays a tournament's match out at once, its result counted. `?host=8` opens
the lobby at eight seats — a room if a server answers, a local table if not —
`?join=CODE` joins one, `&name=Bo` sets the name, `&seed=N` the map, `&private=1` makes
the room private. The menu's Play (with its Public / Private switch), its list of open
games and Join reach the same lobby, which sets the map, players, teams, bot levels and
rounds.

## Layout

| Package          | Contents                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| `config`         | Zod schemas, typed defaults, cross-file validation. Reads `config/*.json`. |
| `sim`            | The deterministic game core. No DOM, no Node, no I/O.                      |
| `protocol`       | Wire messages and validators.                                              |
| `ai`             | Bots: min-cut sealing, 0-1 BFS attack, skill levels and personalities.     |
| `analysis`       | Per-round match statistics, for bot soaks and recorded human play alike.   |
| `tournament`     | Tournament mode's core: schedule, brackets, quick rolls, saves. No DOM.    |
| `server`         | Authoritative match server, rooms, WebSocket, match recordings.            |
| `client`         | Pixi renderer, nineteen visual styles, controls, HUD, netcode client.      |
| `desktop`        | Electron app for releases: the server behind a minimal window (M14).       |
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

- **One island, copied into a pattern.** An island is drawn in a box with rounded
  corners, trimmed to its land, then stamped by translation and mirroring — both exact, so
  every island is pixel-identical at every player count. 2–8 players; grids at every count
  but 3, which is a ring (a short last row is centred), and three teams of two, who play on
  a compact hex of six, wide rather than fair (`teamSize` patterns, ARCHIVE 12zs, 13c). **The map's size is measured from the island and the pattern, not
  configured.**
- **A wall must turn its corners.** The escape flood is 8-connected while the wall is
  not, so a diagonal join does not seal. The coastline is worth nothing.
- **Only walls are destructible**, and a shot removes exactly the tile it hits — and only
  an opponent's. `fire()` refuses your own island, and an eliminated player's rubble is
  indestructible.
- **The main castle** — the one chosen, afresh after a continue — earns the first
  castle's reward only while it is sealed; every other castle earns one. It wears a crown.
- **You see where only your own shots will land**, and bots know no more: they avoid
  tiles their own shots are headed for, not anyone else's.
- **Cannons go inert outside sealed territory.** This is the game's main corrective and
  the source of most bot trouble.
- **A pocket counts.** Sealed ground with no castle is territory — guns, points — while
  its player holds a sealed castle anywhere, as in the original; it never saves a round
  on its own (`enclosure.castlelessRegionsCount`, PLAN §1.3).
- **Flight time _is_ the reload** — a cannon cannot fire again until its shot lands.
- **The starting ring is 8x8 around a 6x6 interior.** A castle sits centred in it, so the
  free band is two tiles wide and a 2x2 cannon spans it: opening cannons must touch the
  wall. Geometry, not a bot failing.
- **Continues**: failing to seal spends a life, wipes the island, and hands back a fresh
  castle and ring. It also rewinds that player's piece schedule to round 1, which is why
  `build.sharedPieceSequence` is false. The rewind is required, the user's decision
  (2026-10-05, ARCHIVE 12k): it is not to be measured or questioned again.
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
- **Seats are shuffled onto islands at the start**, server and local alike — except three
  and four teams of two, dealt onto one of the pattern's fair `teamLayouts`, drawn by
  weight, so every team stands alike (`seatOrder`, ARCHIVE 12zs). Player p still
  owns island p + 1; the room tells each connection which player it has become, so never
  assume the first seat is player 0. **Teams belong to seats**, and the host chooses who
  sits where; the seed is fixed when the table is set, so the lobby shows the real map.

## Status

**Done** (2026-10-10; the latest release **v0.8.7**, 2026-10-10, protocol 21, which a test
session needs the server rebuilt and every page reloaded for):

- **Ready and favourite looks** (ARCHIVE 13i, 2026-10-10): a room's guests say Ready, and the
  host's Start waits for them all (the server refuses it too); styles hearted in the gallery,
  ♥ All and ♥ None, and Random draws only from the favourites, or from all with none.
- **Performance and sound** (ARCHIVE 13e, 13f): Random looks that came round again fixed
  (Pixel's and Night's never finished warming); a Sharpness setting (Sharp or Fast, the render
  resolution); Chocolate's and Blueprint's frames cut to the other styles'; the music starting as
  the page opens where the browser allows, always in the desktop app's window.
- **The style pass** (ARCHIVE 12zt–12zz, 13a, 13b): every style but Minimal reviewed in the same
  screenshots and finished in nine packages — readability first (S1), then Parchment, Blueprint,
  Pixel and Night, Toy bricks, Stained glass and Cyberpunk made things of their setting (castles,
  guns, walls, sealed ground, life), then the middle styles' walls and guns and the last touches;
  the main castle's crown, still one shared mark, smaller and at the castle's foot.
- **Team seating** (ARCHIVE 12zs, 13c): four teams of two on one of the grid's four fair
  seatings (`teamLayouts`); three teams of two on a compact hex of six (`hex`, `rowGapTiles`),
  wide rather than fair, the users' choice for wide screens.
- **The third feedback** (ARCHIVE 12zr): a tournament's lobby is one screen for the host and
  their teammates, a Match tab (the map, the seats, who plays in place of which bot) and a
  Tournament tab (the standings, the bracket as an icon beside them), opening on the match.
  The host's room passes their save on to the teammates' pages (protocol 20,
  `tournamentSave`, the one message allowed up to `limits.maxTournamentBytes`).
- **Tournament mode** (2026-10-08, `docs/TOURNAMENT.md`, ARCHIVE 12ze–12zk): the host's team
  of people and bots against a field of named bot teams, through a league (one match size a
  matchday) and a single- or double-elimination knockout, saved in the browser between
  matches. The core is `packages/tournament` — a save is settings, field, plan and finished
  steps, and `Progress` derives the rest; matches without the host's team are quick rolls
  over linear level ratings. A match is played at a fixed table (`matchTable`, given names
  and personalities), offline or in a room friends join by code to sit in the host's team
  (protocol 18, `TournamentTable`); one left before its end is played again. Its last work
  package, T8, is the users' play-testing round, under way.
- **The second feedback** (ARCHIVE 12zp): lives, one to five, chosen in the lobby beside the
  rounds and in the tournament (`MatchSettings.continues`, protocol 19); a tournament's
  matches of 1–15 rounds; the archnemesis's teammates at the top level, him one above, carried
  to the final by the rolls unless the host puts him out (in double elimination's winners'
  bracket he rolls as anyone); the last match framed under a trophy; and the **Bracket**
  window, the knockout as a tree of matches (`tournamentBracket.ts`, pure, and its view).
- **The first feedback of that round** (ARCHIVE 12zl, 12zm): the score bar sorts teams by
  standing; the title's line glides without pause; the match's summary is larger and no
  longer reveals the bots' personalities; and the looks' wipes are smoother — the coming
  look primed in the pause before its banner (`Scene.prime`), a new random look made a
  frame's share at a time (`withDrawBudget` in `IslandParts`).
- **The game**: its rules, online play with rooms, a games browser, pause, and recording
  of every match (ARCHIVE 11e, each header stamped with the server's commit); team mode
  (ARCHIVE 10u), the teams named where a table names them (`MatchState.teamNames`); bots as
  a skill level 1–10 chosen in the lobby and a personality dealt from the seed (M13,
  ARCHIVE 11x–11zb); bots sharing a few plans a tick (ARCHIVE 12p) and skipping searches
  that cannot fit (ARCHIVE 12s).
- **Stronger bots** (ARCHIVE 12x–12z; `docs/BOT_LEARNING.md`): bots plan round tiles no
  piece can cover (`coverable`, `markUncoverable`), and once sealed widen their wall
  (`widensWhenSealed`, `widen`) — such a bot won 65 of 96 against two of the old. A learned
  fit (`fitWeights`, null by default) and its trainer (`tools/headless/src/cem.ts`) matched
  the hand-made fit; the learning work is paused.
- **A refactoring** (ARCHIVE 12w), the game unchanged: the bot is `Gunner`, `Builder` and
  `Siting`; main.ts is app, prefs, session, menu, lobbyFlow and matchScreen, the last with
  `BoardEffects`; a room's match is `MatchRunner`; the styles since Chocolate extend
  `ShapeTheme`; seats are dealt by `dealSeats` and bots driven by `takeBotTurns`.
- **The looks**: nineteen styles for either look — Minimal, Medieval, Night, Cyberpunk,
  Blueprint, Parchment, Toy bricks, Stained glass, Chocolate (ARCHIVE 11zy), Halloween
  (12a), Sakura (12d), Oktoberfest (12e), Opera (12f), Office (12l), Under the sea (12u),
  Electric (12v), Cartoon, a rubber-hose reel in black and white (12zb), Christmas (12zc),
  and Noir, a crime city at night as a cel-shaded graphic novel, hatched in ink (12zn) —
  each carried to the panels, the big timer, the island banners and the finish (ARCHIVE
  11zz), each with a piece in the sea's corner (`corner.ts`, 12t); chosen from a gallery with
  Random, a new style every round (12q), and changeable mid-match from the pause menu (12b).
- **Around a match**: How to play, the ranking between rounds, awards, a rematch, music
  and sounds volumes, a pause menu with Leave match; rounds of test-session feedback
  (ARCHIVE 11n–11w, 11ze, 12zl). Mouse only; Esc for pause is the one key.
- **Languages**: English and German, every text in `config/locale/`, chosen in the menu and
  pause menu, the desktop window in the system's language (M15, ARCHIVE 12g). A text is a key
  until shown (`t` in `client/src/i18n.ts`); a new text goes into every locale file, or
  `locale.test.ts` fails.
- **Releases**: the desktop app, a portable file for Windows and Linux (M14, ARCHIVE
  11zp–11zt); every audio file credited (ARCHIVE 11zx). Deployment is verified by a CI job,
  since there is no Docker on this machine. **UPnP** (ARCHIVE 12j): the desktop app's switch
  Open to the internet, off by default, and `npm start -- --upnp` ask the router to open the
  port; the lobby then offers an invite link. Never in the image. Tested by the user from
  outside, successfully (2026-10-09).
- **Balance** (M7, ARCHIVE 12h): a weekend soak of 22,656 matches found the points game on
  target and one cliff, Level 4 to 5, ended by `carelessness` fading by level. The default
  is to change no rule without a very good reason. `npm run soak` reruns the whole plan.
- **Rendering performance** (ARCHIVE 12n): 58–60 fps at eight players on an integrated GPU,
  every effect kept; no memory kept by a swap of looks (ARCHIVE 12q); every look, corner
  piece and German checked in play by the user (ARCHIVE 12n–12t).

**Next** — PLAN §11: the tournament's play-testing (T8), more test games towards a first
feature-ready version, **the bots' planning moved to a Web Worker in local matches** (item 3,
planned in detail in seven work packages, to be built in a session of its own), and bots that
miss as people do (combat accuracy, measured against the
testers' recordings; how is not yet decided). **The bot learning work is paused**; when it
resumes, `docs/BOT_LEARNING.md` §6 says where — first, learning the choice of wall rather
than only the cell. French is not to be done. Signing the Windows app was explained (PLAN
§12) and is not pursued for now.

**Declined for budget** (PLAN §12): macOS builds (Apple's paid signing) and a hosted public
server. This is a fan project with no budget: propose nothing that costs money to run.

**Working with the user**: every match they play is recorded in `recordings/`; they send
compiled feedback, which is triaged with them before anything is built, and design
questions are asked before coding. Commits and pushes are theirs to approve, each time.
**Mouse only** (their rule): everything is played with the two mouse buttons and the
wheel — the right button or the wheel turns the piece — and every other action has
something on screen to click. No keyboard shortcuts; Esc for pause is the one agreed
exception, beside its button.

## Making a release

The desktop app (`packages/desktop`, ARCHIVE 11zp–11zt) is built for major versions only,
never for every change.
`.github/workflows/release.yml` builds the Windows portable `.exe` and the Linux `.AppImage`
on their own systems: run it by hand from the Actions tab with a version to get the two
files as the run's artifacts, to try first; push a tag `v1.2.3` to build them and publish
a GitHub release of that version. Locally, `npm run build` then
`npm run package -w @bollwerk/desktop` makes the file for this machine. Both are unsigned:
Windows warns of an unknown publisher on first start, and an AppImage must be marked
executable. Electron's own binary, for `npm start -w @bollwerk/desktop`, is fetched by
`node node_modules/electron/install.js` when `npm install` has not; CI and the image skip
it (`ELECTRON_SKIP_BINARY_DOWNLOAD`).

## Measuring the bots

`npm start -w @bollwerk/headless -- --stats FILE` writes a row per player per round,
sampled at the resolution that ends each build phase — castles sealed, cannons owned and
active, cannon room, pockets, wall tiles, pieces placed against the pieces the level had
time for; each row names the seat's `level` and `personality`.
A summary goes to the console. `--level 8,5,2` sets each seat
separately (old tiers: recruit 2, gunner 5, marshal 8, baron 8 offensive),
`--personality offensive` (trait values joined by `-`, one per seat by comma) fixes
personalities and `dealt` deals them from the seed as a match does — soaks are balanced
unless asked, so they measure what they say — and `--max-rounds N|none` overrides the cap. Rows also carry points banked and,
for diagnosing failed rounds, `repairAtBuild`, `repairLeft` and `repairStuck`: what the
tightest seal needed as the phase opened, what was still missing at its end, and how much
of that no piece in the bag could fill. Prefer this to watching; watching is for forming
the hypothesis.

**Human play is recorded** into `recordings/` (git-ignored): every match the server runs,
and every local match a page served by it plays, one `<id>.jsonl` each — header, the
actions of each tick, end (`protocol/src/recording.ts`). A dev-server page has nowhere to
send them and records nothing, as does `&snapshot=`. When a match ends the server writes
its statistics beside it, `<id>.stats.csv`, the same table a bot soak's `--stats` writes,
a person's seat labelled `human`. `--replay` does the same for any recordings by hand — an
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
- **Bot tactics measured and dropped** (ARCHIVE 11y): a penalty for leaving an unfillable
  one-tile hole (no effect — those holes come from shots) and thickening the side facing
  opponents first (raised forfeits). And "close gaps from the outside" applied to every
  plan thinned walls 14%: it is applied only while repairing.
- **A defensive bot opening from the castle farthest from opponents** had half the guns
  and won 2 of 24: that castle is on the outer edge, hemmed in by sea (ARCHIVE 11zb).
- **Rounder islands** read better but meet their neighbours at points with open sea
  between, and flight time is the reload: corner radius 6 is the roundest that kept the
  channels (ARCHIVE 11zc).
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
- **Headless Chrome cannot verify anything time-dependent in the client** by virtual time: a
  watched match is still on round 0 after 120s of it at 10x speed. Pull the logic into a pure
  function and test that, as `banners.ts`, `lobby.ts` and `scores.ts` do. It can still be
  _looked at_: in real time, Playwright's screenshot command renders fine, and
  `tools/screenshots.sh` uses `&snapshot=PHASE&round=N` plus a wait to reach a state —
  an announcement, the final round, game over. And it can be _watched_: launched with
  `--enable-gpu --use-angle=gl --ignore-gpu-blocklist`, a watched match at `&speed=4` plays out
  in real time, and temporary `console.log`s read through Playwright's `console` event are how
  the Random looks' lost styles were found (ARCHIVE 13e) — removed before committing.
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
  `node_modules` resolves `@bollwerk/*` back into the working tree and measures the new
  code twice; a server left running on 8080 answers instead of the one you just built.
  Identical state hashes either side of a change mean the code did not load.
- **The HUD's banner layer holds more than the announcement**: island banners, team tags,
  the big timer, the cursor count. Replacing its children for each announcement detached
  the rest, which went on updating nodes no longer on the page. Screenshots taken with
  `&snapshot=` skip the announcements and could not catch it; watch a phase change.
- Removing a rectangle's **corner** does not breach it under 4-connectivity; use a
  mid-edge tile in tests.
- **`weakestWall` only aims at sealed castles** (`castle.enclosed`), so an ASCII test board
  needs `applyEnclosure` first — which also sets guns outside sealed ground inert.
- **Before-and-after soaks**: `git stash`, run, `git stash pop`, then run again — and edit
  nothing while a background soak runs, since the stash swaps the files under it. Attribute
  a change of several parts with a temporary switch per part, removed before committing,
  and check the final code reproduces the measured variant's hashes.
- **The Bash tool's heredocs mangle patch scripts**: a backslash is lost (a `\s` became
  `s`, and a parser split words on the letter "s") and template literals with backticks
  break the quoting. Write patch scripts with the file tool, or edit directly.
- **Stopping a background `npm start` leaves its node child serving the port.** Find it by
  port and check its command line before killing it; remove any recording a test match
  left in `recordings/` — that folder is the user's tuning data.
- **`destroy({ children: true })` keeps every `Graphics`' own drawing**: Pixi hands the
  options down, and a `Graphics` destroyed with any keeps its context, registered with the
  renderer for good. Use `release` (`render/release.ts`); a look thrown away also empties
  Pixi's `BigPool`, whose free batches hold old buffers (`Scene.drop`, ARCHIVE 12q).
- **A bloomed layer blurs everything in it**, and each `BlurFilter` costs a screen-sized
  texture and its passes whatever it holds. Sharp cores go in an added layer never bloomed
  (Cyberpunk's `effectCore`), and blurs run at half resolution (ARCHIVE 12r).
- **`motionReduced()` is called per particle and per point**: it once read storage and built
  a media query at every call, 48 ms a frame in Opera. It is cached in `motion.ts`; anything
  else read that often must be too.
- **A new look's first render is warmed a piece at a time** (`Scene.warmChains`): a container's
  drawings one by one, its sprites together. One chain a sprite made Pixel's and Night's six
  thousand tiles six thousand chains, a minute and a half of warming, and their random looks never
  arrived in time (ARCHIVE 13e).
- **Pixi rebuilds a render group's whole draw list when any `Graphics` in it changes shape**:
  500 stamps each changing shape on their own beat cost Chocolate 3 ms a frame until they were
  put in render groups of their own (ARCHIVE 13f).
- **A local match's bots think inside the frame**: one bot planning its walls takes 15 to
  50 ms. `LocalMatch` spreads a tick's turns over frames (8 ms a frame) without changing an
  action or its tick.
- **Bots share a few plans a tick** (`PlanningSlots`, `ai.plansPerTick`): every player is dealt
  the same pieces, so bots of one level fall due to plan on the same ticks. Every driver —
  room, `LocalMatch`, harness — gives a table's bots one `PlanningSlots` and calls them in
  `turnOrder` (`takeBotTurns`; `LocalMatch` spreads one tick's over frames in the same
  order); a bot made without one is never held back (ARCHIVE 12p).
- **`computeEnclosure`, `weakestWall` and `MaxFlow` keep their working arrays between
  calls** (ARCHIVE 12w): nothing they return is one of them, and they are not re-entrant.
  A cache of a bot's plan lasts one turn (`Look`, `SealPlanner`), never a tick: bots act
  in turn, and each one's action changes the board the next one plans on.
- **Never `app.destroy(true)` while another Pixi renderer runs**: `true` releases what every
  renderer on the page shares, including pooled batches the other is using, and its next
  frame fails in the batcher. The style pictures destroy theirs without it (ARCHIVE 12b).
- **Playwright clicks on the canvas need a move, a pause, then down and up**, and clicks
  inside one tick claim one gun between them.
- **Line endings are LF everywhere, by `.gitattributes`**: a git that converts to CRLF —
  this machine's, a Windows runner's — fails every file against prettier's `endOfLine: lf`
  and `CREDITS.md` against its staleness test, which is what stopped the first v0.5.0
  Windows build.

## Drawing a style cheaply

Pixi cuts every changed `Graphics` into triangles on the CPU inside `render`; a good graphics
card does not help with that (ARCHIVE 12n). So a style **never redraws what has not changed**:

- **Walls and sealed ground by island**: `IslandParts` (`render/islandParts.ts`) gives the
  style's drawing one island's board and redraws only the island that changed.
- **Sprites in a layer emptied every frame**: from a `SpritePool` (`render/stamps.ts`), not
  `new Sprite`; Medieval made two hundred a frame and left them to the collector (ARCHIVE 12w).
- **Many alike, moving**: `Stamps` and `StampBook` (`render/stamps.ts`) — a shape drawn once
  for the tile size, then only placed, turned, scaled, tinted and faded. A shape whose
  look changes with its motion is stamped per step (Chocolate's swirls by turn, Sakura's
  crests by rise), never stretched where a line would thin.
- **Still most of the time**: `Memos` — a `Graphics` per thing redrawn when its key changes;
  the guns' barrels, which move only when firing. The key must name everything drawn.
- **Changing at a hit or a round**: its own `Graphics` behind a key (blots, stains, the Maß).
- **Thousands of sprites** beside something redrawn each frame: a render group of their own
  (Medieval's `tileLayer`), or Pixi gathers and packs every one of them again each frame.

- **Hatching, textures, anything repeating**: a `FillPattern` drawn once on a small canvas and
  laid into shapes as a fill, in screen space (Noir's hatching and cobbles, ARCHIVE 12zn) — a
  few vertices a shape, where strokes would be thousands.

A hidden look is rendered once offscreen at the start (`Scene.warmUp`) and primed in the pause
before the banner that brings it (`Scene.prime`): its stale layers drawn and rendered unseen a
frame's share at a time, so the wipe's first frame has nothing left to do (ARCHIVE 12zm). A new
random look is made the same way, `IslandParts` drawing under a budget (`withDrawBudget`). Each
style's terrain is still one drawing, the last hitch a new random look costs.

Check with `&perf=1` at eight players: the readout names the `Graphics` rebuilt most, every
frame and at worst. Keep the draw order where it shows; what came after a stamped thing goes
in a second `Graphics` above it.

## Conventions

Comments explain _why_, not _what_, and record measurements where a number was chosen by
experiment. Commit messages are prose explaining the reasoning and what was measured.
Tests state expectations as ASCII pictures where the subject is geometric
(`stateFromAscii` in `sim/testing.ts`). Findings that are deferred go into `docs/PLAN.md`
rather than being left in chat; completed work is summarised into `docs/ARCHIVE.md`.
