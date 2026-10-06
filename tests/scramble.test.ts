import { describe, it, expect } from 'vitest';
import { Scrambler, defaultScrambleCount, clampScrambleCount, MAX_SCRAMBLE_MOVES } from '../src/core/Scramble';
import { CubeState } from '../src/core/CubeState';

function axesRunLength(moves: { axis: string }[]): number {
  let run = 1;
  for (let i = 1; i < moves.length; i++) {
    if (moves[i].axis === moves[i - 1].axis) run++;
    else run = 1;
  }
  return run;
}

describe('scramble generator', () => {
  it('produces the requested number of moves', () => {
    for (const n of [2, 3, 5, 20]) {
      const moves = new Scrambler({ moveCount: 30 }).generate(n);
      expect(moves).toHaveLength(30);
      for (const m of moves) {
        expect(m.layer).toBeGreaterThanOrEqual(0);
        expect(m.layer).toBeLessThan(n);
        expect([1, -1]).toContain(m.direction);
        expect(['X', 'Y', 'Z']).toContain(m.axis);
      }
    }
  });

  it('never immediately undoes the previous move', () => {
    for (let n of [3, 7, 50]) {
      const moves = new Scrambler({ moveCount: 120 }).generate(n);
      for (let i = 1; i < moves.length; i++) {
        const a = moves[i - 1];
        const b = moves[i];
        const isInverse = a.axis === b.axis && a.layer === b.layer && a.direction === -b.direction;
        expect(isInverse).toBe(false);
      }
    }
  });

  it('does not repeat the same axis more than twice in a row', () => {
    const moves = new Scrambler({ moveCount: 200 }).generate(6);
    expect(axesRunLength(moves)).toBeLessThanOrEqual(2);
  });

  it('really changes the state of the cube', () => {
    for (const n of [2, 3, 5, 10]) {
      const cube = CubeState.createSolved(n);
      const moves = new Scrambler({ moveCount: defaultScrambleCount(n) }).generate(n);
      cube.applyMoves(moves);
      expect(cube.isSolved()).toBe(false);
    }
  });

  it('scramble + inverse sequence restores the cube', () => {
    for (const n of [3, 4, 5, 10]) {
      const cube = CubeState.createSolved(n);
      const moves = new Scrambler({ moveCount: 40 }).generate(n);
      cube.applyMoves(moves);
      cube.applyMoves(CubeState.inverseMoves(moves));
      expect(cube.isSolved()).toBe(true);
    }
  });
});

describe('scramble length config', () => {
  it('scales scramble moves with cube size', () => {
    // New formula: max(MIN_SCRAMBLE_MOVES, round(SCRAMBLE_FACTOR * N))
    // MIN_SCRAMBLE_MOVES = 20, SCRAMBLE_FACTOR = 2
    expect(defaultScrambleCount(2)).toBe(20);  // max(20, 4) = 20
    expect(defaultScrambleCount(3)).toBe(20);  // max(20, 6) = 20
    expect(defaultScrambleCount(10)).toBe(20); // max(20, 20) = 20
    expect(defaultScrambleCount(100)).toBe(200); // round(200) = 200
    expect(defaultScrambleCount(1000)).toBe(2000); // round(2000) = 2000
    expect(defaultScrambleCount(1000)).toBeGreaterThan(defaultScrambleCount(100));
  });

  it('clamps the requested move count', () => {
    expect(clampScrambleCount(10, 3)).toBe(10);
    expect(clampScrambleCount(0, 3)).toBe(1);
    expect(clampScrambleCount(99999, 3)).toBe(MAX_SCRAMBLE_MOVES);
    expect(clampScrambleCount(NaN, 3)).toBe(defaultScrambleCount(3));
  });
});

describe('scramble layer distribution', () => {
  it('covers multiple layers across all axes for large N', () => {
    const n = 100;
    const count = defaultScrambleCount(n); // 200 moves
    const moves = new Scrambler({ moveCount: count }).generate(n);

    // Check axis distribution
    const axisCounts = { X: 0, Y: 0, Z: 0 };
    for (const m of moves) axisCounts[m.axis]++;
    expect(axisCounts.X).toBeGreaterThan(30);
    expect(axisCounts.Y).toBeGreaterThan(30);
    expect(axisCounts.Z).toBeGreaterThan(30);

    // Check layer coverage per axis
    for (const axis of ['X', 'Y', 'Z'] as const) {
      const layers = new Set<number>();
      for (const m of moves) {
        if (m.axis === axis) layers.add(m.layer);
      }
      // With 200 moves and 3 axes, ~66 moves per axis
      // Should hit many different layers
      expect(layers.size).toBeGreaterThan(20);
    }
  });

  it('covers deep layers for N=1000', () => {
    const n = 1000;
    const count = defaultScrambleCount(n); // 2000 moves
    const moves = new Scrambler({ moveCount: count }).generate(n);

    // Check that we hit layers across the full range
    for (const axis of ['X', 'Y', 'Z'] as const) {
      const layers = new Set<number>();
      for (const m of moves) {
        if (m.axis === axis) layers.add(m.layer);
      }
      // Should cover a significant fraction of 1000 layers
      expect(layers.size).toBeGreaterThan(100);
      
      // Check we hit both shallow and deep layers
      const minLayer = Math.min(...layers);
      const maxLayer = Math.max(...layers);
      expect(minLayer).toBeLessThan(100);  // Near the start
      expect(maxLayer).toBeGreaterThan(900); // Near the end
    }
  });

  it('does not concentrate on outer layers only', () => {
    const n = 100;
    const count = defaultScrambleCount(n);
    const moves = new Scrambler({ moveCount: count }).generate(n);

    const outerLayers = new Set<number>();
    const innerLayers = new Set<number>();
    
    for (const m of moves) {
      if (m.layer === 0 || m.layer === n - 1) {
        outerLayers.add(m.layer);
      } else {
        innerLayers.add(m.layer);
      }
    }

    // Should have many more inner layers than just outer
    expect(innerLayers.size).toBeGreaterThan(outerLayers.size * 2);
  });
});
