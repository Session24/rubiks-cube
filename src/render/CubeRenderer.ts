/**
 * Scalable Three.js renderer for the cube.
 *
 * Draw calls are constant regardless of N:
 *   6 static face quads (colour index lives in an R8 texture, borders are procedural)
 * + 1 dark core box (visible through the hole left by a moving layer)
 * + 1 moving slab (6 quads) that physically rotates around the layer pivot.
 *
 * There is never an N³ (or even N²) object count - N only changes texture size.
 */

import * as THREE from 'three';
import { CubeState } from '../core/CubeState';
import { AXIS_INDEX, FACE_NAMES } from '../core/geometry';
import type { FaceName, Move } from '../types';
import { COLOR_HEX } from '../types';
import {
  SLAB_DIRECTIONS,
  SLAB_FACES,
  buildHideRegions,
  buildSlabQuads,
  buildStaticFaceQuads,
  facesAffectedByMove,
  isOuterCap,
  slabBounds,
} from './faceGeometry';
import { CUBE_FRAGMENT_SHADER, CUBE_VERTEX_SHADER } from './shaders';

type CubeUniforms = {
  uMap: { value: THREE.Texture };
  uN: { value: number };
  uDark: { value: number };
  uHideMode: { value: number };
  uHideAxis: { value: number };
  uHideMin: { value: number };
  uHideMax: { value: number };
  uC0: { value: THREE.Vector3 };
  uC1: { value: THREE.Vector3 };
  uC2: { value: THREE.Vector3 };
  uC3: { value: THREE.Vector3 };
  uC4: { value: THREE.Vector3 };
  uC5: { value: THREE.Vector3 };
  uPlastic: { value: THREE.Vector3 };
};

const AXIS_VECTORS = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const SLAB_VERTEX_COUNT = 6 * 4;

function hexToVector(hex: number): THREE.Vector3 {
  return new THREE.Vector3(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);
}

function createUniforms(n: number): CubeUniforms {
  return {
    uMap: { value: null as unknown as THREE.Texture },
    uN: { value: n },
    uDark: { value: 0 },
    uHideMode: { value: 0 },
    uHideAxis: { value: 0 },
    uHideMin: { value: 0 },
    uHideMax: { value: 0 },
    uC0: { value: hexToVector(COLOR_HEX[0]) },
    uC1: { value: hexToVector(COLOR_HEX[1]) },
    uC2: { value: hexToVector(COLOR_HEX[2]) },
    uC3: { value: hexToVector(COLOR_HEX[3]) },
    uC4: { value: hexToVector(COLOR_HEX[4]) },
    uC5: { value: hexToVector(COLOR_HEX[5]) },
    uPlastic: { value: new THREE.Vector3(0.022, 0.024, 0.03) },
  };
}

export interface RendererDebug {
  mode: string;
  maxTextureSize: number;
  objects: number;
  cellsPerFace: number;
}

export class CubeRenderer {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly maxTextureSize: number;

  private readonly container: HTMLElement;
  private readonly faceMeshes = new Map<FaceName, THREE.Mesh>();
  private readonly faceUniforms = new Map<FaceName, CubeUniforms>();
  private readonly faceTextures = new Map<FaceName, THREE.DataTexture>();
  private readonly slabUniforms: CubeUniforms[] = [];
  private readonly slabPivot = new THREE.Group();
  private readonly slabMesh: THREE.Mesh;
  private readonly slabGeometry: THREE.BufferGeometry;
  private readonly placeholderTexture: THREE.DataTexture;

  private n = 3;
  private activeMove: Move | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.classList.add('canvas');
    container.appendChild(this.renderer.domElement);

    const gl = this.renderer.getContext();
    this.maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    this.camera.position.set(2.1, 1.85, 2.5);

