/**
 * Application orchestrator: wires the cube state, the renderer, the animator,
 * the solver worker and the UI together.
 *
 * Rules it follows:
 *  - a move is only committed to CubeState once its 90° animation finished;
 *  - only one sequence (scramble or solve) runs at a time;
 *  - the solver is asked for a *validated* plan before anything is animated;
 *  - nothing is ever "solved" by an instant reset.
 */

import { MoveAnimator } from '../anim/MoveAnimator';
import { CubeState } from '../core/CubeState';
import { FACE_NAMES, formatMove } from '../core/geometry';
import { clampScrambleCount, defaultScrambleCount, MAX_SCRAMBLE_MOVES, Scrambler } from '../core/Scramble';
import { CameraRig } from '../render/CameraRig';
import { CubeRenderer } from '../render/CubeRenderer';
import { SolverClient } from '../solver/SolverClient';
import { Ui } from '../ui/Ui';
import type { CubeStatus, Move } from '../types';

const DEFAULT_SIZE = 3;
const ABSOLUTE_MAX_SIZE = 1000;

export class App {
  private readonly container: HTMLElement;
  private readonly renderer: CubeRenderer;
  private readonly rig: CameraRig;
  private readonly animator = new MoveAnimator();
  private readonly solver = new SolverClient();
  private readonly ui: Ui;
  private readonly debugFromQuery: boolean;

  private state: CubeState;
  private phase: CubeStatus = 'solved';
  private busy = false;

  private sequence: Move[] = [];
  private sequenceTotal = 0;
  private sequenceDone = 0;
  private sequenceKind: 'scramble' | 'solve' = 'scramble';

  private lastFrameTime = 0;
  private lastDebugPaint = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fps = 0;
  private currentAngle = 0;
  private solverMode = '—';

  constructor(container: HTMLElement) {
    this.container = container;
    this.debugFromQuery = new URLSearchParams(window.location.search).get('debug') === '1';

    this.renderer = new CubeRenderer(container);
    this.state = new CubeState(DEFAULT_SIZE);
    this.renderer.attachState(this.state);
    this.rig = new CameraRig(this.renderer.camera, this.renderer.renderer.domElement);

    this.ui = new Ui({
      onScramble: () => void this.scramble(),
      onSolve: () => void this.solve(),
      onReset: () => this.reset(),
      onPause: () => this.togglePause(),
      onSizeChange: (size) => this.setSize(size),
      onMovesChange: (count) => this.onMovesChange(count),
      onSpeed: (speed) => {
        this.animator.speed = speed;
      },
      onDebugToggle: (enabled) => {
        if (enabled) this.paintDebug();
      },
    });

    this.animator.setHooks({
      onFrame: (angle) => {
        this.currentAngle = angle;
        this.renderer.setMoveAngle(angle);
      },
      onComplete: (move) => this.commitMove(move),
    });

    const maxAllowed = this.resolveMaxSize();
    this.ui.setMaxSize(maxAllowed);
    this.ui.setSize(DEFAULT_SIZE, defaultScrambleCount(DEFAULT_SIZE));
    if (maxAllowed < ABSOLUTE_MAX_SIZE) {
      this.ui.setWarning(
        `WebGL2 сообщает MAX_TEXTURE_SIZE = ${this.renderer.maxTextureSize}, поэтому размер ограничен N ≤ ${maxAllowed}.`,
      );
    }
    if (this.debugFromQuery) {
      this.ui.setDebugEnabled(true);
      this.btnDebugActive(true);
      // Debug hook: lets the console (or an automated check) inspect and step the
      // app when the tab is hidden and requestAnimationFrame does not fire.
      (window as unknown as { __rubik?: App }).__rubik = this;
    }

    window.addEventListener('resize', this.onResize);
    this.onResize();
    this.fitCamera();
    this.updatePhase('solved');
    this.ui.setSolverMessage('Готово. Нажмите «ПЕРЕМЕШАТЬ».');

    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ helpers
  private resolveMaxSize(): number {
    const textureLimit = this.renderer.maxTextureSize;
    if (!textureLimit || textureLimit < ABSOLUTE_MAX_SIZE) {
      return Math.max(2, Math.min(ABSOLUTE_MAX_SIZE, textureLimit || ABSOLUTE_MAX_SIZE));
    }
    return ABSOLUTE_MAX_SIZE;
  }

  private btnDebugActive(active: boolean): void {
    document.querySelector('#btn-debug')?.classList.toggle('active', active);
  }

  private updatePhase(phase: CubeStatus): void {
    this.phase = phase;
    const status: CubeStatus = this.busy && this.animator.paused ? 'paused' : phase;
    this.ui.setStatus(status);
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.ui.setBusy(busy);
    if (!busy) {
      this.animator.paused = false;
      this.ui.setPaused(false);
    }
    this.updatePhase(this.phase);
  }

  private isBusy(): boolean {
    return this.busy || this.animator.isAnimating;
  }

  private onMovesChange(count: number): void {
    const clamped = Math.max(1, Math.min(MAX_SCRAMBLE_MOVES, count));
    this.ui.setMoveCount(clamped);
  }

  // -------------------------------------------------------------- cube sizes
  private setSize(size: number): void {
    if (this.isBusy()) return;
    if (size === this.state.size) return;

    this.state = new CubeState(size);
    this.renderer.attachState(this.state);
    this.ui.setSize(size, defaultScrambleCount(size));
    this.sequence = [];
    this.sequenceTotal = 0;
    this.sequenceDone = 0;
    this.ui.setMoveCounter(0, 0);
    this.ui.setCurrentMove('—');
    this.ui.setProgress(0);
    this.ui.setWarning(null);
    this.ui.setSolverMessage(`Новый кубик ${size} × ${size} × ${size}`);
    this.fitCamera();
    this.updatePhase('solved');
  }

  private fitCamera(): void {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.rig.fit(this.state.size, width / Math.max(height, 1));
  }

  private onResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.renderer.resize(width, height);
    this.rig.fit(this.state.size, width / Math.max(height, 1));
  };

