/**
 * Geometric conventions shared by the cube state, the solver and the renderer.
 *
 * Cell lattice
 * ------------
 * The cube is an N×N×N lattice of cells with integer coordinates (i, j, k), 0..N-1:
 *   i -> X  (0 = L face, N-1 = R face)
 *   j -> Y  (0 = D face, N-1 = U face)
 *   k -> Z  (0 = B face, N-1 = F face)
 * World coordinates are normalised to the unit cube [-0.5, 0.5]³:
 *   x = (i + 0.5)/N - 0.5   (and the same for y, z)
 *
 * Face storage
 * ------------
 * Every face is a row-major Uint8Array of N*N colour indices, index = row*N + col.
 * Row 0 is the top of the face as seen from outside the cube, column 0 is the left
 * side of the face seen from outside. All six faces are right handed, i.e.
 *   (direction of increasing column) × (direction of decreasing row) = outward normal
 * which is what makes the six arrays a foldable, non-mirrored cube net:
 *
 *          U (row = k,        col = i)
 *   L           F           R           B
 *   (col=k,     (col=i,      (col=N-1-k, (col=N-1-i,
 *    row=N-1-j)  row=N-1-j)   row=N-1-j)  row=N-1-j)
 *          D (row = N-1-k,   col = i)
 */

import type { Axis, FaceName, Move } from '../types';

export type AxisIndex = 0 | 1 | 2;

export const AXIS_INDEX: Readonly<Record<Axis, AxisIndex>> = { X: 0, Y: 1, Z: 2 };
export const AXIS_NAMES: readonly Axis[] = ['X', 'Y', 'Z'];

export interface FaceDef {
  readonly name: FaceName;
  readonly color: number;
  /** axis on which the face plane is fixed (0 = X, 1 = Y, 2 = Z) */
  readonly fixedAxis: AxisIndex;
  /** true when the face sits at coordinate N-1, false when it sits at 0 */
  readonly fixedMax: boolean;
  /** world axis that the column index runs along */
  readonly uAxis: AxisIndex;
  readonly uSign: 1 | -1;
  /** world axis that the row index runs along (row 0 = top of the face) */
  readonly vAxis: AxisIndex;
  readonly vSign: 1 | -1;
}

export const FACE_DEFS: Readonly<Record<FaceName, FaceDef>> = {
  U: { name: 'U', color: 0, fixedAxis: 1, fixedMax: true, uAxis: 0, uSign: 1, vAxis: 2, vSign: 1 },
  D: { name: 'D', color: 1, fixedAxis: 1, fixedMax: false, uAxis: 0, uSign: 1, vAxis: 2, vSign: -1 },
  L: { name: 'L', color: 2, fixedAxis: 0, fixedMax: false, uAxis: 2, uSign: 1, vAxis: 1, vSign: -1 },
  R: { name: 'R', color: 3, fixedAxis: 0, fixedMax: true, uAxis: 2, uSign: -1, vAxis: 1, vSign: -1 },
  F: { name: 'F', color: 4, fixedAxis: 2, fixedMax: true, uAxis: 0, uSign: 1, vAxis: 1, vSign: -1 },
  B: { name: 'B', color: 5, fixedAxis: 2, fixedMax: false, uAxis: 0, uSign: -1, vAxis: 1, vSign: -1 },
};

export const FACE_NAMES: readonly FaceName[] = ['U', 'D', 'L', 'R', 'F', 'B'];

/** Face sitting at the minimum / maximum end of each axis: [min, max]. */
export const FACE_BY_AXIS: readonly (readonly [FaceName, FaceName])[] = [
  ['L', 'R'],
  ['D', 'U'],
  ['B', 'F'],
];

/** Fill `out` with the (i, j, k) lattice coordinates of face cell (col, row). */
export function faceCellCoords(def: FaceDef, col: number, row: number, n: number, out: Int32Array): void {
  out[def.uAxis] = def.uSign > 0 ? col : n - 1 - col;
  out[def.vAxis] = def.vSign > 0 ? row : n - 1 - row;
  out[def.fixedAxis] = def.fixedMax ? n - 1 : 0;
}

