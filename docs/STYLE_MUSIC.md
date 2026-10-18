# Audio loaded once, and music for the styles — plan

Two packages, in order (PLAN §11 item 4). **A** changes how the game's audio is loaded and played,
for the files it has today. **B** builds on it: some styles bring a track of their own, played at
times in place of the shared music. The user keeps every original music file outside the
repository.

**Package A is built** (2026-10-18, ARCHIVE 14b); what was measured is there, and §2 below stays as
the framework B builds on. **Package B is open.**

---

## 1. Why the loading has to change

Today `client/src/audio.ts` (`loadAll`) fetches every file in the manifest as the page opens and
decodes each into an `AudioBuffer` — raw samples, about 21–23 MB a minute of stereo music. The nine
music files, some 13 minutes, already take about **300 MB of memory** decoded on every page; the
styles' tracks on top would take a gigabyte or more. And the server sends no caching headers
(`server.ts` writes only the content type), so a page served by a host downloads every file again
at every load.

Downloading every file at the start is not the problem; decoding every file is. So (the user's
choice, 2026-10-18, over fetching tracks as looks need them): **every audio file is downloaded
once, at the first load, behind a loading screen, and kept compressed; music is played compressed,
never decoded whole; the browser keeps the files between visits.**

---

## 2. Package A — audio loaded once

### 2.1 The music files, at a lower bitrate

The user's: the music's bitrate comes down whatever else is chosen.

- Every music file re-encoded once with `ffmpeg`, from the user's originals, to **MP3, 96 kbps
  stereo, 44.1 kHz**. MP3 because Mac players use the browser, and only MP3 plays in every browser
  and in the desktop app; today's two Ogg tracks (`music_battle.ogg`, `.2.ogg`, `music_defeat.ogg`)
  are converted too, and older Safari may not play them now.
- Each original's bitrate measured first: one already at or below 96 kbps is kept as it is (a
  lossy file converted again only loses).
