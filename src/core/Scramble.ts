/**
 * Scramble Generator
 * 
 * Generates random move sequences for scrambling the cube.
 * Avoids obviously redundant moves (inverse of previous, same axis repetition).
 * Scales move count with cube size and distributes layers across the full depth.
 */

import type { Move, Axis, Direction, ScrambleConfig } from '../types';
import { CubeState } from './CubeState';

export class Scrambler {
  private config: ScrambleConfig;
  private lastMove: Move | null = null;
  private lastAxis: Axis | null = null;
  private sameAxisCount = 0;

  constructor(config: Partial<ScrambleConfig> = {}) {
    this.config = {
      moveCount: config.moveCount ?? 25,
      avoidSameAxis: config.avoidSameAxis ?? true,
      avoidInverse: config.avoidInverse ?? true,
    };
  }

  /**
   * Generate a scramble sequence for a cube of given size
   */
  generate(size: number): Move[] {
    this.lastMove = null;
    this.lastAxis = null;
    this.sameAxisCount = 0;

    const moves: Move[] = [];
    const axes: Axis[] = ['X', 'Y', 'Z'];
    
    for (let i = 0; i < this.config.moveCount; i++) {
      const move = this.generateMove(size, axes);
      moves.push(move);
      this.updateState(move);
    }

    return moves;
  }

  /**
   * Generate a single valid move with good layer distribution
   */
  private generateMove(size: number, axes: Axis[]): Move {
    const maxAttempts = 100;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const axis = this.selectAxis(axes);
      const layer = this.selectLayer(size);
      const direction: Direction = Math.random() < 0.5 ? 1 : -1;

      const move: Move = { axis, layer, direction };

      if (this.isValidMove(move)) {
        return move;
      }
      attempts++;
    }

    // Fallback: just return any valid move
    const axis = axes[Math.floor(Math.random() * axes.length)];
    const layer = this.selectLayer(size);
    const direction: Direction = Math.random() < 0.5 ? 1 : -1;
    return { axis, layer, direction };
  }

  /**
   * Select layer with bias towards covering the full depth of the cube.
   * Uses a stratified approach: divides layers into buckets and picks from
   * under-represented buckets to ensure good coverage for large N.
   */
  private selectLayer(size: number): number {
    // For small cubes, uniform random is fine
    if (size <= 10) {
      return Math.floor(Math.random() * size);
    }

    // For larger cubes, track which layer buckets have been used
    // and bias selection towards less-used buckets
    if (!this.layerBuckets || this.layerBucketSize !== size) {
      this.initializeLayerBuckets(size);
    }

    // Find buckets with minimum usage
    let minCount = Infinity;
    for (const count of this.layerBuckets) {
      if (count < minCount) minCount = count;
    }

    // Collect all buckets at minimum usage
    const candidateBuckets: number[] = [];
    for (let i = 0; i < this.layerBuckets.length; i++) {
      if (this.layerBuckets[i] === minCount) {
        candidateBuckets.push(i);
      }
    }

    // Pick a random candidate bucket
    const bucketIndex = candidateBuckets[Math.floor(Math.random() * candidateBuckets.length)];
    this.layerBuckets[bucketIndex]++;

    // Pick a random layer within that bucket
    const bucketStart = Math.floor((bucketIndex / this.layerBuckets.length) * size);
    const bucketEnd = Math.floor(((bucketIndex + 1) / this.layerBuckets.length) * size);
    const layerRange = Math.max(1, bucketEnd - bucketStart);
    
    return bucketStart + Math.floor(Math.random() * layerRange);
  }

  private layerBuckets: number[] = [];
  private layerBucketSize = 0;

  private initializeLayerBuckets(size: number): void {
    // Use roughly sqrt(N) buckets, capped at a reasonable number
    // This gives good coverage without too much overhead
    const numBuckets = Math.min(Math.max(Math.floor(Math.sqrt(size)), 8), 64);
    this.layerBuckets = new Array(numBuckets).fill(0);
    this.layerBucketSize = size;
  }

  /**
   * Select axis with bias against repeating same axis
   */
  private selectAxis(axes: Axis[]): Axis {
    if (!this.config.avoidSameAxis || this.sameAxisCount < 2 || !this.lastAxis) {
      return axes[Math.floor(Math.random() * axes.length)];
    }

    // Filter out last axis
    const available = axes.filter(a => a !== this.lastAxis);
    return available[Math.floor(Math.random() * available.length)];
  }

  /**
   * Check if move is valid (not inverse of last move, not too many same axis)
   */
  private isValidMove(move: Move): boolean {
    if (this.config.avoidInverse && this.lastMove) {
      if (move.axis === this.lastMove.axis &&
          move.layer === this.lastMove.layer &&
          move.direction === -this.lastMove.direction) {
        return false;
      }
    }

    if (this.config.avoidSameAxis && this.lastAxis === move.axis && this.sameAxisCount >= 3) {
      return false;
    }

    return true;
  }

  /**
   * Update internal state after a move
   */
  private updateState(move: Move): void {
    if (this.lastAxis === move.axis) {
      this.sameAxisCount++;
    } else {
      this.sameAxisCount = 1;
    }
    this.lastAxis = move.axis;
    this.lastMove = move;
  }

  /**
   * Apply scramble to a cube state and return the moves
   */
  scramble(cube: CubeState): Move[] {
    const moves = this.generate(cube.size);
    cube.applyMoves(moves);
    return moves;
  }
}

/**
 * Default number of scramble moves for a given cube size.
 * Scales with N to ensure good coverage of large cubes.
 * Formula: max(MIN_SCRAMBLE_MOVES, round(SCRAMBLE_FACTOR * N))
 * 
 * This ensures:
 * - Small cubes get enough moves for good scrambling
 * - Large cubes get proportionally more moves to cover their volume
 */
export const MIN_SCRAMBLE_MOVES = 20;
export const SCRAMBLE_FACTOR = 2;
export const MAX_SCRAMBLE_MOVES = 5000; // Hard cap for safety

export function defaultScrambleCount(size: number): number {
  const calculated = Math.round(SCRAMBLE_FACTOR * size);
  return Math.max(MIN_SCRAMBLE_MOVES, Math.min(MAX_SCRAMBLE_MOVES, calculated));
}

/**
 * Clamp the requested move count to valid bounds.
 */
export function clampScrambleCount(requested: number, size: number): number {
  const n = Number.isFinite(requested) ? Math.floor(requested) : defaultScrambleCount(size);
  return Math.max(1, Math.min(MAX_SCRAMBLE_MOVES, n));
}

/**
 * Create a scramble with notation for display
 */
export function generateScrambleWithNotation(size: number, moveCount: number = 25): Move[] {
  const scrambler = new Scrambler({ moveCount });
  const moves = scrambler.generate(size);
  
  // Add notation for display
  const axisNotation: Record<string, string> = { X: 'R', Y: 'U', Z: 'F' };
  const layerNotation = (layer: number, size: number) => {
    if (layer === 0) return '';
    if (layer === size - 1) return '';
    return String(layer + 1);
  };

  return moves.map(move => ({
    ...move,
    notation: `${axisNotation[move.axis]}${layerNotation(move.layer, size)}${move.direction === -1 ? "'" : ''}`
  }));
}