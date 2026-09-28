#!/usr/bin/env bash
# Screenshots of the client in fixed states, for checking layout by eye.
#
# Headless Chrome cannot verify anything that depends on the clock (CLAUDE.md), but it
# renders in real time well enough to be *looked at*: ?autostart with &snapshot jumps to a
# phase, &round=N to a phase deep in a match, and waiting lets the clock carry a state
# into the moment worth seeing — an announcement is on screen for four seconds, about
# twenty after a build phase opens.
#
#   npm run dev -w @rampart/client            # in another terminal, or BASE=...
#   tools/screenshots.sh [outdir] [scene...]  # all scenes by default
#
# Uses the latest Playwright through npx, whose browser matches the one cached here.
set -euo pipefail

OUT=${1:-/tmp/shots}
shift || true
BASE=${BASE:-http://localhost:5173}
GAME="$BASE/?autostart=1&players=3&seed=7"
# Bots in every seat, so the cannon phase ends early and the banners come on time.
WATCH="$GAME&watch=1&bots=gunner"

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
  "eight-night|$BASE/?autostart=1&players=8&seed=3&snapshot=combat&round=3&style=night|3000"
  "standings|$GAME&snapshot=build&round=2&style=flat|25500"
  "final-round|$GAME&snapshot=cannon_place&round=9&style=flat|27500"
  "game-over|$GAME&snapshot=game_over&style=flat|2000"
  "game-over-watched|$GAME&snapshot=game_over&watch=1&style=pixel|2000"
  "combat-close|$BASE/?autostart=1&players=2&seed=5&snapshot=combat&round=3&style=pixel|4200"
  "gains|$GAME&snapshot=build&round=3&style=pixel|21800"
  "life-lost|$GAME&snapshot=build&round=2&style=pixel|21600"
  "knocked-out|$GAME&snapshot=combat&round=5&idle=1&style=pixel|2500"
  # The banners, mid-crossing, in the default looks (&style= sets both looks to one).
  # Waits are real time, so a slower machine may need them nudged.
  "wipe-to-build|$WATCH&snapshot=combat&round=2|20000"
  "sweep|$WATCH&snapshot=build&round=2|24500"
  "wipe-to-combat|$WATCH&snapshot=build&round=2|30500"
  # The clock has run out; the border pulses, so it may be caught faint.
  "overtime|$GAME&snapshot=build&round=2|21500"
  "four-players|$BASE/?autostart=1&players=4&seed=3&snapshot=combat&round=3&style=pixel|3000"
  # The pixel style's weather is drawn from the seed: 1 rains, 2 is foggy, 7 overcast, 5
  # clear; and its light follows the round, morning at the first to sunset at the last.
  "weather-rain|$BASE/?autostart=1&players=3&seed=1&snapshot=combat&round=3&style=pixel|3000"
  "weather-fog|$BASE/?autostart=1&players=3&seed=2&snapshot=combat&round=3&style=pixel|3000"
  "morning|$BASE/?autostart=1&players=3&seed=5&snapshot=build&style=pixel|2000"
  "sunset|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=10&style=pixel|3000"
  # Night's sea: the moon's path, lighthouses and their beams.
  "night-sea|$BASE/?autostart=1&players=3&seed=5&snapshot=combat&round=3&style=night|3000"
)

mkdir -p "$OUT"
for scene in "${SCENES[@]}"; do
  IFS='|' read -r name url wait <<<"$scene"
  if [[ $# -gt 0 && ! " $* " =~ " $name " ]]; then continue; fi
  (cd /tmp && npx -y playwright@latest screenshot --viewport-size "1400,900" \
    --wait-for-timeout "$wait" "$url" "$OUT/$name.png" >/dev/null 2>&1 &&
    echo "$OUT/$name.png") &
done
wait
