import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Check if Supabase is configured
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Create client (may be non-functional if not configured)
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key');

// Types for our database
export type Writer = 'daniel' | 'huaiyao';

export interface Sentence {
  id: string;
  content: string;
  writer: Writer;
  page_number: number;
  created_at: string;
}

export interface BookSettings {
  id: string;
  title: string;
  created_at: string;
}

// Helper to get the other writer
export function getOtherWriter(writer: Writer): Writer {
  return writer === 'daniel' ? 'huaiyao' : 'daniel';
}

// Format writer name for display
export function formatWriterName(writer: Writer): string {
  return writer === 'daniel' ? 'Daniel' : 'Huaiyao';
}
