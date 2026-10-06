/**
 * DOM bindings for the control and status panels.
 * Pure view code: no cube logic, no rendering.
 */

import type { CubeStatus } from '../types';

export interface UiCallbacks {
  onScramble: () => void;
  onSolve: () => void;
  onReset: () => void;
  onPause: () => void;
  onSizeChange: (size: number) => void;
  onMovesChange: (count: number) => void;
  onSpeed: (speed: number) => void;
  onDebugToggle: (enabled: boolean) => void;
}

export interface DebugState {
  n: number;
  fps: number;
  moveCount: number;
  mode: string;
  maxTextureSize: number;
  layer: number | null;
  axis: string | null;
  angle: number;
  phase: string;
  solverMode: string;
}

const STATUS_LABEL: Record<CubeStatus, string> = {
  solved: 'Собран',
  scrambling: 'Перемешивание',
  scrambled: 'Перемешан',
  analyzing: 'Анализ',
  solving: 'Сборка',
  paused: 'Пауза',
};

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Не найден элемент интерфейса: ${selector}`);
  return element;
}

export class Ui {
  private readonly sizeRange = required<HTMLInputElement>('#size-range');
  private readonly sizeInput = required<HTMLInputElement>('#size-input');
  private readonly sizeLabel = required<HTMLElement>('#size-label');
  private readonly movesInput = required<HTMLInputElement>('#moves-input');
  private readonly speedGroup = required<HTMLElement>('#speed-group');

  private readonly btnScramble = required<HTMLButtonElement>('#btn-scramble');
  private readonly btnSolve = required<HTMLButtonElement>('#btn-solve');
  private readonly btnReset = required<HTMLButtonElement>('#btn-reset');
  private readonly btnPause = required<HTMLButtonElement>('#btn-pause');
  private readonly btnDebug = required<HTMLButtonElement>('#btn-debug');

  private readonly statusState = required<HTMLElement>('#status-state');
  private readonly statusMove = required<HTMLElement>('#status-move');
  private readonly statusMoves = required<HTMLElement>('#status-moves');
  private readonly statusBar = required<HTMLElement>('#status-bar');
  private readonly statusPercent = required<HTMLElement>('#status-percent');
  private readonly solverMessage = required<HTMLElement>('#solver-message');
  private readonly warningEl = required<HTMLElement>('#warning');
  private readonly debugEl = required<HTMLElement>('#debug');

  private busy = false;
  private paused = false;
  private lastPercent = -1;

  constructor(callbacks: UiCallbacks) {
    this.btnScramble.addEventListener('click', callbacks.onScramble);
    this.btnSolve.addEventListener('click', callbacks.onSolve);
    this.btnReset.addEventListener('click', callbacks.onReset);
    this.btnPause.addEventListener('click', callbacks.onPause);

    const applySize = (raw: string) => {
      const value = Math.floor(Number(raw));
      if (!Number.isFinite(value)) return;
      const min = Number(this.sizeRange.min);
      const max = Number(this.sizeRange.max);
      const clamped = Math.max(min, Math.min(max, value));
      this.sizeRange.value = String(clamped);
      this.sizeInput.value = String(clamped);
      callbacks.onSizeChange(clamped);
    };
    this.sizeRange.addEventListener('change', () => applySize(this.sizeRange.value));
    this.sizeInput.addEventListener('change', () => applySize(this.sizeInput.value));

    this.movesInput.addEventListener('change', () => {
      const value = Math.floor(Number(this.movesInput.value));
      if (!Number.isFinite(value)) return;
      const min = Number(this.movesInput.min);
      const max = Number(this.movesInput.max);
      const clamped = Math.max(min, Math.min(max, value));
      this.movesInput.value = String(clamped);
      callbacks.onMovesChange(clamped);
    });

    this.speedGroup.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('click', () => {
        this.speedGroup.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        button.classList.add('active');
        callbacks.onSpeed(Number(button.dataset.speed ?? '1'));
      });
    });

    this.btnDebug.addEventListener('click', () => {
      const enabled = !this.debugEl.hidden;
      this.setDebugEnabled(enabled);
      this.btnDebug.classList.toggle('active', enabled);
      callbacks.onDebugToggle(enabled);
    });
  }

  // ---------------------------------------------------------------- settings
  setMaxSize(max: number): void {
    this.sizeRange.max = String(max);
    this.sizeInput.max = String(max);
  }

  setSize(size: number, scrambleDefault?: number): void {
    this.sizeRange.value = String(size);
    this.sizeInput.value = String(size);
    this.sizeLabel.textContent = `${size} × ${size} × ${size}`;
    if (scrambleDefault !== undefined) this.movesInput.value = String(scrambleDefault);
  }

  getSize(): number {
    return Math.floor(Number(this.sizeRange.value));
  }

  getMoveCount(): number {
    return Math.floor(Number(this.movesInput.value));
  }

  setMoveCount(count: number): void {
    this.movesInput.value = String(count);
  }

  // ------------------------------------------------------------------ status
  setStatus(status: CubeStatus): void {
    this.statusState.textContent = STATUS_LABEL[status];
    this.statusState.className = `state state-${status}`;
  }

  setCurrentMove(text: string): void {
    this.statusMove.textContent = text;
  }

  setMoveCounter(current: number, total: number): void {
    this.statusMoves.textContent = total > 0 ? `Ход: ${current} / ${total}` : 'Ход: —';
  }

  /** Overall progress of the running sequence, 0..100. */
  setProgress(percent: number): void {
    const rounded = Math.max(0, Math.min(100, Math.round(percent)));
    if (rounded === this.lastPercent) return;
    this.lastPercent = rounded;
    this.statusBar.style.width = `${rounded}%`;
    this.statusPercent.textContent = `${rounded}%`;
  }

  setSolverMessage(text: string): void {
    this.solverMessage.textContent = text;
  }

  setWarning(text: string | null): void {
    this.warningEl.hidden = text === null;
    this.warningEl.textContent = text ?? '';
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.btnScramble.disabled = busy;
    this.btnSolve.disabled = busy;
    this.btnReset.disabled = busy;
    this.sizeRange.disabled = busy;
    this.sizeInput.disabled = busy;
    this.movesInput.disabled = busy;
    this.btnPause.disabled = !busy;
    if (!busy) this.setPaused(false);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.btnPause.textContent = paused ? 'ПРОДОЛЖИТЬ' : 'ПАУЗА';
  }

  isBusy(): boolean {
    return this.busy;
  }

  isPaused(): boolean {
    return this.paused;
  }

  // ------------------------------------------------------------------- debug
  setDebugEnabled(enabled: boolean): void {
    this.debugEl.hidden = !enabled;
  }

  isDebugEnabled(): boolean {
    return !this.debugEl.hidden;
  }

  setDebug(state: DebugState): void {
    const layer = state.layer === null ? '—' : String(state.layer);
    const axis = state.axis ?? '—';
    this.debugEl.textContent = [
      `N ............. ${state.n} (${state.n}³ клеток = ${(state.n ** 3).toLocaleString('ru-RU')})`,
      `FPS ........... ${state.fps.toFixed(0)}`,
      `Ходов в истории ${state.moveCount}`,
      `Режим ......... ${state.mode}`,
      `MAX_TEXTURE_SIZE ${state.maxTextureSize}`,
      `Состояние ..... ${state.phase}`,
      `Solver ........ ${state.solverMode}`,
      `Слой .......... ${layer}`,
      `Ось ........... ${axis}`,
      `Угол .......... ${((state.angle * 180) / Math.PI).toFixed(1)}°`,
    ].join('\n');
  }
}
