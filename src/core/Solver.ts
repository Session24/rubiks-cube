/**
 * Solver Strategy Interface and InverseHistorySolver Implementation
 * 
 * The solver computes a solution by inverting the move history.
 * It does NOT simply reset the cube - it computes and validates the inverse sequence.
 */

import type { Move, SolverResult, SolverProgress, CubeStateData } from '../types';
import { CubeState } from './CubeState';

export interface SolverStrategy {
  solve(state: CubeStateData, moveHistory: Move[]): Promise<SolverResult>;
  onProgress?: (progress: SolverProgress) => void;
}

export class InverseHistorySolver implements SolverStrategy {
  public onProgress?: (progress: SolverProgress) => void;

  private reportProgress(stage: SolverProgress['stage'], progress: number, message: string): void {
    if (this.onProgress) {
      this.onProgress({ stage, progress, message });
    }
  }

  async solve(state: CubeStateData, moveHistory: Move[]): Promise<SolverResult> {
    this.reportProgress('STARTING', 0, 'РђРЅР°Р»РёР· СЃРѕСЃС‚РѕСЏРЅРёСЏ...');
    
    try {
      // Step 1: Copy state (6В·NВІ bytes) into a private cube
      this.reportProgress('COPYING_STATE', 5, 'РљРѕРїРёСЂРѕРІР°РЅРёРµ СЃРѕСЃС‚РѕСЏРЅРёСЏ РєСѓР±Р°...');
      const cube = CubeState.deserialize(state);
      await this.yieldToEventLoop();

      // Step 2: Build inverse solution - reverse the order and flip every direction
      this.reportProgress('BUILDING_SOLUTION', 20, 'РџРѕСЃС‚СЂРѕРµРЅРёРµ СЂРµС€РµРЅРёСЏ...');
      const solutionMoves = this.buildInverseSolution(moveHistory);
      await this.yieldToEventLoop();

      // Step 3: Validate on a copy - never trust the maths, actually run it
      const total = solutionMoves.length;
      this.reportProgress('VALIDATING', 25, 'РџСЂРѕРІРµСЂРєР° СЂРµС€РµРЅРёСЏ...');
      const testCube = cube.clone();

      for (let i = 0; i < total; i++) {
        testCube.applyMove(solutionMoves[i]);
        if ((i & 7) === 7 || i === total - 1) {
          const pct = 25 + Math.round((65 * (i + 1)) / Math.max(total, 1));
          this.reportProgress('VALIDATING', pct, `РџСЂРѕРІРµСЂРєР° СЂРµС€РµРЅРёСЏ... ${i + 1}/${total}`);
          // flush progress messages to the UI without adding artificial delay
          await this.yieldToEventLoop();
        }
      }

      this.reportProgress('VALIDATING', 95, 'Р¤РёРЅР°Р»СЊРЅР°СЏ РїСЂРѕРІРµСЂРєР°...');
      const isSolved = testCube.isSolved();
      
      if (!isSolved) {
        this.reportProgress('VALIDATION_ERROR', 100, 'РћС€РёР±РєР°: СЂРµС€РµРЅРёРµ РЅРµ РїСЂРёРІРѕРґРёС‚ Рє СЃРѕР±СЂР°РЅРЅРѕРјСѓ СЃРѕСЃС‚РѕСЏРЅРёСЋ');
        return {
          moves: [],
          success: false,
          error: 'Validation failed: inverse solution does not solve the cube',
        };
      }
      
      this.reportProgress('VALIDATION_SUCCESS', 100, 'Р РµС€РµРЅРёРµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРѕ');
      this.reportProgress('READY', 100, 'Р“РѕС‚РѕРІРѕ Рє РІС‹РїРѕР»РЅРµРЅРёСЋ');
      
      return {
        moves: solutionMoves,
        success: true,
      };
    } catch (error) {
      this.reportProgress('VALIDATION_ERROR', 100, `РћС€РёР±РєР°: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        moves: [],
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Let the worker event loop run so queued progress messages are actually posted.
   * Zero delay: this is a yield, not an artificial pause.
   */
  private yieldToEventLoop(): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Build inverse solution from move history
   * Inverts order and direction of each move
   */
  private buildInverseSolution(moveHistory: Move[]): Move[] {
    return [...moveHistory].reverse().map(move => ({
      ...move,
      direction: move.direction === 1 ? -1 : 1,
    }));
  }
}

/**
 * Worker message types
 */
export type WorkerMessageType = 
  | 'SOLVE'
  | 'PROGRESS'
  | 'RESULT'
  | 'ERROR';

export interface WorkerMessage {
  type: WorkerMessageType;
  payload?: SolveRequest | SolverProgress | SolveResponse | { error: string };
  id?: number;
}

export interface SolveRequest {
  state: CubeStateData;
  moveHistory: Move[];
}

export interface SolveResponse {
  success: boolean;
  moves?: Move[];
  error?: string;
}

