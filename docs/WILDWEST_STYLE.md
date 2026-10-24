# A Wild West style — the design

The user's choice (2026-10-24) of two last styles from their shortlist, this one and Mythology
([`MYTHOLOGY_STYLE.md`](./MYTHOLOGY_STYLE.md)). Pitched with options for every element and
**decided by the user the same day**; to be built after Mythology or before it, on a sketch page
first, then retired into the ARCHIVE.

**The user's rule for both styles**: **one gun design, no people as guns** — Stadium and Anime
already vary their guns as figures.

---

## 1. The idea: a showdown at high noon among the mesas

**The American frontier as the westerns showed it**: red rock, ochre dust, a hard blue sky, heat
shimmer, frontier towns of planks and adobe. A warm, sunlit look with the humour Pirates and
Oktoberfest have — at the genre's clichés, never at a player.

**Why it rounds out the set**: the one hot, dry palette (ochre, rust, sage and sky blue, where every
other style's islands stand in water); **no sea at all** — the board as mesas over a canyon floor,
which no style does, the picture changed and not the rules; and a game that already speaks it —
mending the fences, staking a claim, outlaws, high noon.

**Kept clear of**: Pirates (no log stockade, no wooden deck for a HUD, no cannon with something
perched on it: its parrot), Stadium and Anime (no figures), Parchment (the wanted poster a printed
playbill, not a chart).

**Nothing of the darker history**: no "cowboys and Indians", no caricature of the Native peoples,
no lynching or slavery, no real guns' makers. The cast, all implied rather than drawn, is
settlers, sheriffs, outlaws, prospectors, cattle and the railway; the firearms cartoonish, as
Pirates' are.

**Name**: **Wild West** / **Wilder Westen** (`wildwest` in `ArtStyleSchema`, `style.wildwest`).

---

## 2. What carries meaning (decided)

| The game      | The frontier                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The sea       | **A canyon floor far below**: pale dust, a dry riverbed's braids, the cliffs' shadow                                                        |
| Islands       | **Mesas**: flat tops of dusty ochre, sage brush, edged by cliffs of banded red rock                                                         |
| Walls         | **Adobe brick** whitewashed in the owner's colour, the brick showing where it chips                                                         |
| Castles       | **Frontier buildings** — a saloon, a sheriff's office, a bank, a general store, by id                                                       |
| Sealed        | **A windpump turning** beside the building, vanes in the owner's colour, its trough filling; at a breach it stops and its tail swings loose |
| Sealed ground | **A staked claim**: furrows within pegs and a ribbon in the owner's colour, gold glinting                                                   |
| Guns          | **Mortar barrels** (§3), their hoops in the owner's colour                                                                                  |
| Shots         | **Dynamite**, a stick turning in the air, its fuse fizzing                                                                                  |
| A hit         | A dust cloud, adobe chips in the owner's colour, now and then "KA-BLAM!"                                                                    |
| A miss below  | A puff of dust on the canyon floor                                                                                                          |
| Out           | The building boarded up, the windpump's vanes broken, the claim's ribbon torn                                                               |

**The canyon floor must read at once as no ground to build on**: the mesas' cliffs in banded rock
and the hard shadow they throw on the floor carry it, and are **checked first** on the sketch page.
Shots arc over it as over water.

**The player colours**: the mesa's top a pale, dusty ochre, so the yellow and orange players read;
the owner's colour always edged in dark, as Mythology's.

---

## 3. The guns: mortar barrels (decided)

One design for every gun: **a barrel with a stubby mortar poking out of its top**, its iron hoops
and a stencilled star painted in the owner's colour. No one is seen — whoever works it is inside.
Chosen over field cannons wearing hats (Pirates' parrot again: a thing on a cannon thrown up by
the shot and back as it loads) and over cacti (the desert's own scenery, so a gun could not be told
from a plant, and spines do not lob dynamite). **A mortar lobs**, as the game's shots fly.

Flight time being the reload:

- **Ready**: the mortar out of the top, aimed, a stick of dynamite's fuse just showing.
- **Firing**: the barrel jolts and hops, a puff of smoke from the muzzle (`firedAgo`).
- **Reloading**: the mortar pulled back in, the barrel rocking and clanking from inside, until
  the shot lands (`isLoaded`); it pokes out again as the gun is loaded.
- **Silenced**: the lid nailed shut, two planks across it in an X.
- **Lulled**: the lid shut, under the shared Zs.
- **Out**: the barrel staved in, its hoops grey.

**Aiming**: the barrel stands upright; the mortar tilts towards the target, mirrored to face it.

**Drawn as stamps**: the barrel, the mortar and the lid stamps of their own, the hop and rock a
placing; the hoops a stamp tinted the owner's colour.

**Towers** keep their emblems on a bigger barrel. In this style's scenery there are no loose
barrels, so a gun is never mistaken for one — troughs, crates and wagon wheels instead.

---

## 4. The rest (decided)

- **Tumbleweeds** (the user's): rolling across the mesas' open ground as scenery that moves, and
  across the canyon floor with the wind; bouncing, never over walls, sealed ground or guns.
- **The corner piece: a steam locomotive at a water tower**, puffing, its bell; when the clock
  presses (`hurry`) it whistles, steam shooting up, its wheels starting to turn.
- **The climax: high noon** — the sun at its height, the screen's top and bottom closing in to
  widescreen bars as in a western's showdown, heat shimmer at the edges, a big tumbleweed rolling
  across the canyon floor. Faint and outside the board, coming in with `climaxLevel`.
- **The canyon floor's life**: tumbleweeds, a stagecoach crossing, vultures circling, dust devils;
  now and then a train on a track along a far edge.
- **Scenery**: saguaro cacti, a cow's skull, a water trough, a wagon wheel, crates, a hitching post,
  tumbleweeds — no barrels (§3).
- **The banner**: **a wanted poster or playbill** pinned to boards, wood-type slab capitals, nail
  holes and a torn corner; the style's words under the call (`BANNER_FLAVOUR`: "Draw!" /
  „Zieht!" in combat, "Mend the fences!" / „Flickt die Zäune!" in the build phase, "Stake your
  claim!" / „Steckt euren Claim ab!" choosing a castle, "The last showdown" / „Der letzte
  Showdown" in the final round).
- **The HUD**: a weathered sheet of the same paper, a sheriff's-star accent; the big timer a pocket
  watch's figures.
- **The title**: wood type in two colours slightly misregistered, as old posters were.
- **The finish**: gold nuggets and sheriff's stars, and a pennant on a lasso — `FinishLook` gains
  `nuggets`.

---

## 5. Building it

1. **A sketch page** (`?wildwest=sketch`, removed once built): a mesa's cliff against the canyon
   floor at tiles of 12 to 32 pixels; an adobe wall and a staked claim in all eight player
   colours; the mortar barrel in every state; a windpump turning and stopped; tumbleweeds; the
   wanted-poster banner. **The canyon floor's reading passes or fails here**; shown to the user
   before the theme is written.
2. **The registration**, as every style (Anime's commit 28df270 the latest pattern):
   `ArtStyleSchema`, `STYLE_LOOKS`, `WildWestStyleSchema` and `art.wildwest` with a palette,
   `createTheme`, `STYLE_NAMES`, `BANNER_CLASS`, `HUD_SKIN`, `BANNER_FLAVOUR`, a title, the CSS,
   both locales, `seaLife.ts`, `tools/screenshots.sh`.
3. **The theme** (`render/wildwest.ts`, its drawings in `render/wildwest/`), extending `ShapeTheme`
   and drawn cheaply from the start: the canyon and mesas in `TerrainStrips` (the cliffs' bands and
   shadows a pass each), walls and claims by island, barrels, buildings, windpumps, shots and
   tumbleweeds as stamps, the locomotive a `Memos`.
4. **Measured** with `&perf=1` at eight players against Stadium; the docs (ARCHIVE, PLAN §7,
   CLAUDE.md, README).
