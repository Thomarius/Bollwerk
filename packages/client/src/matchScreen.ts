import { artForStyle, defaultConfigBundle, type ArtStyle, type Ruleset } from '@bollwerk/config';
import { owesCastleChoice, type MatchEvent, type Phase } from '@bollwerk/sim';

import { countdownBeat, showsClock } from './clock.js';
import { Controls, inputMode, readyCannons } from './controls.js';
import { bannersFor, type LifeLost, type PointsGained } from './banners.js';
import { matchPalette, playerCssColour, useMatchPalette } from './colours.js';
import { matchShapes, playerShape, useMatchShapes } from './shapes.js';
import { NetworkBadge } from './network.js';
import { WatchingStrip } from './watching.js';
import { LookRotation, openLookGallery } from './looks.js';
import { t } from './i18n.js';
import { Hud } from './hud.js';
import type { IslandBanner } from './boardLabels.js';
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
import { bannerProgress, looksAround, type Look } from './transition.js';
import { Scene, createTheme, type Ghost, type SceneLook } from './render/scene.js';
import { app, audio, showSoundButton } from './app.js';
import { saveStyles } from './prefs.js';
import type { Session, Setup } from './session.js';
import { showMenu } from './menu.js';
import { BoardEffects } from './boardEffects.js';

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
  hud.endScreen.useLog(matchLog);
  hud.endScreen.useReveal(revealLines(session.state, session.setups));
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
    hud.labels.showTeamTags(
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
        holdMs: pointsHoldMs(session.state.ruleset),
        colour: playerCssColour(banner.player),
        ...scene.screenAt(centre.x, centre.y),
      });
    }
    hud.labels.showIslandBanners(banners);
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

  /** The board as drawn: swept and crumbling walls, the held enclosure, floods and drains. */
  const board = new BoardEffects(scene, session);

  const fit = (): void => {
    scene.resize(session.state, globalThis.innerWidth, globalThis.innerHeight, HUD_BAR_PX);
    scene.drawTerrain(session.state);
    board.drawFloodedTerritory(performance.now());
    board.drawBoard();
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
  hud.endScreen.onLeave(leaveMatch);
  // Locally the table opens at once; online the host asks, and the room's answer brings
  // every page back to the lobby, this one included.
  hud.endScreen.useRematch(session.rematch);
  hud.endScreen.onRematch(() => {
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
        if (state.pendingPhase === 'build') board.startRebuild();
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
    // Swept walls go as the line passes them, and lost ground drains as it reaches it.
    board.underBanner(lineY);
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
      hud.labels.showBigTimer({ ...centre, sizePx: edge.x - centre.x }, seconds);
    } else {
      hud.labels.showBigTimer(null, 0);
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
    hud.labels.showReadyCount(
      ghost.tile !== null && count !== null
        ? scene.screenAt(ghost.tile.x + 1.4, ghost.tile.y - 1.1)
        : null,
      count ?? 0,
    );
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
          board.noteChoice(event.castleId, event.player);
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
            (pointsHoldMs(session.state.ruleset) * session.state.ruleset.tickRateHz) / 1000,
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
            if (result.territoryPoints > 0) board.noteTally(result.player);
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
          if (centre !== undefined) board.noteWipe(island, centre);
          structuresChanged = true;
          territoryChanged = true;
          break;
        }
        case 'walls_swept':
          // Drawn away by the next banner rather than now.
          board.noteSwept(event.tiles);
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
    const sealing = board.refresh(structuresChanged, territoryChanged);
    if (sealing !== null) {
      matchAudio.sealed(session.state, sealing.sealedBefore, sealing.sealedAfter);
      hints = buildHints(session.state, session.humanPlayer, board.live);
    }
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
    // Then faded a few seconds into the choice, by the sim's clock: over the island's middle
    // it often stood on a castle, just when the castles are what to look at.
    const { youAreHereMs, youAreHereFadeMs } = defaultConfigBundle.art.hud;
    const rate = state.ruleset.tickRateHz;
    const choosingMs =
      state.phase === 'castle_select'
        ? state.ruleset.phases.castleSelectMs -
          ((state.phaseEndTick - state.tick - session.tickFraction) * 1000) / rate
        : 0;
    const hereOpacity = Math.max(
      0,
      Math.min(1, 1 - (choosingMs - youAreHereMs) / youAreHereFadeMs),
    );
    hud.labels.showYouAreHere(
      me !== undefined &&
        centre !== undefined &&
        opening &&
        me.startingCastleId === null &&
        hereOpacity > 0
        ? {
            ...scene.screenAt(centre.x, centre.y),
            colour: playerCssColour(me.id),
            shape: playerShape(me.id),
            opacity: hereOpacity,
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

    board.crumbleRuins();
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
        build: board.enclosureFor('build').castleEnclosed,
        combat: board.enclosureFor('combat').castleEnclosed,
      },
      board.advanceFloods(),
      session.humanPlayer,
      celebrate,
      board.recentChoices(now),
      board.advanceDrains(now),
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

/**
 * How long an island's banked points stay over it: `pointsBannerMs`, but never past the
 * intermission after the build phase, so they are gone as the cannon phase opens. Held the
 * full eight seconds they covered the island for the first three of placing guns, its clock
 * already running (the user's report, 2026-10-07).
 */
export function pointsHoldMs(ruleset: Ruleset): number {
  const { endOfPhasePauseMs, transitionBannerMs } = ruleset.phases;
  return Math.min(
    defaultConfigBundle.art.hud.pointsBannerMs,
    endOfPhasePauseMs + transitionBannerMs,
  );
}
