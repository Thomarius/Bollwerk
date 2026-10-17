# Cannon icons in every style — implementation plan

The cannon phase shows a row of icons beside the cursor, one a cannon still to place, the tower
chosen leading the row as its emblem (ARCHIVE 13zm). The cannon icon is one generic SVG for every
style (`cannonSvg` in `client/src/towerIcons.ts`). The user's wish (2026-10-16): **each style's own
cannon**, drawn small, so the icon is the gun the player is about to place. Planned here, not yet
built; PLAN §11 item 3.

**Built (2026-10-17): CI1–CI3**, every style, waiting for the review (CI4) and the testers. What
building it decided, beyond §1–§3:

- **A switch in config**, the user's: `art.cannonIcons`, `"style"` (the default) or `"generic"`,
  today's SVG cannon for every style — both kept until the testers' readings decide. Config only,
  no setting in the menus. The right button's hint switches back to the same cannon as the row.
- **Rendered once to an image, the row left in the page** (§2's open choice): `Scene.cannonIcon`
  draws the style's gun (`Theme.drawCannonIcon(root, size, player)`, into a `Container` rather
  than a `Graphics`, so Pixel's sprites and Cyberpunk's blurred glow fit), reads it back as a PNG
  at the screen's density and caches it by look, player and size; the row's `<img>` takes the
  generic icon's place and size (1.3rem). So the box, the "+N", the struck-through grey (a
  `grayscale` filter on the image) and the hint stay as they were. Pixi icons laid over the page
  would sit under its box. The read-back costs 5–65 ms the first time (headless Chrome on this
  machine's GPU), so the person's icon is made in the still pause before the cannon phase
  (`matchScreen`), not as the cursor arrives.
- **What "the gun alone" took**, style by style: Minimal its square and bore (it has no base, so
  the square is the gun); Blueprint its octagon, Glass its lancet, Halloween its pot, Sakura its
  carriage — each the gun's body, the barrel alone a bare stick; Chocolate the cane alone, its
  cupcake the base; Pixel and Night the carriage and barrel sprites, at 16 CSS pixels a tile so
  their pixels stay whole; Cyberpunk the hex mount, rails and lit coil with its glow blurred into
  the image; the figures (Cartoon, Christmas, Noir) facing right, without their shadows, Noir
  without its sandbags.
- **The board unchanged**, every refactor checked pixel for pixel: each style's preview board in a
  build and a combat phase, at two sizes (`?icons=boards`), against six runs of the old code, a
  pixel counted only if it changed in each of three runs of the new and lies outside the
  animation's noise. All nineteen identical.
- **The sheet for the review**: `?icons=sheet` (`&style=`, `&sizes=21,28,42`, `&players=8`) shows
  every style's icon for every player at three sizes, over its own board and over dark, the generic
  icon beside it.

**For the review (CI4)**, seen in the sheet at 21 px: Opera's horn is the same for every player
(its colour was the stand's disc, the base) and reads as a ball on a stick; Noir's gun is low and
its near-black barrel vanishes over dark, the shield and lamp carrying it; Christmas's players
differ only by scarf and hat band; Chocolate's cane and Parchment's long gun are thin; Night's
carriage is faint, as on its board.

---

## 1. What was decided

- **The style's own gun, the gun alone** (the user's, 2026-10-16): no base — not the square the
  gun stands on in most styles (`cannonBase`), nor the style's own plate, sandbags or stand.
  Cleaner at an icon's size.
- **Drawn, never copied from the board.** A snapshot of one of the player's guns was considered and
  rejected by the user: there is none to copy before the first cannon is placed, and it would
  change with the guns' state (inert, firing, a tower). The icon is drawn from fixed inputs and is
  the same every time for a style and a player.
- **A fixed pose**: active, never fired (no recoil, no muzzle flash), the barrel to the upper
  right, a style's figure in its "ready" mood, no time animation (bob, bubbles, foam, crackle).
- **The tower stays its emblem badge** (`drawEmblem`, `towerMarks.ts`), as now.
- **The right button's hint stays** as it is (`switchHintHtml`), its "switch to a cannon" symbol
  becoming the style's icon too where it is drawn in Pixi (§3, step 1).

---

## 2. The interface

A new method on the `Theme` interface (`render/theme.ts`), implemented by every style, so the
compiler refuses a style without one — including every style added later:

```ts
/** One ordinary cannon of this player, standing ready, the gun alone, centred on (cx, cy). */
drawCannonIcon(g: Graphics, cx: number, cy: number, size: number, player: number): void;
```

- It lives on an initialised theme, since it needs the style's art, constants (Sakura's `sumi`,
  Noir's `crossHatch`, Parchment's `paper`) and Pixel's textures. The `Scene`'s slot for the look in
  front owns it.
