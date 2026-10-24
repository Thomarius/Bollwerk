# A Mythology style — the design

The user's choice (2026-10-24) of two last styles from their shortlist — Wild West, Food, Beach,
Mythology, Nordic, Egypt, Supermarket, Microscopic — this one and the Wild West
([`WILDWEST_STYLE.md`](./WILDWEST_STYLE.md)). Pitched with options for every element and **decided
by the user the same day**; to be built next, on a sketch page first, then retired into the
ARCHIVE. It was the runner-up when Stadium was chosen (ARCHIVE 14d).

**The user's rule for both styles**: **one gun design, no people as guns**. Stadium and Anime
already vary their guns as figures, a sport or a clan to a gun, so the last two styles do not.

---

## 1. The idea: the board is a painted vase

**Ancient Greece as black-figure vase painting**: figures in black glaze on the orange of fired
clay, details scratched through the black so the clay shows in fine lines, touches of white and
purple-red, borders of meander and waves. The game drawn _as the painter would have drawn it_, a
frieze round a pot.

**Why it rounds out the set**: a technique no style has (two flat colours and incised lines; Sakura
is a woodblock print, Cartoon an ink reel, Noir cross-hatching); antiquity, which none of the
twenty-two has; a warm, dark palette of terracotta and black; and the myths for the big moments,
everyone's, with nothing from any film or game (no _God of War_, no _Hades_, no Olympic rings).

**Kept clear of**: Medieval (no knights, no castles; its guns are cannons, these are catapults
drawn in black figure), Electric (no Zeus hurling lightning about the board), Pirates (no sea
monster at the climax: its Kraken), Stadium (no athletes, no Olympic rings).

**Name**: **Mythos**, in both languages (`mythology` in `ArtStyleSchema`, `style.mythology`).

---

## 2. What carries meaning (decided)

| The game          | The vase                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------- |
| The sea           | **The wine-dark sea**: black glaze, waves scratched through it in the clay's colour      |
| Islands           | The clay's own orange, the shore a band of the running-wave scroll                       |
| Walls             | **The meander** (the Greek key) in the owner's colour, a unit a tile, joining across     |
| Castles           | **Temples**: a pediment on columns, an altar before the steps                            |
| Sealed            | **The altar fire lit**, white and purple-red; smoking out at a breach (`FlagHoist`)      |
| Sealed ground     | **A mosaic floor**: tesserae in the owner's colour and the clay's shades (`FillPattern`) |
| Guns              | **Onager catapults** in black figure (§3), a shield in the owner's colour on the frame   |
| Shots             | **Stones**, tumbling; the Berthas' **a pot of burning oil**                              |
| A hit             | **The glaze cracks**: potsherds flying in the wall owner's colour                        |
| A miss in the sea | A ring of scratched waves, white spray                                                   |
| Out               | The temple's columns toppled, the altar cold, the shields face down                      |

**The player colours** are the difficulty, as pastels were for Anime: the vase has two colours, and
an orange or red player on terracotta disappears. The answer is the painters' own, **added
colour**: the owner's colour is always laid on as painted slip inside a black outline, with a
black border where it meets the clay (the shield, the meander, the mosaic, the pediment). The clay
a little paler and yellower than real terracotta, so the red and orange players read as painted
colour, not ground. **Checked first on the sketch page, with all eight colours.**

---

## 3. The guns: the onager (decided)

