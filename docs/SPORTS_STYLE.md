# A Sports style — the idea

The users' choice (2026-10-18) of the themes brainstormed — Sports, Superheroes, Comic books,
Anime / Kawaii, Mythology — for the next style: a stadium. An idea written down to build later,
after the styles' own music (PLAN §11 item 4); nothing here is built or settled beyond what the
user said. Mythology as Greek vase painting (black figures on terracotta, the meander as the
wall) was the runner-up; Superheroes and Comic books would make one pop-art comic style between
them; Anime / Kawaii overlaps Sakura, Chocolate and Cartoon and fights the player colours with its
pastels.

---

## 1. Why Sports

- **The game already speaks it**: a score, overtime as extra time, the final round as the final
  minutes, teams, and a tournament with a league and a knockout — every one maps straight on.
- **Unlike all nineteen styles** in look and setting.
- **The player colours are team jerseys**, which helps the readability the style pass put first.
- **No trademarks**: generic sport only — no real clubs, leagues, logos, nor the Olympic
  pictograms, which are designs of their own; the figures are ours.

---

## 2. The guns: sportsmen with their balls (the user's idea)

The centre of the style. Every gun is a **stick figure of a ball sport**, pictogram-like, with its
ball:

- **Ready**: the figure holding its ball, in a ready pose, facing its target.
- **Firing**: a short pose of the throw, the kick, the serve or the swing (`GunAims`' `firedAgo`),
  and the sport's own ball launched as the shot.
- **Reloading**: the figure without its ball until the shot lands. Flight time _is_ the reload,
  so the ball flying across the map is exactly the missing one, and the figure has it back as it
  lands — the game's own rule drawn, no rule added (`isLoaded`, the gun's shots in the air).
- **Inert**: still read as inert, as in every style — the figure sat down or greyed.
- **The sport chosen at random per gun** from the pool — but never by `Math.random`: by the
  cannon's id and the match's seed, which every client shares, so everyone sees the same sport
  on the same gun. Purely visual; nothing reaches the simulation.

### 2.1 The pool, about ten

Each a pose and its equipment and ball:

| Sport             | The shot               | Its ball                   |
| ----------------- | ---------------------- | -------------------------- |
| Soccer            | a kick                 | black and white            |
| Basketball        | a jump shot            | orange, its seams          |
| Handball          | a throw                | small, panelled            |
| Volleyball        | an overhead serve      | white, curved panels       |
| Tennis            | a serve with a racket  | yellow                     |
| Baseball          | a pitch                | white, red stitches        |
| American football | a pass                 | brown oval, white laces    |
| Rugby             | a drop kick            | white oval                 |
| Golf              | a swing with a club    | small, white               |
| Cricket           | a bowl                 | red, its seam              |
| Water polo        | a throw from the water | yellow — the sea all round |

Left out: bowling (rolls its ball), table tennis (a ball too small to read).

### 2.2 How it stays cheap

- **One skeleton** for every sport — a head circle and thick strokes for the limbs — and each
  sport a small table of joint angles for its three poses (ready, the moment of the shot,
  empty-handed), plus its equipment and ball: data, not ten drawings.
- **Every pose drawn once per tile size and then only placed**, mirrored to face its target
  (`StampBook`, "Drawing a style cheaply" in CLAUDE.md), so eight players' dozens of guns cost what
  any style's guns cost now. Cartoon, Christmas and Noir already draw figures that face their
  target and change mood as they fire; this follows them.
- **Shots**: each sport's ball, spinning in flight; at the impact, a bounce.

### 2.3 To watch

- **Readability at a small tile**: a gun is 2×2 tiles, about 24–32 pixels at eight players. The
  figure in the owner's colour (the jersey), so whose gun it is stays clear; the balls in their
  own colours, so the sport is.
- **Towers** keep their emblem badge. The Rapid Cannon perhaps a figure with a stack of balls, one
  a barrel; the Allerdickste Bertha a giant ball.
- **The cannon icon** beside the cursor (`drawCannonIcon`): a figure with its ball, ready — or the
  sports the next guns will be, the sport following from the id the new gun will get.

---

## 3. The rest of the stadium (first thoughts)

- **Islands**: pitches — striped turf, chalk lines.
- **The sea**: the stands, a crowd in each player's colour, a wave going round when its side seals
  a castle.
- **Walls**: padded pitch-side barriers or advertising boards; **castles**: the goals, or a trophy
  cabinet; **sealed ground**: freshly mown stripes.
- **Corner piece**: the scoreboard with its clock, hurrying in the last seconds.
- **HUD**: an LED scoreboard; **banners**: "Kick-off!", "Half-time!"; the final round "The final
  minutes".
- **Climax** (overtime, the final round): confetti, the crowd on its feet, floodlights.
- **Music**: a candidate for a track of its own (Package B of `STYLE_MUSIC.md`) — a stadium anthem
  or organ.

---

## 4. Before building

To be designed with the user and agreed first, as every style is: the look of the pitches, stands
and walls; the pool's final list; the figures' poses; and a first sketch of one gun in its four
states at the board's sizes, to judge the readability before the rest is drawn.
