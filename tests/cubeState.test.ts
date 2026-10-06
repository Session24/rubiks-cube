import { describe, it, expect } from 'vitest';
import { CubeState } from '../src/core/CubeState';
import { FACE_DEFS, FACE_NAMES, faceCellCoords } from '../src/core/geometry';
import type { FaceName, Move, Axis } from '../src/types';

/**
 * The tables below are written by hand from the cube net below and are NOT shared
 * with the implementation - they are the independent reference used to prove that
 * the six face orientations of FACE_DEFS are correct and not mirrored.
 *
 *          U
 *   L   F   R   B
 *          D
 *
 * i -> X (0 = L, N-1 = R), j -> Y (0 = D, N-1 = U), k -> Z (0 = B, N-1 = F)
 */
function refCoords(face: FaceName, col: number, row: number, n: number): [number, number, number] {
  switch (face) {
    case 'U': return [col, n - 1, row];
    case 'D': return [col, 0, n - 1 - row];
    case 'L': return [0, n - 1 - row, col];
    case 'R': return [n - 1, n - 1 - row, n - 1 - col];
    case 'F': return [col, n - 1 - row, n - 1];
    case 'B': return [n - 1 - col, n - 1 - row, 0];
  }
}

/** Inverse of refCoords: which cell of `face` holds lattice coordinates (i,j,k)? */
function refCell(face: FaceName, i: number, j: number, k: number, n: number): [number, number] {
  switch (face) {
    case 'U': return [i, k];
    case 'D': return [i, n - 1 - k];
    case 'L': return [k, n - 1 - j];
    case 'R': return [n - 1 - k, n - 1 - j];
    case 'F': return [i, n - 1 - j];
    case 'B': return [n - 1 - i, n - 1 - j];
  }
}

/** Face whose outward normal is (axis, max). */
function refFaceForNormal(axis: number, max: boolean): FaceName {
  if (axis === 0) return max ? 'R' : 'L';
  if (axis === 1) return max ? 'U' : 'D';
  return max ? 'F' : 'B';
}

interface Sticker {
  face: FaceName;
  col: number;
  row: number;
  i: number;
  j: number;
  k: number;
  color: number;
  normalAxis: number;
  normalMax: boolean;
}

const NORMAL_AXIS: Record<FaceName, [number, boolean]> = {
  U: [1, true], D: [1, false], L: [0, false], R: [0, true], F: [2, true], B: [2, false],
};

function allStickers(cube: CubeState): Sticker[] {
  const n = cube.size;
  const out: Sticker[] = [];
  for (const face of FACE_NAMES) {
    const [axis, max] = NORMAL_AXIS[face];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const [i, j, k] = refCoords(face, col, row, n);
        out.push({ face, col, row, i, j, k, color: cube.get(face, row, col), normalAxis: axis, normalMax: max });
      }
    }
  }
  return out;
}

/** Geometric reference: rotate every sticker that lies in the slab. */
function refApplyMove(stickers: Sticker[], move: Move, n: number): void {
  const axis = move.axis === 'X' ? 0 : move.axis === 'Y' ? 1 : 2;
  const dir = move.direction;
  const b1 = (axis + 1) % 3;
  const b2 = (axis + 2) % 3;

  for (const s of stickers) {
    const along = axis === 0 ? s.i : axis === 1 ? s.j : s.k;
    if (along !== move.layer) continue;

    // rotate position
    if (axis === 0) {
      const j = s.j, k = s.k;
      s.j = dir > 0 ? n - 1 - k : k;
      s.k = dir > 0 ? j : n - 1 - j;
    } else if (axis === 1) {
      const i = s.i, k = s.k;
      s.i = dir > 0 ? k : n - 1 - k;
      s.k = dir > 0 ? n - 1 - i : i;
    } else {
      const i = s.i, j = s.j;
      s.i = dir > 0 ? n - 1 - j : j;
      s.j = dir > 0 ? i : n - 1 - i;
    }

    // rotate outward normal
    if (s.normalAxis !== axis) {
      const sign = s.normalMax ? 1 : -1;
      if (s.normalAxis === b1) {
        s.normalAxis = b2;
        s.normalMax = dir > 0 ? sign > 0 : sign < 0;
      } else {
        s.normalAxis = b1;
        s.normalMax = dir > 0 ? sign < 0 : sign > 0;
      }
    }
    s.face = refFaceForNormal(s.normalAxis, s.normalMax);
    const [col, row] = refCell(s.face, s.i, s.j, s.k, n);
    s.col = col;
    s.row = row;
  }
}

function randomMoves(count: number, n: number): Move[] {
  const axes: Axis[] = ['X', 'Y', 'Z'];
  const moves: Move[] = [];
  for (let i = 0; i < count; i++) {
    moves.push({
      axis: axes[Math.floor(Math.random() * 3)],
      layer: Math.floor(Math.random() * n),
      direction: Math.random() < 0.5 ? 1 : -1,
    });
  }
  return moves;
}

