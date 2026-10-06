import { describe, it, expect } from 'vitest';
import {
  HOLE_EPSILON_CELLS,
  SLAB_FACES,
  buildHideRegions,
  buildSlabQuads,
  buildStaticFaceQuads,
  facesAffectedByMove,
  isOuterCap,
  slabBounds,
} from '../src/render/faceGeometry';
import type { FaceQuad, HideRegion } from '../src/render/faceGeometry';
import { FACE_NAMES, AXIS_INDEX } from '../src/core/geometry';
import type { Axis, FaceName, Move } from '../src/types';

const EPS = HOLE_EPSILON_CELLS + 1e-9;

function hide(faces: HideRegion[], face: FaceName): HideRegion {
  const region = faces.find((r) => r.face === face);
  if (!region) throw new Error(`no hide region for ${face}`);
  return region;
}

function quadFace(quads: FaceQuad[], face: FaceName): FaceQuad {
  const quad = quads.find((q) => q.face === face);
  if (!quad) throw new Error(`no slab quad for ${face}`);
  return quad;
}

function uvRect(quad: FaceQuad): { u0: number; u1: number; v0: number; v1: number } {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < 4; i++) {
    u0 = Math.min(u0, quad.uv[i * 2]);
    u1 = Math.max(u1, quad.uv[i * 2]);
    v0 = Math.min(v0, quad.uv[i * 2 + 1]);
    v1 = Math.max(v1, quad.uv[i * 2 + 1]);
  }
  return { u0, u1, v0, v1 };
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Hand written expectations: for every axis, which UV axis a face's strip runs
 * along and whether that axis is mirrored on that face.
 * Derived from the cube net in src/core/geometry.ts - not from the implementation.
 */
type StripSpec = { face: FaceName; axis: 0 | 1; mirror: boolean };

const STRIPS: Record<Axis, StripSpec[]> = {
  X: [
    { face: 'U', axis: 0, mirror: false },
    { face: 'D', axis: 0, mirror: false },
    { face: 'F', axis: 0, mirror: false },
    { face: 'B', axis: 0, mirror: true },
  ],
  Y: [
    { face: 'F', axis: 1, mirror: true },
    { face: 'R', axis: 1, mirror: true },
    { face: 'B', axis: 1, mirror: true },
    { face: 'L', axis: 1, mirror: true },
  ],
  Z: [
    { face: 'U', axis: 1, mirror: false },
    { face: 'D', axis: 1, mirror: true },
    { face: 'L', axis: 0, mirror: false },
    { face: 'R', axis: 0, mirror: true },
  ],
};

/** Hidden cell range of one strip: [uvAxis, loCells, hiCells]. */
function expectedRange(spec: StripSpec, layer: number, n: number): [number, number, number] {
  return [spec.axis, spec.mirror ? n - layer - 1 : layer, spec.mirror ? n - layer : layer + 1];
}

function stripFaces(axis: Axis): FaceName[] {
  return STRIPS[axis].map((s) => s.face);
}

/** Faces perpendicular to the axis - they are hidden entirely on the outer layers. */
function perpendicularFaces(axis: Axis): [FaceName, FaceName] {
  if (axis === 'X') return ['L', 'R'];
  if (axis === 'Y') return ['D', 'U'];
  return ['B', 'F'];
}