One design for every gun: **a torsion catapult**, its frame and arm in black figure with the wood's
grain incised, a round **hoplite shield in the owner's colour hung on the frame**, a blazon on it
from the vases (owl, lion, horse, scorpion, by the gun's id — the blazon only, the gun the same).
Chosen over a single hero figure (clones of one man across an island, and figures again) and over
a ballista or spear-thrower: **the game's shots fly in an arc, and a catapult lobs**.

Its arm tells the state, flight time being the reload:

- **Ready**: the arm winched down, a stone in its sling.
- **Firing**: the arm swings up and strikes the padded crossbar (`GunAims`' `firedAgo`), the frame
  jolting.
- **Reloading**: while the shot is in the air the arm creaks back down, the winch turning, reaching
  the bottom as the shot lands (`isLoaded`, the gun's shot's `shotProgress`) — the reload shown as
  a motion, as Anime's aura grows.
- **Silenced**: the rope slack, the arm resting on the crossbar, no stone.
- **Lulled**: as silenced, under the shared Zs.
- **Out**: the frame broken, the shield face down.

**Aiming**: the whole engine turns to face its target, in steps, as a stamp turned (`GunAims`'
angle) — the user's open choice, recommended: it shows where each catapult aims. If a turned
frame reads badly at small tiles, it is mirrored only, as Stadium's figures are.

**Drawn as stamps**: the frame and the arm two stamps, the arm's angle a rotation, so the motion
costs a placing; the shield a stamp tinted the owner's colour, its blazon in black.

**Towers** keep their emblems (`towerMarks.ts`) on the same engine, scaled to their size.

---

## 4. The rest (decided)

- **The corner piece: Sisyphus**, in black figure, pushing his boulder up a hill in the sea's
  corner; at the top it rolls back down and he trudges after it. When the clock presses
  (`hurry`) he pushes faster and it rolls back sooner. The myth is the game's own: build it, lose
  it, build it again.
- **The climax: the gods watching** — Zeus, Hera, Athena and Poseidon in black figure leaning out
  of clouds at the screen's edges, nodding and pointing, as the gods watch the war in Homer;
  nothing over the board. Coming in with `climaxLevel`.
- **The sea's life**: triremes rowing across, oars sweeping; leaping dolphins as on the Minoan
  frescoes; now and then the Argo, its eye on the prow.
- **Scenery**: olive trees, cypresses, amphorae, broken columns, a herm.
- **The banner**: **a frieze**, black glaze between two meander borders, the call in terracotta
  capitals and the style's words under it (`BANNER_FLAVOUR`: "Into battle!" / „In die Schlacht!";
  the build phase "Rebuild the walls of Troy!" / „Baut die Mauern Trojas wieder auf!"; the final
  round "The last battle for Troy"). Classical capitals only, no faux-Greek letters (Σ for E),
  which spoil reading.
- **The HUD**: a band of black glaze, a running-wave border under it, terracotta lettering.
- **The title**: the letters in black figure on clay, highlights incised.
- **The finish**: laurel leaves falling and a votive banner on a spear — `FinishLook` gains
  `laurel`.
- **Sound words**: none; the cracking glaze is the hit's mark.

---

## 5. Building it

1. **A sketch page** (`?mythology=sketch`, removed once built, as Anime's): the onager in every
   state at tiles of 12 to 32 pixels, turned to eight directions; a meander wall and a mosaic in
   all eight player colours on the clay; a temple sealed and open; Sisyphus; the frieze banner.
   **The colours pass or fail here**; shown to the user before the theme is written.
2. **The registration**, as every style (Anime's commit 28df270 is the latest pattern):
   `ArtStyleSchema`, `STYLE_LOOKS`, `MythologyStyleSchema` and `art.mythology` with a palette,
   `createTheme`, `STYLE_NAMES`, `BANNER_CLASS`, `HUD_SKIN`, `BANNER_FLAVOUR`, a title in
   `titles.ts`, the CSS, both locales, `seaLife.ts`, `tools/screenshots.sh`.
3. **The theme** (`render/mythology.ts`, its drawings in `render/mythology/`), extending
   `ShapeTheme`, drawn cheaply from the start (CLAUDE.md, "Drawing a style cheaply"): terrain in
   `TerrainStrips`, walls and mosaic by island (`IslandParts`), engines, temples and shots as
   stamps, Sisyphus a `Memos`.
4. **Measured** with `&perf=1` at eight players against Stadium; the docs (ARCHIVE, PLAN §7,
   CLAUDE.md, README).