- Every style draws in board coordinates (`tileX`, `tileY`, `view.tile`, the cannon's `x`, `y`,
  `w`, `h`), so no geometry is rewritten: the method makes up a view
  (`{ tile: size / 2, originX: cx - size / 2, originY: cy - size / 2 }`), a cannon
  (`{ x: 0, y: 0, w: 2, h: 2, owner: player, active: true, kind: 'cannon', cost: 1, shotIds: [] }`)
  and an aim (`{ angle: UP_RIGHT, firedAgo: Infinity }` for `GunAims`), and calls the code the board
  calls.
- A shared helper for the made-up view, cannon and aim (`iconFrame(cx, cy, size, player)`, in
  `theme.ts`), so each style's method is only its drawing.

**Drawing it**: the row moves from the page's SVG into the Pixi overlay (`TowerMarks`, the layer
the tower emblems, Bertha's cross and the Architect's reach are in), drawn with the look in front.
Each icon drawn once per look, player colour and size into a `StampBook` context or a `Memos` entry
(see "Drawing a style cheaply" in CLAUDE.md), then only placed each frame; a look's swap redraws
them. The box behind the row and the hint may stay in the page, positioned as now
(`showPlaceIcons`), with the row's room left empty for the Pixi icons, or follow into Pixi —
decided in step 1 by what reads better.

---

## 3. The work, style by style

From a survey of every style's gun drawing (2026-10-16). Night is Pixel with another palette, so
eighteen implementations. Each draws the gun in two halves: its base in `drawStructures` and the
turning part (barrel, horn, figure) in `drawEffects`, aimed by `GunAims` — so "the gun alone" is
mostly the turning part, with whatever of the base belongs to the gun rather than the ground.

