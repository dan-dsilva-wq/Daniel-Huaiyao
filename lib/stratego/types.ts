export type Player = 'daniel' | 'huaiyao' | 'computer';
export type TeamColor = 'red' | 'blue';
export type GameStatus = 'setup' | 'playing' | 'finished';
export type WinReason = 'flag_captured' | 'no_moves' | 'resignation';
export type CombatResult = 'attacker_wins' | 'defender_wins' | 'both_die';

// Piece ranks (numeric for combat comparison)
// 0=Flag, 1=Spy, 2=Scout, 3=Miner, 4=Sergeant, 5=Lieutenant,
// 6=Captain, 7=Major, 8=Colonel, 9=General, 10=Marshal, 11=Bomb
export type PieceRank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface Piece {
  id: string;
  rank: PieceRank;
  row: number;
  col: number;
  revealed: boolean;
}

// Opponent piece with hidden rank (-1 means unknown)
export interface OpponentPiece {
  id: string;
  rank: PieceRank | -1;
  row: number;
  col: number;
  revealed: boolean;
}

export interface MoveHistoryEntry {
  turn: number;
  color: TeamColor;
  piece_id: string;
  from_row: number;
  from_col: number;
  to_row: number;
  to_col: number;
  combat_result: CombatResult | null;
  attacker_rank: PieceRank;
  defender_rank: PieceRank | null;
}

export interface GameState {
  id: string;
  status: GameStatus;
  player_red: Player;
  player_blue: Player;
  my_color: TeamColor;
  current_turn: TeamColor;
  turn_number: number;
  red_setup_done: boolean;
  blue_setup_done: boolean;
  my_pieces: Piece[];
  opponent_pieces: OpponentPiece[];
  red_captured: Piece[];
  blue_captured: Piece[];
  move_history: MoveHistoryEntry[];
  winner: TeamColor | null;
  win_reason: WinReason | null;
  created_at: string;
  updated_at: string;
}

export interface MoveResult {
  success?: boolean;
  error?: string;
  combat_result: CombatResult | null;
  attacker_rank: PieceRank | null;
  defender_rank: PieceRank | null;
  game_over: boolean;
  winner: TeamColor | null;
  win_reason: WinReason | null;
}

export interface CombatAnimationData {
  attacker_rank: PieceRank;
  defender_rank: PieceRank;
  result: CombatResult;
  attacker_color: TeamColor;
}

export interface GameRecord {
  id: string;
  player_red: Player;
  player_blue: Player;
  winner: TeamColor | null;
  win_reason: WinReason | null;
  turn_number: number;
  created_at: string;
}