  // ------------------------------------------------------------- animation
  /** Register the visual side of a move; the promise resolves at exactly 90°. */
  private animateMove(move: Move): Promise<void> {
    this.renderer.beginMove(move);
    return this.animator.start(move);
  }

  /** The single place where the maths is committed to the cube state. */
  private commitMove(move: Move): void {
    this.state.applyMove(move);
    this.renderer.commitMove(move);
  }

  private async playSequence(moves: Move[], kind: 'scramble' | 'solve'): Promise<void> {
    this.sequence = moves;
    this.sequenceKind = kind;
    this.sequenceTotal = moves.length;
    this.sequenceDone = 0;
    this.ui.setMoveCounter(0, moves.length);

    for (const move of moves) {
      this.ui.setMoveCounter(this.sequenceDone + 1, this.sequenceTotal);
      this.ui.setCurrentMove(formatMove(move));
      await this.animateMove(move);
      this.sequenceDone++;
      this.updateSequenceProgress();
    }
  }

  private updateSequenceProgress(): void {
    if (this.sequenceTotal <= 0) return;
    const partial = this.animator.isAnimating ? this.animator.progress : 0;
    const percent = ((this.sequenceDone + partial) / this.sequenceTotal) * 100;
    this.ui.setProgress(percent);
  }

  private finishSequence(): void {
    const solved = this.state.isSolved();
    this.sequence = [];
    this.sequenceTotal = 0;
    this.sequenceDone = 0;
    this.ui.setMoveCounter(0, 0);
    this.ui.setCurrentMove('—');
    this.ui.setProgress(100);

    if (this.sequenceKind === 'solve') {
      if (solved) {
        // the cube really is solved - the history no longer describes anything
        this.state.moveHistory = [];
        this.ui.setSolverMessage('Кубик собран.');
      } else {
        this.ui.setSolverMessage('Последовательность не сошлась — состояние проверено повторно');
      }
    } else {
      this.ui.setSolverMessage(solved ? 'Кубик остался собранным' : 'Перемешан');
    }

    this.setBusy(false);
    this.updatePhase(solved ? 'solved' : 'scrambled');
  }

  // ------------------------------------------------------------- sequences
  private async scramble(): Promise<void> {
    if (this.isBusy()) return;
    this.ui.setWarning(null);
    this.setBusy(true);
    this.updatePhase('scrambling');

    const size = this.state.size;
    const count = clampScrambleCount(this.ui.getMoveCount(), size);
    this.ui.setMoveCount(count);
    this.ui.setProgress(0);
    this.ui.setSolverMessage(`Перемешивание: ${count} ходов...`);

    // Generate scramble moves
    const moves = new Scrambler({ moveCount: count }).generate(size);
    
    // Apply all moves instantly to state (no animation)
    this.state.applyMoves(moves);
    
    // Update renderer to reflect new state
    this.renderer.refreshFaces(FACE_NAMES);
    this.renderer.endMove();
    
    // Update UI immediately
    this.ui.setMoveCounter(0, 0);
    this.ui.setCurrentMove('—');
    this.ui.setProgress(100);
    this.ui.setSolverMessage(`Перемешивание завершено. Ходов: ${moves.length}`);
    
    this.setBusy(false);
    this.updatePhase('scrambled');
  }

