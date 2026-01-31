import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key');

export interface DateIdea {
  id: string;
  category_id: string;
  title: string;
  description: string | null;
  emoji: string | null;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  emoji: string;
  sort_order: number;
  created_at: string;
}

export interface NotificationLog {
  id: string;
  last_sent: string;
}

// Mystery Files types
export type Player = 'daniel' | 'huaiyao';

export interface MysteryEpisode {
  id: string;
  episode_number: number;
  title: string;
  description: string | null;
  is_available: boolean;
}

export interface MysteryScene {
  id: string;
  episode_id: string;
  scene_order: number;
  title: string | null;
  narrative_text: string;
  is_decision_point: boolean;
  is_ending: boolean;
  ending_type: 'good' | 'neutral' | 'bad' | null;
}

export interface MysteryChoice {
  id: string;
  scene_id: string;
  choice_order: number;
  choice_text: string;
  next_scene_id: string | null;
}

export interface MysterySession {
  id: string;
  episode_id: string;
  current_scene_id: string;
  status: 'waiting' | 'active' | 'completed';
  daniel_joined: boolean;
  huaiyao_joined: boolean;
  daniel_last_seen: string | null;
  huaiyao_last_seen: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface MysteryVote {
  player: Player;
  choice_id: string;
}

export interface MysteryGameState {
  session: MysterySession;
  episode: {
    id: string;
    title: string;
    episode_number: number;
  };
  scene: MysteryScene;
  choices: MysteryChoice[];
  votes: MysteryVote[];
  puzzle?: MysteryPuzzle | null;
}

// Puzzle Types
export type PuzzleType = 'cryptography' | 'number_theory' | 'logic' | 'geometry' | 'sequence' | 'research' | 'minigame';
export type PuzzleAnswerType = 'exact' | 'numeric' | 'multiple_choice' | 'set';
export type PuzzleStatus = 'pending' | 'agreed' | 'disagreed' | 'solved' | 'failed';

export interface MysteryPuzzle {
  id: string;
  puzzle_type: PuzzleType;
  difficulty: number;
  title: string;
  description: string;
  puzzle_data: PuzzleData;
  answer_type: PuzzleAnswerType;
  max_hints: number;
  is_blocking: boolean;
  time_limit_seconds?: number | null;
}

// Puzzle data structures for different puzzle types
export interface PuzzleData {
  // Number theory
  equations?: string[];
  note?: string;
  // Cryptography
  ciphertext?: string;
  context?: string;
  cipher_type?: string;
  // Logic
  statements?: string[];
  rules?: string[];
  question?: string;
  // Geometry
  figure_description?: string;
  measurements?: Record<string, number>;
  // Sequence
  sequence?: number[];
  find?: string;
  // Research
  clue?: string;
  sources_hint?: string;
  // Mini-game
  game_type?: string;
  game_config?: Record<string, unknown>;
  // Generic
  [key: string]: unknown;
}

export interface PuzzleAnswerState {
  status: PuzzleStatus;
  hints_revealed: number;
  daniel_submitted: boolean;
  huaiyao_submitted: boolean;
  my_submitted?: boolean;
  partner_submitted?: boolean;
  solved_at?: string | null;
}

export interface PuzzleWithState extends MysteryPuzzle {
  answer_state: PuzzleAnswerState;
  hints: {
    hints: string[];
    hints_revealed: number;
    max_hints: number;
  };
}

export interface PuzzleSubmitResult {
  status: 'solved' | 'wrong' | 'disagreed' | 'waiting' | 'error';
  is_correct: boolean;
  agreed: boolean;
  message: string;
}

export interface HintResult {
  success: boolean;
  hint?: string;
  hint_number?: number;
  hints_revealed: number;
  max_hints: number;
  message?: string;
}

export interface MinigameState {
  game_state: Record<string, unknown>;
  my_state: Record<string, unknown>;
  partner_ready?: boolean;
  last_action_by?: Player;
  last_action_at?: string;
}
