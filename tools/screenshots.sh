#!/usr/bin/env bash
# Screenshots of the client in fixed states, for checking layout by eye.
#
# Headless Chrome cannot verify anything that depends on the clock (CLAUDE.md), but it
# renders in real time well enough to be *looked at*: ?autostart with &snapshot jumps to a
# phase, &round=N to a phase deep in a match, and waiting lets the clock carry a state
# into the moment worth seeing — an announcement is on screen for four seconds, about
# twenty after a build phase opens.
#
#   npm run dev -w @bollwerk/client            # in another terminal, or BASE=...
#   tools/screenshots.sh [outdir] [scene...]  # all scenes by default
#
# Uses Playwright through npx at the version whose browser is cached here: the latest moved
# on to a browser not downloaded (1.64 wants Chromium 1248, the cache holds 1243). PLAYWRIGHT
# overrides it after a `npx playwright install`.
set -euo pipefail

OUT=${1:-/tmp/shots}
shift || true
BASE=${BASE:-http://localhost:5173}
GAME="$BASE/?autostart=1&players=3&seed=7"
# Bots in every seat, so the cannon phase ends early and the banners come on time.
WATCH="$GAME&watch=1&level=5"

# name|query appended to the base|milliseconds to wait
SCENES=(
  # The title sweeps once as the menu opens, so these wait for it to come to rest.
  "menu|$BASE/|4000"
  "menu-neon|$BASE/?buildStyle=pixel&combatStyle=cyberpunk|4000"
  "menu-night|$BASE/?buildStyle=flat&combatStyle=night|4000"
  "menu-one|$BASE/?style=pixel|2000"
  # The lobby, with the map it will play; no server under the dev server, so a local table.
  "lobby|$BASE/?host=3&seed=5&name=Ada|3000"
  "lobby-eight|$BASE/?host=8&seed=11&name=Ada|3000"
  # The tournament screens (docs/TOURNAMENT.md); the resume list is empty in a fresh browser.
  "tournament-new|$BASE/?tournament=new&name=Ada|1500"
  "tournament-resume|$BASE/?tournament=resume|1500"
  # A tournament between matches; under the dev server no room opens, after its two seconds.
  "tournament-demo|$BASE/?tournament=demo&seed=5&name=Ada|3500"
  "build-flat|$GAME&snapshot=build&style=flat|2000"
  "build-pixel|$GAME&snapshot=build&style=pixel|2000"
  "cannons-pixel|$GAME&snapshot=cannon_place&round=2&style=pixel|2000"
  "build-night|$GAME&snapshot=build&round=3&style=night|2000"
  "combat-night|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=night|4200"
  "wipe-night|$WATCH&snapshot=build&round=2&buildStyle=flat&combatStyle=night|30500"
  "build-cyber|$GAME&snapshot=build&round=3&style=cyberpunk|2000"
  "cannons-cyber|$GAME&snapshot=cannon_place&round=2&style=cyberpunk|2000"
  "combat-cyber|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=cyberpunk|4200"
  "four-cyber|$BASE/?autostart=1&players=4&seed=3&snapshot=combat&round=3&style=cyberpunk|3000"
  "eight-cyber|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=cyberpunk|3000"
  "teams-cyber|$BASE/?autostart=1&players=8&teams=2&seed=3&snapshot=combat&round=3&style=cyberpunk|3000"
  "wipe-pixel-cyber|$WATCH&snapshot=cannon_place&round=2&buildStyle=pixel&combatStyle=cyberpunk|4000"
  "wipe-cyber|$WATCH&snapshot=cannon_place&round=2&combatStyle=cyberpunk|4000"
  "build-blueprint|$GAME&snapshot=build&round=3&style=blueprint|2000"
  "combat-blueprint|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=blueprint|4200"
  "eight-blueprint|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=blueprint|3000"
  "build-parchment|$GAME&snapshot=build&round=3&style=parchment|2000"
  "combat-parchment|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=parchment|4200"
  "eight-parchment|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=parchment|3000"
  "build-bricks|$GAME&snapshot=build&round=3&style=bricks|2000"
  "combat-bricks|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=bricks|4200"
  "eight-bricks|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=bricks|3000"
  "wipe-pixel-bricks|$WATCH&snapshot=cannon_place&round=2&buildStyle=pixel&combatStyle=bricks|4000"
  "menu-bricks|$BASE/?buildStyle=flat&combatStyle=bricks|4000"
  "build-glass|$GAME&snapshot=build&round=3&style=glass|2000"
  "combat-glass|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=glass|4200"
  "eight-glass|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=glass|3000"
  "wipe-pixel-glass|$WATCH&snapshot=cannon_place&round=2&buildStyle=pixel&combatStyle=glass|4000"
  "menu-glass|$BASE/?buildStyle=flat&combatStyle=glass|4000"
  "build-chocolate|$GAME&snapshot=build&round=3&style=chocolate|2000"
  "combat-chocolate|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=chocolate|4200"
  "eight-chocolate|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=chocolate|3000"
  "wipe-chocolate|$WATCH&snapshot=build&round=2&buildStyle=flat&combatStyle=chocolate|30500"
  "menu-chocolate|$BASE/?buildStyle=flat&combatStyle=chocolate|4000"
  "build-halloween|$GAME&snapshot=build&round=3&style=halloween|2000"
  "combat-halloween|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=halloween|4200"
  "eight-halloween|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=halloween|3000"
  "wipe-halloween|$WATCH&snapshot=build&round=2&buildStyle=flat&combatStyle=halloween|30500"
  "menu-halloween|$BASE/?buildStyle=flat&combatStyle=halloween|4000"
  "build-sakura|$GAME&snapshot=build&round=3&style=sakura|2000"
  "combat-sakura|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=sakura|4200"
  "eight-sakura|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=sakura|3000"
  "wipe-sakura|$WATCH&snapshot=build&round=2&buildStyle=flat&combatStyle=sakura|30500"
  "menu-sakura|$BASE/?buildStyle=flat&combatStyle=sakura|4000"
  "build-oktoberfest|$GAME&snapshot=build&round=3&style=oktoberfest|2500"
  "combat-oktoberfest|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=oktoberfest|4200"
  "eight-oktoberfest|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=oktoberfest|3500"
  "final-oktoberfest|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=oktoberfest|4000"
  "menu-oktoberfest|$BASE/?buildStyle=flat&combatStyle=oktoberfest|4000"
  "build-opera|$GAME&snapshot=build&round=3&style=opera|2500"
  "combat-opera|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=opera|4200"
  "eight-opera|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=opera|3500"
  "final-opera|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=opera|4000"
  "menu-opera|$BASE/?buildStyle=flat&combatStyle=opera|4000"
  "build-office|$GAME&snapshot=build&round=3&style=office|2500"
  "combat-office|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=office|4200"
  "eight-office|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=office|3500"
  "final-office|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=office|4000"
  "menu-office|$BASE/?buildStyle=flat&combatStyle=office|4000"
  "build-undersea|$GAME&snapshot=build&round=3&style=undersea|2500"
  "combat-undersea|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=undersea|4200"
  "eight-undersea|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=undersea|3500"
  "final-undersea|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=undersea|4000"
  "menu-undersea|$BASE/?buildStyle=flat&combatStyle=undersea|4000"
  "build-electric|$GAME&snapshot=build&round=3&style=electric|2500"
  "combat-electric|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=electric|4200"
  "eight-electric|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=electric|3500"
  "final-electric|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=electric|4000"
  "menu-electric|$BASE/?buildStyle=flat&combatStyle=electric|4000"
  "build-cartoon|$GAME&snapshot=build&round=3&style=cartoon|2500"
  "combat-cartoon|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=cartoon|4200"
  "eight-cartoon|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=cartoon|3500"
  "final-cartoon|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=cartoon|4000"
  "menu-cartoon|$BASE/?buildStyle=flat&combatStyle=cartoon|4000"
  "build-christmas|$GAME&snapshot=build&round=3&style=christmas|2500"
  "combat-christmas|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=christmas|4200"
  "eight-christmas|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=christmas|3500"
  "final-christmas|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=christmas|4000"
  "menu-christmas|$BASE/?buildStyle=flat&combatStyle=christmas|4000"
  "build-noir|$GAME&snapshot=build&round=3&style=noir|2500"
  "combat-noir|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=noir|4200"
  "eight-noir|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=noir|3500"
  "final-noir|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=noir|4000"
  "menu-noir|$BASE/?buildStyle=flat&combatStyle=noir|4000"
  # Sports (ARCHIVE 14d): the sportsmen, the trophies, the stands; its banner's
  # "Kick-off!" under the call, a watched match caught as the banner crosses.
  "build-sports|$GAME&snapshot=build&round=3&style=sports|2500"
  "combat-sports|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=sports|4200"
  "eight-sports|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=sports|3500"
  "final-sports|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=sports|4000"
  "banner-sports|$WATCH&snapshot=cannon_place&round=2&style=sports|5000"
  "menu-sports|$BASE/?buildStyle=flat&combatStyle=sports|4000"
  # Pirates (ARCHIVE 14q): the stockades, the forts' Jolly Rogers, the parrots on the guns,
  # the galleon in the corner; the Kraken in the final round; "Fire at will!" under the call.
  "build-pirates|$GAME&snapshot=build&round=3&style=pirates|4500"
  "cannons-pirates|$GAME&snapshot=cannon_place&round=2&style=pirates|2500"
  "combat-pirates|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=pirates|4200"
  "eight-pirates|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=pirates|3500"
  "final-pirates|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=pirates|8000"
  "banner-pirates|$WATCH&snapshot=cannon_place&round=2&style=pirates|5000"
  "menu-pirates|$BASE/?style=pirates|4000"
  # Anime (ARCHIVE 14w): the clans' chibi guns, the screentone and magic circles; the focus lines
  # in the final round; the banner an episode card with the hero's face.
  "build-anime|$GAME&snapshot=build&round=3&style=anime|4500"
  "cannons-anime|$GAME&snapshot=cannon_place&round=2&style=anime|2500"
  "combat-anime|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=anime|4200"
  "eight-anime|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=anime|3500"
  "final-anime|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=anime|8000"
  "banner-anime|$WATCH&snapshot=cannon_place&round=2&style=anime|5000"
  "menu-anime|$BASE/?style=anime|4000"
  # Mythos and Wild West (ARCHIVE 14x, 14y): the vase and its onagers, Sisyphus in the corner, the
  # gods at the climax; the mesas over the canyon floor, the barrels, tumbleweeds, high noon.
  "combat-mythology|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=mythology|4200"
  "eight-mythology|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=mythology|3500"
  "final-mythology|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=mythology|8000"
  "banner-mythology|$WATCH&snapshot=cannon_place&round=2&style=mythology|5000"
  "menu-mythology|$BASE/?style=mythology|4000"
  "combat-wildwest|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=wildwest|4200"
  "eight-wildwest|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=wildwest|3500"
  "final-wildwest|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=wildwest|8000"
  "banner-wildwest|$WATCH&snapshot=cannon_place&round=2&style=wildwest|5000"
  "menu-wildwest|$BASE/?style=wildwest|4000"
  "eight-night|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=night|3000"
  # The climaxes of the first eight styles (PLAN 11 item 5), in the final round's build phase.
  "final-pixel|$GAME&snapshot=build&round=10&style=pixel|8000"
  "final-night|$GAME&snapshot=build&round=10&style=night|8000"
  "final-cyber|$GAME&snapshot=build&round=10&style=cyberpunk|8000"
  "final-blueprint|$GAME&snapshot=build&round=10&style=blueprint|8000"
  "final-parchment|$GAME&snapshot=build&round=10&style=parchment|8000"
  "final-bricks|$GAME&snapshot=build&round=10&style=bricks|8000"
  "final-glass|$GAME&snapshot=build&round=10&style=glass|8000"
  "standings|$GAME&snapshot=build&round=2&style=flat|25500"
  "final-round|$GAME&snapshot=cannon_place&round=9&style=flat|27500"
  # The summary is held back for art.summary.delayMs while the fireworks play.
  "game-over|$GAME&snapshot=game_over&style=flat|5500"
  "game-over-watched|$GAME&snapshot=game_over&watch=1&style=pixel|5500"
  "combat-close|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=pixel|4200"
  "gains|$GAME&snapshot=build&round=3&style=pixel|21800"
  "life-lost|$GAME&snapshot=build&round=2&style=pixel|21600"
  "knocked-out|$GAME&snapshot=combat&round=5&idle=1&style=pixel|2500"
  # W6's moments: the opening on your own island, marked, then pulled out to the map;
  # the final round's stamp; the push onto the winner; the summary of a match actually
  # played (five watched rounds at ten times speed), which alone fills its columns.
  "opening-close|$GAME&style=pixel|700"
  "opening-pull|$GAME&style=pixel|2600"
  "final-stamp|$GAME&snapshot=combat&round=10&style=pixel|900"
  "winner-push|$GAME&snapshot=game_over&style=flat|6000"
  "summary|$GAME&watch=1&level=5&speed=10&rounds=5&style=flat|95000"
  # The banners, mid-crossing, in the default looks (&style= sets both looks to one).
  # Waits are real time, so a slower machine may need them nudged.
  "wipe-to-build|$WATCH&snapshot=combat&round=2|20000"
  "sweep|$WATCH&snapshot=build&round=2|24500"
  "wipe-to-combat|$WATCH&snapshot=build&round=2|30500"
  # The clock has run out; the border pulses, so it may be caught faint.
  "overtime|$GAME&snapshot=build&round=2|21500"
  "four-players|$BASE/?autostart=1&players=4&seed=3&snapshot=combat&round=3&style=pixel|3000"
  # The pixel style's weather is drawn from the seed: 1 rains, 2 snows, 3 is foggy, 21
  # overcast, 5 clear; its light and shadows follow the round, morning to sunset.
  "weather-rain|$BASE/?autostart=1&players=3&seed=1&snapshot=combat&round=3&style=pixel|3000"
  "weather-fog|$BASE/?autostart=1&players=3&seed=3&snapshot=combat&round=3&style=pixel|3000"
  "weather-snow|$BASE/?autostart=1&players=3&seed=2&snapshot=combat&round=3&style=pixel|3000"
  "morning|$BASE/?autostart=1&players=3&seed=5&snapshot=build&style=pixel|2000"
  "sunset|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=pixel|3000"
  # A shape per player off the board (X6): by player at eight, by team in teams of two.
  "shapes-eight|$BASE/?autostart=1&players=8&seed=3&snapshot=build&round=2&style=flat|3000"
  "shapes-teams|$BASE/?autostart=1&players=8&teams=2&seed=3&snapshot=build&round=2&style=pixel|3000"
  # Special towers (docs/SPECIAL_TOWERS.md): the emblems and the Architect's circle in a cannon
  # phase, a Bertha's in combat, the person's seat played by a bot on the way. The menu and the
  # cursor's marks need a click or a pointer, so they are seen by script, not here.
  "towers-cannons|$BASE/?autostart=1&players=2&seed=5&specials=1&tower=architect3&snapshot=cannon_place&round=3&style=flat|2500"
  "towers-combat|$BASE/?autostart=1&players=2&seed=5&specials=1&tower=bertha3&snapshot=combat&round=3&style=flat|4200"
  # Night's sea: the moon's path, lighthouses and their beams.
  "night-sea|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=3&style=night|3000"
)

mkdir -p "$OUT"
for scene in "${SCENES[@]}"; do
  IFS='|' read -r name url wait <<<"$scene"
  if [[ $# -gt 0 && ! " $* " =~ " $name " ]]; then continue; fi
  (cd /tmp && npx -y "playwright@${PLAYWRIGHT:-1.63.0}" screenshot --viewport-size "1400,900" \
    --wait-for-timeout "$wait" "$url" "$OUT/$name.png" >/dev/null 2>&1 &&
    echo "$OUT/$name.png") &
done
wait
