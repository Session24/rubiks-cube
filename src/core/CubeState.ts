/**
 * Core Cube State Module
 * 
 * Stores cube state as 6 faces of N×N Uint8Arrays.
 * Each cell stores a color index 0-5.
 * No 3D objects, no N³ storage - only 6×N² bytes.
 *
 * The (col, row) → (i, j, k) orientation of every face is documented in
 * ./geometry.ts and is shared with the renderer, so a sticker drawn on screen and
 * the sticker moved by applyMove are always the same one.
 */

import type { 
  CubeStateData, 
  Move, 
  Direction, 
  FaceName,
} from '../types';

import {
  AXIS_INDEX,
  FACE_DEFS,
  FACE_NAMES,
  faceCellCoords,
  faceCol,
  faceRow,
  faceTouchesLayer,
  inverseMove as geometryInverseMove,
  inverseMoves as geometryInverseMoves,
  rotateCoords,
  rotateFaceNormal,
  faceForNormal,
} from './geometry';
import type { AxisIndex, FaceDef } from './geometry';

export class CubeState {
  public readonly size: number;
  public readonly faces: {
    U: Uint8Array;
    D: Uint8Array;
    L: Uint8Array;
    R: Uint8Array;
    F: Uint8Array;
    B: Uint8Array;
  };
  public moveHistory: Move[] = [];

  private readonly faceNames: FaceName[] = ['U', 'D', 'L', 'R', 'F', 'B'];

  /** Reusable destination buffer so applyMove never allocates after the first call. */
  private readonly scratch: Record<FaceName, Uint8Array>;
  /** Reusable coordinate triplet for the hot loop. */
  private readonly coordBuf = new Int32Array(3);

  constructor(size: number) {
    if (size < 2) throw new Error('Cube size must be at least 2');
    this.size = size;
    this.faces = {
      U: new Uint8Array(size * size),
      D: new Uint8Array(size * size),
      L: new Uint8Array(size * size),
      R: new Uint8Array(size * size),
      F: new Uint8Array(size * size),
      B: new Uint8Array(size * size),
    };
    this.scratch = {
      U: new Uint8Array(size * size),
      D: new Uint8Array(size * size),
      L: new Uint8Array(size * size),
      R: new Uint8Array(size * size),
      F: new Uint8Array(size * size),
      B: new Uint8Array(size * size),
    };
    this.reset();
  }

  /**
   * Create a solved cube of given size
   */
  static createSolved(size: number): CubeState {
    return new CubeState(size);
  }

  /**
   * Reset to solved state
   */
  reset(): void {
    // Fill each face with its color index
    for (const face of this.faceNames) {
      this.faces[face].fill(FACE_DEFS[face].color);
    }
    this.moveHistory = [];
  }

  /**
   * Clone the cube state
   */
  clone(): CubeState {
    const cloned = new CubeState(this.size);
    for (const face of this.faceNames) {
      cloned.faces[face].set(this.faces[face]);
    }
    cloned.moveHistory = [...this.moveHistory];
    return cloned;
  }

  /**
   * Get cell value at (row, col) on a face
   */
  get(face: FaceName, row: number, col: number): number {
    return this.faces[face][row * this.size + col];
  }

  /**
   * Set cell value at (row, col) on a face
   */
  set(face: FaceName, row: number, col: number, value: number): void {
    this.faces[face][row * this.size + col] = value;
  }

  /**
   * Get entire row from a face
   */
  getRow(face: FaceName, row: number): Uint8Array {
    const start = row * this.size;
    return this.faces[face].slice(start, start + this.size);
  }

  /**
   * Set entire row on a face
   */
  setRow(face: FaceName, row: number, data: Uint8Array): void {
    const start = row * this.size;
    this.faces[face].set(data, start);
  }

  /**
   * Get entire column from a face
   */
  getCol(face: FaceName, col: number): Uint8Array {
    const result = new Uint8Array(this.size);
    for (let row = 0; row < this.size; row++) {
      result[row] = this.faces[face][row * this.size + col];
    }
    return result;
  }

  /**
   * Set entire column on a face
   */
  setCol(face: FaceName, col: number, data: Uint8Array): void {
    for (let row = 0; row < this.size; row++) {
      this.faces[face][row * this.size + col] = data[row];
    }
  }

