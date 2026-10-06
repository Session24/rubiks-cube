/**
 * Main-thread client for the solver Web Worker.
 *
 * Keeps the UI responsive while the worker copies and validates the cube state.
 * If module workers are unavailable the same solver runs inline (still async and
 * still progress reporting) so the app keeps working - `usedWorker` exposes which
 * path was taken for the debug panel.
 */

import { InverseHistorySolver } from '../core/Solver';
import type {
  SolveRequest,
  SolveResponse,
  WorkerMessage,
} from '../core/Solver';
import type { CubeStateData, Move, SolverProgress, SolverResult } from '../types';

interface Pending {
  resolve: (result: SolverResult) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: SolverProgress) => void;
}

export class SolverClient {
  private worker: Worker | null = null;
  private workerBroken = false;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();

  /** true when the last solve ran inside a real Web Worker. */
  public usedWorker = false;

  private ensureWorker(): Worker | null {
    if (this.workerBroken) return null;
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('../worker/solverWorker.ts', import.meta.url), {
        type: 'module',
        name: 'rubik-solver',
      });
      this.worker.addEventListener('message', (event: MessageEvent) => {
        this.handleMessage(event.data as WorkerMessage);
      });
      this.worker.addEventListener('error', (event: ErrorEvent) => {
        this.failAll(new Error(event.message || 'Solver worker error'));
      });
      return this.worker;
    } catch {
      this.workerBroken = true;
      return null;
    }
  }

  private handleMessage(message: WorkerMessage): void {
    const pending = this.pending.get(message.id ?? -1);
    if (!pending) return;

    if (message.type === 'PROGRESS') {
      pending.onProgress?.(message.payload as SolverProgress);
      return;
    }

    if (message.type === 'RESULT') {
      this.pending.delete(message.id ?? -1);
      const payload = message.payload as SolveResponse;
      pending.resolve({
        success: payload.success,
        moves: payload.moves ?? [],
        error: payload.error,
      });
      return;
    }

    if (message.type === 'ERROR') {
      this.pending.delete(message.id ?? -1);
      const payload = message.payload as { error: string };
      pending.resolve({ success: false, moves: [], error: payload.error });
    }
  }

  private failAll(error: Error): void {
    for (const [, pending] of this.pending) pending.reject(error);
    this.pending.clear();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerBroken = true;
  }

  /**
   * Ask the worker to compute and validate a solution for `state`.
   * Resolves with a verified plan - never with an unvalidated one.
   */
  solve(
    state: CubeStateData,
    moveHistory: Move[],
    onProgress?: (progress: SolverProgress) => void,
  ): Promise<SolverResult> {
    const request: SolveRequest = { state, moveHistory };
    const worker = this.ensureWorker();

    if (!worker) {
      this.usedWorker = false;
      return this.solveInline(request, onProgress);
    }

    this.usedWorker = true;
    const id = ++this.sequence;

    return new Promise<SolverResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      try {
        worker.postMessage({ type: 'SOLVE', payload: request, id } satisfies WorkerMessage);
      } catch (error) {
        this.pending.delete(id);
        // structured clone failed (e.g. detached buffers) - fall back to inline
        this.workerBroken = true;
        this.solveInline(request, onProgress).then(resolve, reject);
      }
    });
  }

  /** Fallback path: same algorithm, main thread, still asynchronous. */
  private solveInline(
    request: SolveRequest,
    onProgress?: (progress: SolverProgress) => void,
  ): Promise<SolverResult> {
    const solver = new InverseHistorySolver();
    solver.onProgress = onProgress;
    return solver.solve(request.state, request.moveHistory);
  }

  dispose(): void {
    this.failAll(new Error('Solver client disposed'));
    this.workerBroken = false;
  }
}
