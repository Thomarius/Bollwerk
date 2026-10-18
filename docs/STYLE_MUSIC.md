# Music for every style — plan

The users' idea (2026-10-18): each of the nineteen styles brings music of its own, supplied as MP3,
some 70 MB in all. Planned here, not yet built; PLAN §11 item 4. The original files are kept by the
user outside the repository before anything is converted.

---

## 1. Why the way audio loads has to change first

Today `client/src/audio.ts` (`loadAll`) fetches **every** file in the manifest as the page opens
and decodes each into an `AudioBuffer` — raw samples, about 21–23 MB a minute of stereo music:

- the nine music files now, some 13 minutes, already take about **300 MB of memory** decoded, on
  every page;
- 70 MB of MP3 is 50–75 minutes of music at 128–192 kbps: about **1.1–1.7 GB** decoded, and
  seconds of decoding after the page opens — too much for weaker machines and browser tabs;
- every page would download all 70 MB, though a match plays the music of one or two looks; a
  guest downloads from the host's machine, whose home upload (5–20 Mbit/s) makes that 30 seconds
  to 2 minutes a guest;
- the release files grow by about 70 MB each, and the repository (102 MB now) by the files' size
  for good — git cannot compress MP3, and every replaced track adds its whole size again. Git LFS
  is not an option: beyond a small free allowance it costs money (PLAN §12).

So the music must be **loaded when needed and never decoded whole**; the sound effects stay as they
are (2 MB, decoded once, played at once, which they need).

---

## 2. What is decided

- **One format for all music** (the user's): every track re-encoded once, from the user's originals,
  to one format and bitrate, its loudness evened out.
- **Loaded when needed**: a track is fetched only when a look that plays it is coming, and dropped
  when no look on screen or coming plays it any more.
- **Not decoded whole**: a track plays compressed through an `<audio>` element fed into the Web
  Audio graph (`MediaElementAudioSourceNode`), so the music volume bus, mute and crossfades work as
  now. It is fetched **whole** before it plays (into a `Blob`), not streamed, so a slow host never
  makes it stutter mid-track.
- **Random looks every round must not cause trouble** (the user's): a Random build look and a
  Random combat look, each a new style every round, is the case the design is measured against
  (§5).
- **Nothing reaches the simulation**: music is the page's alone, so none of this can desync.

---

## 3. Decisions before building

For the user, each with a suggestion:

1. **Which phases play a style's track.** Suggested: the **build look's** style during castle
   selection, cannon placement and building (today's `music_admin`), the **combat look's** during
   combat (`music_battle`); the menu, the lobby, victory and defeat keep the shared tracks. One
   style in both looks plays one track straight through the banners, without restarting.
2. **One track a style, or two** (a calm one and a battle one). One is half the files; two keep
   today's change of mood between building and combat.
3. **When a track changes.** Today the next phase's music starts as the intermission opens, leading
   into the announcement. A new look arrives only with its banner, near the intermission's end.
   Suggested: a change of style crossfades as the banner's line crosses the screen, so the music
   changes with the wipe.
4. **A style without a track** plays today's shared track, so styles can get music one at a time.
5. **Format and bitrate**: suggested **MP3, about 128 kbps stereo, 44.1 kHz**. Mac players use the
   browser, and only MP3 plays in every browser and in the desktop app; Ogg/Opus would be a third
   smaller but older Safari may not play it — today's two Ogg tracks (`music_battle`,
   `music_defeat`) may be silent there already, and are converted too. 96 kbps if the size still
   matters; each source file is measured first, since converting a file already at 128 kbps gains
   nothing.

---

## 4. How it works

### 4.1 The files

- `assets/audio/music/styles/<style>.mp3` (or `<style>.calm.mp3` and `<style>.battle.mp3`, §3.2),
  one per style that has one, the style's id as in `ArtStyleSchema`.
- Re-encoded once with `ffmpeg` from the user's originals: one bitrate, loudness normalised (EBU R128,
  `loudnorm`, one target for every track, the shared ones included), and encoded gapless (LAME's
  encoder delay written to the file), since an `<audio>` element otherwise shows MP3's padding as a
  short gap at every loop.
- Every file credited in `config/audio.manifest.json` (title, author, licence, source, changes —
  "re-encoded at 128 kbps, loudness normalised"), as every audio file must be; `npm run credits`.

### 4.2 The manifest

A style's music in `config/audio.manifest.json` under a key of its own (`styleMusic`, by style:
file, volume, loop), behind the strict schema; a style left out plays the shared track. The shared
music cues stay as they are.