  private async solve(): Promise<void> {
    if (this.isBusy()) return;
    if (this.state.isSolved()) {
      this.ui.setSolverMessage('Кубик уже собран — вычислять нечего.');
      this.updatePhase('solved');
      return;
    }

    this.ui.setWarning(null);
    this.setBusy(true);
    this.updatePhase('analyzing');
    this.ui.setProgress(0);
    this.ui.setSolverMessage('Анализ состояния...');

    let moves: Move[];
    try {
      const result = await this.solver.solve(
        this.state.serialize(),
        [...this.state.moveHistory],
        (progress) => {
          this.ui.setSolverMessage(progress.message);
          this.ui.setProgress(progress.progress);
        },
      );
      this.solverMode = this.solver.usedWorker ? 'Web Worker' : 'inline (worker недоступен)';

      if (!result.success) {
        this.ui.setWarning(result.error ?? 'Решение не найдено');
        this.ui.setSolverMessage('Решение отклонено: проверка не пройдена');
        this.setBusy(false);
        this.updatePhase('scrambled');
        return;
      }
      moves = result.moves;
    } catch (error) {
      this.ui.setWarning(error instanceof Error ? error.message : String(error));
      this.ui.setSolverMessage('Ошибка вычисления решения');
      this.setBusy(false);
      this.updatePhase('scrambled');
      return;
    }

    this.ui.setSolverMessage(`Решение подтверждено · ходов: ${moves.length}`);
    this.updatePhase('solving');
    await this.playSequence(moves, 'solve');
    this.finishSequence();
  }

  private reset(): void {
    if (this.isBusy()) return;
    this.state.reset();
    this.renderer.refreshFaces(FACE_NAMES);
    this.renderer.endMove();
    this.sequence = [];
    this.sequenceTotal = 0;
    this.sequenceDone = 0;
    this.ui.setMoveCounter(0, 0);
    this.ui.setCurrentMove('—');
    this.ui.setProgress(0);
    this.ui.setWarning(null);
    this.ui.setSolverMessage('Состояние сброшено');
    this.updatePhase('solved');
  }

  private togglePause(): void {
    if (!this.busy) return;
    this.animator.paused = !this.animator.paused;
    this.ui.setPaused(this.animator.paused);
    this.updatePhase(this.phase);
  }

  // -------------------------------------------------------------- main loop
  private frame = (time: number): void => {
    requestAnimationFrame(this.frame);

    const dt = this.lastFrameTime === 0 ? 0 : time - this.lastFrameTime;
    this.lastFrameTime = time;
    this.tick(dt);

    if (dt > 0) {
      this.fpsAccum += dt;
      this.fpsFrames++;
      if (this.fpsAccum >= 500) {
        this.fps = (this.fpsFrames * 1000) / this.fpsAccum;
        this.fpsAccum = 0;
        this.fpsFrames = 0;
      }
    }

    if (this.ui.isDebugEnabled() && time - this.lastDebugPaint > 250) {
      this.lastDebugPaint = time;
      this.paintDebug();
    }
  };

  /** One animation + render tick. Also used by the debug hook when RAF is paused. */
  private tick(dt: number): void {
    this.animator.update(dt);
    this.rig.update();
    this.renderer.render();
    if (this.sequenceTotal > 0) this.updateSequenceProgress();
  }

  /**
   * Debug-only: advance one frame by hand. Returns true while an animation is
   * running, so a caller can drive a whole sequence without requestAnimationFrame.
   */
  public step(dt: number): boolean {
    this.tick(dt);
    if (this.ui.isDebugEnabled()) this.paintDebug();
    return this.animator.isAnimating;
  }

  private paintDebug(): void {
    const active = this.animator.active;
    const info = this.renderer.debugInfo;
    this.ui.setDebug({
      n: this.state.size,
      fps: this.fps,
      moveCount: this.state.moveHistory.length,
      mode: info.mode,
      maxTextureSize: info.maxTextureSize,
      layer: active ? active.layer : null,
      axis: active ? active.axis : null,
      angle: this.currentAngle,
      phase: this.phase,
      solverMode: this.solverMode,
    });
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.solver.dispose();
    this.rig.dispose();
    this.renderer.dispose();
  }
}