describe('static face quads', () => {
  it('covers the unit cube surface with correct UVs and outward normals', () => {
    const quads = buildStaticFaceQuads();
    expect(quads.map((q) => q.face)).toEqual([...FACE_NAMES]);

    for (const quad of quads) {
      const rect = uvRect(quad);
      expect(rect.u0).toBeCloseTo(0, 10);
      expect(rect.u1).toBeCloseTo(1, 10);
      expect(rect.v0).toBeCloseTo(0, 10);
      expect(rect.v1).toBeCloseTo(1, 10);

      const p = [
        [quad.position[0], quad.position[1], quad.position[2]],
        [quad.position[3], quad.position[4], quad.position[5]],
        [quad.position[6], quad.position[7], quad.position[8]],
      ];
      const e1 = p[1].map((v, i) => v - p[0][i]);
      const e2 = p[2].map((v, i) => v - p[1][i]);
      const normal = cross(e1, e2);
      expect(normal[0]).toBeCloseTo(quad.normal[0], 6);
      expect(normal[1]).toBeCloseTo(quad.normal[1], 6);
      expect(normal[2]).toBeCloseTo(quad.normal[2], 6);

      // the face lies on its own plane of the unit cube
      const axis = quad.normal.findIndex((v) => v !== 0);
      const sign = Math.sign(quad.normal[axis]);
      for (let i = 0; i < 4; i++) {
        expect(quad.position[i * 3 + axis]).toBeCloseTo(0.5 * sign, 10);
      }
    }
  });
});