function sameState(a: CubeState, b: CubeState): boolean {
  if (a.size !== b.size) return false;
  for (const face of FACE_NAMES) {
    const x = a.faces[face];
    const y = b.faces[face];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

const SMALL_N = [2, 3, 4, 5, 10];
const BIG_N = [50, 100, 500, 1000];

describe('solved cube', () => {
  it.each(SMALL_N)('is created solved for N=%i', (n) => {
    const cube = CubeState.createSolved(n);
    expect(cube.size).toBe(n);
    expect(cube.isSolved()).toBe(true);
    expect(cube.moveHistory).toHaveLength(0);
    for (const face of FACE_NAMES) {
      expect(cube.faces[face]).toHaveLength(n * n);
      expect(cube.faces[face].every(v => v === FACE_DEFS[face].color)).toBe(true);
    }
  });

  it('rejects sizes below 2', () => {
    expect(() => new CubeState(1)).toThrow();
  });
});

describe('face orientation tables', () => {
  it.each([2, 3, 5, 100])('FACE_DEFS matches the hand written net for N=%i', (n) => {
    const buf = new Int32Array(3);
    for (const face of FACE_NAMES) {
      const def = FACE_DEFS[face];
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          faceCellCoords(def, col, row, n, buf);
          const [i, j, k] = refCoords(face, col, row, n);
          expect([buf[0], buf[1], buf[2]]).toEqual([i, j, k]);
        }
      }
    }
  });

  it('covers every face cell exactly once (no duplicates, no mirrors)', () => {
    const n = 4;
    for (const face of FACE_NAMES) {
      const seen = new Set<string>();
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          const [i, j, k] = refCoords(face, col, row, n);
          const key = `${i},${j},${k}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
      expect(seen.size).toBe(n * n);
      // every cell sits on the plane of its own face
      const [axis, max] = NORMAL_AXIS[face];
      for (const key of seen) {
        const [i, j, k] = key.split(',').map(Number);
        const along = axis === 0 ? i : axis === 1 ? j : k;
        expect(along === (max ? n - 1 : 0)).toBe(true);
      }
    }
  });

  it('neighbouring faces agree on their shared edge', () => {
    const n = 5;
    for (let col = 0; col < n; col++) {
      // U front edge (=k) must be F top edge
      expect(refCoords('U', col, n - 1, n)).toEqual(refCoords('F', col, 0, n));
      // D front edge must be F bottom edge
      expect(refCoords('D', col, 0, n)).toEqual(refCoords('F', col, n - 1, n));
      // D back edge must be B bottom edge
      expect(refCoords('D', col, n - 1, n)).toEqual(refCoords('B', n - 1 - col, n - 1, n));
      // U back edge must be B top edge
      expect(refCoords('U', col, 0, n)).toEqual(refCoords('B', n - 1 - col, 0, n));
      // F left edge <-> L front edge
      expect(refCoords('F', 0, col, n)).toEqual(refCoords('L', n - 1, col, n));
      // F right edge <-> R front edge
      expect(refCoords('F', n - 1, col, n)).toEqual(refCoords('R', 0, col, n));
    }
  });

  it('every face is right handed (not mirrored)', () => {
    const e = (a: number[], b: number[]): number[] => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    for (const face of FACE_NAMES) {
      const n = 4;
      const p00 = refCoords(face, 0, 1, n); // column direction
      const p10 = refCoords(face, 1, 1, n);
      const p01 = refCoords(face, 0, 0, n); // row 0 = up
      const right = [p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]];
      const up = [p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]];
      const normal = e(right, up).map(v => (v === 0 ? 0 : v)); // normalise -0
      const [axis, max] = NORMAL_AXIS[face];
      const expected = [0, 0, 0];
      expected[axis] = max ? 1 : -1;
      expect(normal).toEqual(expected);
    }
  });
});

describe('move inversion', () => {
  it.each(SMALL_N)('move + inverseMove restores the cube for N=%i', (n) => {
    const cube = CubeState.createSolved(n);
    const moves = randomMoves(12, n);
    const before = cube.serialize();
    for (const m of moves) cube.applyMove(m);
    for (let i = moves.length - 1; i >= 0; i--) cube.applyMove(CubeState.inverseMove(moves[i]));
    const restored = CubeState.deserialize(before);
    expect(sameState(cube, restored)).toBe(true);
    expect(cube.isSolved()).toBe(true);
  });

  it.each(SMALL_N)('four identical quarter turns restore the cube for N=%i', (n) => {
    const cases: Move[] = [
      { axis: 'X', layer: 0, direction: 1 },
      { axis: 'X', layer: n - 1, direction: -1 },
      { axis: 'X', layer: Math.floor(n / 2), direction: 1 },
      { axis: 'Y', layer: 0, direction: 1 },
      { axis: 'Y', layer: n - 1, direction: 1 },
      { axis: 'Y', layer: Math.floor(n / 2), direction: -1 },
      { axis: 'Z', layer: 0, direction: 1 },
      { axis: 'Z', layer: n - 1, direction: -1 },
      { axis: 'Z', layer: Math.floor(n / 2), direction: 1 },
    ];
    for (const move of cases) {
      const cube = CubeState.createSolved(n);
      for (let i = 0; i < 4; i++) cube.applyMove(move);
      expect(sameState(cube, CubeState.createSolved(n))).toBe(true);
      expect(cube.isSolved()).toBe(true);
    }
  });

  it('inverseMove is an involution and inverseMoves reverses the order', () => {
    const m: Move = { axis: 'Y', layer: 37, direction: -1 };
    expect(CubeState.inverseMove(CubeState.inverseMove(m))).toEqual(m);
    const seq = randomMoves(6, 10);
    const inv = CubeState.inverseMoves(seq);
    expect(inv).toHaveLength(seq.length);
    const cube = CubeState.createSolved(10);
    cube.applyMoves(seq);
    cube.applyMoves(inv);
    expect(cube.isSolved()).toBe(true);
  });
});

describe('orientation of every move type', () => {
  const axes: Axis[] = ['X', 'Y', 'Z'];

  it.each([3, 4, 5])('matches the geometric reference for N=%i', (n) => {
    for (const axis of axes) {
      const layers = n === 2 ? [0, 1] : [0, Math.floor(n / 2), n - 1];
      for (const layer of layers) {
        for (const direction of [1, -1] as const) {
          const move: Move = { axis, layer, direction };
          const cube = CubeState.createSolved(n);
          // scramble a little so nothing is trivially uniform
          cube.applyMoves(randomMoves(5, n));
          const before = cube.serialize();
          const reference = CubeState.deserialize(before);
          const stickers = allStickers(reference);

          cube.applyMove(move);
          refApplyMove(stickers, move, n);

          for (const s of stickers) {
            expect(cube.get(s.face, s.row, s.col)).toBe(s.color);
          }
        }
      }
    }
  });

  it('moves inner layers and outer layers independently', () => {
    const n = 5;
    const cube = CubeState.createSolved(n);
    cube.applyMove({ axis: 'X', layer: 2, direction: 1 });
    // on U/D the X axis runs along the columns, so only column 2 may change
    for (const face of ['U', 'D'] as FaceName[]) {
      for (let row = 0; row < n; row++) {
        for (let col = 0; col < n; col++) {
          if (col === 2) continue;
          expect(cube.get(face, row, col)).toBe(FACE_DEFS[face].color);
        }
      }
      // the strip itself must have changed
      expect(cube.faces[face].some(v => v !== FACE_DEFS[face].color)).toBe(true);
    }
    // outer faces untouched
    for (const face of ['L', 'R'] as FaceName[]) {
      expect(cube.faces[face].every(v => v === FACE_DEFS[face].color)).toBe(true);
    }
    expect(cube.isSolved()).toBe(false);
  });

  it('turning an outer layer also spins that outer face', () => {
    const n = 3;
    const cube = CubeState.createSolved(n);
    cube.set('L', 0, 0, 3); // distinctive marker in the corner of L
    cube.applyMove({ axis: 'X', layer: 0, direction: 1 });
    expect(cube.isSolved()).toBe(false);
    // after 4 turns the marker must be back
    for (let i = 0; i < 3; i++) cube.applyMove({ axis: 'X', layer: 0, direction: 1 });
    expect(cube.get('L', 0, 0)).toBe(3);
  });
});

describe('large cubes', () => {
  it.each(BIG_N)('basic operations stay correct for N=%i', (n) => {
    const cube = CubeState.createSolved(n);
    expect(cube.isSolved()).toBe(true);

    const moves: Move[] = [
      { axis: 'X', layer: 0, direction: 1 },
      { axis: 'Y', layer: Math.floor(n / 2), direction: -1 },
      { axis: 'Z', layer: n - 1, direction: 1 },
      { axis: 'X', layer: n - 1, direction: -1 },
    ];
    cube.applyMoves(moves);
    expect(cube.moveHistory).toHaveLength(moves.length);
    expect(cube.isSolved()).toBe(false);
    cube.applyMoves(CubeState.inverseMoves(moves));
    expect(cube.isSolved()).toBe(true);
  }, 30000);

  it('state serialises and round-trips for N=1000', () => {
    const cube = CubeState.createSolved(1000);
    cube.applyMove({ axis: 'X', layer: 123, direction: 1 });
    const data = cube.serialize();
    const restored = CubeState.deserialize(data);
    expect(sameState(cube, restored)).toBe(true);
    expect(restored.isSolved()).toBe(false);
    restored.applyMove({ axis: 'X', layer: 123, direction: -1 });
    expect(restored.isSolved()).toBe(true);
  }, 30000);

  it('rejects an out of range layer', () => {
    const cube = CubeState.createSolved(3);
    expect(() => cube.applyMove({ axis: 'X', layer: 3, direction: 1 })).toThrow();
    expect(() => cube.applyMove({ axis: 'Y', layer: -1, direction: 1 })).toThrow();
  });
});
