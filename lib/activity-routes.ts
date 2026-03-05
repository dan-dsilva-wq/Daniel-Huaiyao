export type ActivityActionType =
  | 'added'
  | 'removed'
  | 'completed'
  | 'uncompleted'
  | 'question_added'
  | 'question_answered'
  | 'place_added'
  | 'place_visited'
  | 'mystery_started'
  | 'mystery_waiting'
  | 'mystery_agreed'
  | 'memory_added'
  | 'gratitude_sent'
  | 'chat_message'
  | 'book_sentence'
  | 'date_added'
  | 'date_removed'
  | 'prompt_answered'
  | 'media_added'
  | 'stratego_new_game'
  | 'stratego_move'
  | 'date_idea_edited'
  | 'event_plan_updated';

export const APP_ROUTE_BY_APP_NAME: Record<string, string> = {
  home: '/',
  chat: '/',
  dates: '/dates',
  quiz: '/quiz',
  map: '/map',
  mystery: '/mystery',
  memories: '/memories',
  gratitude: '/gratitude',
  book: '/book',
  countdown: '/countdown',
  prompts: '/prompts',
  media: '/media',
  stratego: '/stratego',
  hive: '/hive',
  profile: '/profile',
  stats: '/stats',
  'two-truths': '/two-truths',
};

export const ACTION_ROUTE_OVERRIDES: Partial<Record<ActivityActionType, string>> = {
  added: '/dates',
  removed: '/dates',
  completed: '/dates',
  uncompleted: '/dates',
  question_added: '/quiz',
  question_answered: '/quiz',
  place_added: '/map',
  place_visited: '/map',
  mystery_started: '/mystery',
  mystery_waiting: '/mystery',
  mystery_agreed: '/mystery',
  memory_added: '/memories',
  gratitude_sent: '/gratitude',
  chat_message: '/',
  book_sentence: '/book',
  date_added: '/countdown',
  date_removed: '/countdown',
  prompt_answered: '/prompts',
  media_added: '/media',
  stratego_new_game: '/stratego',
  stratego_move: '/stratego',
  date_idea_edited: '/dates',
  event_plan_updated: '/countdown',
};

export function resolveActivityRoute(actionType?: string | null, appName?: string | null): string {
  if (actionType && ACTION_ROUTE_OVERRIDES[actionType as ActivityActionType]) {
    return ACTION_ROUTE_OVERRIDES[actionType as ActivityActionType]!;
  }

  if (appName && APP_ROUTE_BY_APP_NAME[appName]) {
    return APP_ROUTE_BY_APP_NAME[appName];
  }

  return '/';
}