- Loudness evened out across the tracks (EBU R128, `loudnorm`, one target), and encoded gapless (the
  encoder's delay written to the file), since an `<audio>` element otherwise shows MP3's padding as
  a short gap at every loop.
- Each changed file's credit in `config/audio.manifest.json` gains its change ("re-encoded at 96
  kbps, loudness normalised"); `npm run credits`.
- The sound effects stay as they are: 2 MB, short, needing to start at once.

### 2.2 The server keeps them cached

The static handler (`server/src/server.ts`) sends, for every file it serves, an `ETag` (from the
file's size and modification time) and `Cache-Control: no-cache`, and answers a request whose
`If-None-Match` matches with **304 Not Modified** and no body. So the browser keeps every file, asks
the host once per load whether it changed, and downloads only what did — a new release's changed
files, never a stale one. The desktop app's window (Electron) caches the same way.

### 2.3 The loading screen

Before the first menu, a screen in the menu's look with a bar: **every sound and music file**
fetched (the user's: everything before the menu, the simplest and certain), counted in bytes as
they arrive. Then the menu opens, its music ready.

- From the player's own disk (the desktop app, a server on their machine) it is a second or two;
  from a host the first time, as long as the host's upload takes — about 40 seconds for 45 MB at 10
  Mbit/s, several guests at once sharing it — and moments ever after (§2.2).
- A file that fails or is absent (the static handler answers a missing path with `index.html` and a
  200, so a file that does not decode is absent, CLAUDE.md) counts as done and stays silent, as
  `missingFilesAreSilent` says now: the loading never stops on it.
- Fetching needs no click; only playing does, as the browser's autoplay rules have it — the menu's
  music then starts at the first click, as now, and at once in the desktop app.
- The dev pages (`?autostart`, `&snapshot=`) load the same way, quickly from the dev server; the
  icon sheets (`?icons=`), which play nothing, open without it.
- The bar counts bytes: a file's length from its response (the server sends it), one not yet begun
  guessed by its kind's known average or typical size (`loadProgress`), the music asked for first
  so the long files' lengths are known early — weighed by file, fifty small sounds took the bar to
  two thirds in a second and left the music to crawl.

### 2.4 Playing

- **Sound effects** as now: decoded once into `AudioBuffer`s, played by buffer sources.
- **Music**: every track held as its compressed bytes (a `Blob`); the one playing — and the one
  fading out — played by an `<audio>` element from an object URL through a
  `MediaElementAudioSourceNode` into the music bus, so the music volume, mute and crossfades work as
  now. Looped by the element. A track not playing holds only its bytes: about 0.7 MB a minute at 96
  kbps, so all of today's music in some 10 MB and the styles' tracks with it in some 40–55 MB,
  against 300 MB decoded for today's alone.

### 2.5 Checked

- Memory of a page in a 10-round match at eight players, before and after (Chrome's task manager,
  `performance.memory`): today's ~300 MB of decoded music should drop to some 10 MB.
- The loading screen against the dev server, the built server and a throttled connection (Chrome's
  "Slow 4G"); a second load answered by 304s.
- Every track's loop heard once for a gap; crossfades and the volume sliders as before;
  `&perf=1` across the phase changes for a hitch where a track starts.

---

## 3. Package B — the styles' own tracks

### 3.1 The user's rules (2026-10-18)

- **Some styles get a track of their own**, one each, for building and combat alike. Not all:
  generic or medieval styles (Medieval, Night) are the shared music's own and keep it.
- **A chance, rolled at every start of a look**: whenever a build phase or a combat phase begins in
  a style that has a track — the build look's span opening with the build phase (it runs on through
  the cannon placement, the same look), the combat look's with combat — the style's track plays in
  place of the shared one with a chance of **`styleTrackChance`, 50% to start**. Rolled even when the
  style has not changed: a style chosen for both looks rolls at every build phase and every combat.
- **A pause per style**: once a style's track has played, that style's track may not play again for
  **`styleTrackPauseRounds`, 3 rounds to start**; until then the style plays the shared music. Other
  styles' tracks are not held back. One consequence, as intended: a style whose track won as
  building began, and which is also the combat look, rolls again at combat but finds its pause
  running, and combat plays the shared battle music.
- Both values in `config/audio.manifest.json`, behind its strict schema — set in the file, not in
  any menu (the user's).

### 3.2 Details to the rules

- **What it replaces**: `music_admin` over the build look's span (castle selection, building, cannon
  placement), `music_battle` over combat. The menu, the lobby, victory and defeat keep theirs.
- **A round** is the match's round; the pauses start afresh with every match.
- **The roll** is the page's own (`Math.random`), never the match's: music is no part of the
  simulation, so two players at one table may hear different music, as they may see different looks.
- **A style changed from the pause menu** mid-phase rolls as its look would have; one changed to
  while its pause runs plays the shared music.
- **The opening**: the first build-look span (castle selection, then the cannon placement) rolls as
  any other.

### 3.3 Built

- **Files**: `assets/audio/music/styles/<style>.mp3`, by the style's id in `ArtStyleSchema`, at the
  bitrate and loudness of §2.1, each credited.
- **Manifest**: `styleMusic`, by style (file, volume), `styleTrackChance` and
  `styleTrackPauseRounds`; a style left out has no track.
- **Loaded** with everything else by the loading screen (§2.3) — the users' 40–55 MB in all at 96
  kbps.
- **Chosen** by a pure function in `client/src/styleMusic.ts`, tested without a browser as
  `banners.ts` and `scores.ts` are: given the look starting, its style, the round, the pauses and a
  roll, which track plays and how the pauses stand after. Tests: the chance's both outcomes, a
  style's pause holding for its rounds and lifting after, another style unaffected, the same style
  in both looks (the case in §3.1), Random looks over 30 rounds.
- **Wired** in `matchAudio.ts`, where the phases' music is chosen today (`trackFor`): the style of
  each look from the scene, the roll at a build phase's and a combat phase's start.

---

## 4. Risks

- **A first load from a slow host**: up to a minute or two once per release, behind the loading
  screen; later loads take moments (§2.2). The lower bitrate is what keeps it short.
- **Loop gaps**: MP3 padding; gapless encoding, every loop heard once.
- **Repository and release files**: about +40–55 MB for good with the styles' tracks. Replace
  tracks rarely, and always convert from the originals, never from a converted copy.
- **Autoplay**: unchanged — music after the first click in a browser.

---

## 5. Work packages

In order, each ending with `npm run check` passing and the user's go-ahead to commit.

1. **A1 — the files**: today's music measured, converted to 96 kbps MP3, normalised, credited.
2. **A2 — caching**: the server's `ETag`, `Cache-Control: no-cache` and 304s; a test of the handler.
3. **A3 — the player**: music held compressed and played through `<audio>` elements, sound effects
   as now; the game sounding as before; memory measured (§2.5).
4. **A4 — the loading screen**, before the first menu, in English and German.
5. **B1 — the styles' tracks**: the files from the user, converted and credited; the manifest's
   `styleMusic`, `styleTrackChance` and `styleTrackPauseRounds`.
6. **B2 — the choosing**: `styleMusic.ts` and its tests, wired into `matchAudio.ts`; play-tested by
   the users.