### 4.3 The player (`client/src/audio.ts`)

- **Sound effects** as now: fetched and decoded as the page opens.
- **Music**, shared and styles' alike: a track is a `MusicTrack` — its file fetched whole into a
  `Blob` on request, played by an `<audio>` element from an object URL through a
  `MediaElementAudioSourceNode` into the music bus, looped by the element, faded by a `GainNode`
  as now.
- **A small cache**, by path: what is playing, what is fading out, and what has been asked for
  ahead. Anything else is dropped — its element stopped and detached, its object URL revoked — so
  at most about four tracks are held, each 2–4 MB compressed. With Random looks a cache of more
  would gain nothing: a cycle of styles plays every favourite once before any comes back
  (`LookRotation`).
- **Never waits**: a track asked to play before it has arrived keeps the old one playing and
  crossfades as soon as it is ready; one that fails to load (a missing file decodes as nothing, the
  static handler answering with `index.html`, CLAUDE.md) falls back to the shared track, quietly.
- **Autoplay** as now: in a browser the music waits for the first click; the desktop app's window
  always allows it.

### 4.4 Which track, and when (`client/src/styleMusic.ts`, pure)

Pure functions, tested without a browser, as `banners.ts` and `scores.ts` are:

- `trackFor(phase, pending, styles)` — the track for this moment from the phase and the two looks'
  styles (§3.1);
- `tracksAhead(state, styles, coming)` — the tracks to fetch now: the current looks', and the
  coming looks' once they are drawn.

### 4.5 Fetching ahead

- **Random looks**: the next round's looks are drawn just after the build phase's resolution
  (`prepareNextLooks` in `matchScreen.ts`), the combat look first. Their tracks are asked for then
  — before the cannon phase and the combat phase have run, over 35 seconds before a combat look's
  track is needed and longer for the build look's.
- **Chosen looks**: both tracks asked for as the match opens; nothing more is fetched in the match.
- **A style changed from the pause menu**: its track asked for at once and crossfaded in when ready.
- **The menu and the lobby**: only the menu's track; a match's tracks as it opens, during the
  opening's own preparation.

---

## 5. Random every round, measured

Random build and combat looks each draw a new style every round, so a 10-round match brings up to
twenty tracks. What makes that safe, and what is checked:

- **Two fetches a round at most**, both well ahead (§4.5); a host's upload of 5 Mbit/s carries a
  3 MB track in about 5 seconds a guest.
- **Bounded memory**: the cache never holds more than the playing, fading and coming tracks. A test
  plays the choosing logic through 30 rounds of Random looks and asserts the cache's size at every
  step; in the page, the memory of a 10-round Random/Random match at eight players is measured
  against today's (Chrome's task manager and `performance.memory`, before and after — today's
  ~300 MB of decoded music should drop to some 20 MB).
- **No waits and no gaps**: a 10-round Random/Random match is watched (`&watch=1`, GPU flags, real
  time, CLAUDE.md) with a temporary log of each track's request, arrival and start; every track
  must arrive before its banner. Then once over a throttled connection (Chrome's "Slow 4G" for a
  guest) to see the fallback keep the old track playing.
- **Frame times**: `&perf=1` at eight players across a few banners — starting an `<audio>` element
  and creating an object URL must not show as a hitch where decoding a whole buffer would have.

---

## 6. Risks

- **A late track**: covered by fetching ahead; the fallback keeps the old track.
- **Loop gaps**: MP3 padding; covered by gapless encoding, checked by ear on every track.
- **Memory creeping back** with many style changes: covered by the cache's drop rule and its test.
- **Repository size**: about +40–70 MB once, for good. Replace tracks rarely; convert from the
  originals, never from an already converted copy (each lossy pass loses a little).
- **Release files** about 40–70 MB larger; acceptable for a game download.

---

## 7. Work packages

In order, each ending with `npm run check` passing and the user's go-ahead to commit.

1. **SM1 — the decisions** of §3, with the user.
2. **SM2 — the player**: music through `<audio>` elements, fetched when asked, the cache and its
   drop rule, the fallback; today's shared tracks played so, the game sounding as before. Memory
   measured before and after (§5).
3. **SM3 — the files**: the originals measured, converted, normalised and credited; the manifest's
   `styleMusic`.
4. **SM4 — which track and when**: `styleMusic.ts` and its tests, the fetching ahead, the pause
   menu's change of style.
5. **SM5 — Random/Random measured** (§5), then play-tested by the users.
