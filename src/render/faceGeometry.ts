/**
 * Pure geometry for the scalable renderer.
 *
 * The cube surface is always drawn with 6 static quads (one per face) plus at most
 * one moving "slab" made of 6 more quads - a constant amount of geometry no matter
 * whether N is 3 or 1000.
 *
 * World space is the unit cube [-0.5, 0.5]³. Face UVs are the *global* UVs of the
 * owning face (0..1), so a strip quad samples exactly the region of the face
 * texture that the static face hides while the strip is in flight.
 */

import { AXIS_INDEX, FACE_BY_AXIS, FACE_DEFS, FACE_NAMES, faceTouchesLayer } from '../core/geometry';
import type { AxisIndex, FaceDef } from '../core/geometry';
import type { FaceName, Move } from '../types';

export type HideMode = 'none' | 'all' | 'range';

export interface FaceQuad {
  face: FaceName;
  /** 4 corners × 3 floats, world space, wound counter clockwise seen from outside */
  position: Float32Array;
  /** 4 uv pairs, global UV of `face` */
  uv: Float32Array;
  /** outward normal */
  normal: [number, number, number];
}

export interface HideRegion {
  face: FaceName;
  mode: HideMode;
  /** 0 = columns (u), 1 = rows (v), in cell units 0..N */
  axis: 0 | 1;
  min: number;
  max: number;
}

export interface SlabBounds {
  axis: AxisIndex;
  min: number;
  max: number;
  center: number;
}

/** The slab's six sides, material index = index in this list. */
export const SLAB_FACES: readonly FaceName[] = ['R', 'L', 'U', 'D', 'F', 'B'];
/** Matching outward directions: +X, -X, +Y, -Y, +Z, -Z. */
export const SLAB_DIRECTIONS: readonly (readonly [AxisIndex, 1 | -1])[] = [
  [0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1],
];

/** How much wider the hidden region is than the slab, in cells (avoids a stale sliver). */
export const HOLE_EPSILON_CELLS = 0.01;

export function slabBounds(n: number, move: Move): SlabBounds {
  const axis = AXIS_INDEX[move.axis];
  const thickness = 1 / n;
  const min = -0.5 + move.layer * thickness;
  const max = min + thickness;
  return { axis, min, max, center: (min + max) / 2 };
}

/** Face parameter (0..1 across the face) of a world coordinate along `axis`. */
function paramOfWorld(def: FaceDef, axis: AxisIndex, w: number): number {
  const sign = axis === def.uAxis ? def.uSign : def.vSign;
  return sign > 0 ? w + 0.5 : 0.5 - w;
}

/**
 * `fixedOverride` moves the quad along the face's own normal. It is only needed for
 * the slab's inner end caps, which lie on a cut plane inside the cube rather than
 * on the cube surface.
 */
function buildQuad(
  def: FaceDef,
  uWorld: readonly [number, number],
  vWorld: readonly [number, number],
  fixedOverride?: number,
): FaceQuad {
  const [ua, ub] = uWorld[0] <= uWorld[1] ? uWorld : [uWorld[1], uWorld[0]];
  const [va, vb] = vWorld[0] <= vWorld[1] ? vWorld : [vWorld[1], vWorld[0]];

  // order corners by *face parameter* so the winding is CCW seen from outside
  const pU0 = paramOfWorld(def, def.uAxis, ua);
  const pU1 = paramOfWorld(def, def.uAxis, ub);
  const pV0 = paramOfWorld(def, def.vAxis, va);
  const pV1 = paramOfWorld(def, def.vAxis, vb);

  const uMinWorld = def.uSign > 0 ? ua : ub;
  const uMaxWorld = def.uSign > 0 ? ub : ua;
  const vMinWorld = def.vSign > 0 ? va : vb;
  const vMaxWorld = def.vSign > 0 ? vb : va;

  const uMin = Math.min(pU0, pU1);
  const uMax = Math.max(pU0, pU1);
  const vMin = Math.min(pV0, pV1);
  const vMax = Math.max(pV0, pV1);

  const position = new Float32Array(12);
  const uv = new Float32Array(8);
  const corners: readonly (readonly [number, number])[] = [
    [uMinWorld, vMinWorld],
    [uMinWorld, vMaxWorld],
    [uMaxWorld, vMaxWorld],
    [uMaxWorld, vMinWorld],
  ];
  const uvs: readonly (readonly [number, number])[] = [
    [uMin, vMin],
    [uMin, vMax],
    [uMax, vMax],
    [uMax, vMin],
  ];
  const fixed = fixedOverride ?? (def.fixedMax ? 0.5 : -0.5);

  for (let i = 0; i < 4; i++) {
    const p = [0, 0, 0];
    p[def.uAxis] = corners[i][0];
    p[def.vAxis] = corners[i][1];
    p[def.fixedAxis] = fixed;
    position[i * 3] = p[0];
    position[i * 3 + 1] = p[1];
    position[i * 3 + 2] = p[2];
    uv[i * 2] = uvs[i][0];
    uv[i * 2 + 1] = uvs[i][1];
  }

  const normal: [number, number, number] = [0, 0, 0];
  normal[def.fixedAxis] = def.fixedMax ? 1 : -1;

  return { face: def.name, position, uv, normal };
}

