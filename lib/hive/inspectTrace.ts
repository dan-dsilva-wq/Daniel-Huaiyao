import type { GameState, PlayerColor } from './types';
import type { HiveComputerDifficulty, HiveSearchEngine } from './ai';

export interface HiveInspectTracePly {
  ply: number;
  turn: number;
  color: PlayerColor;
  player: 'candidate' | 'champion';
  mode: 'opening_random' | 'search';
  legalMoves: number;
  moveLabel: string;
  stateAfter: GameState;
  whiteQueenPressure: number;
  blackQueenPressure: number;
  stats: {
    simulations: number;
    nodesPerSecond: number;
    averageSimulationDepth: number;
    policyEntropy: number;
    rootValue: number;
  } | null;
}

export interface HiveInspectTrace {
  createdAt: string;
  seed: number;
  candidateColor: PlayerColor;
  candidateModelPath: string;
  championModelPath: string;
  difficulty: HiveComputerDifficulty;
  engine: HiveSearchEngine;
  simulations: number | null;
  maxTurns: number;
  noCaptureDrawMoves: number;
  openingRandomPlies: number;
  winner: PlayerColor | 'draw' | null;
  candidateResult: 'win' | 'loss' | 'draw';
  finalTurn: number;
  plies: HiveInspectTracePly[];
}
