// Sync manager for processing queued offline actions when back online

import { supabase } from './supabase';
import { offlineStorage } from './offline-storage';

interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: string[];
}

// Action handlers for different action types
type ActionHandler = (payload: unknown) => Promise<void>;

const actionHandlers: Record<string, ActionHandler> = {
  // Quiz actions
  'quiz:answer': async (payload) => {
    const { player, questionId, isCorrect } = payload as {
      player: string;
      questionId: string;
      isCorrect: boolean;
    };
    await supabase.rpc('record_quiz_answer', {
      p_player: player,
      p_question_id: questionId,
      p_is_correct: isCorrect,
    });
  },

  // Gratitude actions
  'gratitude:add': async (payload) => {
    const { fromPlayer, toPlayer, noteText, category, emoji } = payload as {
      fromPlayer: string;
      toPlayer: string;
      noteText: string;
      category?: string;
      emoji?: string;
    };
    await supabase.rpc('add_gratitude_note', {
      p_from_player: fromPlayer,
      p_to_player: toPlayer,
      p_note_text: noteText,
      p_category: category,
      p_emoji: emoji,
    });
  },

  // Memory actions
  'memory:add': async (payload) => {
    const { createdBy, memoryType, title, description, memoryDate, locationName, tags } =
      payload as {
        createdBy: string;
        memoryType: string;
        title: string;
        description?: string;
        memoryDate: string;
        locationName?: string;
        tags?: string[];
      };
    await supabase.rpc('add_memory', {
      p_created_by: createdBy,
      p_memory_type: memoryType,
      p_title: title,
      p_description: description,
      p_memory_date: memoryDate,
      p_location_name: locationName,
      p_tags: tags || [],
    });
  },

  // Prompt response actions
  'prompt:respond': async (payload) => {
    const { dailyPromptId, player, responseText } = payload as {
      dailyPromptId: string;
      player: string;
      responseText: string;
    };
    await supabase.rpc('submit_prompt_response', {
      p_daily_prompt_id: dailyPromptId,
      p_player: player,
      p_response_text: responseText,
    });
  },

  // Media actions
  'media:add': async (payload) => {
    const { mediaType, title, status, addedBy, metadata } = payload as {
      mediaType: string;
      title: string;
      status?: string;
      addedBy: string;
      metadata?: Record<string, unknown>;
    };
    await supabase.rpc('add_media_item', {
      p_media_type: mediaType,
      p_title: title,
      p_status: status,
      p_added_by: addedBy,
      p_metadata: metadata,
    });
  },

  'media:rate': async (payload) => {
    const { mediaId, player, rating, notes } = payload as {
      mediaId: string;
      player: string;
      rating: number;
      notes?: string;
    };
    await supabase.rpc('rate_media_item', {
      p_media_id: mediaId,
      p_player: player,
      p_rating: rating,
      p_notes: notes,
    });
  },

  // Date idea actions
  'date:toggle': async (payload) => {
    const { dateId, field } = payload as { dateId: string; field: string };
    await supabase.rpc('toggle_date_status', {
      p_date_id: dateId,
      p_field: field,
    });
  },
};

// Maximum retry attempts before giving up
const MAX_RETRIES = 3;

export async function syncPendingActions(): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    synced: 0,
    failed: 0,
    errors: [],
  };

  try {
    const pendingActions = await offlineStorage.getPendingActions();

    if (pendingActions.length === 0) {
      return result;
    }

    console.log(`Syncing ${pendingActions.length} pending actions...`);

    for (const action of pendingActions) {
      const handler = actionHandlers[action.type];

      if (!handler) {
        console.warn(`No handler for action type: ${action.type}`);
        result.errors.push(`Unknown action type: ${action.type}`);
        result.failed++;
        continue;
      }

      try {
        await handler(action.payload);
        await offlineStorage.removePendingAction(action.id);
        result.synced++;
        console.log(`Synced action: ${action.type}`);
      } catch (error) {
        console.error(`Failed to sync action ${action.type}:`, error);

        // Update retry count
        await offlineStorage.updatePendingActionRetry(action.id);

        if (action.retryCount >= MAX_RETRIES) {
          // Give up after max retries
          await offlineStorage.removePendingAction(action.id);
          result.errors.push(
            `Failed to sync ${action.type} after ${MAX_RETRIES} retries: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`
          );
        }

        result.failed++;
        result.success = false;
      }
    }
  } catch (error) {
    console.error('Error during sync:', error);
    result.success = false;
    result.errors.push(error instanceof Error ? error.message : 'Unknown sync error');
  }

  return result;
}

// Register a custom action handler
export function registerActionHandler(type: string, handler: ActionHandler): void {
  actionHandlers[type] = handler;
}

// Queue an action for later sync
export async function queueOfflineAction(
  type: string,
  payload: unknown
): Promise<string | null> {
  try {
    const id = await offlineStorage.addPendingAction(type, payload);
    console.log(`Queued offline action: ${type}`);
    return id;
  } catch (error) {
    console.error('Failed to queue offline action:', error);
    return null;
  }
}

// Check if we have pending actions
export async function hasPendingActions(): Promise<boolean> {
  const count = await offlineStorage.getPendingActionCount();
  return count > 0;
}

// Get count of pending actions
export async function getPendingActionCount(): Promise<number> {
  return offlineStorage.getPendingActionCount();
}