/** The six static face planes of the cube. */
export function buildStaticFaceQuads(): FaceQuad[] {
  return FACE_NAMES.map((name) => {
    const def = FACE_DEFS[name];
    return buildQuad(def, [-0.5, 0.5], [-0.5, 0.5]);
  });
}

/**
 * The moving slab: six quads in SLAB_FACES order.
 * Side quads are strips of the four faces whose plane contains the rotation axis;
 * the two end caps are full faces when the layer is an outer one and plain
 * dark interior surfaces when it is an inner layer.
 */
export function buildSlabQuads(n: number, move: Move): FaceQuad[] {
  const bounds = slabBounds(n, move);
  const quads: FaceQuad[] = [];

  for (let i = 0; i < SLAB_DIRECTIONS.length; i++) {
    const [dirAxis, dirSign] = SLAB_DIRECTIONS[i];
    const def = FACE_DEFS[FACE_BY_AXIS[dirAxis][dirSign > 0 ? 1 : 0]];

    if (dirAxis === bounds.axis) {
      // end cap: perpendicular to the rotation axis. One side of the slab is the
      // cube's own outer face (when the layer is an outer one), the other side is a
      // cut plane inside the cube - both are positioned at the slab bounds, never at
      // the far side of the cube.
      const fixed = dirSign > 0 ? bounds.max : bounds.min;
      quads.push(buildQuad(def, [-0.5, 0.5], [-0.5, 0.5], fixed));
      continue;
    }

    const uRange: [number, number] = def.uAxis === bounds.axis ? [bounds.min, bounds.max] : [-0.5, 0.5];
    const vRange: [number, number] = def.vAxis === bounds.axis ? [bounds.min, bounds.max] : [-0.5, 0.5];
    quads.push(buildQuad(def, uRange, vRange));
  }

  return quads;
}

/** True when the end cap at `dirSign` actually carries stickers. */
export function isOuterCap(n: number, move: Move, dirSign: 1 | -1): boolean {
  const axis = AXIS_INDEX[move.axis];
  const def = FACE_DEFS[FACE_BY_AXIS[axis][dirSign > 0 ? 1 : 0]];
  return (def.fixedMax ? n - 1 : 0) === move.layer;
}

/** For each face: which region of it must disappear while the slab is in flight. */
export function buildHideRegions(n: number, move: Move): HideRegion[] {
  const bounds = slabBounds(n, move);
  const regions: HideRegion[] = [];

  for (const name of FACE_NAMES) {
    const def = FACE_DEFS[name];

    if (def.fixedAxis === bounds.axis) {
      const coord = def.fixedMax ? n - 1 : 0;
      regions.push({ face: name, mode: coord === move.layer ? 'all' : 'none', axis: 0, min: 0, max: 0 });
      continue;
    }

    const alongAxis: AxisIndex = def.uAxis === bounds.axis ? def.uAxis : def.vAxis;
    const axisIdx: 0 | 1 = alongAxis === def.uAxis ? 0 : 1;
    const p0 = paramOfWorld(def, alongAxis, bounds.min);
    const p1 = paramOfWorld(def, alongAxis, bounds.max);
    const lo = Math.max(0, Math.min(p0, p1) * n - HOLE_EPSILON_CELLS);
    const hi = Math.min(n, Math.max(p0, p1) * n + HOLE_EPSILON_CELLS);
    regions.push({ face: name, mode: 'range', axis: axisIdx, min: lo, max: hi });
  }

  return regions;
}

/** Faces whose texture content changes when `move` is committed. */
export function facesAffectedByMove(n: number, move: Move): FaceName[] {
  const axis = AXIS_INDEX[move.axis];
  return FACE_NAMES.filter((name) => faceTouchesLayer(FACE_DEFS[name], axis, move.layer, n));
}
