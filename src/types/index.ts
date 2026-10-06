/**
 * Core type definitions for the Rubik's Cube application
 */

export type Axis = 'X' | 'Y' | 'Z';
export type Direction = 1 | -1;
export type FaceName = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';

export interface Move {
  axis: Axis;
  layer: number;
  direction: Direction;
  notation?: string;
}

export interface CubeStateData {
  faces: {
    U: Uint8Array;
    D: Uint8Array;
    L: Uint8Array;
    R: Uint8Array;
    F: Uint8Array;
    B: Uint8Array;
  };
  size: number;
  moveHistory: Move[];
}

export interface ScrambleConfig {
  moveCount: number;
  avoidSameAxis: boolean;
  avoidInverse: boolean;
}

export type CubeStatus = 
  | 'solved'
  | 'scrambling'
  | 'scrambled'
  | 'analyzing'
  | 'solving'
  | 'paused';

export interface SolverProgress {
  stage: 'STARTING' | 'COPYING_STATE' | 'BUILDING_SOLUTION' | 'VALIDATING' | 'VALIDATION_SUCCESS' | 'VALIDATION_ERROR' | 'READY';
  progress: number;
  message: string;
}

export interface SolverResult {
  moves: Move[];
  success: boolean;
  error?: string;
}

export interface AnimationState {
  isAnimating: boolean;
  currentMove: Move | null;
  startTime: number;
  duration: number;
  progress: number;
  fromAngle: number;
  toAngle: number;
}

export interface CameraState {
  distance: number;
  theta: number;
  phi: number;
  target: { x: number; y: number; z: number };
}

export interface AppConfig {
  size: number;
  maxSize: number;
  scrambleMoves: number;
  animationSpeed: number;
  debugMode: boolean;
}

export const FACE_COLORS = {
  U: 0xFFFFFF, // White
  D: 0xFFFF00, // Yellow
  L: 0xFF8C00, // Orange
  R: 0xFF0000, // Red
  F: 0x00FF00, // Green
  B: 0x0000FF, // Blue
} as const;

export const FACE_COLOR_INDICES: Record<FaceName, number> = {
  U: 0,
  D: 1,
  L: 2,
  R: 3,
  F: 4,
  B: 5,
};

export const COLOR_HEX: number[] = [
  0xFFFFFF, // 0 - White (U)
  0xFFFF00, // 1 - Yellow (D)
  0xFF8C00, // 2 - Orange (L)
  0xFF0000, // 3 - Red (R)
  0x00FF00, // 4 - Green (F)
  0x0000FF, // 5 - Blue (B)
];