    // 1x1 dummy so every sampler always has a valid texture bound
    this.placeholderTexture = new THREE.DataTexture(
      new Uint8Array([COLOR_HEX[4] & 0xff]),
      1,
      1,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.placeholderTexture.needsUpdate = true;

    // ---- six static faces -------------------------------------------------
    for (const quad of buildStaticFaceQuads()) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(12);
      const normals = new Float32Array(12);
      for (let v = 0; v < 4; v++) {
        positions[v * 3] = quad.position[v * 3];
        positions[v * 3 + 1] = quad.position[v * 3 + 1];
        positions[v * 3 + 2] = quad.position[v * 3 + 2];
        normals[v * 3] = quad.normal[0];
        normals[v * 3 + 1] = quad.normal[1];
        normals[v * 3 + 2] = quad.normal[2];
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(quad.uv), 2));
      geometry.setIndex([0, 1, 2, 0, 2, 3]);

      const uniforms = createUniforms(this.n);
      uniforms.uMap.value = this.placeholderTexture;
      const material = new THREE.ShaderMaterial({
        vertexShader: CUBE_VERTEX_SHADER,
        fragmentShader: CUBE_FRAGMENT_SHADER,
        uniforms,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.faceMeshes.set(quad.face, mesh);
      this.faceUniforms.set(quad.face, uniforms);
    }

    // ---- dark core (shows through the hole of a moving layer) -------------
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.994, 0.994, 0.994),
      new THREE.MeshBasicMaterial({ color: 0x07080c }),
    );
    core.frustumCulled = false;
    this.scene.add(core);

    // ---- moving slab ------------------------------------------------------
    this.slabGeometry = new THREE.BufferGeometry();
    this.slabGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SLAB_VERTEX_COUNT * 3), 3),
    );
    this.slabGeometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(SLAB_VERTEX_COUNT * 3), 3));
    this.slabGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(SLAB_VERTEX_COUNT * 2), 2));
    const indices = new Uint16Array(6 * 6);
    for (let q = 0; q < 6; q++) {
      const base = q * 4;
      const o = q * 6;
      indices[o] = base;
      indices[o + 1] = base + 1;
      indices[o + 2] = base + 2;
      indices[o + 3] = base;
      indices[o + 4] = base + 2;
      indices[o + 5] = base + 3;
      this.slabGeometry.addGroup(o, 6, q);
    }
    this.slabGeometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const slabMaterials: THREE.ShaderMaterial[] = [];
    for (let i = 0; i < 6; i++) {
      const uniforms = createUniforms(this.n);
      uniforms.uMap.value = this.placeholderTexture;
      this.slabUniforms.push(uniforms);
      slabMaterials.push(
        new THREE.ShaderMaterial({
          vertexShader: CUBE_VERTEX_SHADER,
          fragmentShader: CUBE_FRAGMENT_SHADER,
          uniforms,
          side: THREE.DoubleSide,
        }),
      );
    }

    this.slabMesh = new THREE.Mesh(this.slabGeometry, slabMaterials);
    this.slabMesh.frustumCulled = false;
    this.slabPivot.add(this.slabMesh);
    this.slabPivot.visible = false;
    this.scene.add(this.slabPivot);
  }

  /** Rebuild the six colour textures around a (possibly new) cube state. */
  attachState(state: CubeState): void {
    this.n = state.size;
    for (const texture of this.faceTextures.values()) texture.dispose();
    this.faceTextures.clear();

    for (const name of FACE_NAMES) {
      const texture = new THREE.DataTexture(
        state.faces[name],
        this.n,
        this.n,
        THREE.RedFormat,
        THREE.UnsignedByteType,
      );
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.flipY = false;
      texture.unpackAlignment = 1;
      texture.colorSpace = THREE.NoColorSpace;
      texture.needsUpdate = true;
      this.faceTextures.set(name, texture);
      this.faceUniforms.get(name)!.uMap.value = texture;
    }

    for (const name of FACE_NAMES) this.faceUniforms.get(name)!.uN.value = this.n;
    for (const uniforms of this.slabUniforms) uniforms.uN.value = this.n;
    this.endMove();
  }

  /** Re-upload the given faces after the state changed. */
  refreshFaces(faces: readonly FaceName[]): void {
    for (const name of faces) {
      const texture = this.faceTextures.get(name);
      if (texture) texture.needsUpdate = true;
    }
  }

  /** Hide the regions the layer will vacate and build the moving slab. */
  beginMove(move: Move): void {
    this.activeMove = move;

    for (const region of buildHideRegions(this.n, move)) {
      const mesh = this.faceMeshes.get(region.face)!;
      const uniforms = this.faceUniforms.get(region.face)!;
      if (region.mode === 'all') {
        mesh.visible = false;
        uniforms.uHideMode.value = 0;
      } else if (region.mode === 'range') {
        mesh.visible = true;
        uniforms.uHideMode.value = 1;
        uniforms.uHideAxis.value = region.axis;
        uniforms.uHideMin.value = region.min;
        uniforms.uHideMax.value = region.max;
      } else {
        mesh.visible = true;
        uniforms.uHideMode.value = 0;
      }
    }

    const bounds = slabBounds(this.n, move);
    const quads = buildSlabQuads(this.n, move);
    const position = this.slabGeometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = this.slabGeometry.getAttribute('normal') as THREE.BufferAttribute;
    const uv = this.slabGeometry.getAttribute('uv') as THREE.BufferAttribute;

    // pivot sits in the centre of the slab, so quad coordinates become local
    const pivot = [0, 0, 0];
    pivot[bounds.axis] = bounds.center;
    const px = pivot[0];
    const py = pivot[1];
    const pz = pivot[2];

    for (let q = 0; q < quads.length; q++) {
      const quad = quads[q];
      const [dirAxis, dirSign] = SLAB_DIRECTIONS[q];
      const isCap = dirAxis === bounds.axis;
      const dark = isCap && !isOuterCap(this.n, move, dirSign);

      for (let v = 0; v < 4; v++) {
        const index = q * 4 + v;
        position.setXYZ(
          index,
          quad.position[v * 3] - px,
          quad.position[v * 3 + 1] - py,
          quad.position[v * 3 + 2] - pz,
        );
        normal.setXYZ(index, quad.normal[0], quad.normal[1], quad.normal[2]);
        uv.setXY(index, quad.uv[v * 2], quad.uv[v * 2 + 1]);
      }

      this.slabUniforms[q].uMap.value = this.faceTextures.get(quad.face) ?? this.placeholderTexture;
      this.slabUniforms[q].uDark.value = dark ? 1 : 0;
    }

    position.needsUpdate = true;
    normal.needsUpdate = true;
    uv.needsUpdate = true;

    this.slabPivot.position.set(px, py, pz);
    this.slabPivot.quaternion.identity();
    this.slabPivot.visible = true;
  }

  /** Rotate the slab to `angle` radians (signed quarter turn × eased progress). */
  setMoveAngle(angle: number): void {
    if (!this.activeMove) return;
    const axis = AXIS_INDEX[this.activeMove.axis];
    this.slabPivot.quaternion.setFromAxisAngle(AXIS_VECTORS[axis], angle);
  }

  /** Commit visuals: un-hide the static faces and drop the slab. */
  endMove(): void {
    this.activeMove = null;
    this.slabPivot.visible = false;
    this.slabPivot.quaternion.identity();
    for (const name of FACE_NAMES) {
      const mesh = this.faceMeshes.get(name);
      const uniforms = this.faceUniforms.get(name);
      if (mesh) mesh.visible = true;
      if (uniforms) uniforms.uHideMode.value = 0;
    }
  }

  /** Everything that happens when a move finishes: upload the faces it changed. */
  commitMove(move: Move): void {
    this.refreshFaces(facesAffectedByMove(this.n, move));
    this.endMove();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get debugInfo(): RendererDebug {
    return {
      mode: 'procedural: 6 face quads + 1 slab (6 quads)',
      maxTextureSize: this.maxTextureSize,
      objects: this.scene.children.length,
      cellsPerFace: this.n * this.n,
    };
  }

  dispose(): void {
    for (const texture of this.faceTextures.values()) texture.dispose();
    this.faceTextures.clear();
    this.placeholderTexture.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  get size(): number {
    return this.n;
  }
}