/** Column index of the face cell holding lattice coordinates `coords`. */
export function faceCol(def: FaceDef, coords: Int32Array, n: number): number {
  const c = coords[def.uAxis];
  return def.uSign > 0 ? c : n - 1 - c;
}

/** Row index of the face cell holding lattice coordinates `coords`. */
export function faceRow(def: FaceDef, coords: Int32Array, n: number): number {
  const c = coords[def.vAxis];
  return def.vSign > 0 ? c : n - 1 - c;
}

/**
 * Rotate lattice coordinates of a quarter turn about `axis`.
 * +90° (right hand rule) maps Y→Z, Z→-Y for X, Z→X, X→-Z for Y, X→Y, Y→-X for Z.
 */
export function rotateCoords(coords: Int32Array, axis: AxisIndex, dir: 1 | -1, n: number): void {
  if (axis === 0) {
    const j = coords[1];
    const k = coords[2];
    if (dir > 0) {
      coords[1] = n - 1 - k;
      coords[2] = j;
    } else {
      coords[1] = k;
      coords[2] = n - 1 - j;
    }
  } else if (axis === 1) {
    const i = coords[0];
    const k = coords[2];
    if (dir > 0) {
      coords[0] = k;
      coords[2] = n - 1 - i;
    } else {
      coords[0] = n - 1 - k;
      coords[2] = i;
    }
  } else {
    const i = coords[0];
    const j = coords[1];
    if (dir > 0) {
      coords[0] = n - 1 - j;
      coords[1] = i;
    } else {
      coords[0] = j;
      coords[1] = n - 1 - i;
    }
  }
}

/**
 * Face a sticker moves to when its own face normal is rotated by the same quarter turn.
 * A normal lying on the rotation axis is unchanged (outer layers spin in place).
 */
export function rotateFaceNormal(def: FaceDef, axis: AxisIndex, dir: 1 | -1): { axis: AxisIndex; max: boolean } {
  if (def.fixedAxis === axis) {
    return { axis: def.fixedAxis, max: def.fixedMax };
  }
  const b1 = ((axis + 1) % 3) as AxisIndex;
  const b2 = ((axis + 2) % 3) as AxisIndex;
  const sign = def.fixedMax ? 1 : -1;
  if (def.fixedAxis === b1) {
    return { axis: b2, max: dir > 0 ? sign > 0 : sign < 0 };
  }
  return { axis: b1, max: dir > 0 ? sign < 0 : sign > 0 };
}

export function faceForNormal(axis: AxisIndex, max: boolean): FaceName {
  return FACE_BY_AXIS[axis][max ? 1 : 0];
}

/** Does any cell of this face belong to the slab described by (axis, layer)? */
export function faceTouchesLayer(def: FaceDef, axis: AxisIndex, layer: number, n: number): boolean {
  if (def.fixedAxis !== axis) return true;
  return (def.fixedMax ? n - 1 : 0) === layer;
}

/** Human readable move notation used by the status panel, e.g. "Y+482 ↻". */
export function formatMove(move: Move): string {
  const arrow = move.direction > 0 ? '↻' : '↺';
  const sign = move.direction > 0 ? '+' : '-';
  return `${move.axis}${sign}${move.layer} ${arrow}`;
}

/** Build a move, keeping an optional notation label. */
export function makeMove(axis: Axis, layer: number, direction: 1 | -1, n?: number): Move {
  const move: Move = { axis, layer, direction };
  if (n !== undefined) move.notation = formatMove({ axis, layer, direction });
  return move;
}

export function inverseMove(move: Move): Move {
  return { ...move, direction: move.direction === 1 ? -1 : 1 };
}

export function inverseMoves(moves: Move[]): Move[] {
  const out: Move[] = new Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[moves.length - 1 - i];
    out[i] = { ...m, direction: m.direction === 1 ? -1 : 1 };
  }
  return out;
}
