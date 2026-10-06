/**
 * Orbit camera: drag to rotate, wheel to zoom.
 * The distance is fitted to the (normalised, unit sized) cube for the current
 * viewport and cube size, so a 1000×1000 cube stays fully visible.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class CameraRig {
  private readonly controls: OrbitControls;
  private readonly camera: THREE.PerspectiveCamera;
  private distance = 3;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 0.9;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.15;
    this.controls.maxDistance = 14;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  /** Distance that keeps the whole cube (its circumscribed sphere) in frame. */
  fit(n: number, aspect: number): void {
    const halfDiagonal = Math.sqrt(3) / 2;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const distanceV = halfDiagonal / Math.tan(vFov / 2);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.2));
    const distanceH = halfDiagonal / Math.tan(hFov / 2);
    // slightly farther away for denser cubes, so the sticker grid stays readable
    const margin = 1.22 + 0.07 * Math.log10(Math.max(2, n));
    this.distance = Math.max(distanceV, distanceH) * margin;

    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.8, 1.2);
    direction.setLength(this.distance);
    this.camera.position.copy(this.controls.target).add(direction);
    this.controls.minDistance = Math.max(1.15, this.distance * 0.35);
    this.controls.maxDistance = this.distance * 4;
    this.controls.update();
  }

  update(): void {
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