describe('moving slab geometry', () => {
  const axes: Axis[] = ['X', 'Y', 'Z'];

  it.each([3, 4, 10, 100])('produces exactly 6 quads for N=%i', (n) => {
    for (const axis of axes) {
      for (const layer of [0, Math.floor(n / 2), n - 1]) {
        for (const direction of [1, -1] as const) {
          const move: Move = { axis, layer, direction };
          const quads = buildSlabQuads(n, move);
          expect(quads).toHaveLength(6);
          expect(quads.map((q) => q.face).slice().sort()).toEqual([...FACE_NAMES].sort());
          expect(SLAB_FACES).toHaveLength(6);
        }
      }
    }
  });

  it.each([3, 4, 10, 100])('strip quads line up with the hidden region for N=%i', (n) => {
    for (const axis of axes) {
      const layers = n === 2 ? [0, 1] : [0, Math.floor(n / 2), n - 1];
      for (const layer of layers) {
        const move: Move = { axis, layer, direction: 1 };
        const regions = buildHideRegions(n, move);
        const quads = buildSlabQuads(n, move);

        for (const spec of STRIPS[axis]) {
          const [axisIdx, lo, hi] = expectedRange(spec, layer, n);
          const region = hide(regions, spec.face);
          expect(region.mode).toBe('range');
          expect(region.axis).toBe(axisIdx);
          // hidden range must contain the strip, only widened by the epsilon
          expect(region.min).toBeLessThanOrEqual(lo + 1e-9);
          expect(region.max).toBeGreaterThanOrEqual(hi - 1e-9);
          expect(region.min).toBeGreaterThanOrEqual(lo - EPS);
          expect(region.max).toBeLessThanOrEqual(hi + EPS);

          // the moving strip samples exactly that region of the face texture
          const rect = uvRect(quadFace(quads, spec.face));
          const along = axisIdx === 0 ? [rect.u0 * n, rect.u1 * n] : [rect.v0 * n, rect.v1 * n];
          // UVs are stored as float32, so allow ~1e-4 cells of rounding noise
          expect(Math.abs(along[0] - lo)).toBeLessThan(1e-4);
          expect(Math.abs(along[1] - hi)).toBeLessThan(1e-4);

          // the other direction spans the whole face
          const across = axisIdx === 0 ? [rect.v0, rect.v1] : [rect.u0, rect.u1];
          expect(across[0]).toBeCloseTo(0, 6);
          expect(across[1]).toBeCloseTo(1, 6);
        }
      }
    }
  });

  it.each([3, 4, 10])('hides the outer face entirely on outer layers only (N=%i)', (n) => {
    for (const axis of axes) {
      const [lowFace, highFace] = perpendicularFaces(axis);
      const outerLow: Move = { axis, layer: 0, direction: 1 };
      const outerHigh: Move = { axis, layer: n - 1, direction: 1 };
      const innerLayer = Math.floor(n / 2);
      const inner: Move | null = n > 2 ? { axis, layer: innerLayer, direction: 1 } : null;

      expect(hide(buildHideRegions(n, outerLow), lowFace).mode).toBe('all');
      expect(hide(buildHideRegions(n, outerLow), highFace).mode).toBe('none');
      expect(hide(buildHideRegions(n, outerHigh), highFace).mode).toBe('all');
      expect(hide(buildHideRegions(n, outerHigh), lowFace).mode).toBe('none');

      if (inner) {
        const regions = buildHideRegions(n, inner);
        expect(hide(regions, lowFace).mode).toBe('none');
        expect(hide(regions, highFace).mode).toBe('none');
        expect(isOuterCap(n, inner, -1)).toBe(false);
        expect(isOuterCap(n, inner, 1)).toBe(false);
      }

      expect(isOuterCap(n, outerLow, -1)).toBe(true);
      expect(isOuterCap(n, outerLow, 1)).toBe(false);
      expect(isOuterCap(n, outerHigh, 1)).toBe(true);
      expect(isOuterCap(n, outerHigh, -1)).toBe(false);
    }
  });

  it('places the slab inside the layer bounds and rotates around its centre', () => {
    const n = 7;
    for (const axis of ['X', 'Y', 'Z'] as Axis[]) {
      for (const layer of [0, 3, 6]) {
        const move: Move = { axis, layer, direction: -1 };
        const bounds = slabBounds(n, move);
        const axisIdx = AXIS_INDEX[axis];
        const thickness = 1 / n;
        expect(bounds.max - bounds.min).toBeCloseTo(thickness, 10);
        expect(bounds.center).toBeCloseTo(-0.5 + (layer + 0.5) / n, 10);

        const quads = buildSlabQuads(n, move);
        for (const quad of quads) {
          for (let v = 0; v < 4; v++) {
            // quads are returned in world space: nothing may leave the cube
            for (let c = 0; c < 3; c++) {
              expect(Math.abs(quad.position[v * 3 + c])).toBeLessThanOrEqual(0.5 + 1e-9);
            }
            // the coordinate along the rotation axis must be inside the slab
            // (positions are float32, hence the 1e-6 tolerance)
            const along = quad.position[v * 3 + axisIdx];
            expect(along).toBeGreaterThanOrEqual(bounds.min - 1e-6);
            expect(along).toBeLessThanOrEqual(bounds.max + 1e-6);
          }
        }
      }
    }
  });

  it('winds every slab quad counter clockwise seen from outside', () => {
    const n = 5;
    const quads = buildSlabQuads(n, { axis: 'X', layer: 2, direction: 1 });
    for (const quad of quads) {
      const p = (i: number) => [quad.position[i * 3], quad.position[i * 3 + 1], quad.position[i * 3 + 2]];
      const e1 = p(1).map((v, i) => v - p(0)[i]);
      const e2 = p(2).map((v, i) => v - p(1)[i]);
      const raw = cross(e1, e2);
      const length = Math.hypot(raw[0], raw[1], raw[2]);
      expect(length).toBeGreaterThan(1e-6);
      // slab quads are not square, so compare the normalised normal
      const normal = raw.map((v) => v / length);
      expect(normal[0]).toBeCloseTo(quad.normal[0], 6);
      expect(normal[1]).toBeCloseTo(quad.normal[1], 6);
      expect(normal[2]).toBeCloseTo(quad.normal[2], 6);
    }
  });
});

describe('faces affected by a move', () => {
  it('reports exactly the faces the layer touches', () => {
    const n = 5;
    expect(facesAffectedByMove(n, { axis: 'X', layer: 2, direction: 1 }).sort()).toEqual(['B', 'D', 'F', 'U']);
    expect(facesAffectedByMove(n, { axis: 'X', layer: 0, direction: 1 }).sort()).toEqual([
      'B', 'D', 'F', 'L', 'U',
    ]);
    expect(facesAffectedByMove(n, { axis: 'Y', layer: 4, direction: 1 }).sort()).toEqual([
      'B', 'F', 'L', 'R', 'U',
    ]);
    expect(facesAffectedByMove(n, { axis: 'Z', layer: 0, direction: 1 }).sort()).toEqual([
      'B', 'D', 'L', 'R', 'U',
    ]);
  });
});
