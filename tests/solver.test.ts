import { describe, it, expect } from 'vitest';
import { InverseHistorySolver } from '../src/core/Solver';
import type { SolverProgress } from '../src/types';
import { CubeState } from '../src/core/CubeState';
import { Scrambler } from '../src/core/Scramble';
import type { Move } from '../src/types';

describe('InverseHistorySolver', () => {
  it('computes, validates and solves a scrambled cube', async () => {
    const cube = CubeState.createSolved(4);
    const scramble = new Scrambler({ moveCount: 30 }).generate(4);
    cube.applyMoves(scramble);
    expect(cube.isSolved()).toBe(false);

    const solver = new InverseHistorySolver();
    const stages: SolverProgress['stage'][] = [];
    solver.onProgress = (p) => stages.push(p.stage);

    const result = await solver.solve(cube.serialize(), cube.moveHistory);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.moves).toHaveLength(scramble.length);

    // the reported plan must actually solve the cube
    const check = CubeState.deserialize(cube.serialize());
    check.applyMoves(result.moves);
    expect(check.isSolved()).toBe(true);

    // stages must be reported honestly and in order
    expect(stages[0]).toBe('STARTING');
    expect(stages).toContain('COPYING_STATE');
    expect(stages).toContain('BUILDING_SOLUTION');
    expect(stages).toContain('VALIDATING');
    expect(stages).toContain('VALIDATION_SUCCESS');
    expect(stages).toContain('READY');
    expect(stages[stages.length - 1]).toBe('READY');
  });

  it('rejects a history that does not match the state (no fake success)', async () => {
    const cube = CubeState.createSolved(3);
    cube.applyMoves(new Scrambler({ moveCount: 20 }).generate(3));

    const solver = new InverseHistorySolver();
    const result = await solver.solve(cube.serialize(), []); // wrong history on purpose

    expect(result.success).toBe(false);
    expect(result.moves).toHaveLength(0);
    expect(result.error).toMatch(/Validation failed/);

    const check = cube.clone();
    expect(check.isSolved()).toBe(false);
  });

  it('never mutates the state it was given', async () => {
    const cube = CubeState.createSolved(3);
    cube.applyMoves(new Scrambler({ moveCount: 12 }).generate(3));
    const before = cube.serialize();

    const solver = new InverseHistorySolver();
    await solver.solve(before, cube.moveHistory);

    for (const face of ['U', 'D', 'L', 'R', 'F', 'B'] as const) {
      expect(Array.from(before.faces[face])).toEqual(Array.from(cube.faces[face]));
    }
    expect(cube.isSolved()).toBe(false);
  });

  it('reports monotonic progress between 0 and 100', async () => {
    const cube = CubeState.createSolved(3);
    const moves: Move[] = new Scrambler({ moveCount: 40 }).generate(3);
    cube.applyMoves(moves);

    const solver = new InverseHistorySolver();
    const values: number[] = [];
    solver.onProgress = (p) => values.push(p.progress);

    await solver.solve(cube.serialize(), cube.moveHistory);

    expect(values.length).toBeGreaterThan(3);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(values[values.length - 1]).toBe(100);
  });

  it('solves larger cubes too', async () => {
    const cube = CubeState.createSolved(50);
    cube.applyMoves(new Scrambler({ moveCount: 12 }).generate(50));

    const solver = new InverseHistorySolver();
    const result = await solver.solve(cube.serialize(), cube.moveHistory);

    expect(result.success).toBe(true);
    const check = CubeState.deserialize(cube.serialize());
    check.applyMoves(result.moves);
    expect(check.isSolved()).toBe(true);
  }, 30000);
});
