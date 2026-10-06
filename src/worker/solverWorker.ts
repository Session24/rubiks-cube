/**
 * Solver Web Worker.
 *
 * Runs the InverseHistorySolver off the main thread so the UI keeps rendering
 * while a 1000×1000 cube is being copied / validated (millions of stickers).
 *
 * Every computation stage posts a real progress message; nothing is faked or
 * delayed. When the maths really is instant the messages simply arrive at once.
 */

import { InverseHistorySolver } from '../core/Solver';
import type { SolveRequest, SolveResponse, WorkerMessage } from '../core/Solver';
import type { SolverProgress } from '../types';

/** Minimal worker scope typing - avoids mixing the DOM and WebWorker lib types. */
interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

const ctx = self as unknown as WorkerScope;

ctx.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as WorkerMessage;
  if (!message || message.type !== 'SOLVE') return;

  const request = message.payload as SolveRequest;
  const id = message.id;

  const post = (type: WorkerMessage['type'], payload: WorkerMessage['payload']) => {
    ctx.postMessage({ type, payload, id } satisfies WorkerMessage);
  };

  post('PROGRESS', { stage: 'STARTING', progress: 0, message: 'Анализ состояния...' } satisfies SolverProgress);

  const solver = new InverseHistorySolver();
  solver.onProgress = (progress: SolverProgress) => post('PROGRESS', progress);

  solver
    .solve(request.state, request.moveHistory)
    .then((result: SolveResponse) => {
      post('RESULT', result);
    })
    .catch((error: unknown) => {
      post('ERROR', { error: error instanceof Error ? error.message : String(error) });
    });
});
