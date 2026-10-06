/**
 * Physically animated quarter turns.
 *
 * A move is never applied instantly: `start()` registers the move, every frame
 * advances a normalised clock, and the eased angle is pushed to the renderer via
 * `onFrame`. Only when the angle reaches 90° does `onComplete` fire - that is the
 * moment the cube state is committed.
 *
 * Pausing simply stops advancing the clock, so the layer freezes at whatever
 * angle it currently has and resumes from exactly that angle.
 */

import type { Move } from '../types';

export interface AnimatorHooks {
  onStart?: (move: Move) => void;
  onFrame?: (angle: number) => void;
  onComplete?: (move: Move) => void;
}

/** Duration of one quarter turn at 1x, in milliseconds (unscaled). */
export const BASE_MOVE_MS = 420;

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class MoveAnimator {
  public paused = false;
  public speed = 1;

  private move: Move | null = null;
  private elapsed = 0;
  private resolver: (() => void) | null = null;
  private hooks: AnimatorHooks = {};

  get active(): Move | null {
    return this.move;
  }

  get isAnimating(): boolean {
    return this.move !== null;
  }

  /** Progress of the current quarter turn, 0..1. */
  get progress(): number {
    if (!this.move) return 0;
    return Math.min(1, this.elapsed / BASE_MOVE_MS);
  }

  setHooks(hooks: AnimatorHooks): void {
    this.hooks = hooks;
  }

  /** Begin animating `move`. Resolves once the 90° turn is complete. */
  start(move: Move): Promise<void> {
    if (this.move) return Promise.reject(new Error('Предыдущий ход ещё анимируется'));
    this.move = { ...move };
    this.elapsed = 0;
    this.hooks.onStart?.(this.move);
    return new Promise<void>((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Advance the clock. `dt` is in milliseconds. */
  update(dt: number): void {
    if (!this.move) return;

    if (!this.paused) {
      // clamp so a background tab cannot teleport the layer
      this.elapsed += Math.min(dt, 64) * this.speed;
    }

    const t = Math.min(1, this.elapsed / BASE_MOVE_MS);
    const angle = easeInOutCubic(t) * this.move.direction * (Math.PI / 2);
    this.hooks.onFrame?.(angle);

    if (t >= 1) {
      const finished = this.move;
      const resolve = this.resolver;
      this.move = null;
      this.resolver = null;
      this.hooks.onComplete?.(finished);
      resolve?.();
    }
  }

  /** Drop the current move without completing it (used when the cube is reset). */
  cancel(): void {
    if (!this.move) return;
    const resolve = this.resolver;
    this.move = null;
    this.resolver = null;
    resolve?.();
  }
}
