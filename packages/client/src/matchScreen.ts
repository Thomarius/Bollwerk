import { artForStyle, defaultConfigBundle, type ArtStyle } from '@bollwerk/config';
import { computeEnclosure, owesCastleChoice, type MatchEvent, type Phase } from '@bollwerk/sim';

import { countdownBeat, showsClock } from './clock.js';
import { Controls, inputMode, readyCannons } from './controls.js';
import { bannersFor, type LifeLost, type PointsGained } from './banners.js';
import { matchPalette, playerCssColour, useMatchPalette } from './colours.js';
import { matchShapes, playerShape, useMatchShapes } from './shapes.js';
import { NetworkBadge } from './network.js';
import { WatchingStrip } from './watching.js';
import { LookRotation, openLookGallery } from './looks.js';
import { t } from './i18n.js';
import { Hud, type IslandBanner } from './hud.js';
import { MatchAudio } from './matchAudio.js';
import {
  announcementLines,
  announcementTitle,
  isTeamMatch,
  ranking,
  teamLetter,
} from './scores.js';
import { buildHints, type BuildHints } from './hints.js';
import { timerSpot } from './timerSpot.js';
import { MatchLog, revealLines } from './summary.js';
import { motionReduced, storedEffects } from './motion.js';
import { PauseControls } from './pause.js';
import { openingShot, winnerShot } from './camera.js';
import { perf } from './perf.js';
import {
  floodFrom,
  floodOver,
  sealGlow,
  drainWash,
  drainsFrom,
  releaseDrains,
  territoryDuring,
  type Flood,
  type SealGlow,
} from './seal.js';
import {
  bannerProgress,
  boardWithStanding,
  crumbleOutward,
  looksAround,
  lostWalls,
  holdsCombatEnclosure,
  stillStanding,
  type Look,
  type Ruin,
  type SweptWall,
} from './transition.js';
import { Scene, createTheme, type Ghost, type SceneLook } from './render/scene.js';
import { type Choice } from './render/theme.js';
import { app, audio, showSoundButton } from './app.js';
import { saveStyles } from './prefs.js';
import type { Session, Setup } from './session.js';
import { showMenu } from './menu.js';

/** A match on screen: the board, the HUD, the sound and the controls, frame by frame. */

/** Height of the HUD's top bar — the phase, timer and roster — kept clear of the board. */
const HUD_BAR_PX = 64;

/**
 * Resolves once what is on the page has been painted: a frame for the layout, and the one
 * after it, by which the browser has drawn it — so work that holds the page afterwards
 * holds it with this on screen, not the screen before.
 */