  /**
   * Rotate a face 90 degrees clockwise (direction = 1) or counter-clockwise (direction = -1)
   */
  rotateFace(face: FaceName, direction: Direction): void {
    const { size } = this;
    const data = this.faces[face];
    const rotated = new Uint8Array(size * size);
    
    if (direction === 1) {
      // Clockwise: new[row][col] = old[size-1-col][row]
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          rotated[row * size + col] = data[(size - 1 - col) * size + row];
        }
      }
    } else {
      // Counter-clockwise: new[row][col] = old[col][size-1-row]
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          rotated[row * size + col] = data[col * size + (size - 1 - row)];
        }
      }
    }
    data.set(rotated);
  }

  /**
   * Apply a single quarter turn of one layer.
   *
   * `layer` is the lattice coordinate along the move axis, counted from 0 (minimum
   * side, e.g. layer 0 on X is the L face) to N-1 (maximum side). Inner layers are
   * handled by exactly the same code path as outer ones.
   *
   * `direction = 1` rotates counter clockwise when looking at the positive end of the
   * axis (right hand rule), `-1` the other way.
   *
   * The slab of cells being turned maps onto itself, so all source values are read
   * from the untouched state while destinations are written into a reusable scratch
   * buffer: no allocation, no aliasing, no N³ storage.
   *
   * Because the rotation is a bijection of the slab onto itself, the set of written
   * cells *is* the intersection of the slab with the surface - so only those cells
   * have to be copied back. Copying whole N² faces here would cost O(N²) per move
   * and made an instant 2000-move scramble of a 1000³ cube take ~1.6 s.
   */
  applyMove(move: Move): void {
    const n = this.size;
    const axis: AxisIndex = AXIS_INDEX[move.axis];
    const layer = move.layer;
    const dir: 1 | -1 = move.direction;

    if (!Number.isInteger(layer) || layer < 0 || layer >= n) {
      throw new Error(`Layer ${layer} out of bounds for size ${n}`);
    }

    const affected: FaceName[] = [];
    for (const name of FACE_NAMES) {
      if (faceTouchesLayer(FACE_DEFS[name], axis, layer, n)) affected.push(name);
    }

    for (const name of affected) {
      const def = FACE_DEFS[name];
      const src = this.faces[name];
      // Every cell of one face moves onto the same target face, so this is computed
      // once per face: rotateFaceNormal allocates, and doing it per cell made an
      // N=1000 batch scramble allocate millions of short lived objects.
      const targetDef = this.targetFace(def, axis, dir);

      if (def.fixedAxis === axis) {
        // The whole face lies inside the slab (outer layers only).
        for (let row = 0; row < n; row++) {
          const base = row * n;
          for (let col = 0; col < n; col++) {
            this.moveCell(def, targetDef, col, row, src[base + col], axis, dir, n);
          }
        }
      } else if (def.uAxis === axis) {
        // The slab crosses this face as a vertical strip (one column).
        const col = def.uSign > 0 ? layer : n - 1 - layer;
        for (let row = 0; row < n; row++) {
          this.moveCell(def, targetDef, col, row, src[row * n + col], axis, dir, n);
        }
      } else {
        // The slab crosses this face as a horizontal strip (one row).
        const row = def.vSign > 0 ? layer : n - 1 - layer;
        const base = row * n;
        for (let col = 0; col < n; col++) {
          this.moveCell(def, targetDef, col, row, src[base + col], axis, dir, n);
        }
      }
    }

    // Copy back only the slab's own cells (see the note above).
    for (const name of affected) {
      const def = FACE_DEFS[name];
      const face = this.faces[name];
      const dest = this.scratch[name];

      if (def.fixedAxis === axis) {
        // Cap face: the whole face lies in the slab (outer layer only).
        face.set(dest);
      } else if (def.uAxis === axis) {
        // The slab crosses this face as a vertical strip (one column).
        const col = def.uSign > 0 ? layer : n - 1 - layer;
        for (let row = 0; row < n; row++) face[row * n + col] = dest[row * n + col];
      } else {
        // The slab crosses this face as a horizontal strip (one row).
        const row = def.vSign > 0 ? layer : n - 1 - layer;
        const base = row * n;
        for (let col = 0; col < n; col++) face[base + col] = dest[base + col];
      }
    }

    this.moveHistory.push({ ...move });
  }

  /**
   * Move one sticker from `def(col,row)` to its rotated position.
   * Reads from the pristine state, writes into `this.scratch`.
   */
  private moveCell(
    def: FaceDef,
    col: number,
    row: number,
    value: number,
    axis: AxisIndex,
    dir: 1 | -1,
    n: number,
  ): void {
    const coords = this.coordBuf;
    faceCellCoords(def, col, row, n, coords);
    rotateCoords(coords, axis, dir, n);

    const normal = rotateFaceNormal(def, axis, dir);
    const target = faceForNormal(normal.axis, normal.max);
    const targetDef = FACE_DEFS[target];
    this.scratch[target][faceRow(targetDef, coords, n) * n + faceCol(targetDef, coords, n)] = value;
  }

  /**
   * Apply multiple moves in sequence
   */
  applyMoves(moves: Move[]): void {
    for (const move of moves) {
      this.applyMove(move);
    }
  }

  /**
   * Check if cube is solved
   */
  isSolved(): boolean {
    for (const face of this.faceNames) {
      const expectedColor = FACE_DEFS[face].color;
      const data = this.faces[face];
      for (let i = 0; i < data.length; i++) {
        if (data[i] !== expectedColor) return false;
      }
    }
    return true;
  }

  /**
   * Serialize state to JSON-serializable object
   */
  serialize(): CubeStateData {
    const data: CubeStateData = {
      size: this.size,
      faces: {
        U: new Uint8Array(this.faces.U),
        D: new Uint8Array(this.faces.D),
        L: new Uint8Array(this.faces.L),
        R: new Uint8Array(this.faces.R),
        F: new Uint8Array(this.faces.F),
        B: new Uint8Array(this.faces.B),
      },
      moveHistory: [...this.moveHistory],
    };
    return data;
  }

  /**
   * Deserialize from serialized data
   */
  static deserialize(data: CubeStateData): CubeState {
    const cube = new CubeState(data.size);
    for (const face of ['U', 'D', 'L', 'R', 'F', 'B'] as FaceName[]) {
      cube.faces[face].set(data.faces[face]);
    }
    cube.moveHistory = data.moveHistory.map(m => ({ ...m }));
    return cube;
  }

  /**
   * Get inverse of a move
   */
  static inverseMove(move: Move): Move {
    return geometryInverseMove(move);
  }

  /**
   * Get inverse sequence of moves
   */
  static inverseMoves(moves: Move[]): Move[] {
    return geometryInverseMoves(moves);
  }
}