| Effort | Style         | Where the gun is drawn now                                                               | What the icon takes                                                         |
| ------ | ------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| easy   | Cartoon       | `drawCannonFigure(g, t, body, mood)`, a module function, by `StampBook`                  | call it, mood `'awake'`, facing right, no hop                               |
| easy   | Christmas     | `drawSnowmanFigure(g, t, scarf, light, mood)`                                            | call it, mood `'ready'`, facing right                                       |
| easy   | Noir          | `drawGun(g, t, colour, mood, crossHatch)`                                                | call it, mood `'ready'`; no searchlight                                     |
| easy   | Under the sea | `drawPuffer(…)`, exported from `reef.ts`                                                 | call it, its ready mood, no bob                                             |
| easy   | Electric      | `drawCoil(g, view, cx, cy, owner, active)`, in structures; it does not aim               | call it; the arcs and halo of the glow layer left out                       |
| easy   | Office        | `copierShape(k, t, owner, active)`, drawn at the origin and placed turned                | call it, turned to the fixed angle                                          |
| medium | Minimal       | inline in `drawStructures` (a square and its bore)                                       | the bore and a barrel as a method; no barrel today, so the icon's own shape |
| medium | Blueprint     | the octagon inline in structures; barrels a `Memos` closure in `drawBarrels`             | the barrel's closure as a method                                            |
| medium | Parchment     | carriage, wheels and barrel a `Memos` closure in `drawBarrels`                           | the closure as a method                                                     |
| medium | Toy bricks    | a `Memos` closure in `drawGuns`                                                          | the closure as a method                                                     |
| medium | Stained glass | lancet panes inline in structures; the barrel a closure in `drawBarrels`                 | the closure as a method                                                     |
| medium | Chocolate     | `drawBarrel(g, view, cannon, aim)`, a method, behind a memo                              | call it; the cupcake under it is the base, left out                         |
| medium | Halloween     | the cauldron's turning part a closure in `drawCauldrons`; bubbles on the clock           | the closure as a method, no bubbles                                         |
| medium | Sakura        | `drawCarriage` a method; the barrel a closure in `drawBarrels`                           | the barrel's closure as a method                                            |
| medium | Oktoberfest   | `drawKeg(k, view, r, owner, active)` by `StampBook`; the dray inline; foam on the clock  | call `drawKeg`, no foam                                                     |
| medium | Opera         | the horn a coil stamp plus an inline tube and bell in `drawHorns`                        | the tube and bell as a method, with the coil                                |
| hard   | Pixel, Night  | tinted sprites from the style's own textures (`KEY.carriage`, `KEY.barrel`, `KEY.balls`) | a small `Container` of sprites, the angle snapped to `rotationSteps`        |
| hard   | Cyberpunk     | `drawTurret` and `drawBarrels`, across layers; its glow is the bloom of its own layers   | the turret and barrels as one method; a faint wide stroke for the glow      |

Line numbers move; the names above are what to look for. The medium refactors move 30–80 lines a
style into a method both the board and the icon call, the board's drawing unchanged.

**The hard two.** Pixel's textures are generated at its start and kept in a private map: an
accessor for the icon, and its sandbags and ball pile — placed by the island's shape round a real
gun (`outward`) — left out, being the base. Cyberpunk's glow is a `BlurFilter` bloom on its own
layers, and an icon outside them loses it; a wider, fainter stroke under the lines stands in, or
the icon gets a small bloomed layer of its own if that reads poorly (measure its cost first, ARCHIVE
12r).

---

## 4. Work packages

In order, each ending with `npm run check` passing and the user's go-ahead to commit.

1. **CI1 — the interface and the easy six.** `drawCannonIcon` on `Theme`, `iconFrame`, the row in
   the Pixi overlay with the tower's emblem leading it, the struck-through "none" in Pixi too; the
   six easy styles; every other style answering with the generic icon (`cannonSvg`'s shape drawn in
   Pixi) until its package, so the interface is whole from the start.
2. **CI2 — the ten medium styles**, each refactor checked by screenshots of the board before and
   after, pixel for pixel, in a build phase and a combat phase (`tools/screenshots.sh`).
3. **CI3 — Pixel, Night and Cyberpunk.**
4. **CI4 — the review.** Screenshots of the row in all nineteen styles side by side, at the icon's
   size at four and at eight players (24–28 pixels); a style whose gun does not read that small
   gets a simpler drawing of its own in its `drawCannonIcon` (the busy ones are likeliest: Opera,
   Noir, Sakura). `&perf=1` at eight players, the icons placed rather than drawn each frame. The
   generic SVG cannon goes only if the testers choose the styles' guns, and the switch with it;
   `towerIcons.ts` keeps the emblems for the page's labels.

---

## 5. Risks

- **The board changing under a refactor**: moved code must draw the board exactly as before;
  before-and-after screenshots in CI2 and CI3 are the check, and the memos' keys must still name
  everything drawn.
- **Readability at icon size**: a 2×2 gun at a tenth of its board area loses its detail; CI4
  decides per style.
- **A style's figure facing**: figures that face their target (Cartoon, Christmas, Noir) face right
  in the icon; a style whose gun reads only from above (Blueprint, Minimal) shows its barrel to the
  upper right.

## 6. Later uses

The same method can draw a style's gun in the How to play page and the style gallery, where every
gun is a generic picture or the whole board today.