function shownOnScreen(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

/** Plays a session; resolves with what takes it down, once it is running. */
export async function runSession(session: Session, setup: Setup): Promise<() => void> {
  // Over the board until its first frame (PLAN 11.18 Y1): building both looks' sprites
  // takes about a second as a match opens, and more with every look added, which read as
  // the page freezing. Painted before that work starts, so it is on screen through it.
  app!.innerHTML =
    `<canvas id="stage"></canvas><div id="hud"></div><div id="banner"></div>` +
    `<div id="preparing" class="preparing"><p>${t('menu.preparing')}</p><span class="blocks"><i></i><i></i><i></i></span></div>`;
  const canvas = document.querySelector<HTMLCanvasElement>('#stage');
  const hudRoot = document.querySelector<HTMLElement>('#hud');
  const bannerRoot = document.querySelector<HTMLElement>('#banner');
  const preparing = document.querySelector<HTMLElement>('#preparing');
  if (!canvas || !hudRoot || !bannerRoot) throw new Error('missing stage');
  await shownOnScreen();

  const scene = new Scene();
  if (perf.enabled) Object.assign(globalThis, { bollwerkScene: scene });
  // Colours for this match: families by team in a team match, distinct otherwise. The
  // HUD takes the shared ramps, and each look its own style's restyling of them.
  const art = defaultConfigBundle.art;
  useMatchPalette(matchPalette(art, session.state));
  useMatchShapes(matchShapes(art, session.state));
  // The looks as chosen, a new style at every banner for one that is random (PLAN 11.23);
  // the pause menu may change them.
  let lookChoices = setup.styles;
  let rotation = new LookRotation(lookChoices);
  const lookFor = (style: ArtStyle): SceneLook => {
    const own = artForStyle(art, style);
    return {
      theme: createTheme(style, setup.seed),
      art: { ...own, players: matchPalette(own, session.state) },
    };
  };
  // One theme when both looks are the same style, so the wipe has nothing to change.
  const looksFor = (chosen: Record<Look, ArtStyle>): Record<Look, SceneLook> => {
    const build = lookFor(chosen.build);
    return { build, combat: chosen.combat === chosen.build ? build : lookFor(chosen.combat) };
  };
  const opening = rotation.opening();
  await scene.init(canvas, looksFor(opening), art);
  // The build look the first "Rebuild" brings, made now behind "Preparing the board", since
  // the first round has no resolution before it to make it in.
  if (rotation.isRandom('build')) {
    await scene.prepare('build', lookFor(rotation.next('build', opening.combat)), false);
  }
  /**
   * The next round's random looks, made a step a frame after a resolution, where nothing is
   * playable and no shot flies (PLAN 11.23): the combat look "Fire!" will bring, then the
   * build look the "Rebuild" after it will. Each goes on screen once its old one is out
   * of sight (`Scene.prepare`).
   */
  const prepareNextLooks = async (): Promise<void> => {
    if (session.state.phase === 'game_over') return;
    const turn = rotation;
    let combat = scene.styles.combat;
    if (turn.isRandom('combat')) {
      combat = turn.next('combat', scene.styles.build);
      await scene.prepare('combat', lookFor(combat));
    }
    if (turn.isRandom('build') && turn === rotation) {
      await scene.prepare('build', lookFor(turn.next('build', combat)));
    }
  };

  const hud = new Hud(hudRoot, bannerRoot);
  // What the end of the match summarises, kept from the events as they come.
  const matchLog = new MatchLog();
  hud.useLog(matchLog);
  hud.useReveal(revealLines(session.state, session.setups));
  const matchAudio = new MatchAudio(audio, session.humanPlayer);

  /**
   * Middle of each player's island, for the banners that sit over them.
   *
   * The island, not the territory: by the time a "life lost" banner shows, the wipe has
   * already taken the territory away, so there would be nothing to anchor to. Islands
   * never move, so this is measured once.
   */
  const islandCentre = new Map<number, { x: number; y: number }>();
  {
    const sums = new Map<number, { x: number; y: number; n: number }>();
    const board = session.state;
    for (let i = 0; i < board.islandId.length; i++) {
      const island = board.islandId[i] as number;
      if (island === 0) continue;
      const x = i % board.width;
      const entry = sums.get(island) ?? { x: 0, y: 0, n: 0 };
      entry.x += x;
      entry.y += (i - x) / board.width;
      entry.n++;
      sums.set(island, entry);
    }
    for (const player of board.players) {
      const sum = sums.get(player.islandId);
      if (sum !== undefined) islandCentre.set(player.id, { x: sum.x / sum.n, y: sum.y / sum.n });
    }
  }

  /** Lives lost, and the tick each announcement stops being news. */
  const livesLost = new Map<number, LifeLost>();
  const gained = new Map<number, PointsGained>();
  /** What the board points out to a player building; see `hints.ts`. */
  let hints: BuildHints = { unsealed: [] };

  // A top corner of each island, for its team's name; terrain never changes. Not the top
  // middle, where the big timer sits on the islands in the middle column, and of the two
  // corners the one farther from the timer: the larger tags met it at the map's centre.
  const islandTops = new Map<number, { x: number; y: number }>();
  const timerAt = timerSpot(session.state);
  if (isTeamMatch(session.state)) {
    const { width, islandId } = session.state;
    for (const player of session.state.players) {
      let top = Number.POSITIVE_INFINITY;
      let left = Number.POSITIVE_INFINITY;
      let right = -1;
      for (let i = 0; i < islandId.length; i++) {
        if (islandId[i] !== player.islandId) continue;
        const x = i % width;
        top = Math.min(top, (i - x) / width);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
      if (right < 0) continue;
      const corners = [left + 3, right - 3];
      const x =
        timerAt === null
          ? corners[0]!
          : corners.reduce((a, b) =>
              Math.hypot(b - timerAt.x, top - timerAt.y) >
              Math.hypot(a - timerAt.x, top - timerAt.y)
                ? b
                : a,
            );
      islandTops.set(player.id, { x, y: top });
    }
  }

  function drawIslandBanners(): void {
    hud.showTeamTags(
      [...islandTops].map(([player, at]) => ({
        player,
        text: t('team.name', { letter: teamLetter(session.state.players[player]?.team ?? 0) }),
        colour: playerCssColour(player),
        ...scene.screenAt(at.x, at.y - 0.3),
      })),
    );
    const banners: IslandBanner[] = [];
    for (const banner of bannersFor(session.state, livesLost, gained)) {
      const centre = islandCentre.get(banner.player);
      if (centre === undefined) continue;
      banners.push({
        ...banner,
        holdMs: defaultConfigBundle.art.hud.pointsBannerMs,
        colour: playerCssColour(banner.player),
        ...scene.screenAt(centre.x, centre.y),
      });
    }
    hud.showIslandBanners(banners);
  }
  const controls = new Controls(
    canvas,
    scene,
    session.state,
    session.humanPlayer,
    (action) => {
      session.submit(action);
    },
    // Rotating and a refused placement are the two things the player does that the
    // simulation never hears about, so they are cued here rather than from an event.
    (cue) => audio.play(cue),
  );
  // Nobody at the keyboard in a watched match, so there is nothing to listen for.
  if (session.humanPlayer >= 0) controls.attach();

  /**
   * Walls the sim swept at the last resolution that the banner has not yet reached; see
   * `transition.ts`. Owners are read from the board as last drawn, because the sweep
   * has already zeroed them in the state.
   */
  let swept: SweptWall[] = [];
  /** The owner layer as last drawn, for exactly that. */
  let drawnOwner = session.state.owner.slice();

  /** Walls, castles and cannons, with any swept wall still standing put back. */
  /**
   * Walls lost with a life, crumbling outward from the middle of the island; see
   * `crumbleOutward`. Drawn standing until each one's moment comes.
   */
  let ruins: Ruin[] = [];
  /** The structure layer as last drawn, beside the owners, to find what a wipe took. */
  let drawnStructure = session.state.structure.slice();

  /** Walls, castles and cannons, with any swept or ruined wall still standing put back. */
  function drawBoard(): void {
    const board = boardWithStanding(session.state, [...swept, ...ruins]);
    scene.drawStructures({ ...session.state, ...board });
    drawnOwner = board.owner.slice();
    drawnStructure = board.structure.slice();
  }

  /** Takes down each ruined block as its moment comes. */
  function crumbleRuins(): void {
    if (ruins.length === 0) return;
    const now = performance.now();
    const falling = ruins.filter((ruin) => ruin.dueMs <= now);
    if (falling.length === 0) return;
    const width = session.state.width;
    for (const ruin of falling) {
      const x = ruin.index % width;
      scene.noteCrumble({ x, y: (ruin.index - x) / width, owner: ruin.owner - 1 });
    }
    ruins = ruins.filter((ruin) => ruin.dueMs > now);
    drawBoard();
  }

  /** Castles chosen lately, for the burst each choice sets off; see `drawChoices`. */
  let choices: { castleId: number; owner: number; at: number }[] = [];

  /** The board's enclosure as it stands, for display; see `Scene.drawTerritory`. */
  let live = computeEnclosure(session.state);
  /**
   * The enclosure as combat began, held for the combat look and the HUD until building
   * begins (`holdsCombatEnclosure`); null outside that. A breach counts for nothing until
   * then, so nothing that says "sealed" should come down with the wall.
   */
  let held: ReturnType<typeof computeEnclosure> | null = null;
  /** One style for both looks: one set of layers, which shows the held board in combat. */
  const oneLook = (): boolean => scene.styles.build === scene.styles.combat;
  /** The enclosure a look shows. */
  const enclosureFor = (look: Look): ReturnType<typeof computeEnclosure> =>
    held !== null && (look === 'combat' || oneLook()) ? held : live;

  /**
   * Newly sealed ground flooding out from its castle; see `seal.ts`. Started whenever
   * the enclosure gains territory — a breach closed, a castle chosen, a loop widened —
   * and drawn in both looks, since it shows exactly what was sealed.
   */
  let floods: Flood[] = [];
  const { sealFloodTilesPerSecond, sealGlowTiles, drainTilesPerSecond } =
    defaultConfigBundle.art.effects;

  /**
   * Ground lost to breaches draining away (`drainsFrom`), in the build look — the
   * enclosure combat began with against the board as it stands. Each island's drain
   * starts as the "Rebuild" banner's line reaches it (`releaseDrains`). With one style
   * for both looks the held board stays up until building begins, so the drains wait for
   * that: `drainDue` keeps the held enclosure until then.
   */
  let drains: Flood[] = [];
  let drainDue: ReturnType<typeof computeEnclosure> | null = null;
  function startDrain(from: ReturnType<typeof computeEnclosure>): void {
    drains.push(...drainsFrom(from.territory, live.territory, live.outside, session.state.width));
  }
  function advanceDrains(now: number) {
    if (drainDue !== null && session.state.phase === 'build') {
      startDrain(drainDue);
      drainDue = null;
      releaseDrains(drains, Number.POSITIVE_INFINITY, session.state.width, now);
    }
    if (drains.length === 0) return [];
    drains = drains.filter((drain) => !floodOver(drain, now, drainTilesPerSecond, 1));
    return drainWash(drains, now, session.state.width, drainTilesPerSecond);
  }

  /** Territory as each look shows it; the live board less what the floods have not reached. */
  function drawFloodedTerritory(now: number): void {
    const flooded = territoryDuring(live.territory, floods, now, sealFloodTilesPerSecond);
    scene.drawTerritory(session.state, {
      build: enclosureFor('build') === live ? flooded : enclosureFor('build').territory,
      combat: enclosureFor('combat') === live ? flooded : enclosureFor('combat').territory,
    });
  }

  const fit = (): void => {
    scene.resize(session.state, globalThis.innerWidth, globalThis.innerHeight, HUD_BAR_PX);
    scene.drawTerrain(session.state);
    drawFloodedTerritory(performance.now());
    drawBoard();
  };
  fit();
  globalThis.addEventListener('resize', fit);

  // No hidden keys: the end screen has a button back to the menu, and sound its switch in
  // the corner. R once did the first and M the second, unannounced, at the user's request
  // removed — a stray key press should not do something nobody was told about.
  const leaveMatch = (): void => {
    audio.play('select');
    session.leave();
    cleanup();
    showMenu();
  };
  hud.onLeave(leaveMatch);
  // Locally the table opens at once; online the host asks, and the room's answer brings
  // every page back to the lobby, this one included.
  hud.useRematch(session.rematch);
  hud.onRematch(() => {
    audio.play('select');
    if (session.network() === null) cleanup();
    session.requestRematch();
  });

  // Anyone may pause, and anyone resume: Esc, or the button beside the Sound switch.
  // Paused, the overlay is the match's menu: the settings, and a way out (PLAN 11.18 Y2).
  const pause = new PauseControls({
    toggle: (paused) => session.setPaused(paused),
    leave: leaveMatch,
    isMuted: () => audio.isMuted,
    setMuted: (muted) => {
      audio.setMuted(muted);
      showSoundButton();
    },
    volumes: audio,
    click: () => audio.play('select'),
    // The gallery over the pause menu, the looks as chosen; a change is drawn at once and
    // saved as the menu's choice. Random starts a rotation of its own, from the next
    // resolution on.
    looks: () =>
      openLookGallery({
        choices: { ...lookChoices },
        active: 'build',
        click: () => audio.play('select'),
        onChange: () => undefined,
        onClose: (chosen) => {
          if (chosen.build === lookChoices.build && chosen.combat === lookChoices.combat) return;
          lookChoices = chosen;
          rotation = new LookRotation(chosen);
          saveStyles(chosen);
          void scene.replaceLooks(looksFor(rotation.opening()));
        },
      }),
  });
  // Beside Pause, online only: the connection, where a player will see it.
  const badge = session.network() === null ? null : new NetworkBadge();
  // Out, and watching, with the way back to the menu (PLAN 11.18 Y3).
  const watching = new WatchingStrip(leaveMatch);

  let frame = 0;
  const cleanup = (): void => {
    cancelAnimationFrame(frame);
    controls.detach();
    pause.destroy();
    badge?.destroy();
    perf.detach();
    watching.destroy();
    hud.useSkin(null);
    globalThis.removeEventListener('resize', fit);
    scene.app.destroy(true);
  };

  /** The intermission whose banner is showing, by the tick it ends on. */
  let announcedAt: number | null = null;
  /** Set by a resolution, so the announcement after it carries the standings. */
  let resolvedSinceAnnounce = false;

  /**
   * The announcement, and what it does to the board as it crosses: the look beneath
   * changes at its line, and swept walls go as it reaches them. Every frame, from the
   * simulation clock, so the two can never part company.
   */
  function drawTransition(): void {
    const state = session.state;
    const progress = bannerProgress(state, session.tickFraction);
    const { before, after } = looksAround(state);
    let lineY: number | null = null;
    if (progress === null) {
      hud.clearAnnouncement();
      announcedAt = null;
    } else {
      if (announcedAt !== state.phaseEndTick) {
        announcedAt = state.phaseEndTick;
        // "Rebuild": the barrage is over, and what it took drains away as the banner
        // reveals the board — at once in the build look, or as building begins when one
        // style draws both looks and holds the old board until then.
        if (state.pendingPhase === 'build' && held !== null) {
          if (oneLook()) drainDue = held;
          else startDrain(held);
        }
        // After a continue the cannon phase opens with a castle to choose, and the
        // announcement should say so rather than tell them to place guns they cannot.
        const human = state.players[session.humanPlayer];
        const choosing =
          state.pendingPhase === 'cannon_place' && human !== undefined && owesCastleChoice(human);
        hud.announce(
          choosing ? 'castle_select' : (state.pendingPhase ?? 'combat'),
          announcementLines(state),
          // Drawn in the look it brings, since it is where the look changes.
          scene.styles[after],
          choosing ? null : announcementTitle(state),
          // The standings after a resolution, counted up from the round before's.
          resolvedSinceAnnounce ? ranking(state, matchLog.scores.at(-2)?.byPlayer ?? null) : [],
        );
        resolvedSinceAnnounce = false;
      }
      lineY = hud.placeAnnouncement(progress);
    }
    hud.useSkin(scene.styles[lineY === null ? before : after]);
    scene.showLooks(
      lineY === null
        ? { from: before, to: before, lineY: null }
        : { from: before, to: after, lineY },
    );
    sweepUnderBanner(lineY);
    // Each island's lost ground drains as the line reaches it; all of it once the
    // banner has gone.
    if (drains.length > 0 && !oneLook()) {
      releaseDrains(
        drains,
        state.phase !== 'intermission' || lineY === null
          ? Number.POSITIVE_INFINITY
          : scene.rowAt(lineY),
        state.width,
        performance.now(),
      );
    }
  }

  /** Takes away each swept wall as the banner's line passes it. */
  function sweepUnderBanner(lineY: number | null): void {
    if (swept.length === 0) return;
    // Any banner will do — normally "Place cannons", but "Fire!" when nobody had guns
    // to place — and once the intermission is over, whatever is left goes.
    const over = session.state.phase !== 'intermission';
    const lineRow = over
      ? Number.POSITIVE_INFINITY
      : lineY === null
        ? Number.NEGATIVE_INFINITY
        : scene.rowAt(lineY);
    const standing = stillStanding(swept, session.state.width, lineRow);
    if (standing.length === swept.length) return;
    const width = session.state.width;
    const kept = new Set(standing.map((wall) => wall.index));
    for (const wall of swept) {
      if (kept.has(wall.index)) continue;
      const x = wall.index % width;
      scene.noteCrumble({ x, y: (wall.index - x) / width, owner: wall.owner - 1 });
    }
    swept = standing;
    drawBoard();
  }

  /** Open water near the middle, for the big timer. Terrain is fixed, so asked once. */
  const bigTimerAt = timerSpot(session.state);
  const TIMED: readonly Phase[] = ['castle_select', 'cannon_place', 'build', 'combat'];

  /** The big timer, and the ready count beside the aiming cursor. */
  function drawCounters(ghost: Ghost): void {
    const state = session.state;
    if (bigTimerAt !== null && TIMED.includes(state.phase) && showsClock(state)) {
      const centre = scene.screenAt(bigTimerAt.x - 0.5, bigTimerAt.y - 0.5);
      const edge = scene.screenAt(bigTimerAt.x - 0.5 + bigTimerAt.size, bigTimerAt.y - 0.5);
      const seconds = Math.max(
        0,
        Math.ceil((state.phaseEndTick - state.tick) / state.ruleset.tickRateHz),
      );
      hud.showBigTimer({ ...centre, sizePx: edge.x - centre.x }, seconds);
    } else {
      hud.showBigTimer(null, 0);
    }
    // Beside the cursor, the number that decides the next click: guns ready when
    // aiming, guns still to place when placing them.
    const mode = inputMode(state, session.humanPlayer);
    const count =
      mode === 'fire' || mode === 'aim'
        ? readyCannons(state, session.humanPlayer)
        : mode === 'cannon'
          ? (state.players[session.humanPlayer]?.cannonsToPlace ?? 0)
          : null;
    hud.showReadyCount(
      ghost.tile !== null && count !== null
        ? scene.screenAt(ghost.tile.x + 1.4, ghost.tile.y - 1.1)
        : null,
      count ?? 0,
    );
  }

  /**
   * The tally at a resolution: a glow sweeping each scoring island's territory outward
   * from its castles while its points count up, timed to finish together (`tallyMs`).
   * Glow only — the ground is already held, so nothing is hidden.
   */
  let tallies: { flood: Flood; speed: number }[] = [];
  /** Players whose points were just banked, tallied once the enclosure is refreshed. */
  const tallyDue: number[] = [];

  function startTallies(now: number): void {
    const { width, castles } = session.state;
    const empty = new Uint8Array(live.territory.length);
    for (const player of tallyDue.splice(0)) {
      const theirs = live.territory.map((owner) => (owner === player + 1 ? owner : 0));
      const flood = floodFrom(empty, theirs, width, castles, now);
      if (flood === null) continue;
      const tallyMs = defaultConfigBundle.art.effects.tallyMs;
      tallies.push({ flood, speed: ((flood.maxDist + sealGlowTiles) * 1000) / tallyMs });
    }
  }

  /** Advances the floods and tallies by a frame, and returns the glow at their fronts. */
  function advanceFloods(): SealGlow[] {
    if (floods.length === 0 && tallies.length === 0) return [];
    const now = performance.now();
    const width = session.state.width;
    tallies = tallies.filter(({ flood, speed }) => !floodOver(flood, now, speed, sealGlowTiles));
    const tallied = tallies.flatMap(({ flood, speed }) =>
      sealGlow([flood], now, width, speed, sealGlowTiles),
    );
    if (floods.length === 0) return tallied;
    floods = floods.filter(
      (flood) => !floodOver(flood, now, sealFloodTilesPerSecond, sealGlowTiles),
    );
    drawFloodedTerritory(now);
    return [...sealGlow(floods, now, width, sealFloodTilesPerSecond, sealGlowTiles), ...tallied];
  }

  function applyEvents(events: readonly MatchEvent[]): void {
    matchLog.note(events, session.state);
    let structuresChanged = false;
    let territoryChanged = false;
    for (const event of events) {
      switch (event.kind) {
        case 'shot_impact': {
          const { width, islandId } = session.state;
          const debris = event.destroyed.map((i) => ({
            x: i % width,
            y: Math.floor(i / width),
            owner: (islandId[i] as number) - 1,
          }));
          scene.noteImpact(event.x, event.y, debris);
          // Only for your own wall: shots land all over the map, all the time.
          const human = session.humanPlayer;
          if (human >= 0 && !motionReduced() && debris.some((d) => d.owner === human)) {
            scene.shake();
          }
          if (event.destroyed.length > 0) structuresChanged = true;
          break;
        }
        case 'shot_fired':
          scene.noteShot(event.shot);
          break;
        case 'piece_placed': {
          // Whose island it went on, which is not always the placer's in a team match.
          const { width, owner } = session.state;
          const cells = event.cells.map((i) => ({ x: i % width, y: Math.floor(i / width) }));
          const first = event.cells[0];
          if (first !== undefined) scene.noteLanding(cells, (owner[first] as number) - 1);
          structuresChanged = true;
          territoryChanged = true;
          break;
        }
        case 'castle_selected':
          choices.push({ castleId: event.castleId, owner: event.player, at: performance.now() });
          structuresChanged = true;
          territoryChanged = true;
          break;
        case 'cannon_placed': {
          // Set down as a piece is: it settles, throws up the style's dust or sparks, and
          // knocks flat whatever stood under it.
          const [w, h] = session.state.ruleset.cannons.footprint;
          const cells: { x: number; y: number }[] = [];
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) cells.push({ x: event.x + dx, y: event.y + dy });
          }
          scene.noteLanding(cells, event.player);
          structuresChanged = true;
          break;
        }
        case 'round_resolved': {
          if (rotation.rotates) void prepareNextLooks();
          const hold = Math.ceil(
            (defaultConfigBundle.art.hud.pointsBannerMs * session.state.ruleset.tickRateHz) / 1000,
          );
          const { tallyMs } = defaultConfigBundle.art.effects;
          const count = Math.ceil((tallyMs * session.state.ruleset.tickRateHz) / 1000);
          for (const result of event.results) {
            gained.set(result.player, {
              amount: result.territoryPoints + result.damagePoints,
              untilTick: event.tick + hold,
              // Counted up as the territory is tallied, rather than landing whole.
              fromTick: event.tick,
              countTicks: count,
              guns: result.cannonsAwarded,
            });
            if (result.territoryPoints > 0) tallyDue.push(result.player);
          }
          resolvedSinceAnnounce = true;
          structuresChanged = true;
          territoryChanged = true;
          break;
        }
        case 'player_eliminated':
          structuresChanged = true;
          territoryChanged = true;
          break;
        case 'player_continued': {
          // The sim lengthens the intermission by continueBannerMs for exactly this,
          // so the announcement has the board to itself. Held a little longer than the
          // pause, so it does not vanish the instant the next phase starts.
          const hold = Math.ceil(
            (session.state.ruleset.phases.continueBannerMs * 2 * session.state.ruleset.tickRateHz) /
              1000,
          );
          livesLost.set(event.player, {
            remaining: event.continuesRemaining,
            untilTick: event.tick + hold,
          });
          // The wipe took the island's wall in one step; take it down outward instead.
          const island = session.state.players[event.player]?.islandId ?? event.player + 1;
          const centre = islandCentre.get(event.player);
          if (centre !== undefined) {
            const lost = lostWalls(drawnStructure, drawnOwner, session.state.structure, island);
            ruins.push(
              ...crumbleOutward(
                lost,
                session.state.width,
                centre,
                performance.now(),
                defaultConfigBundle.art.effects.lifeCrumbleMs,
              ),
            );
          }
          structuresChanged = true;
          territoryChanged = true;
          break;
        }
        case 'walls_swept':
          // Drawn away by the next banner rather than now; see `sweepUnderBanner`. A
          // block placed in this same step was never drawn, so its island says whose.
          swept = event.tiles.map((index) => ({
            index,
            owner: (drawnOwner[index] as number) || (session.state.islandId[index] as number),
          }));
          structuresChanged = true;
          break;
        case 'phase_changed':
          controls.resetRotation();
          territoryChanged = true;
          structuresChanged = true;
          break;
        default:
          break;
      }
    }
    if (structuresChanged) drawBoard();
    if (territoryChanged || structuresChanged) {
      // Taken before this batch's shots are counted, so it is the board combat began on.
      held = holdsCombatEnclosure(session.state) ? (held ?? live) : null;
      const before = live.territory;
      const sealedBefore = live.castleEnclosed;
      live = computeEnclosure(session.state);
      matchAudio.sealed(session.state, sealedBefore, live.castleEnclosed);
      const now = performance.now();
      const flood = floodFrom(
        before,
        live.territory,
        session.state.width,
        session.state.castles,
        now,
      );
      if (flood !== null) floods.push(flood);
      drawFloodedTerritory(now);
      startTallies(now);
      hints = buildHints(session.state, session.humanPlayer, live);
    }
  }

  function recentChoices(now: number): Choice[] {
    const span = defaultConfigBundle.art.effects.choiceBurstMs;
    choices = choices.filter((c) => now - c.at < span);
    return choices.flatMap((c) => {
      const castle = session.state.castles.find((k) => k.id === c.castleId);
      return castle === undefined ? [] : [{ castle, owner: c.owner, ageMs: now - c.at }];
    });
  }

  /** When this client first saw the match over, for the push onto the winner. */
  let overAt: number | null = null;

  /**
   * The camera, moving only while nothing is playable (PLAN 11.11 W6): onto the viewer's
   * island as the match opens and out to the whole map, and slowly onto the winners at
   * game over. Still under reduced motion. Before anything is drawn over the board in
   * HTML, which is placed through it.
   */
  function pointCamera(now: number): void {
    const state = session.state;
    if (state.phase === 'game_over') overAt ??= now;
    const art = defaultConfigBundle.art.camera;
    const winners = state.winners.flatMap((id) => islandCentre.get(id) ?? []);
    const shot = motionReduced()
      ? null
      : (openingShot(state, session.tickFraction, islandCentre.get(session.humanPlayer), art) ??
        winnerShot(state, now - (overAt ?? now), winners, art));
    scene.setCamera(state, shot);

    // "You are here", from the start of the match until the viewer has chosen a castle:
    // seats are shuffled onto islands, so nobody knows which is theirs until told.
    const me = state.players[session.humanPlayer];
    const centre = islandCentre.get(session.humanPlayer);
    const opening =
      state.round === 0 &&
      (state.phase === 'castle_select' ||
        (state.phase === 'intermission' && state.pendingPhase === 'castle_select'));
    hud.showYouAreHere(
      me !== undefined && centre !== undefined && opening && me.startingCastleId === null
        ? {
            ...scene.screenAt(centre.x, centre.y),
            colour: playerCssColour(me.id),
            shape: playerShape(me.id),
          }
        : null,
    );
  }

  perf.attach(scene.app.stage, scene.app.renderer, () => ({
    url: globalThis.location.search,
    styles: `build ${scene.styles.build}, combat ${scene.styles.combat}`,
    players: String(session.state.players.length),
    effects: storedEffects(),
  }));
  let last = performance.now();
  const loop = (now: number): void => {
    const delta = now - last;
    last = now;
    // The board is ready: the first frame takes the screen over it down, and draws the
    // hidden look behind it once (`Scene.warmUp`).
    const first = preparing?.isConnected === true;
    if (first) preparing?.remove();

    perf.begin('sim');
    const events = session.advance(delta);
    pause.update(
      session.pausedBy,
      session.humanPlayer,
      session.state.players.map((p) => p.name),
      session.finished,
    );
    applyEvents(events);
    matchAudio.handle(events);
    matchAudio.frame(session.state);
    perf.end('sim');
    perf.begin('hud');
    pointCamera(now);
    drawTransition();
    drawIslandBanners();
    hud.update(session.state, session.humanPlayer, session.status());
    watching.update(session.state, session.humanPlayer);
    const reading = session.network();
    if (reading !== null) badge?.update(reading, session.state.ruleset.tickRateHz);

    crumbleRuins();
    perf.end('hud');
    // Once the match is over, fireworks over whoever won it.
    const celebrate =
      session.state.phase === 'game_over'
        ? session.state.winners.flatMap((id) => {
            const centre = islandCentre.get(id);
            return centre === undefined ? [] : [{ ...centre, owner: id }];
          })
        : [];
    perf.begin('effects');
    scene.drawEffects(
      session.state,
      session.tickFraction,
      delta,
      {
        build: enclosureFor('build').castleEnclosed,
        combat: enclosureFor('combat').castleEnclosed,
      },
      advanceFloods(),
      session.humanPlayer,
      celebrate,
      recentChoices(now),
      advanceDrains(now),
    );
    perf.end('effects');
    perf.begin('overlay');
    const ghost = {
      ...controls.ghost(session.tickFraction),
      ...hints,
      beat: countdownBeat(session.state, session.tickFraction),
    };
    scene.drawOverlay(session.state, ghost, session.humanPlayer);
    drawCounters(ghost);
    perf.end('overlay');
    if (first) scene.warmUp();
    perf.beforeRender();
    perf.begin('render');
    scene.render();
    perf.end('render');
    perf.frameDone(now, delta);

    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  return cleanup;
}
