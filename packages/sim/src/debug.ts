import { Structure, Terrain } from './types.js';

export interface AsciiLayers {
  width: number;
  height: number;
  terrain: Uint8Array;
  islandId?: Uint8Array;
  structure?: Uint8Array;
  owner?: Uint8Array;
  territory?: Uint8Array;
}

/**
 * Renders the grid as text. Used by tests to express expectations as pictures and
 * by the headless harness to show what a match is doing — a wall gap is obvious
 * in a printed map and invisible in a typed array.
 *
 * `.` water   `,` land   `1-4` island (when no structure)
 * `#` wall    `@` castle  `*` cannon   lowercase marks enclosed territory
 */
export function renderAscii(layers: AsciiLayers): string {
  const { width, height } = layers;
  const rows: string[] = [];

  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const structure = layers.structure?.[i] ?? Structure.Empty;

      if (structure === Structure.Wall) row += '#';
      else if (structure === Structure.Castle) row += '@';
      else if (structure === Structure.Cannon) row += '*';
      else if (layers.terrain[i] === Terrain.Water) row += '.';
      else if (layers.territory?.[i])
        row += String.fromCharCode(96 + (layers.territory[i] as number));
      else if (layers.islandId?.[i]) row += String(layers.islandId[i]);
      else row += ',';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
