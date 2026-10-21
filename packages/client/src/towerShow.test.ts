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

  it('strikes the Lightning Tower’s chain at once, a strike more at cost 3', () => {
    const chain = (variant: TowerVariant): number => {
      const { events } = play(variant, 2000);
      const strike = events.find((e) => e.kind === 'lightning_struck');
      if (strike?.kind !== 'lightning_struck') throw new Error('no strike');
      // Struck on the tick it fired; nothing of it lands later.
      expect(strike.tick).toBe(fired(events)[0]!.tick);
      expect(impacts(events)).toEqual([]);
      return strike.path.length;
    };
    expect(chain('lightning2')).toBe(3);
    expect(chain('lightning3')).toBe(4);
  });

  it('burns the Laser Tower’s beam along the rival’s wall at once, a third at cost 3 by its chance', () => {
    const pierced = (variant: TowerVariant): number => {
      const { events } = play(variant, 2000);
      const beam = events.find((e) => e.kind === 'laser_fired');
      if (beam?.kind !== 'laser_fired') throw new Error('no beam');
      // Burnt on the tick it fired; nothing of it lands later.
      expect(beam.tick).toBe(fired(events)[0]!.tick);
      expect(impacts(events)).toEqual([]);
      return beam.destroyed.length;
    };
    expect(pierced('laser2')).toBe(2);
    expect(pierced('laser3')).toBe(3);
  });

  it('lands the Allerdickste Bertha’s shell after ten seconds, cost 3’s clearing more', () => {
    const cleared = (variant: TowerVariant): number => {
      const { events } = play(variant, 12_000);
      const shot = fired(events)[0];
      const first = impacts(events)[0];
      if (shot?.kind !== 'shot_fired' || first?.kind !== 'shot_impact') throw new Error('no shot');
      expect(first.tick - shot.tick).toBe(10 * new TowerShow(variant).state.ruleset.tickRateHz);
      return first.destroyed.length;
    };
    expect(cleared('biggest3')).toBeGreaterThan(cleared('biggest2'));
  });

  it('loops: the walls come back and it plays again', () => {
    for (const variant of [null, ...TOWER_VARIANTS]) {
      const show = new TowerShow(variant);
      const walls = show.state.structure.filter((s) => s === Structure.Wall).length;
      let resets = 0;
      let shots = 0;
      // The Allerdickste Bertha's shell is ten seconds in the air, so hers is the longest loop.
      for (let t = 0; t < 30_000; t += 50) {
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
