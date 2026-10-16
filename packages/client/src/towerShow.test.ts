import { TOWER_VARIANTS, type TowerVariant } from '@bollwerk/config';
import { Structure, type MatchEvent } from '@bollwerk/sim';
import { describe, expect, it } from 'vitest';

import { TowerShow } from './towerShow.js';

/** The show's events over this long, at 60 frames a second. */
function play(variant: TowerVariant | null, ms: number): { show: TowerShow; events: MatchEvent[] } {
  const show = new TowerShow(variant);
  const events: MatchEvent[] = [];
  for (let t = 0; t < ms; t += 1000 / 60) events.push(...show.advance(1000 / 60).events);
  return { show, events };
}

const impacts = (events: readonly MatchEvent[]) => events.filter((e) => e.kind === 'shot_impact');
const fired = (events: readonly MatchEvent[]) => events.filter((e) => e.kind === 'shot_fired');

describe('the tower menu’s preview, played by the rules', () => {
  it('fires an ordinary cannon for none, clearing one wall', () => {
    const { events } = play(null, 3500);
    const first = impacts(events)[0];
    expect(first?.kind === 'shot_impact' && first.destroyed).toHaveLength(1);
  });

  it('clears Big Bertha’s cross, the cheaper one’s shell landing later', () => {
    const landed = (variant: TowerVariant): number => {
      const { events } = play(variant, 4000);
      const first = impacts(events)[0];
      expect(first?.kind === 'shot_impact' && first.destroyed).toHaveLength(3);
      return first!.tick;
    };
    expect(landed('bertha2')).toBeGreaterThan(landed('bertha3'));
  });

  it('fires each of a Rapid Cannon’s barrels before the first shot lands', () => {
    for (const variant of ['rapid2', 'rapid3'] as const) {
      const { events } = play(variant, 3500);
      const shots = fired(events);
      const firstImpact = impacts(events)[0]!.tick;
      expect(shots.filter((e) => e.tick < firstImpact)).toHaveLength(variant === 'rapid2' ? 2 : 3);
    }
  });

  it('rebuilds what the Architect reaches, wider at cost 3, and not the far corner', () => {
    const rebuilt = (variant: TowerVariant): number[] => {
      const { events } = play(variant, 9000);
      const repair = events.find((e) => e.kind === 'walls_repaired');
      return repair?.kind === 'walls_repaired' ? [...repair.tiles].sort((a, b) => a - b) : [];
    };
    const width = new TowerShow('architect2').state.width;
    const at = (x: number, y: number) => y * width + x;
    expect(rebuilt('architect2')).toEqual([at(10, 4), at(10, 6)]);
    expect(rebuilt('architect3')).toEqual([at(9, 2), at(10, 4), at(10, 6)].sort((a, b) => a - b));
  });

  it('loops: the walls come back and it plays again', () => {
    for (const variant of [null, ...TOWER_VARIANTS]) {
      const show = new TowerShow(variant);
      const walls = show.state.structure.filter((s) => s === Structure.Wall).length;
      let resets = 0;
      let shots = 0;
      for (let t = 0; t < 20_000; t += 50) {
        const frame = show.advance(50);
        if (frame.reset) {
          resets++;
          expect(show.state.structure.filter((s) => s === Structure.Wall).length).toBe(walls);
        }
        shots += fired(frame.events).length;
      }
      expect(resets).toBeGreaterThanOrEqual(2);
      expect(shots).toBeGreaterThan(resets);
    }
  });
});
